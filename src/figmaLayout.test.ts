// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateLayout } from '../functions/src/figmaLayout';
import { parseBackdrop, type Backdrop, type FrameLayout, type TextStyle } from './figmaLayout';
import { backdrops, layouts } from './figmaLayout.fixtures';
import { measureLayout } from './measureLayout';

describe('parseBackdrop', () => {
  it('reads each of the six backdrops as Chrome and Safari compute them', () => {
    for (const [name, { image, color, backdrop }] of Object.entries(backdrops)) expect(parseBackdrop(image, color), name).toEqual(backdrop);
  });

  it('follows CSS for a missing angle, unplaced stops and alpha', () => {
    expect(parseBackdrop('linear-gradient(rgb(0, 0, 0), rgba(255, 0, 0, 0.5) 40%, rgb(0, 0, 255), rgb(255, 255, 255))', 'rgba(0, 0, 0, 0)')).toEqual({
      type: 'linear', angle: 180, stops: [{ color: '#000000', at: 0 }, { color: '#ff0000', at: 0.4 }, { color: '#0000ff', at: 0.7 }, { color: '#ffffff', at: 1 }],
    });
    expect(parseBackdrop('linear-gradient(450deg, rgb(0, 0, 0) 50%, rgb(255, 255, 255) 20%)', '')).toEqual({ type: 'linear', angle: 90, stops: [{ color: '#000000', at: 0.5 }, { color: '#ffffff', at: 0.5 }] });
  });

  it('refuses what it can\'t turn into a Figma paint', () => {
    for (const [image, color] of [['radial-gradient(rgb(0, 0, 0), rgb(255, 255, 255))', ''], ['url("a.png")', 'rgb(0, 0, 0)'], ['linear-gradient(125deg, rgb(0, 0, 0))', ''], ['linear-gradient(125deg, red, blue)', ''], ['none', 'transparent']]) {
      expect(parseBackdrop(image, color), image).toBeNull();
    }
  });
});

// A hero as a browser reports it when it draws `layout`: HeroPreview's DOM with the boxes, computed styles and line boxes
// of a hero `width` CSS px wide under CSS zoom `zoom`. Boxes are zoomed; computed lengths aren't, as in Chromium.
function drawn(layout: FrameLayout, { width = 641, zoom = 0.85, backdrop = backdrops['Studio Glow'], texts = { eyebrow: 'Made with Meshy', headline: 'Design that\nmoves you.', subtitle: 'A little dimension goes a long way.', label: 'Explore Collection' } } = {}) {
  const hero = document.createElement('div');
  hero.className = 'hero-preview';
  hero.innerHTML = `<div class="hero-backdrop"></div><div class="hero-copy">${texts.eyebrow ? `<p class="hero-eyebrow">${texts.eyebrow}</p>` : ''}<h2>${texts.headline}</h2><p class="hero-description">${texts.subtitle}</p><span class="hero-cta">${texts.label}</span></div>`;
  document.body.replaceChildren(hero);
  const box = width * zoom, left = 20, top = 30, rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  const rects = new Map<Element, DOMRect>(), styles = new Map<Element, Record<string, string>>(), lines = new Map<Element, DOMRect[]>();
  const rect = (x: number, y: number, w: number, h: number) => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h }) as DOMRect;
  const css = (fraction: number) => `${fraction * width}px`;
  const textStyle = (style: TextStyle, normal: boolean) => ({ fontSize: css(style.size), lineHeight: normal ? 'normal' : css(style.lineHeight), letterSpacing: style.letterSpacing ? css(style.letterSpacing) : 'normal', fontWeight: String(style.weight), color: rgb(style.color) });
  // One line box per line, and the empty box both engines report for a line break.
  const lineBoxes = (y: number, style: TextStyle) => [...Array.from({ length: style.lines }, (_, i) => rect(left, y + i * style.lineHeight * box, 50, style.lineHeight * box)), rect(left, y, 0, style.lineHeight * box)];
  rects.set(hero, rect(left, top, box, box * 419 / 722));
  styles.set(hero, { width: `${width}px` });
  styles.set(hero.querySelector('.hero-backdrop')!, { backgroundImage: backdrop.image, backgroundColor: backdrop.color });
  const copy = hero.querySelector('.hero-copy')!;
  if (!layout.copy) styles.set(copy, { display: 'none' });
  else {
    const x = left + layout.copy.x * box;
    let y = top + layout.copy.y * box;
    styles.set(copy, { textAlign: layout.copy.align === 'center' ? 'center' : 'start' });
    for (const [name, selector] of [['eyebrow', '.hero-eyebrow'], ['headline', 'h2'], ['subtitle', '.hero-description']] as const) {
      const element = hero.querySelector(selector), item = layout[name];
      if (!element) continue;
      if (!item) { styles.set(element, { display: 'none' }); continue; }
      y += item.gap * box;
      rects.set(element, rect(x, y, layout.copy.width * box, item.lineHeight * item.lines * box));
      styles.set(element, textStyle(item, name === 'eyebrow'));
      lines.set(element, lineBoxes(y, item));
      y += item.lineHeight * item.lines * box;
    }
    const button = hero.querySelector('.hero-cta')!, { label, ...shape } = layout.button!;
    y += shape.gap * box;
    rects.set(button, rect(x, y, 120, (2 * shape.paddingY + label.lineHeight * label.lines) * box));
    styles.set(button, { ...textStyle(label, true), paddingTop: css(shape.paddingY), paddingBottom: css(shape.paddingY), paddingLeft: css(shape.paddingX), borderTopLeftRadius: css(shape.radius), backgroundColor: rgb(shape.fill) });
    lines.set(button, lineBoxes(y + shape.paddingY * box, label));
    rects.set(copy, rect(x, top + layout.copy.y * box, layout.copy.width * box, y - top - layout.copy.y * box));
  }
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) { return rects.get(this) ?? rect(0, 0, 0, 0); });
  vi.stubGlobal('getComputedStyle', (element: Element) => ({ display: 'block', ...styles.get(element) }));
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    let selected: Node | null = null;
    return { selectNodeContents: (node: Node) => { selected = node; }, getClientRects: () => lines.get(selected as Element) ?? [] } as unknown as Range;
  });
  return hero;
}

