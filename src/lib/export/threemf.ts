import { zipSync, strToU8 } from 'fflate';
import type { Mesh } from '../mesh';

export interface ThreeMfPart {
  name: string;
  /** Display color, #rrggbb. */
  color: string;
  mesh: Mesh;
}

export interface ThreeMfObject {
  name: string;
  /** One part per filament. Slicers load these as parts of one object, ready for per-part filament assignment. */
  parts: ThreeMfPart[];
  /** Placement on the build plate, mm. */
  offset: [number, number, number];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number) => (Math.round(n * 1e5) / 1e5).toString();

function meshXml(m: Mesh): string {
  const v: string[] = [];
  for (let i = 0; i < m.positions.length; i += 3)
    v.push(`<vertex x="${num(m.positions[i])}" y="${num(m.positions[i + 1])}" z="${num(m.positions[i + 2])}"/>`);
  const t: string[] = [];
  for (let i = 0; i < m.indices.length; i += 3)
    t.push(`<triangle v1="${m.indices[i]}" v2="${m.indices[i + 1]}" v3="${m.indices[i + 2]}"/>`);
  return `<mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh>`;
}

export function build3mfModel(objects: ThreeMfObject[]): string {
  const colors: string[] = [];
  for (const o of objects) for (const p of o.parts) if (!colors.includes(p.color)) colors.push(p.color);
  const materials = colors
    .map((c) => `<base name="${esc(c)}" displaycolor="${c.toUpperCase()}FF"/>`)
    .join('');

  let nextId = 2; // id 1 is the material group
  const resources: string[] = [];
  const items: string[] = [];
  for (const o of objects) {
    const partIds: number[] = [];
    for (const p of o.parts) {
      const id = nextId++;
      partIds.push(id);
      resources.push(
        `<object id="${id}" name="${esc(p.name)}" type="model" pid="1" pindex="${colors.indexOf(p.color)}">${meshXml(p.mesh)}</object>`,
      );
    }
    const id = nextId++;
    resources.push(
      `<object id="${id}" name="${esc(o.name)}" type="model"><components>${partIds
        .map((pid) => `<component objectid="${pid}"/>`)
        .join('')}</components></object>`,
    );
    const [x, y, z] = o.offset;
    items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(x)} ${num(y)} ${num(z)}"/>`);
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Application">Pixel Print</metadata>` +
    `<resources><basematerials id="1">${materials}</basematerials>${resources.join('')}</resources>` +
    `<build>${items.join('')}</build></model>`
  );
}

export function to3mf(objects: ThreeMfObject[]): Uint8Array {
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(build3mfModel(objects)),
  });
}
