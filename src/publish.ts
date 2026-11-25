import type { FigmaLayout } from './figmaLayout';
import { choices, colors, ranges, textLimits } from './heroOptions';
import { initialDraft, type Draft } from './model';

// The settings a published hero shows, and nothing else: no prompts, uploads, job ids or placement.
export type Snapshot = Pick<Draft, 'frame' | 'layout' | 'template' | 'background' | 'lighting' | 'motion' | 'direction' | 'camera' | 'material'
  | 'backgroundColor' | 'lightingColor' | 'color' | 'secondColor' | 'speed' | 'amount' | 'eyebrow' | 'headline' | 'subtitle' | 'buttonLabel' | 'buttonUrl'>;
// hero.json: file names are inside public/heroes/{heroId}/. The server adds `textured` (the model is a look). `layout` is
// for the Figma plugin; heroes published before Phase 5 have none, and the embed ignores it.
export type PublishedHero = {version: number; model: string; posters: {desktop?: string; mobile?: string}; layout?: FigmaLayout; snapshot: Snapshot & {textured: boolean}};

// In a fixed order, so publishedKey is canonical. The server validates the same fields from its copy of heroOptions.
const fields = [...Object.keys(choices), ...colors, ...Object.keys(ranges), ...Object.keys(textLimits)] as (keyof Snapshot)[];

// Shared by the studio and the embed page.
export function snapshotFromDraft(draft: Draft): Snapshot {
  return Object.fromEntries(fields.map(field => [field, draft[field]])) as Snapshot;
}

// Changes whenever the published hero would look different: its model or any field it shows. The version changes when
// hero.json gains something, so heroes published before then offer an update once. 2: the Figma layout.
const KEY_VERSION = 2;
export const publishedKey = (draft: Draft) => JSON.stringify([KEY_VERSION, draft.lookModelPath || draft.modelPath, snapshotFromDraft(draft)]);

// A draft that renders the published hero with sceneFromDraft and HeroPreview. Throws when `hero` isn't a hero.json.
export function draftFromPublished(heroId: string, hero: unknown): Draft {
  const { model, snapshot } = (hero ?? {}) as Partial<PublishedHero>;
  if (typeof model !== 'string' || !snapshot || typeof snapshot !== 'object') throw new Error('This is not a published hero.');
  const draft = { ...initialDraft };
  // As in readDraft, a field is kept only when it has the expected type.
  for (const field of fields) if (typeof snapshot[field] === typeof draft[field]) Object.assign(draft, { [field]: snapshot[field] });
  const path = `public/heroes/${heroId}/${model}`;
  return { ...draft, ...(snapshot.textured === true ? { lookModelPath: path } : { modelPath: path }) };
}

// The button link rule publishHero enforces: empty, or a link that starts with https://.
export function isHttpsLink(link: string) {
  if (!link.startsWith('https://')) return false;
  try { new URL(link); return true; } catch { return false; }
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const ratios = { desktop: '722/419', mobile: '350/490' };

// The code a designer pastes into a site. Heroes made for Both switch to the mobile box at 600 px and below.
export function embedCode({ heroId, viewer, frame, headline }: {heroId: string; viewer: string; frame: Draft['frame']; headline: string}) {
  const name = `depth-hero-${heroId}`, title = escapeHtml(headline.trim().split(/\s*\n\s*/).join(' '));
  const box = frame === 'Mobile' ? `max-width:390px;aspect-ratio:${ratios.mobile}` : `aspect-ratio:${ratios.desktop}`;
  const iframe = `<div style="container-type:inline-size"><iframe class="${name}" src="${escapeHtml(viewer)}" title="${title}" loading="lazy" style="display:block;width:100%;${box};border:0"></iframe></div>`;
  return frame === 'Both' ? `${iframe}\n<style>@container (max-width:600px){.${name}{aspect-ratio:${ratios.mobile}!important}}</style>` : iframe;
}
