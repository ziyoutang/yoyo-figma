// Pure: where the model is in a poster, the 3D layer on a transparent background.
export type Box = {x: number; y: number; width: number; height: number};

// The box around every pixel whose alpha is above 8 of 255 (RGBA rows, as a canvas gives them), padded on each side by
// 4% of its longer side and kept inside the poster. null when the poster is empty.
export function modelBox(pixels: ArrayLike<number>, width: number, height: number): Box | null {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] <= 8) continue;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    bottom = y;
  }
  if (right < 0) return null;
  const pad = Math.round(Math.max(right - left + 1, bottom - top + 1) * 0.04);
  const x = Math.max(0, left - pad), y = Math.max(0, top - pad);
  return { x, y, width: Math.min(width, right + 1 + pad) - x, height: Math.min(height, bottom + 1 + pad) - y };
}
