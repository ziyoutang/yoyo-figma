import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, mock, test } from 'node:test';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import type { CallableRequest } from 'firebase-functions/https';
import { utcDay } from './jobs';
import type { MeshyTask } from './meshy';
import { cancelGeneration, meshyWebhook, startGeneration, sweepJobs } from './index';

// Run with `npm run test:emulator`, beside heroes.emulator.ts. Meshy is faked inside this process, and any other
// fetch fails the run, so these tests can't spend credits. The secrets are dummies; the real ones are never read.
before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.GCLOUD_PROJECT?.startsWith('demo-'), 'Run this through npm run test:emulator.');
});
const MESHY = 'https://meshy.invalid', KEY = 'test-meshy-key', SECRET = 'test-webhook-secret';
Object.assign(process.env, { MESHY_BASE_URL: MESHY, MESHY_API_KEY: KEY, MESHY_WEBHOOK_SECRET: SECRET });

type MeshyCall = {method: string; path: string; id: string | undefined; body: unknown; auth: string | null};
const tasks = new Map<string, MeshyTask>(), calls: MeshyCall[] = [], leaks: string[] = [];
// A test can answer a Meshy call itself; returning nothing leaves it to the fake.
let answer: ((call: MeshyCall) => Response | undefined | Promise<Response | undefined>) | undefined;
beforeEach(() => { answer = undefined; });
after(() => assert.deepEqual(leaks, [], 'every fetch went to the fake Meshy'));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ENDPOINTS = /^\/openapi\/(v2\/text-to-3d|v1\/image-to-3d|v1\/retexture)(?:\/([^/]+))?$/;
mock.method(globalThis, 'fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(input instanceof Request ? input.url : input), match = url.origin === MESHY ? ENDPOINTS.exec(url.pathname) : null;
  const method = init.method ?? 'GET', id = match?.[2] ? decodeURIComponent(match[2]) : undefined;
  if (!match || !(id ? ['GET', 'DELETE'] : ['POST']).includes(method)) {
    leaks.push(`${method} ${url.href}`);
    throw new Error(`Unexpected fetch: ${method} ${url.href}`);
  }
  const call = { method, path: match[1], id, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init.headers).get('Authorization') };
  calls.push(call);
  const answered = await answer?.(call);
  if (answered) return answered;
  if (!id) {
    const task = { id: randomUUID(), status: 'PENDING', progress: 0 };
    tasks.set(task.id, task);
    return json({ result: task.id });
  }
  const task = tasks.get(id);
  if (!task) return json({ message: 'Task not found.' }, 404);
  if (method === 'GET') return json(task);
  // As Meshy does, only a task that hasn't started can be deleted.
  if (task.status !== 'PENDING') return json({ message: 'Task already started.' }, 409);
  tasks.delete(id);
  return json({});
});

// Cloud Tasks can't run here, so ingest enqueues are recorded instead.
const enqueued: {jobId: string; id?: string}[] = [];
mock.method(Object.getPrototypeOf(getFunctions().taskQueue('locations/us-west1/functions/ingestModel')), 'enqueue', async (data: {jobId: string}, options?: {id?: string}) => {
  enqueued.push({ ...data, id: options?.id });
});

const db = () => getFirestore();
const MINUTE = 60_000, DAY = 24 * 60 * MINUTE;
const today = () => utcDay(new Date()), month = (day = today()) => day.slice(0, 7);
type Who = {uid: string; auth: unknown};

// Not `person`, which heroes.emulator.ts uses against the same emulator.
let makers = 0;
async function maker(): Promise<Who> {
  const uid = `maker${++makers}`, email = `${uid}@example.test`;
  await db().doc(`allowedUsers/${email}`).set({ enabled: true });
  return { uid, auth: { uid, token: { email, email_verified: true, firebase: { sign_in_provider: 'google.com' } } } };
}

const call = <T>(fn: {run: (request: CallableRequest) => unknown}, who: Who, data: unknown) => fn.run({ auth: who.auth, data, app: { appId: 'app', token: {}, alreadyConsumed: false } } as unknown as CallableRequest) as Promise<T>;
const SHAPE = { source: 'text', prompt: 'a small brass robot' };
const lookOf = (shapeJobId: string) => ({ kind: 'look', shapeJobId, prompt: 'polished gold' });
const start = (who: Who, data: object = SHAPE) => call<{jobId: string}>(startGeneration, who, data);
const cancel = (who: Who, jobId: unknown) => call<{status: string; refunded: boolean}>(cancelGeneration, who, { jobId });

