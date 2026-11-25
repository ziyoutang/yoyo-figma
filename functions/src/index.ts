import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getDownloadURL, getStorage } from 'firebase-admin/storage';
import { logger, setGlobalOptions } from 'firebase-functions';
import { HttpsError, onCall, onRequest } from 'firebase-functions/https';
import { defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/scheduler';
import { onTaskDispatched } from 'firebase-functions/tasks';
import { requireAllowedUser } from './access';
import { assist } from './agent';
import { anthropicApiKey } from './claude';
import { optimizeGlb } from './glb';
import { publish, sweepPosters, unpublish } from './heroes';
import { applyTask, enqueueIngest, failJob, jobDay, refund, utcDay } from './jobs';
import { createTask, deleteTask, getTask, meshyApiKey, MeshyError, type MeshyEndpoint } from './meshy';
import { isTerminal } from './transitions';

initializeApp();
// us-west1 sits beside the Firestore database; the instance cap limits runaway cost.
setGlobalOptions({ region: 'us-west1', maxInstances: 5 });

const meshyWebhookSecret = defineSecret('MESHY_WEBHOOK_SECRET');
// Text-to-3D preview and untextured image-to-3D both cost 20 credits on this pinned model; refine and retexture cost 10.
const MESHY_MODEL = 'meshy-7.1';
const SHAPE_CREDITS = 20;
const LOOK_CREDITS = 10;
const DAILY_JOBS = 10;
const MONTHLY_CREDITS = 1000;
const MAX_PROMPT = 600;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MINUTE = 60_000;
const ACTIVE = ['starting', 'queued', 'running', 'ingesting'];
const now = () => FieldValue.serverTimestamp();
const EXPIRED_SHAPE = 'Meshy can no longer texture this shape. Make the shape again.';

// First deployable function: proves auth, the allowlist read and deployment end to end.
export const checkAccess = onCall(async request => {
  await requireAllowedUser(request.auth);
  return { allowed: true };
});

const imageUrl = (path: string) => getDownloadURL(getStorage().bucket().file(path));

// Both parsers return the job fields plus a Meshy body builder; the body is built after the reservation because a download URL can fail.
async function parseShapeRequest(uid: string, data: unknown) {
  const { source, prompt, imagePath } = (data ?? {}) as Record<string, unknown>;
  const shape = { kind: 'shape' as const, credits: SHAPE_CREDITS };
  if (source === 'text' && typeof prompt === 'string' && prompt.trim() && prompt.trim().length <= MAX_PROMPT) {
    const text = prompt.trim();
    return { ...shape, source, prompt: text, imagePath: null, meshyEndpoint: 'text-to-3d' as MeshyEndpoint, body: async () => ({ mode: 'preview', prompt: text, ai_model: MESHY_MODEL }) };
  }
  if (source === 'image' && typeof imagePath === 'string' && imagePath.startsWith(`uploads/${uid}/`)) {
    const file = getStorage().bucket().file(imagePath);
    const [exists] = await file.exists();
    const metadata = exists ? (await file.getMetadata())[0] : null;
    if (metadata && IMAGE_TYPES.includes(metadata.contentType ?? '') && Number(metadata.size) <= MAX_IMAGE_BYTES) {
      return { ...shape, source, prompt: null, imagePath, meshyEndpoint: 'image-to-3d' as MeshyEndpoint, body: async () => ({ image_url: await imageUrl(imagePath), ai_model: MESHY_MODEL, should_texture: false }) };
    }
  }
  throw new HttpsError('invalid-argument', `Send a prompt of 1 to ${MAX_PROMPT} characters, or your own JPEG, PNG or WebP upload under 20 MB.`);
}

// A look textures a finished shape: refine for text-made shapes, retexture for photo-made ones.
// ai_model is omitted so Meshy uses the shape's model.
async function parseLookRequest(uid: string, data: Record<string, unknown>) {
  const { shapeJobId, prompt } = data;
  if (typeof prompt !== 'string' || prompt.trim().length > MAX_PROMPT) throw new HttpsError('invalid-argument', `Send a look prompt of at most ${MAX_PROMPT} characters.`);
  const shape = typeof shapeJobId === 'string' && /^[A-Za-z0-9]{1,64}$/.test(shapeJobId) ? await getFirestore().doc(`jobs/${shapeJobId}`).get() : null;
  if (shape?.get('owner') !== uid || shape.get('kind') !== 'shape' || shape.get('status') !== 'ready' || !shape.get('meshyTaskId')) {
    throw new HttpsError('invalid-argument', 'Choose a finished shape first.');
  }
  const look = prompt.trim(), source = shape.get('source'), imagePath = shape.get('imagePath'), taskId = shape.get('meshyTaskId');
  const pbr = { enable_pbr: true, target_formats: ['glb'] };
  return {
    kind: 'look' as const, credits: LOOK_CREDITS, source, prompt: look || null, imagePath, shapeJobId: shape.id,
    meshyEndpoint: (source === 'text' ? 'text-to-3d' : 'retexture') as MeshyEndpoint,
    body: async () => source === 'text'
      ? { mode: 'refine', preview_task_id: taskId, texture_prompt: look || shape.get('prompt'), ...pbr }
      : { input_task_id: taskId, ...pbr, ...(look ? { text_style_prompt: look } : { image_style_url: await imageUrl(imagePath) }) },
  };
}

export const startGeneration = onCall({ enforceAppCheck: true, consumeAppCheckToken: true, secrets: [meshyApiKey] }, async request => {
  // Consuming only flags a reused token; refusing it is up to the handler.
  if (request.app?.alreadyConsumed) throw new HttpsError('unauthenticated', 'This App Check token was already used.');
  const { uid } = await requireAllowedUser(request.auth);
  const { body, ...job } = request.data?.kind === 'look' ? await parseLookRequest(uid, request.data) : await parseShapeRequest(uid, request.data);
  const db = getFirestore();
  const day = utcDay(new Date());
  const jobRef = db.collection('jobs').doc();
  const userRef = db.doc(`users/${uid}`);
  const usageRef = db.doc(`usage/${day.slice(0, 7)}`);

  // Reserve the daily slot and the monthly credits before Meshy can charge anything.
  await db.runTransaction(async tx => {
    const [user, usage] = await tx.getAll(userRef, usageRef);
    const dayCount = user.get('day') === day ? user.get('dayCount') : 0;
    if (dayCount >= DAILY_JOBS) throw new HttpsError('resource-exhausted', `Daily limit reached: ${DAILY_JOBS} shapes and looks per day. Try again after midnight UTC.`);
    if ((usage.get('credits') ?? 0) + job.credits > MONTHLY_CREDITS) throw new HttpsError('resource-exhausted', 'Monthly limit reached: the app has used its credits for this month.');
    tx.set(userRef, { day, dayCount: dayCount + 1, creditsUsed: FieldValue.increment(job.credits) }, { merge: true });
    tx.set(usageRef, { credits: FieldValue.increment(job.credits), calls: FieldValue.increment(1) }, { merge: true });
    tx.create(jobRef, {
      owner: uid, ...job, meshyTaskId: null, status: 'starting', progress: 0, error: null, modelPath: null, thumbnailPath: null,
      createdAt: now(), updatedAt: now(),
    });
  });

  let taskId: string;
  try {
    taskId = await createTask(job.meshyEndpoint, await body());
  } catch (error) {
    // Meshy deletes tasks after about 3 days, so texturing an old shape is refused with a 4xx.
    const expired = job.kind === 'look' && error instanceof MeshyError && [400, 404, 422].includes(error.status);
    logger.error('Starting the Meshy task failed; refunding the reservation.', error);
    await db.runTransaction(async tx => {
      await refund(tx, uid, job.credits, day);
      tx.update(jobRef, { status: 'failed', error: expired ? EXPIRED_SHAPE : 'The 3D service could not start this shape.', updatedAt: now() });
    });
    if (expired) throw new HttpsError('failed-precondition', EXPIRED_SHAPE);
    throw new HttpsError('unavailable', 'The 3D service is unavailable. Try again shortly.');
  }

  // A cancel during the create call wins; the task id is still recorded.
  await db.runTransaction(async tx => {
    const starting = (await tx.get(jobRef)).get('status') === 'starting';
    tx.update(jobRef, { meshyTaskId: taskId, ...(starting && { status: 'queued' }), updatedAt: now() });
  });
  return { jobId: jobRef.id };
});

export const cancelGeneration = onCall({ enforceAppCheck: true, secrets: [meshyApiKey] }, async request => {
  const { uid } = await requireAllowedUser(request.auth);
  const jobId = (request.data ?? {}).jobId;
  if (typeof jobId !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(jobId)) throw new HttpsError('invalid-argument', 'Send a job id.');
  const db = getFirestore();
  const jobRef = db.doc(`jobs/${jobId}`);
  const job = await jobRef.get();
  if (job.get('owner') !== uid) throw new HttpsError('permission-denied', 'This job does not belong to you.');
  if (job.get('status') === 'canceled') return { status: 'canceled', refunded: false };
  if (isTerminal(job.get('status'))) throw new HttpsError('failed-precondition', 'This job has already finished.');

  // Only a task Meshy has not started can be deleted, and Meshy refunds it.
  let deleted = false;
  const taskId = job.get('meshyTaskId'), endpoint = job.get('meshyEndpoint');
  if (taskId) {
    try {
      if ((await getTask(endpoint, taskId)).status === 'PENDING') {
        await deleteTask(endpoint, taskId);
        deleted = true;
      }
    } catch (error) {
      if (!(error instanceof MeshyError && error.status === 409)) {
        logger.error(`Meshy cancel failed for job ${jobId}.`, error);
        throw new HttpsError('unavailable', 'The 3D service is unavailable. Try again shortly.');
      }
    }
  }

  const refunded = await db.runTransaction(async tx => {
    const current = await tx.get(jobRef);
    if (current.get('status') === 'canceled') return false;
    if (isTerminal(current.get('status'))) throw new HttpsError('failed-precondition', 'This job has already finished.');
    if (deleted) await refund(tx, uid, current.get('credits'), jobDay(current.get('createdAt')));
    tx.update(jobRef, { status: 'canceled', updatedAt: now() });
    return deleted;
  });
  return { status: 'canceled', refunded };
});

// Publishing spends no credits, so App Check is enforced without consuming tokens, as for cancelGeneration.
// Defined here so setGlobalOptions applies; the logic is in heroes.ts.
export const publishHero = onCall({ enforceAppCheck: true, memory: '1GiB', timeoutSeconds: 120 }, publish);
export const unpublishHero = onCall({ enforceAppCheck: true }, unpublish);
// Agent Mode spends Claude usage, not credits, and its caps bound it, so App Check is enforced without consuming tokens.
// 1 GiB because template pick resizes an upload with sharp; 90 seconds covers two 30-second Claude attempts. The logic is in agent.ts.
export const agentAssist = onCall({ enforceAppCheck: true, secrets: [anthropicApiKey], memory: '1GiB', timeoutSeconds: 90 }, assist);

function sameSecret(received: string | undefined) {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return received !== undefined && timingSafeEqual(digest(received), digest(meshyWebhookSecret.value()));
}

// Meshy's webhook is account-wide, so unknown tasks are acknowledged and ignored. Every authenticated
// delivery gets a 2xx, because Meshy deactivates the webhook after repeated failures; sweepJobs recovers.
export const meshyWebhook = onRequest({ invoker: 'public', timeoutSeconds: 30, secrets: [meshyWebhookSecret, meshyApiKey] }, async (req, res) => {
  if (!sameSecret(req.get('X-MESHY-API-WEBHOOK-SECRET-KEY'))) {
    res.sendStatus(401);
    return;
  }
  try {
    const taskId = req.body?.id;
    const jobs = typeof taskId === 'string' ? await getFirestore().collection('jobs').where('meshyTaskId', '==', taskId).limit(1).get() : null;
    const job = jobs?.docs[0];
    if (job && !isTerminal(job.get('status'))) await applyTask(job.ref, await getTask(job.get('meshyEndpoint'), taskId));
  } catch (error) {
    logger.error('Meshy webhook handling failed; sweepJobs will retry.', error);
  }
  res.sendStatus(200);
});

async function download(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Model download returned HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

export const ingestModel = onTaskDispatched<{ jobId: string }>({
  memory: '2GiB', timeoutSeconds: 300, retryConfig: { maxAttempts: 5, minBackoffSeconds: 60 }, secrets: [meshyApiKey],
}, async request => {
  const jobRef = getFirestore().doc(`jobs/${request.data.jobId}`);
  const job = await jobRef.get();
  if (job.get('status') !== 'ingesting') return;

  // Meshy's asset URLs are signed and expire, so fetch them fresh.
  const task = await getTask(job.get('meshyEndpoint'), job.get('meshyTaskId'));
  if (!task.model_urls?.glb || !task.thumbnail_url) throw new Error(`Meshy task for job ${job.id} has no GLB or thumbnail.`);
  const [glb, thumbnail] = await Promise.all([download(task.model_urls.glb), download(task.thumbnail_url)]);
  const modelPath = `models/${job.get('owner')}/${job.id}/model.glb`;
  const thumbnailPath = `models/${job.get('owner')}/${job.id}/thumbnail.png`;
  const bucket = getStorage().bucket();
  // The browser's getDownloadURL needs a Firebase download token, which server-side saves don't add.
  const token = () => ({ metadata: { firebaseStorageDownloadTokens: randomUUID() } });
  await Promise.all([
    bucket.file(modelPath).save(await optimizeGlb(glb), { contentType: 'model/gltf-binary', metadata: token() }),
    bucket.file(thumbnailPath).save(thumbnail, { contentType: 'image/png', metadata: token() }),
  ]);

  await getFirestore().runTransaction(async tx => {
    if ((await tx.get(jobRef)).get('status') !== 'ingesting') return;
    tx.update(jobRef, { status: 'ready', progress: 100, modelPath, thumbnailPath, updatedAt: now() });
  });
});

async function sweepJob(job: QueryDocumentSnapshot, time: number) {
  const status = job.get('status');
  const age = time - job.get('createdAt').toMillis();
  const idle = time - job.get('updatedAt').toMillis();
  if (age > 30 * MINUTE) return failJob(job.ref, 'This model took too long to generate.');
  if (status === 'starting') return age > 5 * MINUTE ? failJob(job.ref, 'This model could not be started.') : undefined;
  if (status === 'ingesting') return idle > 15 * MINUTE ? enqueueIngest(job.id, `-${Math.floor(time / (15 * MINUTE))}`) : undefined;
  if (idle > 2 * MINUTE) await applyTask(job.ref, await getTask(job.get('meshyEndpoint'), job.get('meshyTaskId')));
}

// Recovers from missed webhooks and stuck jobs, and deletes posters no publish took. Queries by status only, so no composite index is needed.
export const sweepJobs = onSchedule({ schedule: 'every 5 minutes', secrets: [meshyApiKey] }, async () => {
  const active = await getFirestore().collection('jobs').where('status', 'in', ACTIVE).get();
  const time = Date.now();
  for (const job of active.docs) {
    try {
      await sweepJob(job, time);
    } catch (error) {
      logger.error(`Sweep failed for job ${job.id}.`, error);
    }
  }
  await sweepPosters(time).catch(error => logger.error('Sweeping stale posters failed.', error));
});
