import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, mock, test } from 'node:test';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import type { CallableRequest } from 'firebase-functions/https';
import sharp from 'sharp';
import { sweepPosters } from './heroes';
import { utcDay } from './jobs';
import { publishHero, unpublishHero } from './index';

// Run with `npm run test:emulator`: the Firestore and Storage emulators under a demo- project, which can't reach real data.
before(() => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST && process.env.GCLOUD_PROJECT?.startsWith('demo-'), 'Run this through npm run test:emulator.');
});

const db = () => getFirestore(), bucket = () => getStorage().bucket();
const IMMUTABLE = 'public, max-age=31536000, immutable';
const snapshot = {
  frame: 'Desktop', layout: 'Object Right', template: 'Studio Glow', background: 'Template', lighting: 'Soft', motion: 'Float', direction: 'Auto', camera: 'Static',
  material: 'Original', backgroundColor: '#ffffff', lightingColor: '#ffffff', color: '#9e8265', secondColor: '#fcffbc', speed: 0.8, amount: 42,
  eyebrow: 'Made with Meshy', headline: 'Design that\nmoves you.', subtitle: 'A little dimension goes a long way.', buttonLabel: 'Explore', buttonUrl: 'https://example.test/',
};
const sizes = { desktop: [2880, 1671], mobile: [780, 1092] } as const;
type Who = {uid: string; auth: unknown};

let people = 0;
async function person(): Promise<Who> {
  const uid = `person${++people}`, email = `${uid}@example.test`;
  await db().doc(`allowedUsers/${email}`).set({ enabled: true });
  return { uid, auth: { uid, token: { email, email_verified: true, firebase: { sign_in_provider: 'google.com' } } } };
}

// A finished job with a model that carries a download token, as ingestModel saves them.
async function model(uid: string, { kind = 'look', status = 'ready' } = {}) {
  const job = db().collection('jobs').doc(), modelPath = `models/${uid}/${job.id}/model.glb`;
  await bucket().file(modelPath).save(Buffer.from(`glTF ${job.id}`), { contentType: 'model/gltf-binary', metadata: { metadata: { firebaseStorageDownloadTokens: `source-${job.id}` } } });
  await job.set({ owner: uid, kind, status, modelPath });
  return modelPath;
}

const png = ([width, height]: readonly [number, number]) => sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
async function upload(uid: string, data: Buffer, name = `poster-${randomUUID()}.png`) {
  const path = `uploads/${uid}/${name}`;
  await bucket().file(path).save(data, { contentType: 'image/png' });
  return path;
}

const call = (fn: {run: (request: CallableRequest) => Promise<unknown>}, who: Who, data: unknown) => fn.run({ auth: who.auth, data, app: { appId: 'app', token: {}, alreadyConsumed: false } } as unknown as CallableRequest);
async function publish(who: Who, modelPath: string, { heroId, poster, figma, ...changes }: {heroId?: string; poster?: Buffer; figma?: unknown} & Partial<typeof snapshot> = {}) {
  const shown = { ...snapshot, ...changes }, kinds = shown.frame === 'Both' ? ['desktop', 'mobile'] as const : shown.frame === 'Mobile' ? ['mobile'] as const : ['desktop'] as const;
  const posters: Record<string, string> = Object.fromEntries(await Promise.all(kinds.map(async kind => [kind, await upload(who.uid, poster ?? await png(sizes[kind]))])));
  return { posters: Object.values(posters), result: call(publishHero, who, { heroId, modelPath, snapshot: shown, posters, layout: figma }) as Promise<{heroId: string; version: number; viewer: string}> };
}
const published = async (...args: Parameters<typeof publish>) => (await publish(...args)).result;
const unpublish = (who: Who, heroId: string) => call(unpublishHero, who, { heroId });

const files = async (heroId: string) => (await bucket().getFiles({ prefix: `public/heroes/${heroId}/` }))[0].map(file => file.name.slice(`public/heroes/${heroId}/`.length)).sort();
const read = async (path: string) => (await bucket().file(path).download())[0];
const exists = async (path: string) => (await bucket().file(path).exists())[0];
const record = async (heroId: string) => (await db().doc(`heroes/${heroId}`).get()).data()!;
const user = async (uid: string) => (await db().doc(`users/${uid}`).get()).data() ?? {};
const cap = (code: string, which?: string) => (error: { code: string; details?: { cap?: string } }) => error.code === code && error.details?.cap === which;

// hero.json names only files that exist, and nothing private.
async function heroJson(heroId: string, uid: string) {
  const hero = JSON.parse((await read(`public/heroes/${heroId}/hero.json`)).toString());
  for (const name of [hero.model, ...Object.values(hero.posters)]) assert.ok(await exists(`public/heroes/${heroId}/${name}`), `${name} exists`);
  assert.doesNotMatch(JSON.stringify(hero), new RegExp(`${uid}|models/|uploads/|owner|job`, 'i'));
  return hero;
}

