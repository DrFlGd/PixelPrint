import { MeshBuilder, circle, fillPolygon, wall, type Mesh, type P2 } from './mesh';
import type { PixelGrid } from './sprite';
import type { ColorMapping } from './palette';
import { buildStand, slotDepth, DEFAULT_POST, type Slot, type StandSettings } from './stand';
import {
  DEFAULT_MAGNETS,
  MAGNET_WALL,
  pocketRadius,
  pocketZ,
  type MagnetReport,
  type MagnetSettings,
} from './magnets';

export type ModelMode = 'flat' | 'one-sided' | 'two-sided' | 'stacked';

export interface ModelSettings {
  mode: ModelMode;
  /** Edge length of one sprite pixel in mm. */
  pixelSize: number;
  /** Total thickness for flat / one-sided / two-sided, mm. */
  thickness: number;
  /** Depth of the colored face layer for one- and two-sided, mm. Use a multiple of your layer height. */
  capThickness: number;
  /** Filament for the core of one/two-sided figures and for the stand tab. */
  backingId: string;
  /** Stacked mode: base slab thickness and the rise per level, mm. */
  stackBase: number;
  stackStep: number;
  /** Stacked mode: level per filament id (0 = base only). */
  levels: Record<string, number>;
  stand: StandSettings;
  /** Magnet pockets in the back of the figure. */
  magnets: MagnetSettings;
}

export const DEFAULT_MODEL: ModelSettings = {
  mode: 'one-sided',
  pixelSize: 1,
  thickness: 4,
  capThickness: 0.6,
  backingId: 'black',
  stackBase: 1.6,
  stackStep: 0.8,
  levels: {},
  stand: {
    enabled: true,
    autoSize: true,
    shape: 'round',
    width: 25,
    depth: 25,
    height: 4,
    slotDepth: 2.6,
    clearance: 0.15,
    chamfer: 0.8,
    filamentId: 'black',
    post: DEFAULT_POST,
    magnets: { ...DEFAULT_MAGNETS, count: 2 },
  },
  magnets: DEFAULT_MAGNETS,
};

/** Fill in settings added after a design was saved. */
export function withDefaults(s: Partial<ModelSettings>): ModelSettings {
  return {
    ...DEFAULT_MODEL,
    ...s,
    stand: {
      ...DEFAULT_MODEL.stand,
      ...s.stand,
      post: { ...DEFAULT_POST, ...s.stand?.post },
      magnets: { ...DEFAULT_MODEL.stand.magnets, ...s.stand?.magnets },
    },
    magnets: { ...DEFAULT_MAGNETS, ...s.magnets },
  };
}

export interface VoxelGrid {
  nx: number;
  ny: number;
  nz: number;
  xs: number[];
  ys: number[];
  zs: number[];
  /** Material index per cell, -1 = empty. Index = i + nx * (j + ny * k). */
  cells: Int32Array;
  materials: string[];
}

export interface Part {
  filamentId: string;
  mesh: Mesh;
}

export interface BuiltModel {
  /** Figure parts in print orientation: lying flat, sprite up = +Y, front face = +Z. */
  parts: Part[];
  /** Stand in print orientation, centered on the origin, slots along X. */
  stand: Part | null;
  grid: VoxelGrid;
  width: number;
  height: number;
  thickness: number;
  pixelSize: number;
  spriteRows: number;
  /** Length of the post under the sprite (0 without a stand). */
  postLength: number;
  /** Post center in figure coordinates; the stand's slots are centered on it. */
  postCenterX: number;
  postCenterZ: number;
  figureMagnets: MagnetReport;
  standMagnets: MagnetReport | null;
}

/** Full thickness of the part of the figure that the post can use. */
function postSpan(s: ModelSettings): [number, number] {
  const full = s.mode === 'stacked' ? s.stackBase : s.thickness;
  const t = s.stand.post?.thickness > 0 ? Math.min(s.stand.post.thickness, full) : full;
  return [full / 2 - t / 2, full / 2 + t / 2];
}

