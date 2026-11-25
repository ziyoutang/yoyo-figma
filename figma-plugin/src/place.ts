import { frameSpec, kindsOf, type BoxSpec, type FrameKind, type FrameSpec, type HeroFile, type TextSpec } from '../../src/figmaFrame';
import { hostingOrigin } from './config';

// Builds what the panel asked for with the Figma API. It never calls figma.notify, which throws when use_figma runs
// this code; every message goes back to the panel.

export const viewerUrl = (heroId: string) => `${hostingOrigin}/embed/${heroId}`;

type Fonts = {hero: Record<400 | 700, FontName>; inter: Record<400 | 700, FontName>; notice: string | null};
const HERO_FONT = 'Google Sans Flex';
const inter: Fonts['inter'] = { 400: { family: 'Inter', style: 'Regular' }, 700: { family: 'Inter', style: 'Bold' } };

// The hero's Google Sans Flex Regular and Bold when this Figma lists them and they load; otherwise Inter, and a notice.
// Inter Regular is loaded either way, for the Live hero caption.
export async function pickFonts(): Promise<Fonts> {
  await Promise.all([figma.loadFontAsync(inter[400]), figma.loadFontAsync(inter[700])]);
  try {
    const listed = await figma.listAvailableFontsAsync();
    const hero: Fonts['hero'] = { 400: { family: HERO_FONT, style: 'Regular' }, 700: { family: HERO_FONT, style: 'Bold' } };
    if ([hero[400], hero[700]].every(font => listed.some(({ fontName }) => fontName.family === font.family && fontName.style === font.style))) {
      await Promise.all([figma.loadFontAsync(hero[400]), figma.loadFontAsync(hero[700])]);
      return { hero, inter, notice: null };
    }
  } catch { /* Inter, below. */ }
  return { hero: inter, inter, notice: `${HERO_FONT} isn’t in this Figma, so the text uses Inter.` };
}

// Each text made, with what Depth drew, for the line check.
type Made = {node: TextNode; spec: TextSpec}[];

function text(spec: TextSpec, fonts: Fonts, made: Made) {
  const node = figma.createText();
  node.name = spec.name;
  node.fontName = (spec.font === 'Inter' ? fonts.inter : fonts.hero)[spec.weight];
  node.characters = spec.characters;
  node.fontSize = spec.size;
  node.lineHeight = { unit: 'PIXELS', value: spec.lineHeight };
  node.letterSpacing = { unit: 'PIXELS', value: spec.letterSpacing };
  node.fills = [{ type: 'SOLID', color: spec.color }];
  node.textAlignHorizontal = spec.align;
  // A fixed width wraps the text as the browser did; auto height then follows the lines.
  if (spec.width === null) node.textAutoResize = 'WIDTH_AND_HEIGHT';
  else {
    node.textAutoResize = 'HEIGHT';
    node.resize(spec.width, node.height);
  }
  if (spec.link) node.hyperlink = { type: 'URL', value: spec.link };
  made.push({ node, spec });
  return node;
}

// An auto-layout frame that hugs its children.
function box(spec: BoxSpec, fonts: Fonts, made: Made) {
  const node = figma.createFrame();
  node.name = spec.name;
  node.layoutMode = spec.direction;
  node.primaryAxisSizingMode = 'AUTO';
  node.counterAxisSizingMode = 'AUTO';
  node.counterAxisAlignItems = spec.align;
  node.itemSpacing = spec.itemSpacing;
  Object.assign(node, { paddingTop: spec.padding.top, paddingRight: spec.padding.right, paddingBottom: spec.padding.bottom, paddingLeft: spec.padding.left });
  node.cornerRadius = spec.radius;
  node.fills = spec.fill ? [{ type: 'SOLID', color: spec.fill }] : [];
  node.clipsContent = false;
  for (const child of spec.children) node.appendChild(child.type === 'TEXT' ? text(child, fonts, made) : box(child, fonts, made));
  return node;
}

