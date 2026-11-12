import { MeshBuilder, type Mesh } from './mesh';
import type { PixelGrid } from './sprite';
import type { ColorMapping } from './palette';
import { buildStand, slotDepth, type StandSettings } from './stand';

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
  },
};

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
  /** Number of tab rows at the bottom (0 or 1). */
  tabRows: number;
}

export interface Part {
  filamentId: string;
  mesh: Mesh;
}

export interface BuiltModel {
  /** Figure parts in print orientation: lying flat, sprite up = +Y, front face = +Z. */
  parts: Part[];
  /** Stand in print orientation, centered on the origin, slot along X. */
  stand: Part | null;
  grid: VoxelGrid;
  width: number;
  height: number;
  thickness: number;
  tabHeight: number;
  tabCenterX: number;
}

/** Thickness of the part of the figure that slides into the stand. */
export function tabThickness(s: ModelSettings): number {
  return s.mode === 'stacked' ? s.stackBase : s.thickness;
}

export function buildVoxels(grid: PixelGrid, mapping: ColorMapping, s: ModelSettings): VoxelGrid {
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

  const cap = Math.min(s.capThickness, s.mode === 'two-sided' ? s.thickness / 3 : s.thickness / 2);
  let zs: number[];
  let maxLevel = 0;
  switch (s.mode) {
    case 'flat':
      zs = [0, s.thickness];
      break;
    case 'one-sided':
      zs = [0, s.thickness - cap, s.thickness];
      break;
    case 'two-sided':
      zs = [0, cap, s.thickness - cap, s.thickness];
      break;
    case 'stacked': {
      for (const p of grid.px) if (p && mapping[p]) maxLevel = Math.max(maxLevel, s.levels[mapping[p]] ?? 0);
      zs = [0];
      for (let l = 0; l <= maxLevel; l++) zs.push(s.stackBase + l * s.stackStep);
      break;
    }
  }

  const tabRows = s.stand.enabled ? 1 : 0;
  const tabH = slotDepth(s.stand);
  const nx = grid.w;
  const ny = grid.h + tabRows;
  const nz = zs.length - 1;
  const xs = Array.from({ length: nx + 1 }, (_, i) => i * ps);
  const ys = [0];
  if (tabRows) ys.push(tabH);
  for (let r = 1; r <= grid.h; r++) ys.push((tabRows ? tabH : 0) + r * ps);

  const cells = new Int32Array(nx * ny * nz).fill(-1);
  const set = (i: number, j: number, k: number, m: number) => (cells[i + nx * (j + ny * k)] = m);
  const backing = mat(s.backingId);

  for (let r = 0; r < grid.h; r++) {
    const j = tabRows + (grid.h - 1 - r);
    for (let i = 0; i < grid.w; i++) {
      const hex = grid.px[r * grid.w + i];
      if (!hex) continue;
      const fid = mapping[hex];
      if (!fid) continue;
      const m = mat(fid);
      switch (s.mode) {
        case 'flat':
          set(i, j, 0, m);
          break;
        case 'one-sided':
          set(i, j, 0, backing);
          set(i, j, 1, m);
          break;
        case 'two-sided':
          set(i, j, 0, m);
          set(i, j, 1, backing);
          set(i, j, 2, m);
          break;
        case 'stacked': {
          const level = Math.min(maxLevel, Math.max(0, s.levels[fid] ?? 0));
          for (let k = 0; k <= level; k++) set(i, j, k, m);
          break;
        }
      }
    }
  }

  if (tabRows) {
    // Tab spans the bottom row of the sprite so the figure slots into the stand.
    let lo = Infinity, hi = -1;
    for (let i = 0; i < grid.w; i++) if (grid.px[(grid.h - 1) * grid.w + i]) { lo = Math.min(lo, i); hi = Math.max(hi, i); }
    const tabLayers = s.mode === 'stacked' ? 1 : nz;
    for (let i = lo; i <= hi; i++) for (let k = 0; k < tabLayers; k++) set(i, 0, k, backing);
  }

  return { nx, ny, nz, xs, ys, zs, cells, materials, tabRows };
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

/** One closed mesh per material. Faces between cells of the same material are dropped. */
export function voxelMeshes(g: VoxelGrid): Part[] {
  const { nx, ny, nz, cells } = g;
  const coords = [g.xs, g.ys, g.zs];
  const builders = g.materials.map(() => new MeshBuilder());
  const at = (c: number[]) =>
    c[0] < 0 || c[1] < 0 || c[2] < 0 || c[0] >= nx || c[1] >= ny || c[2] >= nz ? -1 : cells[c[0] + nx * (c[1] + ny * c[2])];

  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const m = cells[i + nx * (j + ny * k)];
        if (m < 0) continue;
        const b = builders[m];
        const cell = [i, j, k];
        for (const f of FACES) {
          const n = cell.slice();
          n[f.axis] += f.sign;
          if (at(n) === m) continue;
          // Corner of the face with the lowest u/v indices.
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

  return builders
    .map((b, i) => ({ filamentId: g.materials[i], mesh: b.build() }))
    .filter((p) => p.mesh.indices.length > 0);
}

export function buildModel(grid: PixelGrid, mapping: ColorMapping, s: ModelSettings): BuiltModel {
  const vox = buildVoxels(grid, mapping, s);
  const parts = voxelMeshes(vox);
  const width = vox.xs[vox.nx];
  const height = vox.ys[vox.ny];
  const thickness = vox.zs[vox.nz];
  let tabCenterX = width / 2;
  let stand: Part | null = null;
  if (s.stand.enabled && vox.tabRows) {
    let lo = Infinity, hi = -1;
    for (let i = 0; i < vox.nx; i++) if (vox.cells[i] >= 0) { lo = Math.min(lo, i); hi = Math.max(hi, i); }
    if (hi >= 0) {
      tabCenterX = (vox.xs[lo] + vox.xs[hi + 1]) / 2;
      const tabLen = vox.xs[hi + 1] - vox.xs[lo];
      stand = {
        filamentId: s.stand.filamentId,
        mesh: buildStand(s.stand, tabLen + 2 * s.stand.clearance, tabThickness(s) + 2 * s.stand.clearance),
      };
    }
  }
  return {
    parts,
    stand,
    grid: vox,
    width,
    height,
    thickness,
    tabHeight: vox.tabRows ? vox.ys[1] : 0,
    tabCenterX,
  };
}

/** Smallest common miniature base that fits the tab with a few mm to spare. */
export const BASE_SIZES = [20, 25, 32, 40, 50, 60];
export function autoBaseSize(tabLen: number, tabThick: number): number {
  const need = Math.max(tabLen, tabThick) + 6;
  return BASE_SIZES.find((d) => d >= need) ?? Math.ceil(need);
}