describe('measureLayout', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('measures the hero as drawn, as fractions of its width, under the studio\'s zoom', () => {
    for (const name of ['desktopObjectRight', 'mobileObjectRight', 'desktopCentered', 'mobileCentered'] as const) {
      expect(measureLayout(drawn(layouts[name])), name).toEqual(layouts[name]);
      expect(measureLayout(drawn(layouts[name], { width: 1440, zoom: 1 })), name).toEqual(layouts[name]);
    }
  });

  it('has no copy for 3D only', () => {
    expect(measureLayout(drawn(layouts.threeDOnly))).toEqual({ backdrop: backdrops['Studio Glow'].backdrop, copy: null });
  });

  it('reads every backdrop', () => {
    for (const backdrop of Object.values(backdrops)) expect(measureLayout(drawn(layouts.desktopObjectRight, { backdrop })).backdrop).toEqual(backdrop.backdrop);
  });

  it('leaves out an empty eyebrow, headline or button', () => {
    const hero = drawn(layouts.desktopObjectRight, { texts: { eyebrow: '', headline: '', subtitle: 'Subtitle', label: '' } });
    expect(Object.keys(measureLayout(hero))).toEqual(['backdrop', 'copy', 'subtitle']);
  });

  it('says which backdrop it couldn\'t read', () => {
    expect(() => measureLayout(drawn(layouts.desktopObjectRight, { backdrop: { image: 'url("a.png")', color: '', backdrop: { type: 'solid', color: '#000000' } } }))).toThrow('url("a.png")');
  });
});

