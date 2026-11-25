import { describe, expect, it } from 'vitest';
import { initialDraft, type Draft } from './model';
import { draftFromPublished, embedCode, publishedKey, snapshotFromDraft, type PublishedHero } from './publish';
import { sceneFromDraft } from './scene';

const shown = ['frame', 'layout', 'template', 'background', 'lighting', 'motion', 'direction', 'camera', 'material', 'backgroundColor', 'lightingColor',
  'color', 'secondColor', 'speed', 'amount', 'eyebrow', 'headline', 'subtitle', 'buttonLabel', 'buttonUrl'];
const draft: Draft = {
  ...initialDraft, connected: true, shapeReady: true, lookReady: true, placed: true,
  prompt: 'private prompt', previousPrompts: ['older private prompt'], uploadName: 'photo.png', uploadPath: 'uploads/u/photo.png', lookPrompt: 'private look',
  shapeJobId: 'shapeJob', modelJobId: 'shapeJob', lookJobId: 'lookJob', modelPath: 'models/u/shapeJob/model.glb', lookModelPath: 'models/u/lookJob/model.glb',
  placement: 'Replace Selection', frame: 'Both', layout: 'Centered', motion: 'Sway', speed: 1.5, amount: 70, direction: 'Reverse', camera: 'Push-in',
  lighting: 'Dramatic', material: 'Metallic', color: '#123456', secondColor: '#ff0000', background: 'Custom', backgroundColor: '#eeddcc', lightingColor: '#ff8800',
  headline: 'Fish & "chips"\n<now>', buttonUrl: 'https://example.test/shop',
};
const published = (from: Draft, textured: boolean): PublishedHero => ({ version: 3, model: 'v3/model.glb', posters: { desktop: 'v3/poster-desktop.webp' }, snapshot: { ...snapshotFromDraft(from), textured } });

describe('snapshotFromDraft', () => {
  it('keeps only what the hero shows', () => {
    const snapshot = snapshotFromDraft(draft);
    expect(Object.keys(snapshot)).toEqual(shown);
    expect(snapshot).toMatchObject({ frame: 'Both', motion: 'Sway', speed: 1.5, headline: 'Fish & "chips"\n<now>', buttonUrl: 'https://example.test/shop' });
    expect(JSON.stringify(snapshot)).not.toMatch(/private|photo|uploads|Job|models\/|Replace Selection/);
  });

  it('leaves out the published hero it updates', () => {
    expect(JSON.stringify(snapshotFromDraft({ ...draft, heroId: 'abcdefghij0123456789', publishedKey: 'key' }))).not.toMatch(/abcdefghij|key/);
  });
});

describe('draftFromPublished', () => {
  it('renders the same scene as the original draft, from the public model', () => {
    for (const frame of ['Desktop', 'Mobile', 'Both'] as const) for (const textured of [true, false]) {
      const original = { ...draft, frame, lookModelPath: textured ? draft.lookModelPath : '' };
      const copy = draftFromPublished('abcdefghij0123456789', published(original, textured));
      const { modelPath, ...scene } = sceneFromDraft(copy);
      const { modelPath: privatePath, ...originalScene } = sceneFromDraft(original);
      expect(scene).toEqual(originalScene);
      expect(modelPath).toBe('public/heroes/abcdefghij0123456789/v3/model.glb');
      expect(privatePath).not.toBe(modelPath);
      expect(snapshotFromDraft(copy)).toEqual(snapshotFromDraft(original));
    }
  });

  it('skips fields of the wrong type and refuses anything that is not a hero', () => {
    const hero = published(draft, false);
    const copy = draftFromPublished('abcdefghij0123456789', { ...hero, snapshot: { ...hero.snapshot, speed: 'fast', headline: 7 } });
    expect(copy).toMatchObject({ speed: initialDraft.speed, headline: initialDraft.headline, motion: 'Sway' });
    for (const broken of [null, 'text', {}, { model: 'v1/model.glb' }, { snapshot: hero.snapshot }]) expect(() => draftFromPublished('abcdefghij0123456789', broken)).toThrow();
  });
});

describe('embedCode', () => {
  const code = (frame: Draft['frame']) => embedCode({ heroId: 'abcdefghij0123456789', viewer: 'https://depth.test/embed/abcdefghij0123456789', frame, headline: draft.headline });
  const iframe = (box: string) => `<div style="container-type:inline-size"><iframe class="depth-hero-abcdefghij0123456789" src="https://depth.test/embed/abcdefghij0123456789" title="Fish &#38; &#34;chips&#34; &#60;now&#62;" loading="lazy" style="display:block;width:100%;${box};border:0"></iframe></div>`;

  it('sizes the frame for Desktop, Mobile and Both, with the headline escaped on one line', () => {
    expect(code('Desktop')).toBe(iframe('aspect-ratio:722/419'));
    expect(code('Mobile')).toBe(iframe('max-width:390px;aspect-ratio:350/490'));
    expect(code('Both')).toBe(`${iframe('aspect-ratio:722/419')}\n<style>@container (max-width:600px){.depth-hero-abcdefghij0123456789{aspect-ratio:350/490!important}}</style>`);
  });
});

describe('publishedKey', () => {
  it('changes with the model and every shown field, but not with studio-only settings', () => {
    const key = publishedKey(draft);
    expect(publishedKey({ ...draft, lookModelPath: 'models/u/otherLook/model.glb' })).not.toBe(key);
    for (const field of shown) {
      const value = draft[field as keyof typeof draft];
      expect(publishedKey({ ...draft, [field]: typeof value === 'number' ? value + .1 : `${value}x` }), field).not.toBe(key);
    }
    for (const studioOnly of [{ lowOpacity: !draft.lowOpacity }, { prompt: 'another' }, { placement: 'New Frame' as const }, { placed: false }, { heroId: 'x', publishedKey: 'y' }]) {
      expect(publishedKey({ ...draft, ...studioOnly })).toBe(key);
    }
  });

  it('differs from the key of a hero published before hero.json kept the Figma layout, so that hero offers an update', () => {
    const beforeLayout = JSON.stringify([draft.lookModelPath, snapshotFromDraft(draft)]);
    expect(publishedKey(draft)).not.toBe(beforeLayout);
    expect(publishedKey(draft)).toBe(JSON.stringify([2, draft.lookModelPath, snapshotFromDraft(draft)]));
  });
});
