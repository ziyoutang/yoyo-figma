import { describe, expect, it } from 'vitest';
import { backdropPaint, frameSpec, kindsOf, readHeroFile, rgb, type BoxSpec, type FrameKind, type FrameSpec, type HeroFile, type TextSpec } from './figmaFrame';
import type { FrameLayout } from './figmaLayout';
import { backdrops, layouts } from './figmaLayout.fixtures';
import { initialDraft } from './model';
import { snapshotFromDraft } from './publish';

const heroId = 'abcdefghij0123456789', viewer = `https://depth-plugin-demo-20261006.web.app/embed/${heroId}`;
// hero.json as publishHero writes it.
const heroJson = (frame: HeroFile['frame'], layout: Partial<Record<FrameKind, FrameLayout>> | undefined, changes: Partial<typeof initialDraft> = {}) => ({
  version: 3, model: 'v3/model.glb', posters: Object.fromEntries(kindsOf(frame).map(kind => [kind, `v3/poster-${kind}.webp`])),
  ...(layout && { layout }), snapshot: { ...snapshotFromDraft({ ...initialDraft, ...changes, frame }), textured: true },
});
const hero = (frame: HeroFile['frame'], layout: Partial<Record<FrameKind, FrameLayout>>, changes: Partial<typeof initialDraft> = {}) => readHeroFile(heroJson(frame, layout, changes));
const byLayout = { 'Object Right': [layouts.desktopObjectRight, layouts.mobileObjectRight], Centered: [layouts.desktopCentered, layouts.mobileCentered], '3D only': [layouts.threeDOnly, layouts.threeDOnly] } as const;

// Every node under the copy, wrappers included.
const nodes = (node: BoxSpec | TextSpec): (BoxSpec | TextSpec)[] => node.type === 'TEXT' ? [node] : [node, ...node.children.flatMap(nodes)];
const named = (spec: FrameSpec, name: string) => spec.copy && nodes(spec.copy).find(node => node.name === name);
// Where Figma's auto layout puts each text and button: a vertical stack of padding, children and item spacing, where
// a text with a fixed line height is lines × line height tall. Returns tops relative to the frame.
function tops(copy: NonNullable<FrameSpec['copy']>) {
  const found: Record<string, number> = {};
  const height = (node: BoxSpec | TextSpec): number => node.type === 'TEXT' ? node.lines * node.lineHeight
    : node.direction === 'HORIZONTAL' ? node.padding.top + Math.max(...node.children.map(height)) + node.padding.bottom
      : node.padding.top + node.children.reduce((sum, child, i) => sum + (i ? node.itemSpacing : 0) + height(child), 0) + node.padding.bottom;
  const place = (node: BoxSpec | TextSpec, top: number) => {
    if (node.type === 'TEXT' || node.direction === 'HORIZONTAL') { found[node.name] = top; return; }
    let y = top + node.padding.top;
    for (const child of node.children) { place(child, y); y += height(child) + node.itemSpacing; }
  };
  place(copy, copy.y);
  return found;
}