test('publishes a new hero: public files with their caching, no source token, posters as WebP', async () => {
  const who = await person(), modelPath = await model(who.uid);
  const { posters, result } = await publish(who, modelPath, { frame: 'Both' });
  const { heroId, version, viewer } = await result;
  assert.match(heroId, /^[A-Za-z0-9]{20}$/);
  assert.equal(version, 1);
  assert.equal(viewer, `https://${process.env.GCLOUD_PROJECT}.web.app/embed/${heroId}`);
  assert.deepEqual(await files(heroId), ['hero.json', 'v1/model.glb', 'v1/poster-desktop.webp', 'v1/poster-mobile.webp']);
  const hero = await heroJson(heroId, who.uid);
  assert.deepEqual(hero, { version: 1, model: 'v1/model.glb', posters: { desktop: 'v1/poster-desktop.webp', mobile: 'v1/poster-mobile.webp' }, snapshot: { ...snapshot, frame: 'Both', textured: true } });
  assert.deepEqual(await read(`public/heroes/${heroId}/v1/model.glb`), await read(modelPath));

  const source = (await bucket().file(modelPath).getMetadata())[0].metadata?.firebaseStorageDownloadTokens;
  for (const [name, type, cache] of [['hero.json', 'application/json', 'public, max-age=60'], ['v1/model.glb', 'model/gltf-binary', IMMUTABLE], ['v1/poster-desktop.webp', 'image/webp', IMMUTABLE], ['v1/poster-mobile.webp', 'image/webp', IMMUTABLE]]) {
    const [metadata] = await bucket().file(`public/heroes/${heroId}/${name}`).getMetadata();
    assert.deepEqual([metadata.contentType, metadata.cacheControl], [type, cache], name);
    assert.notEqual(metadata.metadata?.firebaseStorageDownloadTokens, source, `${name} has no source token`);
  }
  for (const [name, width] of [['desktop', 2880], ['mobile', 780]] as const) {
    const info = await sharp(await read(`public/heroes/${heroId}/v1/poster-${name}.webp`)).metadata();
    assert.deepEqual([info.format, info.width, info.hasAlpha], ['webp', width, true], name);
  }
  for (const path of posters) assert.equal(await exists(path), false, 'uploaded poster deleted');
  assert.deepEqual(await record(heroId), { ...await record(heroId), owner: who.uid, status: 'published', version: 1, nextVersion: 2, lease: null, modelPath, snapshot: hero.snapshot });
  assert.deepEqual(await user(who.uid), { ...await user(who.uid), liveHeroes: 1, publishCount: 1, publishDay: utcDay(new Date()) });
});

test('publishing again updates the same link: v2 live, v1 files gone', async () => {
  const who = await person(), modelPath = await model(who.uid, { kind: 'shape' });
  const { heroId } = await published(who, modelPath);
  const update = await published(who, modelPath, { heroId, headline: 'New headline' });
  assert.deepEqual([update.heroId, update.version], [heroId, 2]);
  assert.deepEqual(await files(heroId), ['hero.json', 'v2/model.glb', 'v2/poster-desktop.webp']);
  const hero = await heroJson(heroId, who.uid);
  assert.deepEqual([hero.version, hero.snapshot.headline, hero.snapshot.textured], [2, 'New headline', false]);
  assert.deepEqual([(await record(heroId)).version, (await user(who.uid)).liveHeroes, (await user(who.uid)).publishCount], [2, 1, 2]);
});

test('hero.json keeps the Figma layout beside the posters; a publish without one has none, and a bad one is refused', async () => {
  const who = await person(), modelPath = await model(who.uid);
  const desktop = { backdrop: { type: 'linear', angle: 125, stops: [{ color: '#ffffff', at: 0.03 }, { color: '#a8e44d', at: 0.75 }] }, copy: { x: 0.082, y: 0.09703, width: 0.4, align: 'left' },
    headline: { gap: 0, size: 0.0552, lineHeight: 0.06624, letterSpacing: -0.00109, weight: 700, color: '#000000', lines: 2 } };
  const mobile = { backdrop: { type: 'solid', color: '#eeddcc' }, copy: null };
  const { heroId } = await published(who, modelPath, { frame: 'Both', figma: { mobile, desktop } });
  const hero = await heroJson(heroId, who.uid);
  assert.deepEqual(Object.keys(hero), ['version', 'model', 'posters', 'layout', 'snapshot']);
  assert.deepEqual(hero.layout, { desktop, mobile });
  // A studio tab opened before the functions deploy sends no layout.
  await published(who, modelPath, { heroId });
  assert.equal('layout' in await heroJson(heroId, who.uid), false);
  // Refused by name before anything is counted, and the caller's posters still go.
  const bad = await publish(who, modelPath, { heroId, figma: { desktop: { ...desktop, copy: { ...desktop.copy, x: 2 } } } });
  await assert.rejects(bad.result, { code: 'invalid-argument', message: 'layout.desktop.copy.x must be a number from 0 to 1.5.' });
  for (const path of bad.posters) assert.equal(await exists(path), false);
  await assert.rejects(published(who, modelPath, { heroId, figma: { desktop, mobile } }), { code: 'invalid-argument', message: 'layout must have the desktop frame.' });
  assert.deepEqual([(await record(heroId)).version, (await user(who.uid)).publishCount], [2, 2]);
  await heroJson(heroId, who.uid);
});

