import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import type { CallableRequest } from 'firebase-functions/https';
import sharp from 'sharp';
import { JOB_PROMPTS, schemas } from './agent';
import { utcDay } from './jobs';
import { agentAssist } from './index';

// Run with `npm run test:emulator`, beside heroes.emulator.ts and generation.emulator.ts. Claude's Messages API is faked
// inside this process and any other fetch fails the run, so these tests can't reach Claude. The key is a dummy.
before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST && process.env.GCLOUD_PROJECT?.startsWith('demo-'), 'Run this through npm run test:emulator.');
});
const ANTHROPIC = 'https://anthropic.invalid', KEY = 'test-anthropic-key';
Object.assign(process.env, { ANTHROPIC_BASE_URL: ANTHROPIC, ANTHROPIC_API_KEY: KEY });

type ClaudeCall = {url: URL; headers: Headers; body: Record<string, any>};
const calls: ClaudeCall[] = [], leaks: string[] = [];
// A test can answer a Claude call itself; returning nothing leaves it to the fake.
let answer: ((call: ClaudeCall) => Response | undefined | Promise<Response | undefined>) | undefined;
beforeEach(() => { answer = undefined; });
after(() => assert.deepEqual(leaks, [], 'every fetch went to the fake Claude'));

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'request-id': 'req_test', ...headers } });
// A Messages API reply: the empty thinking block Opus 5.5 returns by default, then the answer as text.
const reply = (text: unknown, { stop_reason = 'end_turn', model = 'claude-opus-5-5', before: extra = [] as object[] } = {}) => json({
  id: 'msg_test', type: 'message', role: 'assistant', model, container: null, context_management: null, diagnostics: null, stop_sequence: null, stop_reason,
  stop_details: stop_reason === 'refusal' ? { type: 'refusal', category: null, explanation: null } : null,
  content: [{ type: 'thinking', thinking: '', signature: 'sig' }, ...extra, { type: 'text', text: typeof text === 'string' ? text : JSON.stringify(text) }],
  usage: { input_tokens: 612, output_tokens: 345, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});
const answers = {
  polish: { prompt: 'A small brass robot with riveted joints, stylised.', note: 'Added materials and style.' },
  template: { template: 'Quiet Space', reason: 'A crafted object.' },
  edit: { changes: [{ field: 'speed', value: 0.5 }, { field: 'lightingColor', value: '#FFC98A' }], summary: 'Slower float with a warm amber light.', unsupported: '' },
  copy: { ideas: [{ headline: 'Built for\nthe long run', buttonLabel: 'Shop now' }, { headline: 'Small robot, big ideas', buttonLabel: 'Meet it' }, { headline: 'Brass, made to move', buttonLabel: 'Explore' }] },
};
const jobOf = (body: Record<string, any>) => (Object.keys(JOB_PROMPTS) as (keyof typeof answers)[]).find(job => String(body.system).endsWith(JOB_PROMPTS[job]))!;

mock.method(globalThis, 'fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(input instanceof Request ? input.url : input), method = init.method ?? 'GET';
  if (url.origin !== ANTHROPIC || url.pathname !== '/v1/messages' || method !== 'POST') {
    leaks.push(`${method} ${url.href}`);
    throw new Error(`Unexpected fetch: ${method} ${url.href}`);
  }
  const call = { url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) };
  calls.push(call);
  return (await answer?.(call)) ?? reply(answers[jobOf(call.body)]);
});

const db = () => getFirestore(), bucket = () => getStorage().bucket();
const DAY = 24 * 60 * 60_000;
const today = () => utcDay(new Date()), month = () => today().slice(0, 7);
type Who = {uid: string; email: string; auth: unknown};

// Not `person` or `maker`, which the other emulator files use against the same emulators.
let askers = 0;
async function asker({ allowed = true } = {}): Promise<Who> {
  const uid = `asker${++askers}`, email = `${uid}@example.test`;
  if (allowed) await db().doc(`allowedUsers/${email}`).set({ enabled: true });
  return { uid, email, auth: { uid, token: { email, email_verified: true, firebase: { sign_in_provider: 'google.com' } } } };
}

