import { randomUUID } from 'node:crypto';
import { getFirestore, FieldValue, Timestamp, type DocumentReference, type DocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/https';
import { requireAllowedUser } from './access';
import { validateLayout } from './figmaLayout';
import { choices, colors, ranges, textLimits } from './heroOptions';
import { utcDay } from './jobs';

// Publishing freezes a hero's settings and saves its model and posters under public/heroes/{heroId}/, where anyone
// can get a file by its exact path. hero.json names the live version and is written last.
export const LIVE_HEROES = 10;
export const DAILY_PUBLISHES = 20;
const LEASE_MS = 2 * 60_000;
const MAX_POSTER_BYTES = 20 * 1024 * 1024;
const PIXEL_LIMIT = 2880 * 2880;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const HERO_ID = /^[A-Za-z0-9]{20}$/;
// Posters are the 3D layer at twice the frame width, at the Complete screen's proportions.
export const posterSizes = { desktop: { width: 2880, ratio: 419 / 722 }, mobile: { width: 780, ratio: 490 / 350 } };
type PosterKind = keyof typeof posterSizes;
export type Snapshot = Record<string, string | number>;
const fields = [...Object.keys(choices), ...colors, ...Object.keys(ranges), ...Object.keys(textLimits)];
const now = () => FieldValue.serverTimestamp();
const refuse = (message: string) => new HttpsError('invalid-argument', message);
const busy = () => new HttpsError('aborted', 'This hero is already publishing. Try again in a minute.');

// The snapshot in the studio's field order, or a refusal that names the field.
export function validateSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw refuse('Send the hero settings.');
  const input = value as Record<string, unknown>;
  const unknown = Object.keys(input).find(field => !fields.includes(field));
  if (unknown) throw refuse(`Unknown setting: ${unknown}.`);
  for (const [field, options] of Object.entries(choices)) if (!(options as readonly unknown[]).includes(input[field])) throw refuse(`${field} must be one of: ${options.join(', ')}.`);
  for (const field of colors) if (typeof input[field] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input[field])) throw refuse(`${field} must be a #rrggbb colour.`);
  for (const [field, [min, max]] of Object.entries(ranges)) {
    const number = input[field];
    if (typeof number !== 'number' || !(number >= min && number <= max)) throw refuse(`${field} must be a number from ${min} to ${max}.`);
  }
  for (const [field, limit] of Object.entries(textLimits)) {
    const text = input[field];
    if (typeof text !== 'string' || text.length > limit) throw refuse(`${field} must be text of at most ${limit} characters.`);
  }
  const link = input.buttonUrl as string;
  if (link && !(link.startsWith('https://') && URL.canParse(link))) throw refuse('buttonUrl must be a link that starts with https://.');
  return Object.fromEntries(fields.map(field => [field, input[field] as string | number]));
}

// The job id in models/{uid}/{jobId}/model.glb, the only models a person may publish.
export function jobIdFromModelPath(uid: string, path: unknown) {
  const [root, owner, jobId, file, ...rest] = typeof path === 'string' ? path.split('/') : [];
  if (root !== 'models' || owner !== uid || !/^[A-Za-z0-9]{1,64}$/.test(jobId ?? '') || file !== 'model.glb' || rest.length) throw refuse('Choose one of your finished models.');
  return jobId;
}

// The studio uploads posters as uploads/{uid}/poster-{name}. Only those can be published, so a publish never deletes
// another upload, and sweepJobs deletes the ones no publish took.
const POSTER = /^uploads\/([^/]+)\/poster-[^/]+$/;
const STALE_POSTER_MS = 10 * 60_000;

export const isOwnPoster = (uid: string, path: unknown): path is string => typeof path === 'string' && POSTER.exec(path)?.[1] === uid;

// Posters older than 10 minutes: the call never reached publishHero, or the other poster's upload failed.
export const stalePosters = (files: {name: string; metadata: {timeCreated?: string}}[], time: number) =>
  files.filter(file => POSTER.test(file.name) && time - Date.parse(file.metadata.timeCreated ?? '') > STALE_POSTER_MS).map(file => file.name);