/** Thickness of the post that slides into the stand. */
export function tabThickness(s: ModelSettings): number {
  const [a, b] = postSpan(s);
  return b - a;
}

function capOf(s: ModelSettings) {
  return Math.min(s.capThickness, s.mode === 'two-sided' ? s.thickness / 3 : s.thickness / 2);
}

function modeLayers(s: ModelSettings, maxLevel: number): number[] {
  const cap = capOf(s);
  switch (s.mode) {
    case 'flat':
      return [0, s.thickness];
    case 'one-sided':
      return [0, s.thickness - cap, s.thickness];
    case 'two-sided':
      return [0, cap, s.thickness - cap, s.thickness];
    case 'stacked': {
      const zs = [0];
      for (let l = 0; l <= maxLevel; l++) zs.push(s.stackBase + l * s.stackStep);
      return zs;
    }
  }
}

function uniq(values: number[]): number[] {
  const v = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of v) if (!out.length || x - out[out.length - 1] > 1e-6) out.push(x);
  return out;
}

/** X ranges of the post segments, mm. */
function postSegments(grid: PixelGrid, s: ModelSettings): [number, number][] {
  const ps = s.pixelSize;
  let lo = Infinity, hi = -1;
  for (let i = 0; i < grid.w; i++) if (grid.px[(grid.h - 1) * grid.w + i]) { lo = Math.min(lo, i); hi = Math.max(hi, i); }
  if (hi < 0) return [];
  const x0 = lo * ps, x1 = (hi + 1) * ps;
  const span = x1 - x0;
  const post = s.stand.post ?? DEFAULT_POST;
  if (post.style === 'pegs') {
    const pw = Math.max(ps * 0.5, post.pegWidth);
    if (span >= 2 * pw + 1) return [[x0, x0 + pw], [x1 - pw, x1]];
    return [[x0, x1]];
  }
  if (post.width > 0) {
    const w = Math.min(post.width, grid.w * ps);
    const c = Math.min(Math.max((x0 + x1) / 2, w / 2), grid.w * ps - w / 2);
    return [[c - w / 2, c + w / 2]];
  }
  return [[x0, x1]];
}