const job = async (id: string) => (await db().doc(`jobs/${id}`).get()).data()!;
const jobsOf = async (uid: string) => (await db().collection('jobs').where('owner', '==', uid).get()).docs.map(doc => doc.id);
async function counts(uid: string) {
  const user = (await db().doc(`users/${uid}`).get()).data() ?? {};
  return { day: user.day, dayCount: user.dayCount, creditsUsed: user.creditsUsed };
}
// usage/{month} is app-wide, so tests compare its change across a step, never its value.
async function usage(of = month()) {
  const doc = await db().doc(`usage/${of}`).get();
  return { credits: doc.get('credits') ?? 0, calls: doc.get('calls') ?? 0 };
}
async function usageChange(step: () => Promise<unknown>) {
  const was = await usage();
  await step();
  const now = await usage();
  return { credits: now.credits - was.credits, calls: now.calls - was.calls };
}

// A job written straight to Firestore, with its task in the fake Meshy.
async function seed(uid: string, fields: Record<string, unknown> = {}, task: Partial<MeshyTask> = {}, id = db().collection('jobs').doc().id) {
  const meshy = { id: randomUUID(), status: 'PENDING', progress: 0, ...task };
  tasks.set(meshy.id, meshy);
  await db().doc(`jobs/${id}`).set({
    owner: uid, kind: 'shape', credits: 20, source: 'text', prompt: SHAPE.prompt, imagePath: null, meshyEndpoint: 'text-to-3d', meshyTaskId: meshy.id,
    status: 'queued', progress: 0, error: null, modelPath: null, thumbnailPath: null, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...fields,
  });
  return { id, task: meshy };
}

test('a shape and a look each reserve their credits and the day\'s slot, then queue a Meshy task', async () => {
  const who = await maker();
  let shapeId = '', mark = calls.length;
  assert.deepEqual(await usageChange(async () => { shapeId = (await start(who)).jobId; }), { credits: 20, calls: 1 });
  const shape = await job(shapeId);
  assert.deepEqual([shape.status, shape.kind, shape.credits, tasks.get(shape.meshyTaskId)?.status], ['queued', 'shape', 20, 'PENDING']);
  assert.deepEqual(calls.slice(mark), [{ method: 'POST', path: 'v2/text-to-3d', id: undefined, body: { mode: 'preview', prompt: SHAPE.prompt, ai_model: 'meshy-7.1' }, auth: `Bearer ${KEY}` }]);
  assert.deepEqual(await counts(who.uid), { day: today(), dayCount: 1, creditsUsed: 20 });

  await db().doc(`jobs/${shapeId}`).update({ status: 'ready' });
  let lookId = '';
  mark = calls.length;
  assert.deepEqual(await usageChange(async () => { lookId = (await start(who, lookOf(shapeId))).jobId; }), { credits: 10, calls: 1 });
  const look = await job(lookId);
  assert.deepEqual([look.status, look.kind, look.credits, look.shapeJobId, tasks.get(look.meshyTaskId)?.status], ['queued', 'look', 10, shapeId, 'PENDING']);
  assert.deepEqual(calls.slice(mark).map(({ path, body }) => [path, body]), [['v2/text-to-3d', { mode: 'refine', preview_task_id: shape.meshyTaskId, texture_prompt: 'polished gold', enable_pbr: true, target_formats: ['glb'] }]]);
  assert.deepEqual(await counts(who.uid), { day: today(), dayCount: 2, creditsUsed: 30 });
});

test('the 11th job of a UTC day is refused with nothing reserved, and a count from an earlier day starts over', async () => {
  const who = await maker();
  for (let i = 0; i < 10; i++) await start(who);
  const mark = calls.length;
  assert.deepEqual(await usageChange(() => assert.rejects(start(who), { code: 'resource-exhausted', message: /^Daily limit reached/ })), { credits: 0, calls: 0 });
  assert.deepEqual([await counts(who.uid), (await jobsOf(who.uid)).length, calls.length], [{ day: today(), dayCount: 10, creditsUsed: 200 }, 10, mark]);
  await db().doc(`users/${who.uid}`).update({ day: utcDay(new Date(Date.now() - DAY)) });
  await start(who);
  assert.deepEqual(await counts(who.uid), { day: today(), dayCount: 1, creditsUsed: 220 });
});