// The frame's kinds: desktop for Desktop, mobile for Mobile, both for Both.
const kindsOf = (frame: unknown): PosterKind[] => frame === 'Both' ? ['desktop', 'mobile'] : frame === 'Mobile' ? ['mobile'] : ['desktop'];

// Exactly the posters the frame needs.
export function posterPaths(uid: string, frame: unknown, posters: unknown): [PosterKind, string][] {
  const needed = kindsOf(frame);
  const sent = posters && typeof posters === 'object' ? posters as Record<string, unknown> : {};
  if (Object.keys(sent).sort().join() !== needed.join() || !needed.every(kind => isOwnPoster(uid, sent[kind]))) {
    throw refuse(`Send the ${needed.join(' and ')} poster${needed.length > 1 ? 's' : ''} as your own uploads.`);
  }
  return needed.map(kind => [kind, sent[kind] as string]);
}

// The Figma layout for each of the frame's kinds, or none: a studio tab opened before Phase 5 sends none, and its hero
// can't be placed in Figma until it is updated.
export function layoutFor(frame: unknown, layout: unknown) {
  if (layout === undefined) return undefined;
  try {
    return validateLayout(layout, kindsOf(frame));
  } catch (error) {
    throw refuse((error as Error).message);
  }
}

// The width is exact; the height may be 2 px off the frame's proportions.
export function posterFits(kind: PosterKind, width?: number, height?: number) {
  const { width: expected, ratio } = posterSizes[kind];
  return width === expected && height !== undefined && Math.abs(height - expected * ratio) <= 2;
}

// Publishes counted today; the count starts again each UTC day.
export const publishesToday = (user: Record<string, unknown>, day: string) => user.publishDay === day && typeof user.publishCount === 'number' ? user.publishCount : 0;

// Updates count toward the daily cap; only a hero that isn't live yet counts toward the live cap.
export function capReached({ today, liveHeroes, live }: {today: number; liveHeroes: number; live: boolean}): 'daily' | 'live' | null {
  if (today >= DAILY_PUBLISHES) return 'daily';
  if (!live && liveHeroes >= LIVE_HEROES) return 'live';
  return null;
}

export const capError = (cap: 'daily' | 'live') => new HttpsError('resource-exhausted', cap === 'daily'
  ? `You've published ${DAILY_PUBLISHES} times today. Try again after midnight UTC.`
  : `You have ${LIVE_HEROES} published heroes. Unpublish one to publish another.`, { cap });

// Once hero.json names version n, every other file in the hero folder goes.
export const staleFiles = (names: string[], folder: string, version: number) => names.filter(name => name !== `${folder}/hero.json` && !name.startsWith(`${folder}/v${version}/`));

function ownHero(hero: DocumentSnapshot, uid: string) {
  if (!hero.exists) throw new HttpsError('not-found', 'This hero no longer exists.');
  if (hero.get('owner') !== uid) throw new HttpsError('permission-denied', 'This hero belongs to someone else.');
}

const leaseHeld = (hero: DocumentSnapshot) => ((hero.get('lease')?.until as Timestamp | undefined)?.toMillis() ?? 0) > Date.now();
const newLease = (id: string) => ({ id, until: Timestamp.fromMillis(Date.now() + LEASE_MS) });

async function releaseLease(heroRef: DocumentReference, id: string) {
  await getFirestore().runTransaction(async tx => {
    if ((await tx.get(heroRef)).get('lease')?.id === id) tx.update(heroRef, { lease: null });
  }).catch(error => logger.error(`Releasing the lease on hero ${heroRef.id} failed; it expires in 2 minutes.`, error));
}

// A publish that failed after Transaction A gives back its daily count, and a new hero's empty record goes. Only while
// it still holds the lease, and only if this version never went live: Transaction B may have committed before its call failed.
async function uncount(heroRef: DocumentReference, userRef: DocumentReference, lease: string, version: number, day: string, created: boolean) {
  await getFirestore().runTransaction(async tx => {
    const [hero, user] = await tx.getAll(heroRef, userRef);
    if (hero.get('lease')?.id !== lease || hero.get('version') === version) return;
    if (user.get('publishDay') === day) tx.update(userRef, { publishCount: FieldValue.increment(-1) });
    if (created && hero.get('status') !== 'published') tx.delete(heroRef);
  }).catch(error => logger.error(`Giving back the failed publish of hero ${heroRef.id} failed.`, error));
}