type Result = {status: string; result?: any; left: number};
const ask = (who: Who, data: unknown) => agentAssist.run({ auth: who.auth, data, app: { appId: 'app', token: {}, alreadyConsumed: false } } as unknown as CallableRequest) as Promise<Result>;
const current = {
  motion: 'Float', speed: 0.8, amount: 42, direction: 'Auto', camera: 'Static', lighting: 'Soft', lightingColor: '#ffffff',
  background: 'Template', backgroundColor: '#ffffff', template: 'Studio Glow', material: 'Original', color: '#9e8265', secondColor: '#fcffbc',
};
const inputs = {
  polish: { job: 'polish', idea: 'a small brass robot' },
  template: { job: 'template', idea: 'a small brass robot' },
  edit: { job: 'edit', request: 'Float slower, warmer light', current },
  copy: { job: 'copy', idea: 'a small brass robot', direction: '', template: 'Studio Glow', layout: 'Object Right', current: { eyebrow: 'Made with Meshy', headline: 'Design that\nmoves you.', subtitle: '', buttonLabel: 'Explore Collection' } },
};

const user = async (uid: string) => (await db().doc(`users/${uid}`).get()).data();
// usage/{month} is app-wide, so tests compare its change across a step, never its value.
const agentCalls = async () => (await db().doc(`usage/${month()}`).get()).get('agentCalls') ?? 0;
async function counted(step: () => Promise<unknown>) {
  const was = await agentCalls(), mark = calls.length;
  await step();
  return { agentCalls: await agentCalls() - was, claudeCalls: calls.length - mark };
}

test('each job sends its request to Claude, counts one call and returns its checked answer with the calls left today', async () => {
  const who = await asker();
  const expected = {
    polish: { effort: 'medium', max: 4096, result: answers.polish },
    template: { effort: 'low', max: 2048, result: answers.template },
    edit: { effort: 'low', max: 2048, result: { patch: { speed: 0.5, lightingColor: '#ffc98a' }, summary: 'Slower float with a warm amber light.', unsupported: '' } },
    copy: { effort: 'low', max: 2048, result: answers.copy },
  };
  let left = 30;
  for (const [job, { effort, max, result }] of Object.entries(expected) as [keyof typeof inputs, typeof expected.polish][]) {
    let got: Result | undefined;
    assert.deepEqual(await counted(async () => { got = await ask(who, inputs[job]); }), { agentCalls: 1, claudeCalls: 1 }, job);
    assert.deepEqual(got, { status: 'ok', result, left: --left }, job);
    const { headers, body } = calls.at(-1)!;
    assert.deepEqual(Object.keys(body).sort(), ['fallbacks', 'max_tokens', 'messages', 'model', 'output_config', 'system'], job);
    assert.deepEqual([body.model, body.max_tokens, body.output_config, body.fallbacks], ['claude-opus-5-5', max, { effort, format: { type: 'json_schema', schema: schemas[job] } }, 'default'], job);
    assert.equal(body.thinking ?? body.tools, undefined, job);
    // SDK 1.x sends the key as a bearer token.
    assert.equal(headers.get('authorization'), `Bearer ${KEY}`, job);
    assert.ok(headers.get('anthropic-beta')?.split(',').map(beta => beta.trim()).includes('server-side-fallback-2026-07-01'), job);
  }
  assert.deepEqual(await user(who.uid), { agentDay: today(), agentCount: 4 });
});

test('the 30th call of a UTC day works and the 31st is refused before Claude; a count from an earlier day starts over', async () => {
  const who = await asker();
  await db().doc(`users/${who.uid}`).set({ agentDay: today(), agentCount: 29 });
  assert.deepEqual(await counted(async () => assert.equal((await ask(who, inputs.polish)).left, 0)), { agentCalls: 1, claudeCalls: 1 });
  assert.deepEqual(await counted(() => assert.rejects(ask(who, inputs.polish), (error: {code: string; details: unknown; message: string}) => {
    assert.deepEqual([error.code, error.details], ['resource-exhausted', { cap: 'daily' }]);
    assert.match(error.message, /30 Agent Mode requests/);
    return true;
  })), { agentCalls: 0, claudeCalls: 0 });
  assert.deepEqual(await user(who.uid), { agentDay: today(), agentCount: 30 });
  await db().doc(`users/${who.uid}`).update({ agentDay: utcDay(new Date(Date.now() - DAY)) });
  assert.equal((await ask(who, inputs.polish)).left, 29);
  assert.deepEqual(await user(who.uid), { agentDay: today(), agentCount: 1 });
});

