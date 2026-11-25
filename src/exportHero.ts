import { toCanvas } from 'html-to-image';

// Renders the 3D layer at a pixel size and returns it as a 2D canvas.
export type Capture3D = (width: number, height: number) => HTMLCanvasElement | null;

// The hero as shown, `width` pixels wide, drawn in its stacking order: backdrop, 3D model, then the copy on top.
export async function heroPng(node: HTMLElement, width: number, capture: Capture3D | null): Promise<Blob> {
  const pixelRatio = width / node.offsetWidth, height = Math.round(node.offsetHeight * pixelRatio);
  const has = (element: Node, name: string) => element instanceof HTMLElement && element.classList.contains(name);
  const layer = (leaveOut: string) => toCanvas(node, { pixelRatio, filter: element => !has(element, 'hero-canvas') && !has(element, leaveOut) });
  const backdrop = await layer('hero-copy'), copy = await layer('hero-backdrop');
  const out = document.createElement('canvas');
  out.width = width; out.height = height;
  const context = out.getContext('2d')!;
  context.drawImage(backdrop, 0, 0, width, height);
  const model = capture?.(width, height);
  if (model) context.drawImage(model, 0, 0, width, height);
  context.drawImage(copy, 0, 0, width, height);
  return png(out);
}

// The 3D layer alone, `width` pixels wide, on a transparent background. The height keeps the hero's exact proportions.
export function layerPng(node: HTMLElement, width: number, capture: Capture3D | null): Promise<Blob> {
  const { width: w, height: h } = node.getBoundingClientRect(), layer = capture?.(width, Math.round(width * h / w));
  return layer ? png(layer) : Promise.reject(new Error('The 3D layer could not be drawn.'));
}

const png = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The PNG could not be made.')), 'image/png'));