// Clean-up that must not hide the call's own result.
async function remove(paths: string[]) {
  const bucket = getStorage().bucket();
  await Promise.all(paths.map(path => bucket.file(path).delete({ ignoreNotFound: true }).catch(error => logger.error(`Deleting ${path} failed.`, error))));
}

// sweepJobs runs this. It lists every upload and keeps all but stale posters.
export async function sweepPosters(time: number) {
  const [files] = await getStorage().bucket().getFiles({ prefix: 'uploads/' });
  await remove(stalePosters(files, time));
}

async function readPoster(kind: PosterKind, path: string) {
  const { default: sharp } = await import('sharp');
  const file = getStorage().bucket().file(path);
  const [metadata] = await file.getMetadata().catch(() => [null]);
  const data = metadata?.contentType === 'image/png' && Number(metadata.size) <= MAX_POSTER_BYTES ? (await file.download())[0] : null;
  const info = data && await sharp(data, { limitInputPixels: PIXEL_LIMIT }).metadata().catch(() => null);
  if (!data || info?.format !== 'png' || !posterFits(kind, info.width, info.height)) {
    throw refuse(`The ${kind} poster must be a PNG under 20 MB, ${posterSizes[kind].width} px wide at the frame's proportions.`);
  }
  return data;
}

export async function publish(request: CallableRequest) {
  const { uid } = await requireAllowedUser(request.auth);
  const { heroId, modelPath, snapshot, posters, layout } = (request.data ?? {}) as Record<string, unknown>;
  // Uploaded posters are single-use, so the caller's own go whatever happens.
  const uploads = posters && typeof posters === 'object' ? Object.values(posters).filter(path => isOwnPoster(uid, path)) : [];
  try {
    return await publishFor(uid, heroId, modelPath, snapshot, posters, layout);
  } finally {
    await remove(uploads);
  }
}