test('a job that would take the app over its monthly credits is refused with nothing reserved', async () => {
  const who = await maker(), usageRef = db().doc(`usage/${month()}`), mark = calls.length;
  // Raise the app-wide total to 981, where a 20-credit shape would make 1001 of the 1000, and put it back after.
  const raise = 981 - (await usage()).credits;
  await usageRef.set({ credits: FieldValue.increment(raise) }, { merge: true });
  try {
    assert.deepEqual(await usageChange(() => assert.rejects(start(who), { code: 'resource-exhausted', message: /^Monthly limit reached/ })), { credits: 0, calls: 0 });
  } finally {
    await usageRef.update({ credits: FieldValue.increment(-raise) });
  }
  assert.deepEqual([await counts(who.uid), await jobsOf(who.uid), calls.length], [{ day: undefined, dayCount: undefined, creditsUsed: undefined }, [], mark]);
});

test('when Meshy\'s create fails the job fails and the reservation goes back; only a look\'s 400, 404 or 422 means an expired shape', async () => {
  const EXPIRED = 'Meshy can no longer texture this shape. Make the shape again.', DOWN = 'The 3D service could not start this shape.';
  const UNAVAILABLE = 'The 3D service is unavailable. Try again shortly.';
  for (const [kind, failure, code, message, error] of [
    ['shape', 500, 'unavailable', UNAVAILABLE, DOWN], ['shape', 422, 'unavailable', UNAVAILABLE, DOWN], ['shape', 'network', 'unavailable', UNAVAILABLE, DOWN],
    ['look', 400, 'failed-precondition', EXPIRED, EXPIRED], ['look', 404, 'failed-precondition', EXPIRED, EXPIRED], ['look', 422, 'failed-precondition', EXPIRED, EXPIRED],
    ['look', 500, 'unavailable', UNAVAILABLE, DOWN],
  ] as const) {
    const who = await maker(), label = `${kind} ${failure}`, shape = kind === 'look' ? (await seed(who.uid, { status: 'ready' })).id : null;
    answer = ({ method }) => {
      if (method !== 'POST') return;
      if (failure === 'network') throw new TypeError('fetch failed');
      return json({ message: 'Refused.' }, failure);
    };
    assert.deepEqual(await usageChange(() => assert.rejects(start(who, shape ? lookOf(shape) : SHAPE), { code, message })), { credits: 0, calls: 0 }, label);
    const [failed] = (await jobsOf(who.uid)).filter(id => id !== shape);
    assert.deepEqual([(await job(failed)).status, (await job(failed)).error], ['failed', error], label);
    assert.deepEqual(await counts(who.uid), { day: today(), dayCount: 0, creditsUsed: 0 }, label);
  }
});

test('a cancel during Meshy\'s create call stays cancelled, and the task id is still recorded', async () => {
  const who = await maker();
  let canceled: unknown;
  answer = async ({ method }) => {
    if (method === 'POST') canceled = await cancel(who, (await jobsOf(who.uid))[0]);
    return undefined;
  };
  const { jobId } = await start(who);
  assert.deepEqual(canceled, { status: 'canceled', refunded: false });
  const canceledJob = await job(jobId);
  assert.deepEqual([canceledJob.status, tasks.has(canceledJob.meshyTaskId)], ['canceled', true]);
  // The task exists at Meshy and will be charged, so the reservation stays.
  assert.deepEqual(await counts(who.uid), { day: today(), dayCount: 1, creditsUsed: 20 });
});

