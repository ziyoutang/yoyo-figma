import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capError, capReached, DAILY_PUBLISHES, isOwnPoster, jobIdFromModelPath, layoutFor, LIVE_HEROES, posterFits, posterPaths, publishesToday, staleFiles, stalePosters, validateSnapshot } from './heroes';
import { choices, colors, ranges, textLimits } from './heroOptions';

const snapshot = {
  frame: 'Both', layout: 'Centered', template: 'Studio Glow', background: 'Custom', lighting: 'Dramatic', motion: 'Sway', direction: 'Reverse', camera: 'Push-in',
  material: 'Metallic', backgroundColor: '#EEDDCC', lightingColor: '#ff8800', color: '#123456', secondColor: '#fcffbc', speed: 1.5, amount: 70,
  eyebrow: 'Made with Meshy', headline: 'Design that\nmoves you.', subtitle: '', buttonLabel: 'Shop', buttonUrl: 'https://example.test/shop?a=1',
};
const refused = (value: unknown, field: string) => assert.throws(() => validateSnapshot(value), (error: { code: string; message: string }) => error.code === 'invalid-argument' && error.message.includes(field), field);

test('validateSnapshot keeps a valid snapshot, in the studio field order', () => {
  assert.deepEqual(validateSnapshot(snapshot), snapshot);
  assert.deepEqual(Object.keys(validateSnapshot({ ...snapshot, eyebrow: snapshot.eyebrow })), Object.keys(snapshot));
  assert.equal(validateSnapshot({ ...snapshot, buttonUrl: '' }).buttonUrl, '');
  for (const [field, values] of Object.entries(choices)) for (const value of values) assert.equal(validateSnapshot({ ...snapshot, [field]: value })[field], value);
  for (const [field, [min, max]] of Object.entries(ranges)) for (const value of [min, max]) assert.equal(validateSnapshot({ ...snapshot, [field]: value })[field], value);
  for (const [field, limit] of Object.entries(textLimits)) if (field !== 'buttonUrl') assert.equal(validateSnapshot({ ...snapshot, [field]: 'x'.repeat(limit) })[field], 'x'.repeat(limit));
});

test('validateSnapshot refuses each bad field by name', () => {
  for (const value of [null, 'text', [], 7]) refused(value, 'settings');
  refused({ ...snapshot, prompt: 'secret' }, 'prompt');
  for (const field of Object.keys(choices)) for (const value of ['Other', '', undefined, 1]) refused({ ...snapshot, [field]: value }, field);
  for (const field of colors) for (const value of ['#fff', 'red', '#12345g', '#1234567', 0x123456]) refused({ ...snapshot, [field]: value }, field);
  for (const [field, [min, max]] of Object.entries(ranges)) for (const value of [min - .01, max + .01, Number.NaN, String(min), null]) refused({ ...snapshot, [field]: value }, field);
  for (const [field, limit] of Object.entries(textLimits)) for (const value of ['x'.repeat(limit + 1), 5, null]) refused({ ...snapshot, [field]: value }, field);
  for (const link of ['http://example.test', 'javascript:alert(1)', 'https:example.test', 'example.test', 'https://', `https://example.test/${'x'.repeat(2030)}`]) refused({ ...snapshot, buttonUrl: link }, 'buttonUrl');
});

test('only your own models/{uid}/{jobId}/model.glb can be published', () => {
  assert.equal(jobIdFromModelPath('u1', 'models/u1/job1/model.glb'), 'job1');
  for (const path of ['models/u2/job1/model.glb', 'models/u1/job1/thumbnail.png', 'models/u1/job1/model.glb/x', 'models/u1/../model.glb', 'uploads/u1/job1/model.glb', 'models/u1//model.glb', 7, undefined]) {
    assert.throws(() => jobIdFromModelPath('u1', path), { code: 'invalid-argument' }, String(path));
  }
});

test('posters are exactly the frame needs, from your own poster uploads', () => {
  assert.deepEqual(posterPaths('u1', 'Desktop', { desktop: 'uploads/u1/poster-a.png' }), [['desktop', 'uploads/u1/poster-a.png']]);
  assert.deepEqual(posterPaths('u1', 'Mobile', { mobile: 'uploads/u1/poster-b.png' }), [['mobile', 'uploads/u1/poster-b.png']]);
  assert.deepEqual(posterPaths('u1', 'Both', { mobile: 'uploads/u1/poster-b.png', desktop: 'uploads/u1/poster-a.png' }), [['desktop', 'uploads/u1/poster-a.png'], ['mobile', 'uploads/u1/poster-b.png']]);
  for (const [frame, posters] of [
    ['Desktop', {}], ['Desktop', { mobile: 'uploads/u1/poster-b.png' }], ['Desktop', { desktop: 'uploads/u1/poster-a.png', mobile: 'uploads/u1/poster-b.png' }], ['Both', { desktop: 'uploads/u1/poster-a.png' }],
    ['Desktop', { desktop: 'uploads/u2/poster-a.png' }], ['Desktop', { desktop: 'uploads/u1/x/poster-a.png' }], ['Desktop', { desktop: 'models/u1/j/model.glb' }], ['Desktop', null],
    // Another upload, such as a generation photo, is never a poster, so a publish can't delete it.
    ['Desktop', { desktop: 'uploads/u1/a.png' }],
  ] as const) assert.throws(() => posterPaths('u1', frame, posters), { code: 'invalid-argument' }, JSON.stringify([frame, posters]));
  assert.equal(isOwnPoster('u1', 'uploads/u1/poster-a.png'), true);
  for (const path of ['uploads/u1/a.png', 'uploads/u1/poster-', 'uploads/u1/', 'uploads/u2/poster-a.png', 'uploads/u1/x/poster-a.png', 'xuploads/u1/poster-a.png', 7]) assert.equal(isOwnPoster('u1', path), false, String(path));
});