describe('readHeroFile', () => {
  it('reads what the plugin uses from hero.json', () => {
    const file = heroJson('Both', { desktop: layouts.desktopObjectRight, mobile: layouts.mobileObjectRight }, { buttonUrl: 'https://example.test/shop' });
    expect(readHeroFile(file)).toEqual({
      version: 3, model: 'v3/model.glb', posters: { desktop: 'v3/poster-desktop.webp', mobile: 'v3/poster-mobile.webp' }, layout: file.layout, frame: 'Both',
      eyebrow: 'Made with Meshy', headline: 'Design that\nmoves you.', subtitle: initialDraft.subtitle, buttonLabel: 'Explore Collection', buttonUrl: 'https://example.test/shop',
    });
  });

  it('reads a hero published before Phase 5, without a layout, and frameSpec then asks for an update', () => {
    const old = readHeroFile(heroJson('Desktop', undefined));
    expect(old.layout).toBeUndefined();
    expect(() => frameSpec(old, 'desktop', viewer)).toThrow('Update this hero on Depth’s Complete screen, then try again.');
  });

  it('empties texts of the wrong type, as draftFromPublished skips them', () => {
    const file = heroJson('Desktop', { desktop: layouts.desktopObjectRight });
    expect(readHeroFile({ ...file, snapshot: { ...file.snapshot, headline: 7, buttonUrl: null } })).toMatchObject({ headline: '', buttonUrl: '', eyebrow: 'Made with Meshy' });
  });

  it('refuses anything that isn\'t a published hero', () => {
    const file = heroJson('Both', { desktop: layouts.desktopObjectRight, mobile: layouts.mobileObjectRight });
    for (const broken of [null, 'text', [], {}, { ...file, version: '3' }, { ...file, model: undefined }, { ...file, snapshot: null }, { ...file, snapshot: { ...file.snapshot, frame: 'Tablet' } },
      { ...file, posters: { desktop: 'v3/poster-desktop.webp' } }, { ...file, posters: null }, { ...file, layout: null }, { ...file, layout: { desktop: file.layout!.desktop } },
      { ...file, layout: { ...file.layout, mobile: { copy: null } } }, { ...file, layout: { ...file.layout, mobile: { backdrop: {}, copy: 'copy' } } }]) {
      expect(() => readHeroFile(broken), JSON.stringify(broken)?.slice(0, 80)).toThrow('This is not a published hero.');
    }
  });
});

