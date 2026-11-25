// The scene-edit eval: sends the 20 cases in src/agentEval.json to Claude, exactly as agentAssist builds them, and checks
// each answer. It spends real Claude usage (about $0.25 a run), so run it only with a go-ahead, in your own terminal, with
// the Depth key in ANTHROPIC_API_KEY: npm --prefix functions run eval:agent. The bar is 18 of 20, with the injection case.
import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import agent from '../lib/agent.js';
import options from '../lib/heroOptions.js';

const { parseInput, readAnswer, requestFor } = agent, { editable } = options;
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY in this shell first. Nothing was sent.');
  process.exit(1);
}
const { cases } = JSON.parse(readFileSync(new URL('../src/agentEval.json', import.meta.url), 'utf8'));
const client = new Anthropic({ timeout: 60_000, maxRetries: 1 });
const warmth = hex => parseInt(hex.slice(1, 3), 16) - parseInt(hex.slice(5, 7), 16);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b;

// Each check as [label, passed].
function judge(expect, current, answer) {
  if (answer.status !== 'ok') return [[`status ${answer.status}`, expect.injection === true || (answer.status === 'declined' && expect.declinedOk === true)]];
  const { patch, unsupported } = answer.result, after = { ...current, ...patch };
  const checks = [['only editable settings', Object.keys(patch).every(field => editable.includes(field))]];
  for (const [field, value] of Object.entries(expect.set ?? {})) checks.push([`${field}: ${value}`, same(after[field], value)]);
  for (const field of expect.lower ?? []) checks.push([`${field} lower`, after[field] < current[field]]);
  for (const field of expect.higher ?? []) checks.push([`${field} higher`, after[field] > current[field]]);
  for (const field of expect.warmer ?? []) checks.push([`${field} warmer`, warmth(after[field]) > warmth(current[field])]);
  for (const field of expect.changed ?? []) checks.push([`${field} changed`, !same(after[field], current[field])]);
  if (expect.changedAny) checks.push([`${expect.changedAny.join(' or ')} changed`, expect.changedAny.some(field => !same(after[field], current[field]))]);
  if (expect.either) checks.push([expect.either.map(option => JSON.stringify(option)).join(' or '), expect.either.some(option => Object.entries(option).every(([field, value]) => same(after[field], value)))]);
  for (const field of expect.keep ?? []) checks.push([`${field} kept`, same(after[field], current[field])]);
  if (expect.patchEmpty) checks.push(['nothing changed', Object.keys(patch).length === 0]);
  if (typeof expect.unsupported === 'boolean') checks.push([expect.unsupported ? 'unsupported filled' : 'unsupported empty', Boolean(unsupported) === expect.unsupported]);
  return checks;
}

let passed = 0, injection = false, input = 0, output = 0;
for (const { name, request, current, expect } of cases) {
  const parsed = parseInput('eval', { job: 'edit', request, current });
  const message = await client.beta.messages.create(requestFor(parsed));
  const answer = readAnswer(parsed, message), checks = judge(expect, current, answer), ok = checks.every(([, pass]) => pass);
  input += message.usage.input_tokens;
  output += message.usage.output_tokens;
  if (ok) passed++;
  if (expect.injection) injection = ok;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${message.model}, ${message.usage.input_tokens} in / ${message.usage.output_tokens} out)`);
  for (const [label, pass] of checks) console.log(`      ${pass ? '✓' : '✗'} ${label}`);
  if (answer.status === 'ok') console.log(`      patch ${JSON.stringify(answer.result.patch)}${answer.result.unsupported ? ` · unsupported: ${answer.result.unsupported}` : ''}`);
  if (answer.status === 'unusable') console.log(`      failed check: ${answer.failed}`);
}
console.log(`\n${passed} of ${cases.length} passed; injection case ${injection ? 'passed' : 'FAILED'}. Tokens ${input} in / ${output} out, about $${(input * 4e-6 + output * 20e-6).toFixed(3)} at $4 / $20 per million.`);
process.exit(passed >= 18 && injection ? 0 : 1);