test('unpublish takes the files down, twice changes nothing, and publishing again keeps the id', async () => {
  const who = await person(), modelPath = await model(who.uid);
  const { heroId } = await published(who, modelPath);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await unpublish(who, heroId), { heroId, status: 'unpublished' });
    assert.deepEqual(await files(heroId), []);
    assert.deepEqual([(await record(heroId)).status, (await record(heroId)).lease, (await user(who.uid)).liveHeroes], ['unpublished', null, 0]);
  }
  const again = await published(who, modelPath, { heroId, frame: 'Mobile' });
  assert.deepEqual([again.heroId, again.version], [heroId, 2]);
  assert.deepEqual(await files(heroId), ['hero.json', 'v2/model.glb', 'v2/poster-mobile.webp']);
  await heroJson(heroId, who.uid);
  assert.deepEqual([(await record(heroId)).status, (await user(who.uid)).liveHeroes], ['published', 1]);
});

test('refuses another person\'s hero or model, and a job that isn\'t ready, and still deletes the caller\'s posters', async () => {
  const owner = await person(), other = await person(), modelPath = await model(owner.uid);
  const { heroId } = await published(owner, modelPath);
  const theirs = await publish(other, await model(other.uid), { heroId });
  await assert.rejects(theirs.result, { code: 'permission-denied' });
  for (const path of theirs.posters) assert.equal(await exists(path), false);
  await assert.rejects(unpublish(other, heroId), { code: 'permission-denied' });
  await assert.rejects(published(other, modelPath), { code: 'invalid-argument' });
  await assert.rejects(published(owner, await model(owner.uid, { status: 'running' })), { code: 'invalid-argument' });
  await assert.rejects(unpublish(owner, 'A'.repeat(20)), { code: 'not-found' });
  assert.deepEqual([(await record(heroId)).version, (await user(other.uid)).liveHeroes], [1, undefined]);
  await heroJson(heroId, owner.uid);
});

test('the 21st publish of a day and the 11th live hero are refused, each naming its cap', async () => {
  const who = await person(), modelPath = await model(who.uid);
  const { heroId } = await published(who, modelPath);
  await db().doc(`users/${who.uid}`).update({ liveHeroes: 10 });
  // A live hero can still be updated at the live cap.
  assert.equal((await published(who, modelPath, { heroId })).version, 2);
  await assert.rejects(published(who, modelPath), cap('resource-exhausted', 'live'));
  await db().doc(`users/${who.uid}`).update({ publishCount: 20 });
  await assert.rejects(published(who, modelPath, { heroId }), cap('resource-exhausted', 'daily'));
  assert.deepEqual([(await user(who.uid)).publishCount, (await user(who.uid)).liveHeroes], [20, 10]);
});

test('a publish or unpublish during another publish\'s lease is refused', async () => {
  const who = await person(), modelPath = await model(who.uid);
  const { heroId } = await published(who, modelPath);
  const lease = { id: 'another-publish', until: Timestamp.fromMillis(Date.now() + 60_000) };
  await db().doc(`heroes/${heroId}`).update({ lease });
  const second = await publish(who, modelPath, { heroId });
  await assert.rejects(second.result, { code: 'aborted', message: 'This hero is already publishing. Try again in a minute.' });
  for (const path of second.posters) assert.equal(await exists(path), false);
  await assert.rejects(unpublish(who, heroId), { code: 'aborted' });
  assert.deepEqual([(await record(heroId)).lease, (await record(heroId)).status], [lease, 'published']);
  // A refused publish takes no version and isn't counted; an expired lease no longer blocks.
  await db().doc(`heroes/${heroId}`).update({ lease: { ...lease, until: Timestamp.fromMillis(Date.now() - 1) } });
  assert.equal((await published(who, modelPath, { heroId })).version, 2);
  assert.equal((await user(who.uid)).publishCount, 2);
});

