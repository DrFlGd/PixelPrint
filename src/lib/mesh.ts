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
