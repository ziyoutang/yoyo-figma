import type { Backdrop, FigmaLayout, FrameLayout, TextStyle } from './figmaLayout';

// What the Figma plugin builds for a published hero, as plain data. Pure and DOM-free: the plugin's sandbox has no
// browser APIs (not even URL), and it never imports publish.ts or model.ts.
export type FrameKind = 'desktop' | 'mobile';
export type HeroFile = {
  version: number; model: string; posters: Partial<Record<FrameKind, string>>; layout?: FigmaLayout;
  frame: 'Desktop' | 'Mobile' | 'Both'; eyebrow: string; headline: string; subtitle: string; buttonLabel: string; buttonUrl: string;
};

const frames = ['Desktop', 'Mobile', 'Both'];
const texts = ['eyebrow', 'headline', 'subtitle', 'buttonLabel', 'buttonUrl'] as const;
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// The frames a hero gets: one for Desktop or Mobile, both for Both.
export const kindsOf = (frame: HeroFile['frame']): FrameKind[] => frame === 'Both' ? ['desktop', 'mobile'] : frame === 'Mobile' ? ['mobile'] : ['desktop'];

// hero.json's fields the plugin uses, with draftFromPublished's checks: anything that isn't a published hero throws, and
// a text of the wrong type is empty. publishHero checked the layout; this checks only that each frame has one.
export function readHeroFile(json: unknown): HeroFile {
  const { version, model, posters, layout, snapshot } = isObject(json) ? json : {} as Record<string, unknown>;
  if (typeof version !== 'number' || typeof model !== 'string' || !isObject(snapshot) || !frames.includes(snapshot.frame as string) || !isObject(posters)) throw new Error('This is not a published hero.');
  const frame = snapshot.frame as HeroFile['frame'], kinds = kindsOf(frame);
  if (kinds.some(kind => typeof posters[kind] !== 'string')) throw new Error('This is not a published hero.');
  if (layout !== undefined && !(isObject(layout) && kinds.every(kind => isObject(layout[kind]) && isObject(layout[kind].backdrop) && (layout[kind].copy === null || isObject(layout[kind].copy))))) {
    throw new Error('This is not a published hero.');
  }
  const hero: HeroFile = { version, model, posters: Object.fromEntries(kinds.map(kind => [kind, posters[kind] as string])), frame, eyebrow: '', headline: '', subtitle: '', buttonLabel: '', buttonUrl: '' };
  for (const field of texts) if (typeof snapshot[field] === 'string') hero[field] = snapshot[field];
  return layout === undefined ? hero : { ...hero, layout: layout as FigmaLayout };
}

// Figma's shapes: colours 0–1, and a gradient's transform from the layer's 0–1 box to gradient space, where the
// gradient runs along x from 0 to 1.
export type RGB = {r: number; g: number; b: number};
export type Paint = {type: 'SOLID'; color: RGB} | {type: 'GRADIENT_LINEAR'; gradientTransform: [[number, number, number], [number, number, number]]; gradientStops: {position: number; color: RGB & {a: number}}[]};
// `hero` is the hero's font, Google Sans Flex, when Figma has it.
export type TextSpec = {
  type: 'TEXT'; name: string; characters: string; font: 'hero' | 'Inter'; size: number; lineHeight: number; letterSpacing: number; weight: 400 | 700; color: RGB;
  // A fixed width wraps as the browser does; null hugs the text.
  width: number | null; align: 'LEFT' | 'CENTER'; lines: number; link: string | null;
};
// An auto-layout frame.
export type BoxSpec = {
  type: 'FRAME'; name: string; direction: 'VERTICAL' | 'HORIZONTAL'; align: 'MIN' | 'CENTER'; itemSpacing: number;
  padding: {top: number; right: number; bottom: number; left: number}; radius: number; fill: RGB | null; children: (TextSpec | BoxSpec)[];
};
export type FrameSpec = {
  kind: FrameKind; name: string; width: number; height: number; backdrop: Paint;
  // The poster's file in public/heroes/{heroId}/, drawn over the whole frame.
  poster: string;
  copy: (BoxSpec & {x: number; y: number; width: number}) | null;
  // Placed `y` below the frame's top, outside it.
  caption: TextSpec & {y: number};
};

// The frames take the hero's proportions, as the embed and the PNG do.
export const frameSizes: Record<FrameKind, {width: number; height: number}> = { desktop: { width: 1440, height: Math.round(1440 * 419 / 722) }, mobile: { width: 390, height: Math.round(390 * 490 / 350) } };
// Gaps that differ by no more than this are the same in Figma.
const SAME_GAP_PX = 0.5;

export const rgb = (hex: string): RGB => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });

