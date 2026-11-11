import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildModel, DEFAULT_MODEL, type ModelSettings } from '../src/lib/model';
import { meshVolume, type Mesh } from '../src/lib/mesh';
import { to3mf } from '../src/lib/export/threemf';
import { toStl } from '../src/lib/export/stl';
import type { PixelGrid } from '../src/lib/sprite';

// 4x3 sprite with a diagonal step and a hole: R = red, W = white
const rows = ['RRW.', 'R.WW', 'RRR.'];
const grid: PixelGrid = {
  w: 4,
  h: 3,
  px: rows.join('').split('').map((c) => (c === 'R' ? '#ff0000' : c === 'W' ? '#ffffff' : null)),
};
const mapping = { '#ff0000': 'red', '#ffffff': 'white' };

/** Closed and consistently wound: every directed edge is matched by its reverse. */
function isClosed(m: Mesh): boolean {
  const count = new Map<string, number>();
  for (let t = 0; t < m.indices.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = m.indices[t + e], b = m.indices[t + ((e + 1) % 3)];
      count.set(`${a},${b}`, (count.get(`${a},${b}`) ?? 0) + 1);
    }
  for (const [k, n] of count) {
    const [a, b] = k.split(',');
    if ((count.get(`${b},${a}`) ?? 0) !== n) return false;
  }
  return true;
}

const settings = (patch: Partial<ModelSettings>): ModelSettings => ({
  ...DEFAULT_MODEL,
  stand: { ...DEFAULT_MODEL.stand, enabled: false },
  ...patch,
});

describe('buildModel', () => {
  for (const mode of ['flat', 'one-sided', 'two-sided', 'stacked'] as const) {
    it(`${mode}: every part is closed with positive volume`, () => {
      const m = buildModel(grid, mapping, settings({ mode, levels: { red: 0, white: 2 } }));
      expect(m.parts.length).toBeGreaterThan(0);
      for (const p of m.parts) {
        expect(isClosed(p.mesh)).toBe(true);
        expect(meshVolume(p.mesh)).toBeGreaterThan(0);
      }
    });
  }

  it('flat volume equals pixel count x pixel area x thickness', () => {
    const m = buildModel(grid, mapping, settings({ mode: 'flat', pixelSize: 2, thickness: 3 }));
    const total = m.parts.reduce((v, p) => v + meshVolume(p.mesh), 0);
    expect(total).toBeCloseTo(9 * 4 * 3, 5);
  });

  it('one-sided puts the backing filament behind the colored face', () => {
    const m = buildModel(grid, mapping, settings({ mode: 'one-sided', thickness: 4, capThickness: 0.6 }));
    const backing = m.parts.find((p) => p.filamentId === 'black')!;
    expect(meshVolume(backing.mesh)).toBeCloseTo(9 * 3.4, 5);
  });

  it('stacked raises each filament to its level', () => {
    const m = buildModel(grid, mapping, settings({ mode: 'stacked', stackBase: 1, stackStep: 0.5, levels: { red: 0, white: 2 } }));
    expect(m.thickness).toBeCloseTo(2);
    const white = m.parts.find((p) => p.filamentId === 'white')!;
    expect(meshVolume(white.mesh)).toBeCloseTo(3 * 2, 5);
  });

  it('adds a tab and a closed stand with a matching slot', () => {
    const m = buildModel(grid, mapping, { ...DEFAULT_MODEL, mode: 'flat', thickness: 4 });
    expect(m.tabHeight).toBeCloseTo(DEFAULT_MODEL.stand.slotDepth);
    expect(m.stand).not.toBeNull();
    expect(isClosed(m.stand!.mesh)).toBe(true);
    const s = DEFAULT_MODEL.stand;
    const slot = (3 + 2 * s.clearance) * (4 + 2 * s.clearance) * s.slotDepth;
    const disc = Math.PI * (s.width / 2) ** 2 * s.height;
    // Polygonal circle and chamfer make the stand slightly smaller than an ideal cylinder.
    const v = meshVolume(m.stand!.mesh);
    expect(v).toBeLessThan(disc - slot);
    expect(v).toBeGreaterThan((disc - slot) * 0.9);
  });
});

describe('exports', () => {
  const m = buildModel(grid, mapping, { ...DEFAULT_MODEL, mode: 'one-sided' });

  it('writes a 3MF with one part per filament and a stand object', () => {
    const zip = to3mf([
      { name: 'Figure', parts: m.parts.map((p) => ({ name: p.filamentId, color: '#123456', mesh: p.mesh })), offset: [0, 0, 0] },
      { name: 'Stand', parts: [{ name: 'stand', color: '#000000', mesh: m.stand!.mesh }], offset: [40, 0, 0] },
    ]);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const xml = strFromU8(files['3D/3dmodel.model']);
    expect(xml.match(/<components>/g)!.length).toBe(2);
    expect(xml.match(/<item /g)!.length).toBe(2);
    expect(xml).toContain('displaycolor="#123456FF"');
  });

  it('writes a binary STL with the right triangle count', () => {
    const stl = toStl(m.parts.map((p) => p.mesh));
    const tris = m.parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0);
    expect(new DataView(stl.buffer).getUint32(80, true)).toBe(tris);
    expect(stl.length).toBe(84 + tris * 50);
  });
});