interface Pocket {
  cx: number;
  cy: number;
  /** Square of solid plastic the round pocket is cut from. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Find spots on the figure's back where a magnet fits inside solid plastic. */
function placeFigureMagnets(grid: PixelGrid, mapping: ColorMapping, s: ModelSettings, postLen: number, maxLevel: number): {
  pockets: Pocket[];
  report: MagnetReport;
} {
  const m = s.magnets ?? DEFAULT_MAGNETS;
  const report: MagnetReport = { requested: m.count, placed: [], pauseZ: null, warnings: [] };
  if (!m.enabled || m.count < 1) return { pockets: [], report };
  const ps = s.pixelSize;
  const r = pocketRadius(m);
  const sq = r / Math.cos(Math.PI / 32) + 0.3;
  const need = Math.max(r + MAGNET_WALL, sq);
  const [, z1] = pocketZ(m);
  const cap = capOf(s);
  const levelOf = (fid: string) => Math.min(maxLevel, Math.max(0, s.levels[fid] ?? 0));
  const T = modeLayers(s, maxLevel).at(-1)!;

  // The back layers of a 1-sided figure are all core, so any solid spot works there.
  const coreOnly = s.mode === 'one-sided' && z1 <= T - cap - 0.2;
  if (s.mode === 'one-sided' && !coreOnly) {
    report.warnings.push(
      `The figure is too thin for a ${m.thickness} mm magnet. Make it at least ${(z1 + cap + 0.2).toFixed(1)} mm thick.`,
    );
    return { pockets: [], report };
  }

  const fits = (cx: number, cy: number) => {
    const c0 = Math.floor((cx - need) / ps), c1 = Math.ceil((cx + need) / ps) - 1;
    const r0 = grid.h - 1 - (Math.ceil((cy + need - postLen) / ps) - 1);
    const r1 = grid.h - 1 - Math.floor((cy - need - postLen) / ps);
    if (c0 < 0 || r0 < 0 || c1 >= grid.w || r1 >= grid.h) return false;
    let fid: string | null = null;
    for (let row = r0; row <= r1; row++)
      for (let col = c0; col <= c1; col++) {
        const hex = grid.px[row * grid.w + col];
        const f = hex ? mapping[hex] : undefined;
        if (!f) return false;
        if (coreOnly) continue;
        if (fid && f !== fid) return false;
        fid = f;
      }
    if (coreOnly) return true;
    const top = s.mode === 'stacked' ? s.stackBase + levelOf(fid!) * s.stackStep : s.mode === 'two-sided' ? s.thickness - cap : T;
    return z1 <= top - MAGNET_WALL;
  };

  const candidates: P2[] = [];
  let sx = 0, sy = 0, n = 0;
  for (let row = 0; row < grid.h; row++)
    for (let col = 0; col < grid.w; col++)
      if (grid.px[row * grid.w + col]) {
        sx += (col + 0.5) * ps;
        sy += postLen + (grid.h - row - 0.5) * ps;
        n++;
      }
  const step = Math.min(0.5, ps / 2);
  for (let y = postLen + need; y <= postLen + grid.h * ps - need + 1e-9; y += step)
    for (let x = need; x <= grid.w * ps - need + 1e-9; x += step) if (fits(x, y)) candidates.push([x, y]);

  const chosen: P2[] = [];
  if (candidates.length && n) {
    const cx = sx / n, cy = sy / n;
    // One magnet goes nearest the middle; several start from the far edge and spread out.
    const dist = (c: P2) => Math.hypot(c[0] - cx, c[1] - cy);
    chosen.push(candidates.reduce((best, c) => ((m.count === 1 ? dist(c) < dist(best) : dist(c) > dist(best)) ? c : best)));
    while (chosen.length < m.count) {
      let best: P2 | null = null, bestD = -1;
      for (const c of candidates) {
        const d = Math.min(...chosen.map((p) => Math.hypot(c[0] - p[0], c[1] - p[1])));
        const apart = chosen.every((p) => Math.max(Math.abs(c[0] - p[0]), Math.abs(c[1] - p[1])) >= 2 * sq + 0.2);
        if (apart && d > bestD) {
          bestD = d;
          best = c;
        }
      }
      if (!best) break;
      chosen.push(best);
    }
  }
  report.placed = chosen;
  if (chosen.length < m.count) {
    const what = coreOnly ? 'solid area' : 'single-color area';
    report.warnings.push(
      chosen.length === 0
        ? `No ${what} is big enough for a ${m.diameter} mm magnet. Try a bigger pixel size or a smaller magnet.`
        : `Only ${chosen.length} of ${m.count} magnets fit.`,
    );
  }
  if (m.hidden && chosen.length) report.pauseZ = z1;
  return {
    pockets: chosen.map(([cx, cy]) => ({ cx, cy, x0: cx - sq, x1: cx + sq, y0: cy - sq, y1: cy + sq })),
    report,
  };
}

interface Layout {
  vox: VoxelGrid;
  pockets: (Pocket & { i0: number; i1: number; j0: number; j1: number; kLo: number; kHi: number })[];
  report: MagnetReport;
  segments: [number, number][];
  postLen: number;
  postZ: [number, number];
}

function layout(grid: PixelGrid, mapping: ColorMapping, s: ModelSettings): Layout {
  const ps = s.pixelSize;
  const materials: string[] = [];
  const mat = (id: string) => {
    let i = materials.indexOf(id);
    if (i < 0) {
      i = materials.length;
      materials.push(id);
    }
    return i;
  };

  let maxLevel = 0;
  if (s.mode === 'stacked')
    for (const p of grid.px) if (p && mapping[p]) maxLevel = Math.max(maxLevel, s.levels[mapping[p]] ?? 0);
  const cap = capOf(s);
  const layers = modeLayers(s, maxLevel);
  const postLen = s.stand.enabled ? slotDepth(s.stand) : 0;
  const segments = s.stand.enabled ? postSegments(grid, s) : [];
  const postZ = postSpan(s);
  const { pockets, report } = placeFigureMagnets(grid, mapping, s, postLen, maxLevel);
  const [pz0, pz1] = pocketZ(s.magnets ?? DEFAULT_MAGNETS);
  const W = grid.w * ps;

  const xs = uniq([
    ...Array.from({ length: grid.w + 1 }, (_, i) => i * ps),
    ...segments.flat(),
    ...pockets.flatMap((p) => [p.x0, p.x1]),
  ]).filter((x) => x >= -1e-9 && x <= W + 1e-9);
  const ys = uniq([
    0,
    ...(postLen ? [postLen] : []),
    ...Array.from({ length: grid.h + 1 }, (_, r) => postLen + r * ps),
    ...pockets.flatMap((p) => [p.y0, p.y1]),
  ]);
  const zs = uniq([...layers, ...(segments.length ? postZ : []), ...(pockets.length ? [pz0, pz1] : [])]);
  const nx = xs.length - 1, ny = ys.length - 1, nz = zs.length - 1;
  const cells = new Int32Array(nx * ny * nz).fill(-1);
  const backing = mat(s.backingId);

  for (let k = 0; k < nz; k++) {
    const cz = (zs[k] + zs[k + 1]) / 2;
    for (let j = 0; j < ny; j++) {
      const cy = (ys[j] + ys[j + 1]) / 2;
      for (let i = 0; i < nx; i++) {
        const cx = (xs[i] + xs[i + 1]) / 2;
        let m = -1;
        if (cy < postLen) {
          if (cz > postZ[0] && cz < postZ[1] && segments.some(([a, b]) => cx > a && cx < b)) m = backing;
        } else {
          const col = Math.floor(cx / ps);
          const row = grid.h - 1 - Math.floor((cy - postLen) / ps);
          const hex = grid.px[row * grid.w + col];
          const fid = hex ? mapping[hex] : undefined;
          if (fid) {
            switch (s.mode) {
              case 'flat':
                m = mat(fid);
                break;
              case 'one-sided':
                m = cz < s.thickness - cap ? backing : mat(fid);
                break;
              case 'two-sided':
                m = cz < cap || cz > s.thickness - cap ? mat(fid) : backing;
                break;
              case 'stacked': {
                const level = Math.min(maxLevel, Math.max(0, s.levels[fid] ?? 0));
                if (cz < s.stackBase + level * s.stackStep) m = mat(fid);
                break;
              }
            }
          }
        }
        cells[i + nx * (j + ny * k)] = m;
      }
    }
  }

  const idx = (arr: number[], v: number) => arr.findIndex((a) => Math.abs(a - v) < 1e-6);
  const vox: VoxelGrid = { nx, ny, nz, xs, ys, zs, cells, materials };
  const placed: Layout['pockets'] = [];
  const at = (i: number, j: number, k: number) => cells[i + nx * (j + ny * k)];
  for (const p of pockets) {
    const q = { ...p, i0: idx(xs, p.x0), i1: idx(xs, p.x1), j0: idx(ys, p.y0), j1: idx(ys, p.y1), kLo: idx(zs, pz0), kHi: idx(zs, pz1) };
    // Every layer the pocket touches, plus the one above (and below when hidden), must be one solid material.
    let ok = q.kHi < nz;
    for (let k = Math.max(0, q.kLo - 1); ok && k <= q.kHi; k++) {
      const m0 = at(q.i0, q.j0, k);
      for (let j = q.j0; ok && j < q.j1; j++) for (let i = q.i0; ok && i < q.i1; i++) if (at(i, j, k) !== m0 || m0 < 0) ok = false;
    }
    if (ok) placed.push(q);
  }
  if (placed.length < pockets.length) report.placed = placed.map((p) => [p.cx, p.cy]);
  return { vox, pockets: placed, report, segments, postLen, postZ };
}

export function buildVoxels(grid: PixelGrid, mapping: ColorMapping, s: ModelSettings): VoxelGrid {
  return layout(grid, mapping, s).vox;
}

// Face directions: axis, sign, and the two in-plane axes (u x v points outward).
const FACES: { axis: 0 | 1 | 2; sign: 1 | -1; u: 0 | 1 | 2; v: 0 | 1 | 2 }[] = [
  { axis: 0, sign: 1, u: 1, v: 2 },
  { axis: 0, sign: -1, u: 2, v: 1 },
  { axis: 1, sign: 1, u: 2, v: 0 },
  { axis: 1, sign: -1, u: 0, v: 2 },
  { axis: 2, sign: 1, u: 0, v: 1 },
  { axis: 2, sign: -1, u: 1, v: 0 },
];

/**
 * One closed mesh per material. Faces between cells of the same material are dropped.
 * Magnet pockets are cut as round holes through the square of cells reserved for them.
 */
function meshLayout(L: Layout, magnets: MagnetSettings): Part[] {
  const g = L.vox;
  const { nx, ny, nz, cells } = g;
  const coords = [g.xs, g.ys, g.zs];
  const builders = g.materials.map(() => new MeshBuilder());
  const at = (c: number[]) =>
    c[0] < 0 || c[1] < 0 || c[2] < 0 || c[0] >= nx || c[1] >= ny || c[2] >= nz ? -1 : cells[c[0] + nx * (c[1] + ny * c[2])];

  // Bit 1: skip the -Z face, bit 2: skip the +Z face (the pocket code draws those instead).
  const skip = new Uint8Array(cells.length);
  const r = pocketRadius(magnets);
  for (const p of L.pockets) {
    const matAt = (k: number) => cells[p.i0 + nx * (p.j0 + ny * k)];
    for (let j = p.j0; j < p.j1; j++)
      for (let i = p.i0; i < p.i1; i++) {
        for (let k = p.kLo; k < p.kHi; k++) skip[i + nx * (j + ny * k)] = 3;
        if (matAt(p.kHi) === matAt(p.kHi - 1)) skip[i + nx * (j + ny * p.kHi)] |= 1;
        if (p.kLo > 0 && matAt(p.kLo - 1) === matAt(p.kLo)) skip[i + nx * (j + ny * (p.kLo - 1))] |= 2;
      }
  }

  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const ci = i + nx * (j + ny * k);
        const m = cells[ci];
        if (m < 0) continue;
        const b = builders[m];
        const cell = [i, j, k];
        for (const f of FACES) {
          if (f.axis === 2 && skip[ci] & (f.sign < 0 ? 1 : 2)) continue;
          const n = cell.slice();
          n[f.axis] += f.sign;
          if (at(n) === m) continue;
          const base = cell.slice();
          if (f.sign > 0) base[f.axis] += 1;
          const corner = (du: number, dv: number) => {
            const c = base.slice();
            c[f.u] += du;
            c[f.v] += dv;
            return b.vertex(coords[0][c[0]], coords[1][c[1]], coords[2][c[2]]);
          };
          b.quad(corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1));
        }
      }

  for (const p of L.pockets) {
    const matAt = (k: number) => cells[p.i0 + nx * (p.j0 + ny * k)];
    // Square outline through every grid line so its edges meet the neighbouring cells exactly.
    const outer: P2[] = [];
    for (let i = p.i0; i < p.i1; i++) outer.push([g.xs[i], g.ys[p.j0]]);
    for (let j = p.j0; j < p.j1; j++) outer.push([g.xs[p.i1], g.ys[j]]);
    for (let i = p.i1; i > p.i0; i--) outer.push([g.xs[i], g.ys[p.j1]]);
    for (let j = p.j1; j > p.j0; j--) outer.push([g.xs[p.i0], g.ys[j]]);
    const hole = circle(p.cx, p.cy, r);
    const cw = [...hole].reverse();
    for (let k = p.kLo; k < p.kHi; k++) {
      const m = matAt(k);
      const b = builders[m];
      wall(b, cw, g.zs[k], cw, g.zs[k + 1]);
      const below = k === p.kLo ? (k === 0 ? -1 : matAt(k - 1)) : matAt(k - 1);
      const above = matAt(k + 1);
      if (below !== m) fillPolygon(b, outer, [hole], g.zs[k], false);
      if (above !== m) fillPolygon(b, outer, [hole], g.zs[k + 1], true);
    }
    if (p.kLo > 0 && matAt(p.kLo - 1) === matAt(p.kLo)) fillPolygon(builders[matAt(p.kLo)], hole, [], g.zs[p.kLo], true);
    if (matAt(p.kHi) === matAt(p.kHi - 1)) fillPolygon(builders[matAt(p.kHi)], hole, [], g.zs[p.kHi], false);
  }

  return builders
    .map((b, i) => ({ filamentId: g.materials[i], mesh: b.build() }))
    .filter((p) => p.mesh.indices.length > 0);
}

