import { describe, expect, it } from 'vitest';
import { modelBox } from './images';

// A transparent RGBA image with the given pixels' alpha set.
function image(width: number, height: number, opaque: [number, number, number?][]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, alpha = 255] of opaque) pixels[(y * width + x) * 4 + 3] = alpha;
  return pixels;
}

describe('modelBox', () => {
  it('finds nothing in an empty poster, or one whose alpha is 8 or less', () => {
    expect(modelBox(image(10, 10, []), 10, 10)).toBeNull();
    expect(modelBox(image(10, 10, [[3, 3, 8], [5, 5, 1]]), 10, 10)).toBeNull();
  });

  it('boxes one pixel, and counts alpha above 8', () => {
    expect(modelBox(image(10, 10, [[4, 6, 9]]), 10, 10)).toEqual({ x: 4, y: 6, width: 1, height: 1 });
  });

  it('pads each side by 4% of the longer side', () => {
    // A 100 × 50 model in a 400 × 300 poster: 4 px of padding all round.
    const opaque: [number, number][] = [[150, 100], [249, 100], [150, 149], [249, 149], [200, 120]];
    expect(modelBox(image(400, 300, opaque), 400, 300)).toEqual({ x: 146, y: 96, width: 108, height: 58 });
  });

  it('keeps the padding inside the poster for a model at the edge', () => {
    expect(modelBox(image(400, 300, [[0, 0], [99, 0], [0, 299], [399, 150]]), 400, 300)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(modelBox(image(400, 300, [[300, 250], [399, 299]]), 400, 300)).toEqual({ x: 296, y: 246, width: 104, height: 54 });
  });
});