describe('frameSpec', () => {
  it('makes 1440 × 836 desktop and 390 × 546 mobile frames for every frame size and layout', () => {
    for (const frame of ['Desktop', 'Mobile', 'Both'] as const) for (const [layout, [desktop, mobile]] of Object.entries(byLayout)) {
      const file = hero(frame, { desktop, mobile: mobile as FrameLayout });
      const specs = kindsOf(frame).map(kind => frameSpec({ ...file, layout: { desktop, mobile } }, kind, viewer));
      expect(specs.map(spec => [spec.name, spec.width, spec.height, spec.poster]), `${frame} ${layout}`).toEqual(kindsOf(frame).map(kind => kind === 'desktop'
        ? ['Depth hero · Desktop', 1440, 836, 'v3/poster-desktop.webp'] : ['Depth hero · Mobile', 390, 546, 'v3/poster-mobile.webp']));
    }
  });

  it('leaves out empty texts, Centered\'s subtitle and 3D only\'s copy', () => {
    const names = (spec: FrameSpec) => spec.copy && nodes(spec.copy).filter(node => node.type === 'TEXT').map(node => node.name);
    expect(names(frameSpec(hero('Desktop', { desktop: layouts.desktopObjectRight }), 'desktop', viewer))).toEqual(['Eyebrow', 'Headline', 'Subtitle', 'Label']);
    expect(names(frameSpec(hero('Desktop', { desktop: layouts.desktopObjectRight }, { eyebrow: '', subtitle: ' \n ' }), 'desktop', viewer))).toEqual(['Headline', 'Label']);
    expect(names(frameSpec(hero('Desktop', { desktop: layouts.desktopCentered }, { layout: 'Centered' }), 'desktop', viewer))).toEqual(['Eyebrow', 'Headline', 'Label']);
    expect(frameSpec(hero('Desktop', { desktop: layouts.threeDOnly }, { layout: '3D only' }), 'desktop', viewer).copy).toBeNull();
  });

  it('keeps the headline\'s line breaks and collapses other white space, as the CSS does', () => {
    const spec = frameSpec(hero('Desktop', { desktop: layouts.desktopObjectRight }, { headline: ' Design  that \n moves\tyou. ', subtitle: 'Two\nlines  here', buttonLabel: ' Go ' }), 'desktop', viewer);
    expect(['Headline', 'Subtitle', 'Label'].map(name => (named(spec, name) as TextSpec).characters)).toEqual(['Design that\nmoves you.', 'Two lines here', 'Go']);
  });

  it('makes every length the layout times the frame width', () => {
    for (const [kind, layout] of [['desktop', layouts.desktopObjectRight], ['mobile', layouts.mobileObjectRight], ['desktop', layouts.desktopCentered], ['mobile', layouts.mobileCentered]] as const) {
      const width = kind === 'desktop' ? 1440 : 390, px = (fraction: number) => fraction * width;
      const spec = frameSpec(hero(kind === 'desktop' ? 'Desktop' : 'Mobile', { [kind]: layout }), kind, viewer), copy = spec.copy!;
      expect([copy.x, copy.y, copy.width, copy.align]).toEqual([px(layout.copy.x), px(layout.copy.y), px(layout.copy.width), layout.copy.align === 'center' ? 'CENTER' : 'MIN']);
      for (const [name, field] of [['Eyebrow', 'eyebrow'], ['Headline', 'headline'], ['Subtitle', 'subtitle']] as const) {
        const item = (layout as FrameLayout)[field];
        if (!item) continue;
        expect(named(spec, name), name).toMatchObject({ font: 'hero', size: px(item.size), lineHeight: px(item.lineHeight), letterSpacing: px(item.letterSpacing), weight: item.weight, color: rgb(item.color), width: px(layout.copy.width), align: layout.copy.align === 'center' ? 'CENTER' : 'LEFT', lines: item.lines });
      }
      const button = named(spec, 'Button') as BoxSpec, { label } = layout.button;
      expect(button).toMatchObject({ direction: 'HORIZONTAL', padding: { top: px(layout.button.paddingY), right: px(layout.button.paddingX), bottom: px(layout.button.paddingY), left: px(layout.button.paddingX) }, radius: px(layout.button.radius), fill: rgb(layout.button.fill) });
      expect(button.children[0]).toMatchObject({ size: px(label.size), lineHeight: px(label.lineHeight), letterSpacing: 0, weight: 400, color: rgb('#ffffff'), width: null, lines: 1 });
      // Each item's top is where the browser drew it: the copy's top plus every gap and height above it.
      let y = layout.copy.y;
      const expected: Record<string, number> = {};
      for (const [name, item, height] of [['Eyebrow', layout.eyebrow, layout.eyebrow.lineHeight], ['Headline', layout.headline, layout.headline.lineHeight * layout.headline.lines],
        ['Subtitle', 'subtitle' in layout ? layout.subtitle : undefined, 'subtitle' in layout ? layout.subtitle.lineHeight * layout.subtitle.lines : 0], ['Button', layout.button, 0]] as const) {
        if (!item) continue;
        y += item.gap;
        expected[name] = px(y);
        y += height;
      }
      const found = tops(copy);
      for (const name of Object.keys(expected)) expect(found[name], `${kind} ${name}`).toBeCloseTo(expected[name], 9);
    }
  });

  it('spaces the copy by its smallest gap, and pads the button by the rest of its own', () => {
    const layout = layouts.desktopObjectRight, copy = frameSpec(hero('Desktop', { desktop: layout }), 'desktop', viewer).copy!;
    expect(copy.itemSpacing).toBe(layout.headline.gap * 1440);
    expect(copy.padding.top).toBe(0);
    expect(copy.children.map(child => child.name)).toEqual(['Eyebrow', 'Headline', 'Subtitle', 'Button spacing']);
    expect((copy.children[3] as BoxSpec).padding.top).toBeCloseTo((layout.button.gap - layout.headline.gap) * 1440, 9);
    // Without an eyebrow the headline is first; the subtitle's gap is then the spacing, and only the button is wrapped.
    const bare = frameSpec(hero('Desktop', { desktop: { ...layout, eyebrow: undefined, headline: { ...layout.headline, gap: 0 } } }, { eyebrow: '' }), 'desktop', viewer).copy!;
    expect([bare.itemSpacing, bare.children.map(child => child.name)]).toEqual([layout.subtitle.gap * 1440, ['Headline', 'Subtitle', 'Button spacing']]);
    // Gaps within half a pixel of the spacing need no wrapper.
    const close = frameSpec(hero('Desktop', { desktop: { ...layout, button: { ...layout.button, gap: layout.headline.gap + 0.4 / 1440 } } }), 'desktop', viewer).copy!;
    expect(close.children.map(child => child.name)).toEqual(['Eyebrow', 'Headline', 'Subtitle', 'Button']);
  });

  it('links the button label only to an https Button link, and the Live hero caption to the viewer', () => {
    const label = (buttonUrl: string) => ((named(frameSpec(hero('Desktop', { desktop: layouts.desktopObjectRight }, { buttonUrl }), 'desktop', viewer), 'Button') as BoxSpec).children[0] as TextSpec).link;
    expect(label('https://example.test/shop?a=1')).toBe('https://example.test/shop?a=1');
    for (const link of ['', 'http://example.test', 'javascript:alert(1)', 'https://', 'https:// x']) expect(label(link), link).toBeNull();
    for (const kind of ['desktop', 'mobile'] as const) {
      const spec = frameSpec(hero('Both', { desktop: layouts.desktopObjectRight, mobile: layouts.mobileObjectRight }), kind, viewer);
      expect(spec.caption).toMatchObject({ name: 'Live hero', characters: 'Live hero', font: 'Inter', weight: 400, size: 16, link: viewer, y: spec.height + 24 });
      for (const text of nodes(spec.copy!)) if (text.type === 'TEXT' && text.name !== 'Label') expect(text.link).toBeNull();
    }
  });
});

