import earcut from 'earcut';
import { MeshBuilder, type Mesh } from './mesh';

export type StandShape = 'round' | 'oval' | 'square' | 'rect';

export interface StandSettings {
  enabled: boolean;
  /** Pick the base diameter from common miniature base sizes. */
  autoSize: boolean;
  shape: StandShape;
  /** Diameter for round, X size for the others, mm. */
  width: number;
  /** Y size for oval and rect, mm. */
  depth: number;
  height: number;
  slotDepth: number;
  /** Gap added on each side of the slot, mm. */
  clearance: number;
  /** Bevel on the top edge, mm. */
  chamfer: number;
  filamentId: string;
}

type P2 = [number, number];

/** Pocket depth actually cut, leaving at least 0.6 mm of floor under the slot. */
export function slotDepth(s: StandSettings): number {
  return Math.max(0.4, Math.min(s.slotDepth, s.height - 0.6));
}

function outline(s: StandSettings, inset: number): P2[] {
  const w = s.width / 2 - inset;
  const d = (s.shape === 'round' || s.shape === 'square' ? s.width : s.depth) / 2 - inset;
  if (s.shape === 'round' || s.shape === 'oval') {
    const n = 96;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [Math.cos(a) * w, Math.sin(a) * d] as P2;
    });
  }
  return [
    [-w, -d],
    [w, -d],
    [w, d],
    [-w, d],
  ];
}

function triangulate(b: MeshBuilder, outer: P2[], hole: P2[] | null, z: number, up: boolean) {
  const pts = hole ? [...outer, ...hole] : outer;
  const flat = pts.flatMap((p) => p);
  const tris = earcut(flat, hole ? [outer.length] : undefined);
  const ids = pts.map(([x, y]) => b.vertex(x, y, z));
  for (let t = 0; t < tris.length; t += 3) {
    const [a, c, e] = [tris[t], tris[t + 1], tris[t + 2]];
    const area = (pts[c][0] - pts[a][0]) * (pts[e][1] - pts[a][1]) - (pts[e][0] - pts[a][0]) * (pts[c][1] - pts[a][1]);
    if ((area > 0) === up) b.tri(ids[a], ids[c], ids[e]);
    else b.tri(ids[a], ids[e], ids[c]);
  }
}

/** Ring of quads between two loops of equal length; loops run counter-clockwise seen from above. */
function band(b: MeshBuilder, lo: P2[], zLo: number, hi: P2[], zHi: number) {
  for (let i = 0; i < lo.length; i++) {
    const n = (i + 1) % lo.length;
    b.quad(
      b.vertex(lo[i][0], lo[i][1], zLo),
      b.vertex(lo[n][0], lo[n][1], zLo),
      b.vertex(hi[n][0], hi[n][1], zHi),
      b.vertex(hi[i][0], hi[i][1], zHi),
    );
  }
}

/**
 * A flat base lying on the print bed with a rectangular pocket in the top.
 * The pocket runs along X (`slotLen`) and is `slotWidth` wide in Y.
 */
export function buildStand(s: StandSettings, slotLen: number, slotWidth: number): Mesh {
  const b = new MeshBuilder();
  const H = s.height;
  const D = slotDepth(s);
  const ch = Math.max(0, Math.min(s.chamfer, H - D - 0.2, s.width / 4));
  const base = outline(s, 0);
  const top = outline(s, ch);
  const hx = slotLen / 2, hy = slotWidth / 2;
  // Hole loop clockwise from above so its walls face into the pocket.
  const hole: P2[] = [
    [-hx, -hy],
    [-hx, hy],
    [hx, hy],
    [hx, -hy],
  ];

  triangulate(b, base, null, 0, false);
  band(b, base, 0, base, H - ch);
  if (ch > 0) band(b, base, H - ch, top, H);
  triangulate(b, top, hole, H, true);
  band(b, hole, H - D, hole, H);
  triangulate(b, [...hole].reverse(), null, H - D, true);
  return b.build();
}
