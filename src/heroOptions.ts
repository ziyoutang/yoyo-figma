// What a published hero may contain. functions/src/heroOptions.ts is a copy (functions can't import from src),
// and src/heroOptions.test.ts keeps the two equal.
export const choices = {
  frame: ['Desktop', 'Mobile', 'Both'],
  layout: ['Centered', 'Object Right', '3D only'],
  template: ['Studio Glow', 'Quiet Space', 'Soft Studio'],
  background: ['Template', 'White', 'Mint', 'Custom'],
  lighting: ['Soft', 'Bright', 'Dramatic'],
  motion: ['Still', 'Float', 'Hover Pop', 'Slide', 'Sway', 'Cursor Tilt'],
  direction: ['Auto', 'Reverse'],
  camera: ['Static', 'Push-in', 'Cursor Follow', 'Push-out'],
  material: ['Original', 'Metallic', 'Transparent', 'Rough Matte'],
} as const;
// #rrggbb colours.
export const colors = ['backgroundColor', 'lightingColor', 'color', 'secondColor'] as const;
export const ranges = { speed: [0.2, 2], amount: [0, 100] } as const;
// Characters. The button link may be empty, otherwise https only.
export const textLimits = { eyebrow: 60, headline: 120, subtitle: 240, buttonLabel: 40, buttonUrl: 2048 } as const;
// The 13 settings Agent Mode's scene edit may change: what Templates, Materials, Motion and Scene set, all drawn in the browser.
export const editable = ['motion', 'speed', 'amount', 'direction', 'camera', 'lighting', 'lightingColor', 'background', 'backgroundColor', 'template', 'material', 'color', 'secondColor'] as const;