describe('backdrops', () => {
  it('turn #rrggbb into Figma\'s 0–1 colour', () => {
    expect(rgb('#00676c')).toEqual({ r: 0, g: 103 / 255, b: 108 / 255 });
    expect(rgb('#FFFFFF')).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('become the right solid or gradient paint', () => {
    for (const [name, { backdrop }] of Object.entries(backdrops)) {
      const paint = frameSpec(hero('Desktop', { desktop: { ...layouts.desktopObjectRight, backdrop } }), 'desktop', viewer).backdrop;
      if (backdrop.type === 'solid') expect(paint, name).toEqual({ type: 'SOLID', color: rgb(backdrop.color) });
      else expect(paint.type === 'GRADIENT_LINEAR' && paint.gradientStops, name).toEqual(backdrop.stops.map(stop => ({ position: stop.at, color: { ...rgb(stop.color), a: 1 } })));
    }
  });

  // CSS: the gradient line's ends are where the perpendiculars through two opposite corners meet it, so one corner is at
  // 0, the opposite one at 1 and the centre at 0.5. Pointing up and right (under 90deg) it starts bottom left.
  it('place the gradient as CSS does, at 0, 90, 115, 120, 125 and 180 degrees', () => {
    for (const [width, height] of [[1440, 836], [390, 546]]) for (const angle of [0, 90, 115, 120, 125, 180]) {
      const paint = backdropPaint({ type: 'linear', angle, stops: [{ color: '#ffffff', at: 0 }, { color: '#000000', at: 1 }] }, width, height);
      if (paint.type !== 'GRADIENT_LINEAR') throw new Error('Not a gradient.');
      const [[a, b, c], [d, e]] = paint.gradientTransform, t = (u: number, v: number) => a * u + b * v + c;
      const [start, end] = angle < 90 ? [[0, 1], [1, 0]] : [[0, 0], [1, 1]];
      expect([t(start[0], start[1]), t(end[0], end[1]), t(0.5, 0.5)].map(n => Number(n.toFixed(12))), `${angle}deg ${width}`).toEqual([0, 1, 0.5]);
      expect(a * e - b * d, 'invertible').toBeGreaterThan(0);
    }
    const along = (angle: number) => (backdropPaint({ type: 'linear', angle, stops: [] }, 1440, 836) as {gradientTransform: number[][]}).gradientTransform[0].map(n => Number(n.toFixed(12)) + 0);
    expect(along(90)).toEqual([1, 0, 0]);
    expect(along(180)).toEqual([0, 1, 0]);
    expect(along(0)).toEqual([0, -1, 1]);
  });
});