export function voxelMeshes(g: VoxelGrid): Part[] {
  return meshLayout({ vox: g, pockets: [], report: { requested: 0, placed: [], pauseZ: null, warnings: [] }, segments: [], postLen: 0, postZ: [0, 0] }, DEFAULT_MAGNETS);
}

export function buildModel(grid: PixelGrid, mapping: ColorMapping, s: ModelSettings): BuiltModel {
  const L = layout(grid, mapping, s);
  const vox = L.vox;
  const parts = meshLayout(L, s.magnets ?? DEFAULT_MAGNETS);
  const width = vox.xs[vox.nx];
  const height = vox.ys[vox.ny];
  const thickness = vox.zs[vox.nz];
  const postCenterZ = (L.postZ[0] + L.postZ[1]) / 2;
  let postCenterX = width / 2;
  let stand: Part | null = null;
  let standMagnets: MagnetReport | null = null;
  if (s.stand.enabled && L.segments.length) {
    const lo = Math.min(...L.segments.map((x) => x[0]));
    const hi = Math.max(...L.segments.map((x) => x[1]));
    postCenterX = (lo + hi) / 2;
    const c = s.stand.clearance;
    const halfT = (L.postZ[1] - L.postZ[0]) / 2 + c;
    const slots: Slot[] = L.segments.map(([a, b]) => ({ x0: a - c - postCenterX, x1: b + c - postCenterX, y0: -halfT, y1: halfT }));
    const built = buildStand(s.stand, slots);
    stand = { filamentId: s.stand.filamentId, mesh: built.mesh };
    standMagnets = built.magnets;
  }
  return {
    parts,
    stand,
    grid: vox,
    width,
    height,
    thickness,
    pixelSize: s.pixelSize,
    spriteRows: grid.h,
    postLength: L.postLen,
    postCenterX,
    postCenterZ,
    figureMagnets: L.report,
    standMagnets,
  };
}

/** Smallest common miniature base that fits the post with a few mm to spare. */
export const BASE_SIZES = [20, 25, 32, 40, 50, 60];
export function autoBaseSize(tabLen: number, tabThick: number): number {
  const need = Math.max(tabLen, tabThick) + 6;
  return BASE_SIZES.find((d) => d >= need) ?? Math.ceil(need);
}

/** Width of the post along the figure, mm (for sizing the base). */
export function postLength(grid: PixelGrid, s: ModelSettings): number {
  const seg = postSegments(grid, s);
  return seg.length ? Math.max(...seg.map((x) => x[1])) - Math.min(...seg.map((x) => x[0])) : 0;
}