describe('validateLayout', () => {
  const { desktopObjectRight, mobileObjectRight, desktopCentered, mobileCentered, threeDOnly } = layouts;
  // A copy of the desktop layout with one field changed.
  const changed = (path: string, value: unknown) => {
    const copy = structuredClone(desktopObjectRight) as Record<string, unknown>, keys = path.split('.'), last = keys.pop()!;
    const parent = keys.reduce((node, key) => node[key] as Record<string, unknown>, copy);
    // Defined, not assigned, so `__proto__` becomes a key as JSON.parse makes it.
    if (value === undefined) delete parent[last]; else Object.defineProperty(parent, last, { value, enumerable: true, writable: true, configurable: true });
    return { desktop: copy };
  };
  const refused = (layout: unknown, kinds: ('desktop' | 'mobile')[], field: string) => expect(() => validateLayout(layout, kinds), field).toThrow(field);

  it('accepts what the studio measures, for exactly the frame\'s kinds', () => {
    for (const layout of [desktopObjectRight, desktopCentered, threeDOnly, { backdrop: backdrops.Custom.backdrop, copy: null }]) expect(validateLayout({ desktop: layout }, ['desktop'])).toEqual({ desktop: layout });
    expect(validateLayout({ mobile: mobileObjectRight }, ['mobile'])).toEqual({ mobile: mobileObjectRight });
    expect(validateLayout({ mobile: mobileCentered, desktop: desktopCentered }, ['desktop', 'mobile'])).toEqual({ desktop: desktopCentered, mobile: mobileCentered });
    expect(validateLayout(changed('copy.y', -0.6), ['desktop']).desktop).toMatchObject({ copy: { y: -0.6 } });
  });

  it('refuses a layout for other frames', () => {
    for (const [layout, kinds] of [[{ desktop: desktopObjectRight }, ['desktop', 'mobile']], [{ mobile: mobileObjectRight }, ['desktop']], [{ desktop: desktopObjectRight, mobile: mobileObjectRight }, ['mobile']], [null, ['desktop']], [[desktopObjectRight], ['desktop']], ['layout', ['desktop']]] as const) {
      refused(layout, [...kinds], 'layout must have the');
    }
  });

  it('refuses each bad field by name', () => {
    for (const [path, values] of [
      ['copy.x', [-0.01, 1.51]], ['copy.y', [-1.01, 1.51]], ['copy.width', [-0.01, 1.51, '0.4']], ['copy.align', ['right', 'start']],
      ['headline.gap', [-0.01, 0.51]], ['headline.size', [0.51, Number.NaN, Infinity, null]], ['headline.lineHeight', [0.51, undefined]], ['headline.letterSpacing', [0.051, -0.051]],
      ['headline.weight', [500, '700']], ['headline.color', ['#fff', 'red', '#12345g', 0]], ['headline.lines', [0, 21, 1.5]],
      ['eyebrow.color', ['rgb(0, 0, 0)']], ['subtitle.size', [-0.01]],
      ['button.gap', [0.51]], ['button.paddingX', [-0.01]], ['button.paddingY', [0.51]], ['button.radius', [0.51]], ['button.fill', ['teal']],
      ['button.label.size', [0.51]], ['button.label.lines', [0]], ['button.label.color', ['#ffff']],
      ['backdrop.type', ['radial', undefined]], ['backdrop.angle', [-1, 361]], ['backdrop.stops', [[], [{ color: '#ffffff', at: 0 }], Array(5).fill({ color: '#ffffff', at: 0 }), 'stops']],
      ['backdrop.stops.0.at', [1.1, -0.1]], ['backdrop.stops.1.color', ['white']],
      ['copy', [undefined, 'copy']], ['backdrop', [undefined, null]],
    ] as const) for (const value of values) refused(changed(path, value), ['desktop'], `layout.desktop.${path}`);
    refused({ desktop: null }, ['desktop'], 'layout.desktop must be an object');
  });

  it('refuses fields it doesn\'t know', () => {
    for (const path of ['extra', 'copy.extra', 'headline.extra', 'button.extra', 'button.label.gap', 'backdrop.extra', 'backdrop.stops.0.extra', 'constructor', '__proto__']) {
      refused(changed(path, 1), ['desktop'], `Unknown layout field: layout.desktop.${path}`);
    }
    refused({ desktop: { backdrop: { type: 'solid', color: '#ffffff', angle: 90 }, copy: null } }, ['desktop'], 'Unknown layout field: layout.desktop.backdrop.angle');
  });

  it('refuses more than 4 KB', () => {
    refused({ desktop: { ...desktopObjectRight, padding: 'x'.repeat(4000) } }, ['desktop'], 'layout must be at most 4 KB');
  });
});
