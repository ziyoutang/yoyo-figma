// Where a hero's copy sits and how it looks, for the Figma plugin. The studio measures it (measureLayout.ts) when it
// captures the posters, and publishHero keeps it in hero.json. Shared with the plugin, so no DOM and no imports.
// Every length is a fraction of the hero's width, like the CSS's cqw; the plugin multiplies it by the frame width.
export type Backdrop = {type: 'solid'; color: string} | {type: 'linear'; angle: number; stops: {color: string; at: number}[]};
// lineHeight is always set: the CSS value, or the measured height over `lines` where the CSS says `normal`.
export type TextStyle = {size: number; lineHeight: number; letterSpacing: number; weight: 400 | 700; color: string; lines: number};
// `gap` is the space above the item.
export type TextLayout = TextStyle & {gap: number};
export type ButtonLayout = {gap: number; paddingX: number; paddingY: number; radius: number; fill: string; label: TextStyle};
// `copy` is null for 3D only. The texts and the button are absent when hidden or empty.
export type FrameLayout = {
  backdrop: Backdrop; copy: {x: number; y: number; width: number; align: 'left' | 'center'} | null;
  eyebrow?: TextLayout; headline?: TextLayout; subtitle?: TextLayout; button?: ButtonLayout;
};
export type FigmaLayout = {desktop?: FrameLayout; mobile?: FrameLayout};

// '#rrggbb' from a computed rgb() or rgba() colour, without its alpha; null for anything else.
export function hexColor(css: string): string | null {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(css.trim());
  return match ? `#${match.slice(1).map(n => Math.min(255, Math.round(Number(n))).toString(16).padStart(2, '0')).join('')}` : null;
}

// The backdrop from `.hero-backdrop`'s computed background-image and background-color, as Chrome and Safari give them:
// `linear-gradient(125deg, rgb(255, 255, 255) 3%, rgb(168, 228, 77) 75%)`, or `none` and a solid colour. null otherwise.
export function parseBackdrop(image: string, color: string): Backdrop | null {
  if (image.trim() === 'none') {
    const solid = hexColor(color);
    return solid ? { type: 'solid', color: solid } : null;
  }
  const inner = /^linear-gradient\((.*)\)$/.exec(image.trim())?.[1];
  if (!inner) return null;
  const parts = inner.split(/,(?![^(]*\))/).map(part => part.trim());
  const degrees = /^(-?[\d.]+)deg$/.exec(parts[0]);
  if (degrees) parts.shift();
  const parsed = parts.map(part => /^(rgba?\([^)]*\))(?:\s+(-?[\d.]+)%)?$/.exec(part));
  if (parsed.length < 2 || parsed.some(stop => !stop || !hexColor(stop[1]))) return null;
  // CSS's defaults: the first stop at 0, the last at 1, unplaced ones spread evenly between their neighbours, none before the one above.
  const at: (number | null)[] = parsed.map(stop => stop![2] === undefined ? null : Number(stop![2]) / 100);
  at[0] ??= 0;
  at[at.length - 1] ??= 1;
  for (let i = 1; i < at.length; i++) {
    if (at[i] === null) {
      const next = at.findIndex((value, j) => j > i && value !== null), from = at[i - 1]!;
      at[i] = from + (at[next]! - from) / (next - i + 1);
    }
    at[i] = Math.max(at[i]!, at[i - 1]!);
  }
  const angle = degrees ? ((Number(degrees[1]) % 360) + 360) % 360 : 180;
  return { type: 'linear', angle, stops: parsed.map((stop, i) => ({ color: hexColor(stop![1])!, at: at[i]! })) };
}
