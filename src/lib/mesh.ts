import earcut from 'earcut';

/** Indexed triangle mesh in millimetres. */
export interface Mesh {
  positions: number[];
  indices: number[];
}

/** Builds an indexed mesh, welding vertices that land on the same point. */
export class MeshBuilder {
  positions: number[] = [];
  indices: number[] = [];
  private lookup = new Map<string, number>();

  vertex(x: number, y: number, z: number): number {
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let i = this.lookup.get(key);
    if (i === undefined) {
      i = this.positions.length / 3;
      this.positions.push(x, y, z);
      this.lookup.set(key, i);
    }
    return i;
  }

  tri(a: number, b: number, c: number) {
    this.indices.push(a, b, c);
  }

  /** Quad a-b-c-d, counter-clockwise when seen from the outside. */
  quad(a: number, b: number, c: number, d: number) {
    this.indices.push(a, b, c, a, c, d);
  }

  build(): Mesh {
    return { positions: this.positions, indices: this.indices };
  }
}

/** Signed volume in mm³ (positive for a closed, outward-facing mesh). */
export function meshVolume(m: Mesh): number {
  let v = 0;
  const p = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3;
    v +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

export function translateMesh(m: Mesh, dx: number, dy: number, dz: number): Mesh {
  const positions = m.positions.slice();
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += dx;
    positions[i + 1] += dy;
    positions[i + 2] += dz;
  }
  return { positions, indices: m.indices };
}

export function bounds(meshes: Mesh[]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes)
    for (let i = 0; i < m.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], m.positions[i + k]);
        max[k] = Math.max(max[k], m.positions[i + k]);
      }
  return { min, max };
}

export type P2 = [number, number];

/** Fill a flat polygon (with optional holes) at height z, facing up or down. */
export function fillPolygon(b: MeshBuilder, outer: P2[], holes: P2[][], z: number, up: boolean) {
  const pts = [...outer, ...holes.flat()];
  const holeIdx: number[] = [];
  let n = outer.length;
  for (const h of holes) {
    holeIdx.push(n);
    n += h.length;
  }
  const flat = earcut(pts.flat(), holeIdx.length ? holeIdx : undefined);
  const tris: [number, number, number][] = [];
  for (let t = 0; t < flat.length; t += 3) {
    const [a, c, e] = [flat[t], flat[t + 1], flat[t + 2]];
    tris.push(cross(pts, a, c, e) > 0 === up ? [a, c, e] : [a, e, c]);
  }
  splitTJunctions(pts, tris);
  const ids = pts.map(([x, y]) => b.vertex(x, y, z));
  for (const [a, c, e] of tris) b.tri(ids[a], ids[c], ids[e]);
}

function cross(pts: P2[], a: number, b: number, c: number) {
  return (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1]);
}

/**
 * Earcut can leave a vertex lying in the middle of another triangle's edge when hole edges
 * are collinear (e.g. two slots in a row). Split those triangles so every edge is shared exactly.
 */
function splitTJunctions(pts: P2[], tris: [number, number, number][]) {
  const onSegment = (v: number, p: number, q: number) => {
    if (v === p || v === q) return false;
    const [px, py] = pts[p], [qx, qy] = pts[q], [vx, vy] = pts[v];
    const len = Math.hypot(qx - px, qy - py);
    if (len < 1e-9) return false;
    if (Math.abs((qx - px) * (vy - py) - (qy - py) * (vx - px)) / len > 1e-7) return false;
    const t = ((vx - px) * (qx - px) + (vy - py) * (qy - py)) / (len * len);
    return t > 1e-9 && t < 1 - 1e-9;
  };
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    split: for (let e = 0; e < 3; e++) {
      const p = t[e], q = t[(e + 1) % 3], r = t[(e + 2) % 3];
      for (let v = 0; v < pts.length; v++) {
        if (onSegment(v, p, q)) {
          tris[i] = [p, v, r];
          tris.push([v, q, r]);
          i--;
          break split;
        }
      }
    }
  }
  for (let i = tris.length - 1; i >= 0; i--) {
    const [x, y, z] = tris[i];
    if (x === y || y === z || x === z || Math.abs(cross(pts, x, y, z)) < 1e-12) tris.splice(i, 1);
  }
}

/**
 * Vertical wall between two loops of equal length. A counter-clockwise loop (seen from above)
 * faces outward; pass a clockwise loop for the inside wall of a hole.
 */
export function wall(b: MeshBuilder, lo: P2[], zLo: number, hi: P2[], zHi: number) {
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

export const CIRCLE_SEGMENTS = 32;

/**
 * Counter-clockwise polygon around (cx, cy) whose flat sides sit at radius r,
 * so a round part of radius r always fits inside.
 */
export function circle(cx: number, cy: number, r: number, n = CIRCLE_SEGMENTS): P2[] {
  const R = r / Math.cos(Math.PI / n);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * R, cy + Math.sin(a) * R] as P2;
  });
}