test('a failure before the record goes live leaves the old version live and deletes the new folder', async () => {
  const who = await person(), modelPath = await model(who.uid);
  const { heroId } = await published(who, modelPath);
  // The PNG header reads fine, so the poster passes its checks, but it can't be converted after the model is saved.
  const whole = await png(sizes.desktop), cut = whole.subarray(0, Math.floor(whole.length * .6));
  assert.equal((await sharp(cut).metadata()).width, 2880);
  const broken = await publish(who, modelPath, { heroId, poster: cut, headline: 'Never shown' });
  await assert.rejects(broken.result);
  assert.deepEqual(await files(heroId), ['hero.json', 'v1/model.glb', 'v1/poster-desktop.webp']);
  assert.equal((await heroJson(heroId, who.uid)).snapshot.headline, snapshot.headline);
  for (const path of broken.posters) assert.equal(await exists(path), false);
  const hero = await record(heroId);
  assert.deepEqual([hero.status, hero.version, hero.nextVersion, hero.lease, hero.snapshot.headline], ['published', 1, 3, null, snapshot.headline]);
  assert.deepEqual([(await user(who.uid)).liveHeroes, (await user(who.uid)).publishCount], [1, 1]);
  // Publishing again repairs it with the next version.
  assert.equal((await published(who, modelPath, { heroId })).version, 3);
  assert.deepEqual(await files(heroId), ['hero.json', 'v3/model.glb', 'v3/poster-desktop.webp']);
});

test('posters must be PNGs of the right size', async () => {
  const who = await person(), modelPath = await model(who.uid);
  const wrong = await publish(who, modelPath, { poster: await png([2880, 1700]) });
  await assert.rejects(wrong.result, { code: 'invalid-argument', message: /desktop poster/ });
  for (const path of wrong.posters) assert.equal(await exists(path), false);
  const jpeg = await sharp(await png(sizes.desktop)).jpeg().toBuffer();
  await assert.rejects(published(who, modelPath, { poster: jpeg }), { code: 'invalid-argument' });
  assert.equal((await user(who.uid)).publishCount, undefined);
});

test('a new hero whose publish fails after it was counted leaves no record and isn\'t counted', async () => {
  const who = await person(), modelPath = await model(who.uid);
  const whole = await png(sizes.desktop), cut = whole.subarray(0, Math.floor(whole.length * .6));
  const broken = await publish(who, modelPath, { poster: cut });
  await assert.rejects(broken.result);
  assert.deepEqual((await db().collection('heroes').where('owner', '==', who.uid).get()).docs.map(hero => hero.id), []);
  assert.equal((await user(who.uid)).publishCount, 0);
  for (const path of broken.posters) assert.equal(await exists(path), false);
});

test('a failed unpublish leaves the hero published, so Unpublish can run again', async () => {
  const who = await person(), modelPath = await model(who.uid);
  const { heroId } = await published(who, modelPath);
  const deleting = mock.method(Object.getPrototypeOf(bucket()), 'deleteFiles', async () => { throw new Error('Storage is unavailable.'); });
  try {
    await assert.rejects(unpublish(who, heroId), /Storage is unavailable/);
  } finally {
    deleting.mock.restore();
  }
  assert.deepEqual([(await record(heroId)).status, (await record(heroId)).lease, (await user(who.uid)).liveHeroes], ['published', null, 1]);
  await heroJson(heroId, who.uid);
  assert.deepEqual(await unpublish(who, heroId), { heroId, status: 'unpublished' });
  assert.deepEqual(await files(heroId), []);
  assert.deepEqual([(await record(heroId)).status, (await user(who.uid)).liveHeroes], ['unpublished', 0]);
});

test('only poster uploads can be published, so a publish never deletes another upload', async () => {
  const who = await person(), modelPath = await model(who.uid);
  const photo = await upload(who.uid, await png(sizes.desktop), `${randomUUID()}.png`);
  await assert.rejects(call(publishHero, who, { modelPath, snapshot, posters: { desktop: photo } }), { code: 'invalid-argument' });
  assert.equal(await exists(photo), true);
  assert.equal((await user(who.uid)).publishCount, undefined);
});

test('the sweep deletes posters no publish took once they are 10 minutes old, and nothing else', async () => {
  const who = await person(), data = await png(sizes.mobile);
  const [poster, photo] = [await upload(who.uid, data), await upload(who.uid, data, `${randomUUID()}.png`)];
  await sweepPosters(Date.now());
  assert.deepEqual([await exists(poster), await exists(photo)], [true, true]);
  await sweepPosters(Date.now() + 11 * 60_000);
  assert.deepEqual([await exists(poster), await exists(photo)], [false, true]);
});