// One hero frame: the backdrop as its fill, the poster over it, then the copy, in the PNG's order. The caption sits
// outside the frame, which clips.
function heroFrame(spec: FrameSpec, png: Uint8Array, fonts: Fonts, made: Made) {
  const frame = figma.createFrame();
  frame.name = spec.name;
  frame.resize(spec.width, spec.height);
  frame.clipsContent = true;
  frame.fills = [spec.backdrop];
  const model = figma.createRectangle();
  model.name = '3D model';
  model.resize(spec.width, spec.height);
  model.fills = [{ type: 'IMAGE', imageHash: figma.createImage(png).hash, scaleMode: 'FILL' }];
  model.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };
  frame.appendChild(model);
  if (spec.copy) {
    const copy = box(spec.copy, fonts, made);
    // Fixed width, hugging height: resize first, as resizing fixes both axes.
    copy.resize(spec.copy.width, copy.height);
    copy.counterAxisSizingMode = 'FIXED';
    copy.primaryAxisSizingMode = 'AUTO';
    frame.appendChild(copy);
    copy.x = spec.copy.x;
    copy.y = spec.copy.y;
  }
  return { frame, caption: text(spec.caption, fonts, []) };
}

// New Frame: a frame per kind, 200 px right of the page's rightmost top-level node (Both's mobile frame 120 px right of
// the desktop one), selected and zoomed into view as one undo step. Returns notes for the panel.
export async function placeNewFrames(heroId: string, hero: HeroFile, pngs: Partial<Record<FrameKind, Uint8Array>>) {
  const kinds = kindsOf(hero.frame), specs = kinds.map(kind => frameSpec(hero, kind, viewerUrl(heroId)));
  if (kinds.some(kind => !pngs[kind])) throw new Error('The hero’s poster didn’t arrive. Try again.');
  const fonts = await pickFonts(), page = figma.currentPage;
  const rightmost = page.children.reduce<SceneNode | null>((found, node) => !found || node.x + node.width > found.x + found.width ? node : found, null);
  let x = rightmost ? rightmost.x + rightmost.width + 200 : 0;
  const y = rightmost ? rightmost.y : 0, frames: FrameNode[] = [], captions: TextNode[] = [], notes: string[] = fonts.notice ? [fonts.notice] : [];
  for (const spec of specs) {
    const made: Made = [], { frame, caption } = heroFrame(spec, pngs[spec.kind]!, fonts, made);
    frame.x = x;
    frame.y = y;
    caption.x = x;
    caption.y = y + spec.caption.y;
    frame.setPluginData('depth', JSON.stringify({ heroId, version: hero.version, kind: spec.kind }));
    frames.push(frame);
    captions.push(caption);
    notes.push(...lineCheck(made, kinds.length > 1 ? (spec.kind === 'desktop' ? 'Desktop' : 'Mobile') : ''));
    x += spec.width + 120;
  }
  page.selection = frames;
  figma.viewport.scrollAndZoomIntoView([...frames, ...captions]);
  figma.commitUndo();
  return { notes };
}

// Each text whose line count here (its height over its line height) differs from Depth's.
function lineCheck(made: Made, frame: string) {
  return made.flatMap(({ node, spec }) => {
    const lines = Math.round(node.height / spec.lineHeight), name = spec.name === 'Label' ? 'Button' : spec.name;
    return lines === spec.lines ? [] : [`${name}${frame ? ` (${frame})` : ''}: ${lines} line${lines === 1 ? '' : 's'} here, ${spec.lines} in Depth`];
  });
}

// Replace Selection fills exactly one layer that takes fills.
const fillable = ['FRAME', 'RECTANGLE', 'ELLIPSE', 'POLYGON', 'STAR', 'VECTOR', 'COMPONENT', 'INSTANCE'];
const named: Record<string, string> = { TEXT: 'A text layer', GROUP: 'A group', LINE: 'A line' };
export function selectionState(selection: readonly SceneNode[]) {
  if (!selection.length) return { fillable: false, reason: 'Select a frame or shape to fill with the model.' };
  if (selection.length > 1) return { fillable: false, reason: 'Select only one frame or shape.' };
  const [node] = selection;
  return fillable.includes(node.type) ? { fillable: true, reason: '' } : { fillable: false, reason: `${named[node.type] ?? 'This layer'} can’t show the model. Select a frame or shape.` };
}

// The model alone, cropped, fits the layer and keeps its proportions. Only the fills change, as one undo step.
export function replaceSelection(png: Uint8Array) {
  const selection = figma.currentPage.selection, state = selectionState(selection);
  if (!state.fillable) throw new Error(state.reason);
  (selection[0] as MinimalFillsMixin).fills = [{ type: 'IMAGE', imageHash: figma.createImage(png).hash, scaleMode: 'FIT' }];
  figma.commitUndo();
}
