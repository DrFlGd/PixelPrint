import { describe, expect, it } from 'vitest';
import { addBorder, autoRects, BORDER, extractSprite, gridRects, guessBackground, DEFAULT_SLICE, type Img } from '../src/lib/sprite';
import { autoMap, DEFAULT_FILAMENTS } from '../src/lib/palette';

function makeImg(w: number, h: number, fill: [number, number, number, number]): Img {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(fill, i * 4);
  return { width: w, height: h, data };
}
function paint(img: Img, x: number, y: number, w: number, h: number, c: [number, number, number]) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) img.data.set([...c, 255], (yy * img.width + xx) * 4);
}

describe('slicing', () => {
  it('finds sprites on a solid backdrop and merges nearby islands', () => {
    const img = makeImg(40, 20, [255, 0, 255, 255]);
    paint(img, 2, 2, 6, 8, [200, 0, 0]);
    paint(img, 9, 3, 1, 2, [200, 0, 0]); // floating bit 1px away
    paint(img, 20, 4, 8, 8, [0, 0, 200]);
    const bg = guessBackground(img);
    expect(bg).toEqual({ mode: 'color', hex: '#ff00ff' });
    const rects = autoRects(img, { ...DEFAULT_SLICE, background: bg, mergeGap: 2 });
    expect(rects).toEqual([
      { x: 2, y: 2, w: 8, h: 8 },
      { x: 20, y: 4, w: 8, h: 8 },
    ]);
  });

  it('grid mode skips empty cells', () => {
    const img = makeImg(32, 16, [0, 0, 0, 0]);
    paint(img, 18, 2, 4, 4, [10, 10, 10]);
    const rects = gridRects(img, { ...DEFAULT_SLICE, mode: 'grid', cellW: 16, cellH: 16 });
    expect(rects).toEqual([{ x: 16, y: 0, w: 16, h: 16 }]);
  });

  it('trims and undoes 3x upscaling', () => {
    const img = makeImg(20, 20, [0, 0, 0, 0]);
    paint(img, 3, 3, 6, 3, [255, 0, 0]);
    paint(img, 3, 6, 3, 3, [0, 255, 0]);
    const g = extractSprite(img, { x: 0, y: 0, w: 20, h: 20 }, { mode: 'alpha' });
    expect(g.w).toBe(2);
    expect(g.h).toBe(2);
    expect(g.px).toEqual(['#ff0000', '#ff0000', '#00ff00', null]);
  });
});

describe('autoMap', () => {
  it('limits the number of filaments', () => {
    const colors = [
      { hex: '#000000', count: 50 },
      { hex: '#ff0000', count: 30 },
      { hex: '#00aa00', count: 10 },
      { hex: '#ffff00', count: 2 },
    ];
    const map = autoMap(colors, DEFAULT_FILAMENTS, 3);
    expect(new Set(Object.values(map)).size).toBe(3);
    expect(map['#000000']).toBe('black');
    expect(map['#ff0000']).toBe('red');
  });
});

describe('addBorder', () => {
  const dot = { w: 1, h: 1, px: ['#ff0000'] };
  it('outlines with corners', () => {
    const g = addBorder(dot, 1, true);
    expect(g.w).toBe(3);
    expect(g.px.filter((p) => p === BORDER).length).toBe(8);
    expect(g.px[4]).toBe('#ff0000');
  });
  it('outlines without corners and grows with width', () => {
    expect(addBorder(dot, 1, false).px.filter((p) => p === BORDER).length).toBe(4);
    const g = addBorder(dot, 2, true);
    expect(g.w).toBe(5);
    expect(g.px.filter((p) => p === BORDER).length).toBe(24);
  });
  it('outlines holes inside the sprite too', () => {
    const ring = { w: 3, h: 3, px: ['#a', '#a', '#a', '#a', null, '#a', '#a', '#a', '#a'] };
    const g = addBorder(ring, 1, true);
    expect(g.px[2 * 5 + 2]).toBe(BORDER);
  });
});