test('cancelling a task Meshy hasn\'t started deletes it and refunds the day the job was made', async () => {
  const who = await maker();
  let jobId = '', taskId = '';
  assert.deepEqual(await usageChange(async () => {
    jobId = (await start(who)).jobId;
    taskId = (await job(jobId)).meshyTaskId;
    const mark = calls.length;
    assert.deepEqual(await cancel(who, jobId), { status: 'canceled', refunded: true });
    assert.deepEqual(calls.slice(mark).map(({ method, id }) => [method, id]), [['GET', taskId], ['DELETE', taskId]]);
  }), { credits: 0, calls: 0 });
  assert.deepEqual([(await job(jobId)).status, tasks.has(taskId)], ['canceled', false]);
  assert.deepEqual(await counts(who.uid), { day: today(), dayCount: 0, creditsUsed: 0 });

  // A job made 40 days ago gives back that month's credits and leaves today's count alone.
  const made = new Date(Date.now() - 40 * DAY), madeMonth = month(utcDay(made)), old = await seed(who.uid, { createdAt: Timestamp.fromDate(made) });
  await db().doc(`usage/${madeMonth}`).set({ credits: FieldValue.increment(20), calls: FieldValue.increment(1) }, { merge: true });
  await db().doc(`users/${who.uid}`).update({ creditsUsed: FieldValue.increment(20) });
  await start(who);
  const [madeBefore, nowBefore] = [await usage(madeMonth), await usage()];
  assert.deepEqual(await cancel(who, old.id), { status: 'canceled', refunded: true });
  assert.deepEqual([await usage(madeMonth), await usage()], [{ credits: madeBefore.credits - 20, calls: madeBefore.calls - 1 }, nowBefore]);
  assert.deepEqual(await counts(who.uid), { day: today(), dayCount: 1, creditsUsed: 20 });
});

test('cancelling a task Meshy has started keeps its credits, and Meshy\'s 409 is tolerated', async () => {
  const who = await maker(), running = (await start(who)).jobId, runningTask = (await job(running)).meshyTaskId;
  tasks.get(runningTask)!.status = 'IN_PROGRESS';
  const mark = calls.length;
  assert.deepEqual(await cancel(who, running), { status: 'canceled', refunded: false });
  assert.deepEqual(calls.slice(mark).map(({ method, id }) => [method, id]), [['GET', runningTask]]);

  // The task started between the status check and the delete.
  const raced = (await start(who)).jobId;
  answer = ({ method }) => method === 'DELETE' ? json({ message: 'Task already started.' }, 409) : undefined;
  assert.deepEqual(await cancel(who, raced), { status: 'canceled', refunded: false });
  // Any other Meshy failure leaves the job as it was, so cancelling can be tried again.
  const other = (await start(who)).jobId;
  answer = () => json({}, 500);
  await assert.rejects(cancel(who, other), { code: 'unavailable' });
  assert.deepEqual([(await job(running)).status, (await job(raced)).status, (await job(other)).status], ['canceled', 'canceled', 'queued']);
  assert.deepEqual(await counts(who.uid), { day: today(), dayCount: 3, creditsUsed: 60 });
});

test('cancel refuses a bad id, another person\'s job and a finished job; a cancelled job stays cancelled', async () => {
  const owner = await maker(), other = await maker(), queued = await seed(owner.uid), mark = calls.length;
  for (const jobId of ['', 'not/an/id', 'x'.repeat(65), 42, undefined]) await assert.rejects(cancel(owner, jobId), { code: 'invalid-argument' }, String(jobId));
  await assert.rejects(cancel(other, queued.id), { code: 'permission-denied' });
  for (const status of ['ready', 'failed']) {
    const done = await seed(owner.uid, { status });
    await assert.rejects(cancel(owner, done.id), { code: 'failed-precondition' }, status);
    assert.equal((await job(done.id)).status, status);
  }
  const canceled = await seed(owner.uid, { status: 'canceled' });
  assert.deepEqual(await cancel(owner, canceled.id), { status: 'canceled', refunded: false });
  assert.deepEqual([(await job(queued.id)).status, calls.length], ['queued', mark]);
});

async function deliver(headers: Record<string, string>, body?: unknown) {
  let status = 0;
  const req = { method: 'POST', headers, body, get: (name: string) => headers[name.toLowerCase()] };
  const res = {
    headersSent: false,
    sendStatus(code: number) { status = code; this.headersSent = true; return this; },
    status(code: number) { status = code; return this; },
    send() { this.headersSent = true; return this; },
  };
  await meshyWebhook(req as never, res as never);
  return status;
}
const SIGNED = { 'x-meshy-api-webhook-secret-key': SECRET };