test('the 400th call of the month works and the 401st is refused before Claude', async () => {
  const who = await asker(), usageRef = db().doc(`usage/${month()}`);
  // Raise the app-wide count to 399 and put it back after.
  const raise = 399 - await agentCalls();
  await usageRef.set({ agentCalls: FieldValue.increment(raise) }, { merge: true });
  try {
    assert.deepEqual(await counted(() => ask(who, inputs.polish)), { agentCalls: 1, claudeCalls: 1 });
    assert.deepEqual(await counted(() => assert.rejects(ask(who, inputs.polish), { code: 'resource-exhausted', details: { cap: 'monthly' }, message: /limit for this month/ })), { agentCalls: 0, claudeCalls: 0 });
  } finally {
    await usageRef.update({ agentCalls: FieldValue.increment(-raise) });
  }
  assert.deepEqual(await user(who.uid), { agentDay: today(), agentCount: 1 });
});

test('an error status from Anthropic gives the count back, after the one retry for a 529; a refusal, an unusable answer and a lost connection keep it', async () => {
  const who = await asker();
  answer = () => json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529, { 'retry-after-ms': '5' });
  assert.deepEqual(await counted(() => assert.rejects(ask(who, inputs.edit), { code: 'unavailable', message: 'Agent Mode is unavailable right now. Try again in a minute.' })), { agentCalls: 0, claudeCalls: 2 });
  // A 400 (also how a reached Console spend limit answers), an expired or revoked key's 401, and a 429 after its retry.
  for (const [status, type, tries] of [[400, 'invalid_request_error', 1], [401, 'authentication_error', 1], [429, 'rate_limit_error', 2]] as const) {
    answer = () => json({ type: 'error', error: { type, message: 'Refused.' } }, status, { 'retry-after-ms': '5' });
    assert.deepEqual(await counted(() => assert.rejects(ask(who, inputs.edit), { code: 'unavailable', message: 'Agent Mode is unavailable right now. Try again in a minute.' })), { agentCalls: 0, claudeCalls: tries }, String(status));
  }
  assert.deepEqual(await user(who.uid), { agentDay: today(), agentCount: 0 });

  answer = () => reply('{"changes": [', { stop_reason: 'refusal' });
  assert.deepEqual(await counted(async () => assert.deepEqual(await ask(who, inputs.edit), { status: 'declined', left: 29 })), { agentCalls: 1, claudeCalls: 1 });
  answer = () => reply({ changes: [{ field: 'speed', value: 5 }], summary: 'Faster.', unsupported: '' });
  assert.deepEqual(await counted(async () => assert.deepEqual(await ask(who, inputs.edit), { status: 'unusable', left: 28 })), { agentCalls: 1, claudeCalls: 1 });
  answer = () => reply('{"changes": [{"field": "speed"', { stop_reason: 'max_tokens' });
  assert.deepEqual(await ask(who, inputs.edit), { status: 'unusable', left: 27 });
  answer = () => { throw new TypeError('fetch failed'); };
  assert.deepEqual(await counted(() => assert.rejects(ask(who, inputs.edit), { code: 'unavailable' })), { agentCalls: 1, claudeCalls: 2 });
  assert.deepEqual(await user(who.uid), { agentDay: today(), agentCount: 4 });
});

test('a caller off the allowlist, or a bad input, is refused before anything is counted', async () => {
  const outsider = await asker({ allowed: false });
  assert.deepEqual(await counted(() => assert.rejects(ask(outsider, inputs.polish), { code: 'permission-denied' })), { agentCalls: 0, claudeCalls: 0 });
  await assert.rejects(ask({ ...outsider, auth: null }, inputs.polish), { code: 'unauthenticated' });
  assert.equal(await user(outsider.uid), undefined);
  const who = await asker();
  for (const data of [{ job: 'polish', idea: '' }, { job: 'edit', request: 'slower', current: { ...current, modelPath: 'x' } }, { job: 'sing' }]) {
    assert.deepEqual(await counted(() => assert.rejects(ask(who, data), { code: 'invalid-argument' })), { agentCalls: 0, claudeCalls: 0 }, JSON.stringify(data));
  }
  assert.equal(await user(who.uid), undefined);
});

