import type { Mesh } from '../mesh';

/** Binary STL with every mesh merged into one solid. */
export function toStl(meshes: Mesh[]): Uint8Array {
  const triCount = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  const header = 'Pixel Print STL';
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, triCount, true);
  let o = 84;
  for (const m of meshes) {
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (const v of [nx, ny, nz, p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]]) {
        view.setFloat32(o, v, true);
        o += 4;
      }
      view.setUint16(o, 0, true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}