test('the webhook needs the secret, ignores unknown tasks, applies known ones from Meshy, and answers 200 even when that fails', async () => {
  const who = await maker(), { id, task } = await seed(who.uid), mark = calls.length;
  Object.assign(task, { status: 'IN_PROGRESS', progress: 30 });
  for (const headers of [{}, { 'x-meshy-api-webhook-secret-key': 'wrong' }] as Record<string, string>[]) assert.equal(await deliver(headers, { id: task.id }), 401);
  for (const body of [{ id: randomUUID() }, {}, undefined]) assert.equal(await deliver(SIGNED, body), 200);
  assert.deepEqual([(await job(id)).status, calls.length], ['queued', mark]);

  // The job follows the task as Meshy reports it, not the delivered body.
  assert.equal(await deliver(SIGNED, { id: task.id, status: 'SUCCEEDED' }), 200);
  assert.deepEqual([(await job(id)).status, (await job(id)).progress], ['running', 30]);
  task.status = 'SUCCEEDED';
  const queued = enqueued.length;
  assert.equal(await deliver(SIGNED, { id: task.id }), 200);
  assert.deepEqual([(await job(id)).status, enqueued.slice(queued)], ['ingesting', [{ jobId: id, id: `ingest-${id}` }]]);

  const failing = await seed(who.uid, {}, { status: 'IN_PROGRESS', progress: 50 });
  answer = () => json({}, 500);
  assert.equal(await deliver(SIGNED, { id: failing.task.id }), 200);
  assert.equal((await job(failing.id)).status, 'queued');
});

test('the sweep fails stale jobs, catches up idle ones and retries stuck ingests, and one failure doesn\'t stop the rest', async () => {
  const who = await maker(), ago = (minutes: number) => Timestamp.fromMillis(Date.now() - minutes * MINUTE);
  const age = (created: number, updated: number) => ({ createdAt: ago(created), updatedAt: ago(updated) });
  // Queued jobs come back in id order, so the job whose Meshy call fails is swept before the idle one.
  const failing = await seed(who.uid, age(10, 3), {}, `${who.uid}x0failing`);
  const idle = await seed(who.uid, age(10, 3), { status: 'IN_PROGRESS', progress: 55 }, `${who.uid}x1idle`);
  const recent = await seed(who.uid, age(10, 1), { status: 'IN_PROGRESS', progress: 55 });
  const tooOld = await seed(who.uid, { status: 'running', ...age(31, 1) });
  const stuckStart = await seed(who.uid, { status: 'starting', meshyTaskId: null, ...age(6, 6) });
  const newStart = await seed(who.uid, { status: 'starting', meshyTaskId: null, ...age(4, 4) });
  const stuckIngest = await seed(who.uid, { status: 'ingesting', ...age(20, 16) });
  const ingesting = await seed(who.uid, { status: 'ingesting', ...age(20, 10) });
  answer = ({ id }) => id === failing.task.id ? json({}, 500) : undefined;

  const mark = calls.length, queued = enqueued.length, from = Date.now();
  await sweepJobs.run({ scheduleTime: new Date().toISOString() });
  const to = Date.now();
  const state = async ({ id }: {id: string}) => { const swept = await job(id); return [swept.status, swept.progress, swept.error]; };
  assert.deepEqual(await state(tooOld), ['failed', 0, 'This model took too long to generate.']);
  assert.deepEqual(await state(stuckStart), ['failed', 0, 'This model could not be started.']);
  assert.deepEqual(await state(newStart), ['starting', 0, null]);
  assert.deepEqual(await state(idle), ['running', 55, null]);
  assert.deepEqual(await state(recent), ['queued', 0, null]);
  assert.deepEqual(await state(failing), ['queued', 0, null]);

  const gets = calls.slice(mark).map(({ id }) => id);
  assert.ok(gets.includes(failing.task.id) && gets.indexOf(failing.task.id) < gets.indexOf(idle.task.id), 'the failing job was swept before the idle one');
  assert.equal(gets.includes(recent.task.id) || gets.includes(tooOld.task.id), false);
  const retries = enqueued.slice(queued).filter(({ jobId }) => [stuckIngest.id, ingesting.id].includes(jobId));
  const windows = [from, to].map(time => `ingest-${stuckIngest.id}-${Math.floor(time / (15 * MINUTE))}`);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].jobId, stuckIngest.id);
  assert.ok(windows.includes(retries[0].id!), String(retries[0].id));
});
