import { hexColor, parseBackdrop, type ButtonLayout, type FrameLayout, type TextLayout, type TextStyle } from './figmaLayout';

// Studio only: the Figma layout of a HeroPreview as the browser draws it. Lengths are fractions of the hero's width.
// Under CSS zoom (the studio's .workflow-main) boxes are zoomed and computed lengths aren't, so each is divided by the
// hero's width in its own space: its box for positions and heights, its computed width for font sizes and padding.
export function measureLayout(hero: HTMLElement): FrameLayout {
  const box = hero.getBoundingClientRect(), cssWidth = parseFloat(getComputedStyle(hero).width) || box.width;
  const ofBox = (px: number) => round(px / box.width), ofCss = (value: string) => round((parseFloat(value) || 0) / cssWidth);
  const color = (css: string) => {
    const hex = hexColor(css);
    if (!hex) throw new Error(`The hero's colour ${css} couldn't be read.`);
    return hex;
  };
  const backdropStyle = getComputedStyle(hero.querySelector('.hero-backdrop')!);
  const backdrop = parseBackdrop(backdropStyle.backgroundImage, backdropStyle.backgroundColor);
  if (!backdrop) throw new Error(`The hero's backdrop ${backdropStyle.backgroundImage} couldn't be read.`);
  const copy = shown(hero.querySelector('.hero-copy'));
  if (!copy) return { backdrop, copy: null };
  const copyBox = copy.getBoundingClientRect();

  // A text's look; `height` is its content height, for a line height of `normal`.
  const style = (element: Element, height: number): TextStyle => {
    const css = getComputedStyle(element), lines = lineCount(element);
    return {
      size: ofCss(css.fontSize), lineHeight: css.lineHeight.endsWith('px') ? ofCss(css.lineHeight) : ofBox(height / lines),
      letterSpacing: css.letterSpacing === 'normal' ? 0 : ofCss(css.letterSpacing), weight: Number(css.fontWeight) >= 600 ? 700 : 400, color: color(css.color), lines,
    };
  };
  const layout: FrameLayout = { backdrop, copy: { x: ofBox(copyBox.left - box.left), y: ofBox(copyBox.top - box.top), width: ofBox(copyBox.width), align: getComputedStyle(copy).textAlign === 'center' ? 'center' : 'left' } };
  let above = copyBox.top;
  const gapTo = (rect: DOMRect) => { const gap = Math.max(0, ofBox(rect.top - above)); above = rect.bottom; return gap; };
  for (const [name, selector] of [['eyebrow', '.hero-eyebrow'], ['headline', 'h2'], ['subtitle', '.hero-description']] as const) {
    const element = shown(copy.querySelector(selector));
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    layout[name] = { gap: gapTo(rect), ...style(element, rect.height) } satisfies TextLayout;
  }
  const button = shown(copy.querySelector('.hero-cta'));
  if (button) {
    const rect = button.getBoundingClientRect(), css = getComputedStyle(button);
    const padding = (parseFloat(css.paddingTop) + parseFloat(css.paddingBottom)) * box.width / cssWidth;
    layout.button = {
      gap: gapTo(rect), paddingX: ofCss(css.paddingLeft), paddingY: ofCss(css.paddingTop), radius: ofCss(css.borderTopLeftRadius),
      fill: color(css.backgroundColor), label: style(button, rect.height - padding),
    } satisfies ButtonLayout;
  }
  return layout;
}

const round = (fraction: number) => Math.round(fraction * 1e5) / 1e5;

// The element when it is drawn and has text.
function shown(element: Element | null) {
  if (!element?.textContent || getComputedStyle(element).display === 'none') return null;
  const { width, height } = element.getBoundingClientRect();
  return width && height ? element : null;
}

// The distinct line boxes of an element's text.
function lineCount(element: Element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const tops = [...range.getClientRects()].map(rect => rect.top).sort((a, b) => a - b);
  return Math.max(1, tops.filter((top, i) => i === 0 || top - tops[i - 1] > 1).length);
}
