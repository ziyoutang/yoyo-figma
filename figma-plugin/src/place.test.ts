import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameSpec, readHeroFile, type FrameKind } from '../../src/figmaFrame';
import type { FrameLayout } from '../../src/figmaLayout';
import { layouts } from '../../src/figmaLayout.fixtures';
import { initialDraft } from '../../src/model';
import { snapshotFromDraft } from '../../src/publish';
import { pickFonts, placeNewFrames, replaceSelection, selectionState, viewerUrl } from './place';

const heroId = 'abcdefghij0123456789', link = `https://depth-plugin-demo-20261006.web.app/embed/${heroId}`;
const hero = (frame: 'Desktop' | 'Mobile' | 'Both', layout: Partial<Record<FrameKind, FrameLayout>> = { desktop: layouts.desktopObjectRight, mobile: layouts.mobileObjectRight }) => readHeroFile({
  version: 4, model: 'v4/model.glb', posters: { desktop: 'v4/poster-desktop.webp', mobile: 'v4/poster-mobile.webp' }, layout,
  snapshot: { ...snapshotFromDraft({ ...initialDraft, frame, buttonUrl: 'https://example.test/shop' }), textured: true },
});
const pngs = { desktop: new Uint8Array(3), mobile: new Uint8Array(5) };

// A fake of the Figma API that records what is made. Like Figma, a text's characters can't change before its font is
// loaded, and a text's height is its lines times its line height: Depth's lines by default, or `wraps`'s by name.
type Node = Record<string, unknown> & {type: string; name: string; x: number; y: number; width: number; height: number; children: Node[]; parent: Node | null; pluginData: Record<string, string>};
function fakeFigma({ fonts = ['Google Sans Flex/Regular', 'Google Sans Flex/Bold', 'Inter/Regular', 'Inter/Bold'], failing = [] as string[], wraps = {} as Record<string, number> } = {}) {
  const loaded = new Set<string>(), page = node('PAGE') as Node & {selection: Node[]};
  page.selection = [];
  function node(type: string): Node {
    const made: Node = {
      type, name: '', x: 0, y: 0, width: 100, height: 100, children: [], parent: null, pluginData: {}, fills: [], strokes: ['stroke'], effects: ['shadow'],
      resize(width: number, height: number) { made.width = width; made.height = height; },
      appendChild(child: Node) { child.parent?.children.splice(child.parent.children.indexOf(child), 1); child.parent = made; made.children.push(child); },
      setPluginData(key: string, value: string) { made.pluginData[key] = value; },
    };
    if (type === 'TEXT') {
      let characters = '';
      // Lines as Depth drew them in the fixtures, for the frame the text sits in.
      const lines = () => {
        let frame = made.parent;
        while (frame && !frame.name.startsWith('Depth hero')) frame = frame.parent;
        const drawn: Record<string, number> = { Eyebrow: 1, Headline: 2, Subtitle: frame?.name.endsWith('Mobile') ? 2 : 3, Label: 1 };
        return wraps[made.name] ?? (frame ? drawn[made.name] : 1) ?? 1;
      };
      Object.defineProperties(made, {
        characters: { get: () => characters, set(value: string) {
          const font = made.fontName as {family: string; style: string} | undefined;
          if (!font || !loaded.has(`${font.family}/${font.style}`)) throw new Error('Font not loaded.');
          characters = value;
        } },
        height: { get: () => ((made.lineHeight as {value: number} | undefined)?.value ?? 0) * lines(), set() {} },
      });
    }
    return made;
  }
  const add = (type: string) => { const made = node(type); page.appendChild(made); return made; };
  const api = {
    currentPage: page,
    createFrame: () => add('FRAME'), createRectangle: () => add('RECTANGLE'), createText: () => add('TEXT'),
    createImage: (bytes: Uint8Array) => ({ hash: `image-${bytes.length}` }),
    listAvailableFontsAsync: vi.fn(async () => fonts.map(font => ({ fontName: { family: font.split('/')[0], style: font.split('/')[1] } }))),
    loadFontAsync: vi.fn(async ({ family, style }: {family: string; style: string}) => {
      if (failing.includes(family) || !fonts.includes(`${family}/${style}`)) throw new Error(`Couldn't load ${family} ${style}.`);
      loaded.add(`${family}/${style}`);
    }),
    viewport: { scrollAndZoomIntoView: vi.fn() },
    commitUndo: vi.fn(),
    notify: () => { throw new Error('figma.notify throws under use_figma.'); },
  };
  vi.stubGlobal('figma', api);
  return { api, page, node, add };
}
const all = (node: Node): Node[] => [node, ...node.children.flatMap(all)];
const find = (root: Node, name: string) => all(root).find(node => node.name === name)!;
afterEach(() => { vi.unstubAllGlobals(); });

