import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectId = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!projectId || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
  console.error('Usage: node scripts/test-firestore-rules.mjs <project-id> [--dry-run]');
  process.exit(1);
}

// Synthetic identities only: these tests never seed or read real access-list entries.
const identity = { uid: 'rules-test-user', token: {
  email: 'member@example.test', email_verified: true,
  firebase: { sign_in_provider: 'google.com' },
} };
const ownPath = '/databases/(default)/documents/allowedUsers/member@example.test';
const db = '/databases/(default)/documents';
const unverified = { ...identity, token: { ...identity.token, email_verified: false } };
const passwordUser = { ...identity, token: { ...identity.token, firebase: { sign_in_provider: 'password' } } };
const ownJob = { resource: { data: { owner: identity.uid } } };
const ownHero = ownJob, otherHero = { resource: { data: { owner: 'someone-else' } } };
const firestoreCases = [
  ['own verified Google read', 'ALLOW', 'get', ownPath, identity],
  ['unauthenticated read', 'DENY', 'get', ownPath, null],
  ['other user read', 'DENY', 'get', `${db}/allowedUsers/other@example.test`, identity],
  ['collection listing', 'DENY', 'list', `${db}/allowedUsers`, identity],
  ...['create', 'update', 'delete'].map(method => [`client ${method}`, 'DENY', method, ownPath, identity]),
  ['unverified email', 'DENY', 'get', ownPath, unverified],
  ['non-Google provider', 'DENY', 'get', ownPath, passwordUser],
  ['unrelated collection', 'DENY', 'get', `${db}/figmaCodes/test`, identity],
  ['own job read', 'ALLOW', 'get', `${db}/jobs/job1`, identity, ownJob],
  ['other user job read', 'DENY', 'get', `${db}/jobs/job1`, identity, { resource: { data: { owner: 'someone-else' } } }],
  ['unauthenticated job read', 'DENY', 'get', `${db}/jobs/job1`, null, ownJob],
  ['unverified job read', 'DENY', 'get', `${db}/jobs/job1`, unverified, ownJob],
  ['non-Google job read', 'DENY', 'get', `${db}/jobs/job1`, passwordUser, ownJob],
  ['job listing', 'DENY', 'list', `${db}/jobs`, identity],
  ...['create', 'update', 'delete'].map(method => [`client job ${method}`, 'DENY', method, `${db}/jobs/job1`, identity, ownJob]),
  ['own user doc read', 'ALLOW', 'get', `${db}/users/${identity.uid}`, identity],
  ['other user doc read', 'DENY', 'get', `${db}/users/someone-else`, identity],
  ['non-Google user doc read', 'DENY', 'get', `${db}/users/${identity.uid}`, passwordUser],
  ['user doc listing', 'DENY', 'list', `${db}/users`, identity],
  ...['create', 'update', 'delete'].map(method => [`client user doc ${method}`, 'DENY', method, `${db}/users/${identity.uid}`, identity]),
  ['own hero read', 'ALLOW', 'get', `${db}/heroes/hero1`, identity, ownHero],
  ['own heroes listing', 'ALLOW', 'list', `${db}/heroes/hero1`, identity, ownHero],
  ['other user hero read', 'DENY', 'get', `${db}/heroes/hero1`, identity, otherHero],
  ['other user heroes listing', 'DENY', 'list', `${db}/heroes/hero1`, identity, otherHero],
  ['unauthenticated hero read', 'DENY', 'get', `${db}/heroes/hero1`, null, ownHero],
  ['unauthenticated heroes listing', 'DENY', 'list', `${db}/heroes/hero1`, null, ownHero],
  ['unverified hero read', 'DENY', 'get', `${db}/heroes/hero1`, unverified, ownHero],
  ['non-Google hero read', 'DENY', 'get', `${db}/heroes/hero1`, passwordUser, ownHero],
  ...['create', 'update', 'delete'].map(method => [`client hero ${method}`, 'DENY', method, `${db}/heroes/hero1`, identity, ownHero]),
  ['usage read', 'DENY', 'get', `${db}/usage/2026-11`, identity],
  ['usage write', 'DENY', 'update', `${db}/usage/2026-11`, identity],
];

