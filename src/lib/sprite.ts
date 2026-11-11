import { rgbToHex, hexToRgb } from './color';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Minimal image shape so slicing works on canvas ImageData and in tests. */
export interface Img {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export type Background = { mode: 'alpha' } | { mode: 'color'; hex: string };

export interface SliceSettings {
  mode: 'auto' | 'grid';
  background: Background;
  /** Auto mode: join islands whose boxes are within this many pixels (keeps a floating sword with its hero). */
  mergeGap: number;
  /** Auto mode: ignore specks smaller than this many pixels. */
  minPixels: number;
  cellW: number;
  cellH: number;
  offsetX: number;
  offsetY: number;
  gapX: number;
  gapY: number;
}

export const DEFAULT_SLICE: SliceSettings = {
  mode: 'auto',
  background: { mode: 'alpha' },
  mergeGap: 2,
  minPixels: 4,
  cellW: 16,
  cellH: 16,
  offsetX: 0,
  offsetY: 0,
  gapX: 0,
  gapY: 0,
};

/** Sprite pixels, row 0 at the top. `null` = empty. */
export interface PixelGrid {
  w: number;
  h: number;
  px: (string | null)[];
}

export function isEmpty(img: Img, x: number, y: number, bg: Background): boolean {
  const i = (y * img.width + x) * 4;
  if (img.data[i + 3] < 128) return true;
  if (bg.mode === 'color') {
    const [r, g, b] = hexToRgb(bg.hex);
    return Math.abs(img.data[i] - r) + Math.abs(img.data[i + 1] - g) + Math.abs(img.data[i + 2] - b) <= 6;
  }
  return false;
}

/** Sheets with any transparency use alpha; otherwise the most common corner color is the backdrop. */
export function guessBackground(img: Img): Background {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 250) return { mode: 'alpha' };
  const corners = [
    [0, 0],
    [img.width - 1, 0],
    [0, img.height - 1],
    [img.width - 1, img.height - 1],
  ];
  const counts = new Map<string, number>();
  for (const [x, y] of corners) {
    const hex = pixelHex(img, x, y);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const hex = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { mode: 'color', hex };
}

export function pixelHex(img: Img, x: number, y: number): string {
  const i = (y * img.width + x) * 4;
  return rgbToHex(img.data[i], img.data[i + 1], img.data[i + 2]);
}

function rectHasPixels(img: Img, r: Rect, bg: Background): boolean {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!isEmpty(img, x, y, bg)) return true;
  return false;
}

export function gridRects(img: Img, s: SliceSettings): Rect[] {
  const out: Rect[] = [];
  const cw = Math.max(1, Math.floor(s.cellW));
  const ch = Math.max(1, Math.floor(s.cellH));
  for (let y = s.offsetY; y + ch <= img.height; y += ch + s.gapY) {
    for (let x = s.offsetX; x + cw <= img.width; x += cw + s.gapX) {
      const r = { x, y, w: cw, h: ch };
      if (rectHasPixels(img, r, s.background)) out.push(r);
    }
  }
  return out;
}

/** Find sprites as 8-connected islands of non-background pixels, then merge nearby islands. */
export function autoRects(img: Img, s: SliceSettings): Rect[] {
  const { width: W, height: H } = img;
  const seen = new Uint8Array(W * H);
  const boxes: (Rect & { n: number })[] = [];
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (seen[start]) continue;
    seen[start] = 1;
    if (isEmpty(img, start % W, (start / W) | 0, s.background)) continue;
    let minX = W, minY = H, maxX = 0, maxY = 0, n = 0;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p / W) | 0;
      n++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const q = ny * W + nx;
          if (seen[q]) continue;
          seen[q] = 1;
          if (!isEmpty(img, nx, ny, s.background)) stack.push(q);
        }
      }
    }
    boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, n });
  }
  // Merge boxes that are within mergeGap of each other until stable.
  const gap = Math.max(0, s.mergeGap);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
        const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
        if (
          dx <= gap && dy <= gap
        ) {
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
          const x2 = Math.max(a.x + a.w, b.x + b.w), y2 = Math.max(a.y + a.h, b.y + b.h);
          boxes[i] = { x, y, w: x2 - x, h: y2 - y, n: a.n + b.n };
          boxes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return boxes
    .filter((b) => b.n >= s.minPixels)
    .sort((a, b) => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) / 2 ? a.x - b.x : a.y - b.y))
    .map(({ x, y, w, h }) => ({ x, y, w, h }));
}

export function sliceSheet(img: Img, s: SliceSettings): Rect[] {
  return s.mode === 'grid' ? gridRects(img, s) : autoRects(img, s);
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Detect sprites that were upscaled (every art pixel drawn as an NxN block). */
export function detectScale(grid: PixelGrid): number {
  let g = 0;
  const runs = (get: (i: number) => string | null, len: number) => {
    let run = 1;
    for (let i = 1; i <= len; i++) {
      if (i < len && get(i) === get(i - 1)) run++;
      else {
        g = gcd(g, run);
        run = 1;
      }
    }
  };
  for (let y = 0; y < grid.h; y++) runs((i) => grid.px[y * grid.w + i], grid.w);
  for (let x = 0; x < grid.w; x++) runs((i) => grid.px[i * grid.w + x], grid.h);
  return Math.max(1, Math.min(g, 16));
}

/** Read a sprite out of the sheet, trim empty borders, and undo any integer upscaling. */
export function extractSprite(img: Img, r: Rect, bg: Background, scale: number | 'auto' = 'auto'): PixelGrid {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (!isEmpty(img, x, y, bg)) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) return { w: 0, h: 0, px: [] };
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const raw: PixelGrid = { w, h, px: new Array(w * h) };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      raw.px[y * w + x] = isEmpty(img, minX + x, minY + y, bg) ? null : pixelHex(img, minX + x, minY + y);
  const k = scale === 'auto' ? detectScale(raw) : Math.max(1, scale);
  if (k === 1) return raw;
  const sw = Math.floor(w / k), sh = Math.floor(h / k);
  const out: PixelGrid = { w: sw, h: sh, px: new Array(sw * sh) };
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) out.px[y * sw + x] = raw.px[(y * k + (k >> 1)) * w + x * k + (k >> 1)];
  return out;
}

export function spriteColors(grid: PixelGrid): { hex: string; count: number }[] {
  const m = new Map<string, number>();
  for (const p of grid.px) if (p) m.set(p, (m.get(p) ?? 0) + 1);
  return [...m.entries()].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count);
}