describe('fonts', () => {
  it('use Google Sans Flex when Figma lists it, and Inter for the caption', async () => {
    const { page } = fakeFigma();
    expect((await pickFonts()).notice).toBeNull();
    await placeNewFrames(heroId, hero('Desktop'), pngs);
    const frame = page.children.find(node => node.type === 'FRAME')!;
    expect(['Eyebrow', 'Headline', 'Subtitle', 'Label'].map(name => find(frame, name).fontName)).toEqual([
      { family: 'Google Sans Flex', style: 'Regular' }, { family: 'Google Sans Flex', style: 'Bold' }, { family: 'Google Sans Flex', style: 'Regular' }, { family: 'Google Sans Flex', style: 'Regular' }]);
    expect(page.children.find(node => node.name === 'Live hero')!.fontName).toEqual({ family: 'Inter', style: 'Regular' });
  });

  it('fall back to Inter, and say so, when Google Sans Flex is missing or won\'t load', async () => {
    for (const setup of [{ fonts: ['Inter/Regular', 'Inter/Bold', 'Google Sans Flex/Regular'] }, { failing: ['Google Sans Flex'] }]) {
      const { page } = fakeFigma(setup);
      const { notes } = await placeNewFrames(heroId, hero('Desktop'), pngs);
      expect(notes).toEqual(['Google Sans Flex isn’t in this Figma, so the text uses Inter.']);
      expect(find(page.children[0], 'Headline').fontName).toEqual({ family: 'Inter', style: 'Bold' });
    }
  });
});

describe('New Frame', () => {
  it('lands 200 px right of the rightmost node, selected, zoomed into view and undone in one step', async () => {
    const { api, page, add } = fakeFigma();
    Object.assign(add('RECTANGLE'), { x: 0, y: 0, width: 500, height: 300 });
    Object.assign(add('FRAME'), { x: 800, y: 50, width: 400, height: 400 });
    await placeNewFrames(heroId, hero('Both'), pngs);
    const [desktop, mobile] = page.children.filter(node => node.name.startsWith('Depth hero'));
    expect([desktop.name, desktop.x, desktop.y, desktop.width, desktop.height]).toEqual(['Depth hero · Desktop', 1400, 50, 1440, 836]);
    expect([mobile.name, mobile.x, mobile.y, mobile.width, mobile.height]).toEqual(['Depth hero · Mobile', 1400 + 1440 + 120, 50, 390, 546]);
    expect(page.selection).toEqual([desktop, mobile]);
    const captions = page.children.filter(node => node.name === 'Live hero');
    expect(captions.map(caption => [caption.x, caption.y, caption.hyperlink])).toEqual([[1400, 50 + 836 + 24, { type: 'URL', value: link }], [2960, 50 + 546 + 24, { type: 'URL', value: link }]]);
    expect(api.viewport.scrollAndZoomIntoView).toHaveBeenCalledWith([desktop, mobile, ...captions]);
    expect(api.commitUndo).toHaveBeenCalledTimes(1);
    expect([desktop, mobile].map(frame => JSON.parse(frame.pluginData.depth))).toEqual([{ heroId, version: 4, kind: 'desktop' }, { heroId, version: 4, kind: 'mobile' }]);
  });

  it('starts at the origin on an empty page', async () => {
    const { page } = fakeFigma();
    await placeNewFrames(heroId, hero('Mobile'), pngs);
    expect([page.children[0].name, page.children[0].x, page.children[0].y]).toEqual(['Depth hero · Mobile', 0, 0]);
  });

  it('builds the frame spec: backdrop, the poster scaled over it, then the copy as auto layout', async () => {
    const { page } = fakeFigma();
    await placeNewFrames(heroId, hero('Desktop'), pngs);
    const frame = page.children[0], spec = frameSpec(hero('Desktop'), 'desktop', viewerUrl(heroId)), copySpec = spec.copy!;
    expect([frame.clipsContent, frame.fills]).toEqual([true, [spec.backdrop]]);
    expect(frame.children.map(child => child.name)).toEqual(['3D model', 'Copy']);
    expect(frame.children[0]).toMatchObject({ width: 1440, height: 836, fills: [{ type: 'IMAGE', imageHash: 'image-3', scaleMode: 'FILL' }], constraints: { horizontal: 'SCALE', vertical: 'SCALE' } });
    const copy = frame.children[1];
    expect(copy).toMatchObject({ layoutMode: 'VERTICAL', x: copySpec.x, y: copySpec.y, width: copySpec.width, primaryAxisSizingMode: 'AUTO', counterAxisSizingMode: 'FIXED', counterAxisAlignItems: 'MIN', itemSpacing: copySpec.itemSpacing, fills: [] });
    expect(copy.children.map(child => child.name)).toEqual(['Eyebrow', 'Headline', 'Subtitle', 'Button spacing']);
    const headline = find(frame, 'Headline'), headlineSpec = copySpec.children[1] as {size: number; lineHeight: number; letterSpacing: number; color: unknown; width: number};
    expect(headline).toMatchObject({ characters: 'Design that\nmoves you.', fontSize: headlineSpec.size, lineHeight: { unit: 'PIXELS', value: headlineSpec.lineHeight }, letterSpacing: { unit: 'PIXELS', value: headlineSpec.letterSpacing },
      fills: [{ type: 'SOLID', color: headlineSpec.color }], textAlignHorizontal: 'LEFT', textAutoResize: 'HEIGHT', width: headlineSpec.width });
    expect(find(frame, 'Button')).toMatchObject({ layoutMode: 'HORIZONTAL', cornerRadius: layouts.desktopObjectRight.button.radius * 1440, paddingLeft: 0.025 * 1440, paddingTop: 0.0125 * 1440 });
    expect(find(frame, 'Label')).toMatchObject({ characters: 'Explore Collection', textAutoResize: 'WIDTH_AND_HEIGHT', hyperlink: { type: 'URL', value: 'https://example.test/shop' } });
    expect(find(frame, 'Eyebrow').hyperlink).toBeUndefined();
  });

  it('makes no copy for 3D only', async () => {
    const { page } = fakeFigma();
    await placeNewFrames(heroId, hero('Desktop', { desktop: layouts.threeDOnly }), pngs);
    expect(page.children[0].children.map(child => child.name)).toEqual(['3D model']);
  });

  it('lists each text that wraps to a different number of lines', async () => {
    fakeFigma({ wraps: { Headline: 3 } });
    expect((await placeNewFrames(heroId, hero('Desktop'), pngs)).notes).toEqual(['Headline: 3 lines here, 2 in Depth']);
    fakeFigma({ wraps: { Subtitle: 2, Label: 2 } });
    expect((await placeNewFrames(heroId, hero('Both'), pngs)).notes).toEqual(['Subtitle (Desktop): 2 lines here, 3 in Depth', 'Button (Desktop): 2 lines here, 1 in Depth', 'Button (Mobile): 2 lines here, 1 in Depth']);
  });

  it('places nothing for a hero without a layout, or without its posters', async () => {
    const { page } = fakeFigma();
    const old = { ...hero('Desktop'), layout: undefined };
    await expect(placeNewFrames(heroId, old, pngs)).rejects.toThrow('Update this hero on Depth’s Complete screen, then try again.');
    await expect(placeNewFrames(heroId, hero('Both'), { desktop: pngs.desktop })).rejects.toThrow('poster');
    expect(page.children).toEqual([]);
  });
});