// A CSS linear-gradient as a Figma paint. CSS's gradient line runs through the centre at `angle` (0deg points up,
// clockwise) and is |W sin a| + |H cos a| long, so its ends' perpendiculars pass through the corners.
export function backdropPaint(backdrop: Backdrop, width: number, height: number): Paint {
  if (backdrop.type === 'solid') return { type: 'SOLID', color: rgb(backdrop.color) };
  const radians = backdrop.angle * Math.PI / 180, dx = Math.sin(radians), dy = -Math.cos(radians);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  // A layer point (u, v) in 0–1 has gradient position t = ((uW, vH) − centre) · d / length + 0.5; the second row runs across it.
  const along: [number, number, number] = [width * dx / length, height * dy / length, 0.5 - (width * dx + height * dy) / (2 * length)];
  const across: [number, number, number] = [-width * dy / length, height * dx / length, 0.5 - (height * dx - width * dy) / (2 * length)];
  return { type: 'GRADIENT_LINEAR', gradientTransform: [along, across], gradientStops: backdrop.stops.map(stop => ({ position: stop.at, color: { ...rgb(stop.color), a: 1 } })) };
}

// Only an https link goes on the button, as publishHero allows. No URL: the sandbox has none.
const isHttps = (link: string) => /^https:\/\/[^\s/?#]+\S*$/.test(link);
// CSS collapses white space; the headline (white-space: pre-line) keeps its line breaks.
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
const preLine = (text: string) => text.split('\n').map(collapse).join('\n').trim();

// The frame for one of the hero's kinds. Every length is the layout's fraction times the frame width. Throws when the
// hero has no layout, as heroes published before Phase 5 don't.
export function frameSpec(hero: HeroFile, kind: FrameKind, viewerUrl: string): FrameSpec {
  const layout = hero.layout?.[kind];
  if (!layout) throw new Error('Update this hero on Depth’s Complete screen, then try again.');
  const { width, height } = frameSizes[kind], px = (fraction: number) => fraction * width;
  const caption: FrameSpec['caption'] = { type: 'TEXT', name: 'Live hero', characters: 'Live hero', font: 'Inter', size: 16, lineHeight: 24, letterSpacing: 0, weight: 400, color: rgb('#000000'), width: null, align: 'LEFT', lines: 1, link: viewerUrl, y: height + 24 };
  return { kind, name: `Depth hero · ${kind === 'desktop' ? 'Desktop' : 'Mobile'}`, width, height, backdrop: backdropPaint(layout.backdrop, width, height), poster: hero.posters[kind]!, copy: copySpec(hero, layout, px), caption };
}

function text(name: string, characters: string, style: TextStyle, px: (fraction: number) => number, width: number | null, align: TextSpec['align']): TextSpec {
  return { type: 'TEXT', name, characters, font: 'hero', size: px(style.size), lineHeight: px(style.lineHeight), letterSpacing: px(style.letterSpacing), weight: style.weight, color: rgb(style.color), width, align, lines: style.lines, link: null };
}

const box = (name: string, direction: BoxSpec['direction'], align: BoxSpec['align'], children: BoxSpec['children'], extra: Partial<BoxSpec> = {}): BoxSpec =>
  ({ type: 'FRAME', name, direction, align, itemSpacing: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 }, radius: 0, fill: null, children, ...extra });

// The copy as a vertical auto-layout frame. Its item spacing is the smallest gap between items; an item whose gap is
// more sits in a wrapper with the difference as top padding, and the first item's gap is the copy's top padding.
function copySpec(hero: HeroFile, layout: FrameLayout, px: (fraction: number) => number): FrameSpec['copy'] {
  if (!layout.copy) return null;
  const width = px(layout.copy.width), align = layout.copy.align === 'center' ? 'CENTER' : 'LEFT', items: {gap: number; node: TextSpec | BoxSpec}[] = [];
  for (const [name, field, characters] of [['Eyebrow', 'eyebrow', collapse(hero.eyebrow)], ['Headline', 'headline', preLine(hero.headline)], ['Subtitle', 'subtitle', collapse(hero.subtitle)]] as const) {
    const item = layout[field];
    if (item && characters) items.push({ gap: px(item.gap), node: text(name, characters, item, px, width, align) });
  }
  const { button } = layout, label = collapse(hero.buttonLabel);
  if (button && label) {
    const node = box('Button', 'HORIZONTAL', 'MIN', [{ ...text('Label', label, button.label, px, null, 'LEFT'), link: isHttps(hero.buttonUrl) ? hero.buttonUrl : null }], {
      padding: { top: px(button.paddingY), right: px(button.paddingX), bottom: px(button.paddingY), left: px(button.paddingX) }, radius: px(button.radius), fill: rgb(button.fill),
    });
    items.push({ gap: px(button.gap), node });
  }
  const itemSpacing = items.length > 1 ? Math.min(...items.slice(1).map(item => item.gap)) : 0, boxAlign = align === 'CENTER' ? 'CENTER' : 'MIN';
  const children = items.map(({ gap, node }, i) => i === 0 || gap - itemSpacing <= SAME_GAP_PX ? node : box(`${node.name} spacing`, 'VERTICAL', boxAlign, [node], { padding: { top: gap - itemSpacing, right: 0, bottom: 0, left: 0 } }));
  return { ...box('Copy', 'VERTICAL', boxAlign, children, { itemSpacing, padding: { top: items[0]?.gap ?? 0, right: 0, bottom: 0, left: 0 } }), x: px(layout.copy.x), y: px(layout.copy.y), width };
}