async function publishFor(uid: string, heroId: unknown, modelPath: unknown, snapshot: unknown, posters: unknown, layout: unknown) {
  const shown = validateSnapshot(snapshot), figma = layoutFor(shown.frame, layout);
  if (heroId !== undefined && (typeof heroId !== 'string' || !HERO_ID.test(heroId))) throw refuse('Send a hero id.');
  const db = getFirestore(), bucket = getStorage().bucket();
  const job = await db.doc(`jobs/${jobIdFromModelPath(uid, modelPath)}`).get();
  if (job.get('owner') !== uid || job.get('status') !== 'ready' || job.get('modelPath') !== modelPath) throw refuse('Choose one of your finished models.');
  const images = await Promise.all(posterPaths(uid, shown.frame, posters).map(async ([kind, path]) => [kind, await readPoster(kind, path)] as const));

  // Transaction A: count the publish, take the next version and hold the hero's lease.
  const heroRef = typeof heroId === 'string' ? db.doc(`heroes/${heroId}`) : db.collection('heroes').doc();
  const userRef = db.doc(`users/${uid}`), lease = randomUUID(), day = utcDay(new Date());
  const version: number = await db.runTransaction(async tx => {
    const [hero, user] = await tx.getAll(heroRef, userRef);
    if (heroId !== undefined) ownHero(hero, uid);
    if (leaseHeld(hero)) throw busy();
    const today = publishesToday(user.data() ?? {}, day);
    const cap = capReached({ today, liveHeroes: user.get('liveHeroes') ?? 0, live: hero.get('status') === 'published' });
    if (cap) throw capError(cap);
    const next = hero.get('nextVersion') ?? 1;
    tx.set(userRef, { publishDay: day, publishCount: today + 1 }, { merge: true });
    const held = { nextVersion: next + 1, lease: newLease(lease), updatedAt: now() };
    if (hero.exists) tx.update(heroRef, held);
    else tx.create(heroRef, { owner: uid, status: 'unpublished', version: 0, snapshot: null, modelPath: null, createdAt: now(), publishedAt: null, ...held });
    return next;
  });

  const folder = `public/heroes/${heroRef.id}`, dir = `${folder}/v${version}`;
  const published = { ...shown, textured: job.get('kind') === 'look' };
  let committed = false;
  try {
    // Saved fresh rather than copied, so the public model never carries the source's download token.
    const [model] = await bucket.file(modelPath as string).download();
    await bucket.file(`${dir}/model.glb`).save(model, { contentType: 'model/gltf-binary', metadata: { cacheControl: IMMUTABLE } });
    const { default: sharp } = await import('sharp');
    for (const [kind, image] of images) {
      const webp = await sharp(image, { limitInputPixels: PIXEL_LIMIT }).webp({ quality: 80 }).toBuffer();
      await bucket.file(`${dir}/poster-${kind}.webp`).save(webp, { contentType: 'image/webp', metadata: { cacheControl: IMMUTABLE } });
    }

    // Transaction B: the record goes live. The lease stays until hero.json is written, so Unpublish can't run in between.
    await db.runTransaction(async tx => {
      const [hero, user] = await tx.getAll(heroRef, userRef);
      if (hero.get('lease')?.id !== lease) throw busy();
      const live = hero.get('status') === 'published';
      if (!live && (user.get('liveHeroes') ?? 0) >= LIVE_HEROES) throw capError('live');
      tx.update(heroRef, { status: 'published', version, snapshot: published, modelPath, updatedAt: now(), publishedAt: now() });
      if (!live) tx.set(userRef, { liveHeroes: FieldValue.increment(1) }, { merge: true });
    });
    committed = true;

    const heroJson = { version, model: `v${version}/model.glb`, posters: Object.fromEntries(images.map(([kind]) => [kind, `v${version}/poster-${kind}.webp`])), ...(figma && { layout: figma }), snapshot: published };
    try {
      await bucket.file(`${folder}/hero.json`).save(JSON.stringify(heroJson), { contentType: 'application/json', metadata: { cacheControl: 'public, max-age=60' } });
    } catch (error) {
      logger.error(`Writing hero.json for hero ${heroRef.id} failed; the previous version stays public.`, error);
      throw new HttpsError('unavailable', 'The hero was saved but isn\'t public yet. Publish again to finish.');
    }
    const [stored] = await bucket.getFiles({ prefix: `${folder}/` });
    await remove(staleFiles(stored.map(file => file.name), folder, version));
  } catch (error) {
    // Before Transaction B the live version is untouched; only this version's files go, and the publish isn't counted.
    if (!committed) {
      await bucket.deleteFiles({ prefix: `${dir}/` }).catch(cleanup => logger.error(`Deleting ${dir} failed.`, cleanup));
      await uncount(heroRef, userRef, lease, version, day, heroId === undefined);
    }
    throw error;
  } finally {
    await releaseLease(heroRef, lease);
  }
  return { heroId: heroRef.id, version, viewer: `https://${process.env.GCLOUD_PROJECT}.web.app/embed/${heroRef.id}` };
}

export async function unpublish(request: CallableRequest) {
  const { uid } = await requireAllowedUser(request.auth);
  const heroId = (request.data ?? {}).heroId;
  if (typeof heroId !== 'string' || !HERO_ID.test(heroId)) throw refuse('Send a hero id.');
  const db = getFirestore(), heroRef = db.doc(`heroes/${heroId}`), lease = randomUUID();
  // The lease keeps a publish from writing files while this deletes them.
  await db.runTransaction(async tx => {
    const hero = await tx.get(heroRef);
    ownHero(hero, uid);
    if (leaseHeld(hero)) throw busy();
    tx.update(heroRef, { lease: newLease(lease) });
  });
  try {
    // Always deleted, so calling again finishes an earlier call whose deletes failed. The record stays published
    // until they're gone, so the studio keeps offering Unpublish.
    await getStorage().bucket().deleteFiles({ prefix: `public/heroes/${heroId}/` });
    await db.runTransaction(async tx => {
      const hero = await tx.get(heroRef);
      if (hero.get('lease')?.id !== lease) throw busy();
      if (hero.get('status') !== 'published') return;
      tx.update(heroRef, { status: 'unpublished', updatedAt: now() });
      tx.set(db.doc(`users/${uid}`), { liveHeroes: FieldValue.increment(-1) }, { merge: true });
    });
  } finally {
    await releaseLease(heroRef, lease);
  }
  return { heroId, status: 'unpublished' };
}