describe('Replace Selection', () => {
  it('refuses no selection, two layers, a group, a text and a line', () => {
    const { node } = fakeFigma();
    expect(selectionState([])).toEqual({ fillable: false, reason: 'Select a frame or shape to fill with the model.' });
    expect(selectionState([node('RECTANGLE'), node('FRAME')] as never)).toEqual({ fillable: false, reason: 'Select only one frame or shape.' });
    for (const [type, start] of [['GROUP', 'A group'], ['TEXT', 'A text layer'], ['LINE', 'A line'], ['SLICE', 'This layer']]) {
      expect(selectionState([node(type)] as never)).toEqual({ fillable: false, reason: `${start} can’t show the model. Select a frame or shape.` });
    }
  });

  it('fills a rectangle, frame or instance with the model, fitted, and keeps everything else', () => {
    for (const type of ['RECTANGLE', 'FRAME', 'INSTANCE', 'ELLIPSE', 'COMPONENT']) {
      const { api, page, add } = fakeFigma(), target = Object.assign(add(type), { name: 'Card', x: 10, y: 20, width: 400, height: 400, fills: [{ type: 'SOLID' }] });
      page.selection = [target];
      const before = { ...target };
      replaceSelection(new Uint8Array(7));
      expect(target.fills).toEqual([{ type: 'IMAGE', imageHash: 'image-7', scaleMode: 'FIT' }]);
      expect({ ...target, fills: before.fills }).toEqual(before);
      expect(page.children).toEqual([target]);
      expect(api.commitUndo).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses to fill what it can\'t, and changes nothing', () => {
    const { page, add } = fakeFigma(), text = add('TEXT');
    page.selection = [text];
    expect(() => replaceSelection(new Uint8Array(7))).toThrow('A text layer can’t show the model.');
    expect(text.fills).toEqual([]);
  });
});