test('the sweep takes only posters older than 10 minutes', () => {
  const time = Date.parse('2026-11-12T12:00:00Z'), at = (minutes: number) => ({ timeCreated: new Date(time - minutes * 60_000).toISOString() });
  const files = [
    { name: 'uploads/u1/poster-old.png', metadata: at(11) }, { name: 'uploads/u2/poster-old.png', metadata: at(60) }, { name: 'uploads/u1/poster-new.png', metadata: at(9) },
    { name: 'uploads/u1/photo.png', metadata: at(60) }, { name: 'uploads/u1/x/poster-old.png', metadata: at(60) }, { name: 'models/u1/j/poster-old.png', metadata: at(60) },
    { name: 'uploads/u1/poster-undated.png', metadata: {} },
  ];
  assert.deepEqual(stalePosters(files, time), ['uploads/u1/poster-old.png', 'uploads/u2/poster-old.png']);
});

test('the Figma layout is optional, but covers exactly the frame\'s kinds when sent', () => {
  const desktop = { backdrop: { type: 'solid', color: '#ffffff' }, copy: null };
  const mobile = { backdrop: { type: 'linear', angle: 125, stops: [{ color: '#ffffff', at: 0.03 }, { color: '#a8e44d', at: 0.75 }] }, copy: { x: 0.09, y: 0.21, width: 0.82, align: 'left' },
    headline: { gap: 0, size: 0.0857, lineHeight: 0.10284, letterSpacing: -0.00147, weight: 700, color: '#000000', lines: 2 } };
  assert.equal(layoutFor('Desktop', undefined), undefined);
  assert.deepEqual(layoutFor('Desktop', { desktop }), { desktop });
  assert.deepEqual(layoutFor('Mobile', { mobile }), { mobile });
  assert.deepEqual(layoutFor('Both', { mobile, desktop }), { desktop, mobile });
  for (const [frame, layout, field] of [
    ['Desktop', { mobile }, 'layout must have the desktop frame'], ['Both', { desktop }, 'layout must have the desktop and mobile frames'], ['Desktop', null, 'layout must have'],
    ['Mobile', { mobile: { ...mobile, headline: { ...mobile.headline, size: 0.6 } } }, 'layout.mobile.headline.size'], ['Desktop', { desktop: { ...desktop, secret: 'x' } }, 'layout.desktop.secret'],
  ] as const) assert.throws(() => layoutFor(frame, layout), (error: { code: string; message: string }) => error.code === 'invalid-argument' && error.message.includes(field), field);
});

test('posters are 2880 or 780 px wide, within 2 px of the frame proportions', () => {
  for (const height of [1670, 1671, 1673]) assert.equal(posterFits('desktop', 2880, height), true, String(height));
  for (const height of [1669, 1674]) assert.equal(posterFits('desktop', 2880, height), false, String(height));
  for (const height of [1090, 1092, 1094]) assert.equal(posterFits('mobile', 780, height), true, String(height));
  for (const height of [1089, 1095]) assert.equal(posterFits('mobile', 780, height), false, String(height));
  assert.equal(posterFits('desktop', 2879, 1671), false);
  assert.equal(posterFits('mobile', 2880, 1671), false);
  assert.equal(posterFits('desktop', 2880, undefined), false);
});

test('caps: 20 publishes a UTC day, updates included, and 10 live heroes', () => {
  assert.equal(publishesToday({ publishDay: '2026-11-11', publishCount: 7 }, '2026-11-11'), 7);
  assert.equal(publishesToday({ publishDay: '2026-11-10', publishCount: 7 }, '2026-11-11'), 0);
  assert.equal(publishesToday({}, '2026-11-11'), 0);
  assert.equal(capReached({ today: DAILY_PUBLISHES - 1, liveHeroes: LIVE_HEROES - 1, live: false }), null);
  assert.equal(capReached({ today: DAILY_PUBLISHES, liveHeroes: 0, live: true }), 'daily');
  assert.equal(capReached({ today: 0, liveHeroes: LIVE_HEROES, live: false }), 'live');
  // Updating a hero that's already live doesn't add one.
  assert.equal(capReached({ today: 0, liveHeroes: LIVE_HEROES, live: true }), null);
  assert.deepEqual([capError('daily').code, capError('daily').details, capError('live').details], ['resource-exhausted', { cap: 'daily' }, { cap: 'live' }]);
  assert.equal(capError('live').message, 'You have 10 published heroes. Unpublish one to publish another.');
  assert.equal(capError('daily').message, 'You\'ve published 20 times today. Try again after midnight UTC.');
});

test('clean-up keeps hero.json and the live version only', () => {
  const folder = 'public/heroes/h1';
  const names = ['hero.json', 'v1/model.glb', 'v1/poster-desktop.webp', 'v2/model.glb', 'v2/poster-desktop.webp', 'v12/model.glb', 'stray.txt'].map(name => `${folder}/${name}`);
  assert.deepEqual(staleFiles(names, folder, 2), ['v1/model.glb', 'v1/poster-desktop.webp', 'v12/model.glb', 'stray.txt'].map(name => `${folder}/${name}`));
  assert.deepEqual(staleFiles(names, folder, 1), ['v2/model.glb', 'v2/poster-desktop.webp', 'v12/model.glb', 'stray.txt'].map(name => `${folder}/${name}`));
});