const bucket = '/b/depth-plugin-demo-20261006.firebasestorage.app/o';
const ownUpload = `${bucket}/uploads/${identity.uid}/photo.png`;
const png = size => ({ request: { resource: { size, contentType: 'image/png' } } });
const publicHero = `${bucket}/public/heroes/hero1`, json = { request: { resource: { size: 1024, contentType: 'application/json' } } };
const storageCases = [
  ['own image upload', 'ALLOW', 'create', ownUpload, identity, png(1024)],
  ...['image/jpeg', 'image/webp'].map(contentType => [`own ${contentType} upload`, 'ALLOW', 'create', ownUpload, identity, { request: { resource: { size: 1024, contentType } } }]),
  ['upload of 20 MB', 'DENY', 'create', ownUpload, identity, png(20 * 1024 * 1024)],
  ['non-image upload', 'DENY', 'create', ownUpload, identity, { request: { resource: { size: 1024, contentType: 'image/svg+xml' } } }],
  ['upload to another user folder', 'DENY', 'create', `${bucket}/uploads/someone-else/photo.png`, identity, png(1024)],
  ['unauthenticated upload', 'DENY', 'create', ownUpload, null, png(1024)],
  ['unverified upload', 'DENY', 'create', ownUpload, unverified, png(1024)],
  ['non-Google upload', 'DENY', 'create', ownUpload, passwordUser, png(1024)],
  ['upload overwrite', 'DENY', 'update', ownUpload, identity, png(1024)],
  ['upload delete', 'DENY', 'delete', ownUpload, identity],
  // Publish posters use the same rule under a poster- name; only functions delete them.
  ['own poster upload', 'ALLOW', 'create', `${bucket}/uploads/${identity.uid}/poster-a.png`, identity, png(1024)],
  ['own poster delete', 'DENY', 'delete', `${bucket}/uploads/${identity.uid}/poster-a.png`, identity],
  ['own upload read', 'ALLOW', 'get', ownUpload, identity],
  ['other user upload read', 'DENY', 'get', `${bucket}/uploads/someone-else/photo.png`, identity],
  ['own model read', 'ALLOW', 'get', `${bucket}/models/${identity.uid}/job1/model.glb`, identity],
  ['other user model read', 'DENY', 'get', `${bucket}/models/someone-else/job1/model.glb`, identity],
  ['unauthenticated model read', 'DENY', 'get', `${bucket}/models/${identity.uid}/job1/model.glb`, null],
  ['client model write', 'DENY', 'create', `${bucket}/models/${identity.uid}/job1/model.glb`, identity, { request: { resource: { size: 1024, contentType: 'model/gltf-binary' } } }],
  ['signed-out hero.json read', 'ALLOW', 'get', `${publicHero}/hero.json`, null],
  ['signed-out public model read', 'ALLOW', 'get', `${publicHero}/v1/model.glb`, null],
  ['signed-in public poster read', 'ALLOW', 'get', `${publicHero}/v1/poster-desktop.webp`, identity],
  ['public hero folder listing', 'DENY', 'list', publicHero, null],
  ['public heroes listing', 'DENY', 'list', `${bucket}/public/heroes`, identity],
  ['public version listing', 'DENY', 'list', `${publicHero}/v1`, identity],
  ...['create', 'update'].flatMap(method => [[`client public hero ${method}`, 'DENY', method, `${publicHero}/hero.json`, identity, json], [`signed-out public hero ${method}`, 'DENY', method, `${publicHero}/hero.json`, null, json]]),
  ['client public hero delete', 'DENY', 'delete', `${publicHero}/hero.json`, identity],
  ['unrelated path read', 'DENY', 'get', `${bucket}/public/hero.png`, identity],
  ['unrelated path write', 'DENY', 'create', `${bucket}/public/hero.png`, identity, png(1024)],
];

const suites = [['firestore.rules', firestoreCases], ['storage.rules', storageCases]];
const payload = (file, cases) => ({
  source: { files: [{ name: file, content: readFileSync(resolve(root, file), 'utf8') }] },
  testSuite: { testCases: cases.map(([, expectation, method, path, auth, extra = {}]) => ({
    expectation, request: { auth, method, path, ...extra.request }, ...(extra.resource && { resource: extra.resource }), pathEncoding: 'PLAIN',
  })) },
});

async function accessToken() {
  if (process.env.DEPTH_RULES_ACCESS_TOKEN) return process.env.DEPTH_RULES_ACCESS_TOKEN;
  try {
    const binary = realpathSync(execFileSync('which', ['firebase'], { encoding: 'utf8' }).trim());
    const require = createRequire(binary);
    const auth = require(resolve(dirname(binary), '..', 'auth.js'));
    const account = auth.getProjectDefaultAccount(root);
    if (!account?.tokens?.refresh_token) throw new Error('No signed-in CLI account.');
    const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/firebase']);
    if (!token.access_token) throw new Error('No access token.');
    return token.access_token;
  } catch {
    throw new Error('Unable to use Firebase CLI authentication. Run firebase login, or supply a short-lived owner OAuth token in DEPTH_RULES_ACCESS_TOKEN.');
  }
}

try {
  const total = suites.reduce((sum, [, cases]) => sum + cases.length, 0);
  if (dryRun) {
    console.log(`Prepared ${total} rules cases for ${projectId}; no credentials loaded or network request sent.`);
    for (const [file, cases] of suites) for (const [label, expectation] of cases) console.log(`${file} ${expectation}: ${label}`);
  } else {
    const token = await accessToken();
    let failed = false;
    for (const [file, cases] of suites) {
      const response = await fetch(`https://firebaserules.googleapis.com/v1/projects/${projectId}:test`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(file, cases)), signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Rules API returned HTTP ${response.status}. Check project existence, API access, and owner permissions.`);
      const result = await response.json();
      const issues = result.issues ?? [];
      for (const issue of issues) console.log(`${file} ${issue.severity}: ${issue.description}`);
      const results = result.testResults ?? [];
      for (const [index, [label]] of cases.entries()) console.log(`${file} ${results[index]?.state ?? 'NOT_RUN'}: ${label}`);
      if (issues.some(issue => issue.severity === 'ERROR') || results.length !== cases.length || results.some(test => test.state !== 'SUCCESS')) failed = true;
    }
    if (failed) throw new Error('Rules verification failed. Do not deploy until every expected result passes.');
    console.log(`All ${total} remote rules cases passed. No rules were deployed or documents modified.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Rules verification failed.');
  process.exitCode = 1;
}