test('template pick sends the caller\'s upload as a WebP that fits 1024 px, and refuses anyone else\'s', async () => {
  const who = await asker(), other = await asker();
  const photo = `uploads/${who.uid}/photo.png`, theirs = `uploads/${other.uid}/photo.png`;
  const png = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: { r: 200, g: 120, b: 60 } } }).png().toBuffer();
  await bucket().file(photo).save(png, { contentType: 'image/png' });
  await bucket().file(theirs).save(png, { contentType: 'image/png' });
  await bucket().file(`uploads/${who.uid}/fake.png`).save(Buffer.from('GIF89a'), { contentType: 'image/gif' });

  assert.deepEqual(await ask(who, { job: 'template', imagePath: photo }), { status: 'ok', result: answers.template, left: 29 });
  const [image, text] = calls.at(-1)!.body.messages[0].content;
  assert.deepEqual([image.type, image.source.type, image.source.media_type, text], ['image', 'base64', 'image/webp', { type: 'text', text: '{"idea":""}' }]);
  const sent = await sharp(Buffer.from(image.source.data, 'base64')).metadata();
  assert.deepEqual([sent.format, sent.width, sent.height], ['webp', 1024, 768]);

  for (const imagePath of [theirs, `uploads/${who.uid}/fake.png`, `uploads/${who.uid}/missing.png`, `uploads/${who.uid}/poster-a.png`]) {
    assert.deepEqual(await counted(() => assert.rejects(ask(who, { job: 'template', imagePath }), { code: 'invalid-argument', message: /imagePath/ })), { agentCalls: 0, claudeCalls: 0 }, imagePath);
  }
  assert.deepEqual(await user(who.uid), { agentDay: today(), agentCount: 1 });
});

test('nothing is written for the caller but the three counters, and the log line carries no typed text', async () => {
  const who = await asker(), photo = `uploads/${who.uid}/photo.webp`;
  await bucket().file(photo).save(await sharp({ create: { width: 64, height: 64, channels: 3, background: '#336699' } }).webp().toBuffer(), { contentType: 'image/webp' });
  const info = mock.method(logger, 'info');
  try {
    const secret = 'zebra-striped teapot 7731';
    answer = ({ body }) => jobOf(body) === 'polish' ? reply(answers.polish, { model: 'claude-opus-4-8', before: [{ type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } }] }) : undefined;
    assert.deepEqual(await counted(async () => {
      assert.equal((await ask(who, { job: 'polish', idea: secret })).status, 'ok');
      await ask(who, { job: 'template', idea: secret, imagePath: photo });
      await ask(who, { ...inputs.edit, request: secret });
      await ask(who, { ...inputs.copy, direction: secret });
    }), { agentCalls: 4, claudeCalls: 4 });
    const lines = info.mock.calls.filter(({ arguments: [message] }) => message === 'agentAssist').map(({ arguments: [, fields] }) => fields as Record<string, unknown>);
    assert.equal(lines.length, 4);
    assert.deepEqual(lines[0], { uid: who.uid, job: 'polish', status: 'ok', stopReason: 'end_turn', model: 'claude-opus-4-8', inputTokens: 612, outputTokens: 345, ms: lines[0].ms, requestId: 'req_test' });
    assert.deepEqual(lines.map(({ job, model }) => [job, model]), [['polish', 'claude-opus-4-8'], ['template', 'claude-opus-5-5'], ['edit', 'claude-opus-5-5'], ['copy', 'claude-opus-5-5']]);
    assert.equal(JSON.stringify(lines).includes(secret), false);
  } finally {
    info.mock.restore();
  }
  assert.deepEqual(await user(who.uid), { agentDay: today(), agentCount: 4 });
  for (const collection of ['jobs', 'heroes']) assert.equal((await db().collection(collection).where('owner', '==', who.uid).get()).size, 0, collection);
  const files = await Promise.all([`uploads/${who.uid}/`, `models/${who.uid}/`, 'public/'].map(async prefix => (await bucket().getFiles({ prefix }))[0].map(file => file.name)));
  assert.deepEqual(files[0], [photo]);
  assert.deepEqual(files[1], []);
  assert.equal(files[2].some(name => name.includes(who.uid)), false);
});
