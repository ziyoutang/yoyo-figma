import type { Backdrop, FrameLayout } from './figmaLayout';

// Test fixtures. Each backdrop's computed background-image and background-color, exactly as Chromium 156 and WebKit
// 605.1.15 (Safari's engine) both gave them on Nov 16, from styles.css, with what parseBackdrop makes of them.
export const backdrops: Record<string, {image: string; color: string; backdrop: Backdrop}> = {
  'Studio Glow': { image: 'linear-gradient(125deg, rgb(255, 255, 255) 3%, rgb(168, 228, 77) 75%)', color: 'rgba(0, 0, 0, 0)', backdrop: { type: 'linear', angle: 125, stops: [{ color: '#ffffff', at: 0.03 }, { color: '#a8e44d', at: 0.75 }] } },
  'Quiet Space': { image: 'linear-gradient(115deg, rgb(234, 227, 219), rgb(212, 200, 178))', color: 'rgba(0, 0, 0, 0)', backdrop: { type: 'linear', angle: 115, stops: [{ color: '#eae3db', at: 0 }, { color: '#d4c8b2', at: 1 }] } },
  'Soft Studio': { image: 'linear-gradient(125deg, rgb(252, 243, 255), rgb(198, 182, 233))', color: 'rgba(0, 0, 0, 0)', backdrop: { type: 'linear', angle: 125, stops: [{ color: '#fcf3ff', at: 0 }, { color: '#c6b6e9', at: 1 }] } },
  Mint: { image: 'linear-gradient(120deg, rgb(255, 255, 255), rgb(167, 232, 211))', color: 'rgba(0, 0, 0, 0)', backdrop: { type: 'linear', angle: 120, stops: [{ color: '#ffffff', at: 0 }, { color: '#a7e8d3', at: 1 }] } },
  White: { image: 'none', color: 'rgb(255, 255, 255)', backdrop: { type: 'solid', color: '#ffffff' } },
  Custom: { image: 'none', color: 'rgb(238, 221, 204)', backdrop: { type: 'solid', color: '#eeddcc' } },
};
const glow = backdrops['Studio Glow'].backdrop;

// Layouts measureLayout made in Chromium 156 on the Complete screen's CSS at 1440 × 900, under the studio's zoom of .85,
// for the default hero copy (the button label is Explore Collection).
const teal = '#00676c';
export const layouts = {
  desktopObjectRight: {
    backdrop: glow, copy: { x: 0.082, y: 0.09703, width: 0.4, align: 'left' },
    eyebrow: { gap: 0, size: 0.0353, lineHeight: 0.04405, letterSpacing: 0, weight: 400, color: teal, lines: 1 },
    headline: { gap: 0.01248, size: 0.0552, lineHeight: 0.06624, letterSpacing: -0.00109, weight: 700, color: '#000000', lines: 2 },
    subtitle: { gap: 0.01248, size: 0.0306, lineHeight: 0.03917, letterSpacing: 0, weight: 400, color: '#878787', lines: 3 },
    button: { gap: 0.01939, paddingX: 0.025, paddingY: 0.0125, radius: 0.01248, fill: teal, label: { size: 0.018, lineHeight: 0.02293, letterSpacing: 0, weight: 400, color: '#ffffff', lines: 1 } },
  },
  mobileObjectRight: {
    backdrop: glow, copy: { x: 0.08999, y: 0.20999, width: 0.82, align: 'left' },
    eyebrow: { gap: 0, size: 0.0353, lineHeight: 0.0444, letterSpacing: 0, weight: 400, color: teal, lines: 1 },
    headline: { gap: 0.01676, size: 0.0857, lineHeight: 0.10284, letterSpacing: -0.00147, weight: 700, color: '#000000', lines: 2 },
    subtitle: { gap: 0.01676, size: 0.0457, lineHeight: 0.05849, letterSpacing: 0, weight: 400, color: '#878787', lines: 2 },
    button: { gap: 0.03999, paddingX: 0.0514, paddingY: 0.0257, radius: 0.01677, fill: teal, label: { size: 0.0371, lineHeight: 0.04684, letterSpacing: 0, weight: 400, color: '#ffffff', lines: 1 } },
  },
  // Centered hides the subtitle.
  desktopCentered: {
    backdrop: glow, copy: { x: 0.08, y: 0.03481, width: 0.83999, align: 'center' },
    eyebrow: { gap: 0, size: 0.0353, lineHeight: 0.04425, letterSpacing: 0, weight: 400, color: teal, lines: 1 },
    headline: { gap: 0.01253, size: 0.0552, lineHeight: 0.06624, letterSpacing: -0.0011, weight: 700, color: '#000000', lines: 2 },
    button: { gap: 0.01939, paddingX: 0.025, paddingY: 0.0125, radius: 0.01254, fill: teal, label: { size: 0.018, lineHeight: 0.02302, letterSpacing: 0, weight: 400, color: '#ffffff', lines: 1 } },
  },
  mobileCentered: {
    backdrop: glow, copy: { x: 0.08997, y: 0.20998, width: 0.81998, align: 'center' },
    eyebrow: { gap: 0, size: 0.0353, lineHeight: 0.04493, letterSpacing: 0, weight: 400, color: teal, lines: 1 },
    headline: { gap: 0.03393, size: 0.08569, lineHeight: 0.10283, letterSpacing: -0.00297, weight: 700, color: '#000000', lines: 2 },
    button: { gap: 0.03998, paddingX: 0.0514, paddingY: 0.0257, radius: 0.03395, fill: teal, label: { size: 0.0371, lineHeight: 0.04486, letterSpacing: 0, weight: 400, color: '#ffffff', lines: 1 } },
  },
  threeDOnly: { backdrop: glow, copy: null },
} satisfies Record<string, FrameLayout>;
