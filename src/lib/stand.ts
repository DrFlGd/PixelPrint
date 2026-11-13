import { MeshBuilder, circle, fillPolygon, wall, type Mesh, type P2 } from './mesh';
import { DEFAULT_MAGNETS, MAGNET_WALL, pocketRadius, pocketZ, type MagnetReport, type MagnetSettings } from './magnets';

export type StandShape = 'round' | 'oval' | 'square' | 'rect';

export interface PostSettings {
  /** One bar along the bottom row, or a peg at each end. */
  style: 'bar' | 'pegs';
  /** Bar width in mm; 0 = span the sprite's bottom row. */
  width: number;
  /** Width of each peg, mm. */
  pegWidth: number;
  /** Post thickness in mm; 0 = full figure thickness. */
  thickness: number;
}

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
  /** How far the post reaches into the base, mm. */
  slotDepth: number;
  /** Gap added on each side of the slot, mm. */
  clearance: number;
  /** Bevel on the top edge, mm. */
  chamfer: number;
  filamentId: string;
  post: PostSettings;
  magnets: MagnetSettings;
}

export const DEFAULT_POST: PostSettings = { style: 'bar', width: 0, pegWidth: 3, thickness: 0 };

/** Pocket depth actually cut, leaving at least 0.6 mm of floor under the slot. */
export function slotDepth(s: StandSettings): number {
  return Math.max(0.4, Math.min(s.slotDepth, s.height - 0.6));
}

/** Slot rectangle in stand coordinates (X along the figure, Y across it). */
export interface Slot {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function halfSizes(s: StandSettings): [number, number] {
  return [s.width / 2, (s.shape === 'round' || s.shape === 'square' ? s.width : s.depth) / 2];
}

function outline(s: StandSettings, inset: number): P2[] {
  const [a, b] = halfSizes(s);
  const w = a - inset;
  const d = b - inset;
  if (s.shape === 'round' || s.shape === 'oval') {
    const n = 96;
    return Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      return [Math.cos(t) * w, Math.sin(t) * d] as P2;
    });
  }
  return [
    [-w, -d],
    [w, -d],
    [w, d],
    [-w, d],
  ];
}

function insideOutline(s: StandSettings, x: number, y: number, r: number): boolean {
  const [a, b] = halfSizes(s);
  const A = a - r, B = b - r;
  if (A <= 0 || B <= 0) return false;
  if (s.shape === 'round' || s.shape === 'oval') return (x / A) ** 2 + (y / B) ** 2 <= 1;
  return Math.abs(x) <= A && Math.abs(y) <= B;
}

function hitsSlot(slots: Slot[], x: number, y: number, r: number): boolean {
  return slots.some((sl) => {
    const dx = Math.max(sl.x0 - x, 0, x - sl.x1);
    const dy = Math.max(sl.y0 - y, 0, y - sl.y1);
    return Math.hypot(dx, dy) < r;
  });
}

/** Where the base magnets go: centered, beside the slot, or spread around the base. */
export function layoutStandMagnets(s: StandSettings, slots: Slot[]): MagnetReport {
  const m = s.magnets ?? DEFAULT_MAGNETS;
  const report: MagnetReport = { requested: m.count, placed: [], pauseZ: null, warnings: [] };
  if (!m.enabled || m.count < 1) return report;
  const r = pocketRadius(m);
  const [, z1] = pocketZ(m);
  const [a, b] = halfSizes(s);
  const D = slotDepth(s);
  const slotHalfY = Math.max(0, ...slots.map((sl) => Math.max(Math.abs(sl.y0), Math.abs(sl.y1))));
  const besideSlot = Math.max(slotHalfY + r + MAGNET_WALL, b * 0.5);

  let spots: P2[];
  switch (Math.min(4, Math.max(1, Math.round(m.count)))) {
    case 1:
      spots = [[0, 0]];
      break;
    case 2:
      spots = [
        [0, besideSlot],
        [0, -besideSlot],
      ];
      break;
    case 3:
      spots = [90, 210, 330].map((deg) => [Math.cos((deg * Math.PI) / 180) * a * 0.55, Math.sin((deg * Math.PI) / 180) * b * 0.55]);
      break;
    default:
      spots = [45, 135, 225, 315].map((deg) => [Math.cos((deg * Math.PI) / 180) * a * 0.55, Math.sin((deg * Math.PI) / 180) * b * 0.55]);
  }

  const roomUnderSlot = s.height - D - MAGNET_WALL;
  let blockedBySlot = 0, outside = 0;
  for (const [x, y] of spots) {
    if (!insideOutline(s, x, y, r + MAGNET_WALL)) {
      outside++;
      continue;
    }
    if (hitsSlot(slots, x, y, r + MAGNET_WALL) && z1 > roomUnderSlot) {
      blockedBySlot++;
      continue;
    }
    if (z1 > s.height - MAGNET_WALL) {
      outside++;
      continue;
    }
    report.placed.push([x, y]);
  }
  if (blockedBySlot)
    report.warnings.push(
      `The slot leaves no room for a magnet under it. Raise the base to ${(z1 + D + MAGNET_WALL).toFixed(1)} mm or use 2 magnets.`,
    );
  if (outside)
    report.warnings.push(
      z1 > s.height - MAGNET_WALL
        ? `The base is too thin for this magnet. Make it at least ${(z1 + MAGNET_WALL).toFixed(1)} mm tall.`
        : `${outside} magnet${outside > 1 ? 's' : ''} didn't fit on the base. Use a bigger base or fewer magnets.`,
    );
  if (m.hidden && report.placed.length) report.pauseZ = z1;
  return report;
}

/**
 * A flat base lying on the print bed with slot pockets in the top
 * and optional magnet pockets in the bottom.
 */
export function buildStand(s: StandSettings, slots: Slot[]): { mesh: Mesh; magnets: MagnetReport } {
  const b = new MeshBuilder();
  const H = s.height;
  const D = slotDepth(s);
  const ch = Math.max(0, Math.min(s.chamfer, H - D - 0.2, s.width / 4));
  const base = outline(s, 0);
  const top = outline(s, ch);
  // Slot loops run clockwise from above so their walls face into the pocket.
  const holes: P2[][] = slots.map((sl) => [
    [sl.x0, sl.y0],
    [sl.x0, sl.y1],
    [sl.x1, sl.y1],
    [sl.x1, sl.y0],
  ]);

  const magnets = layoutStandMagnets(s, slots);
  const m = s.magnets ?? DEFAULT_MAGNETS;
  const r = pocketRadius(m);
  const [z0, z1] = pocketZ(m);
  const pockets = magnets.placed.map(([x, y]) => circle(x, y, r));

  fillPolygon(b, base, m.hidden ? [] : pockets, 0, false);
  wall(b, base, 0, base, H - ch);
  if (ch > 0) wall(b, base, H - ch, top, H);
  fillPolygon(b, top, holes, H, true);
  for (const h of holes) {
    wall(b, h, H - D, h, H);
    fillPolygon(b, [...h].reverse(), [], H - D, true);
  }
  for (const c of pockets) {
    const cw = [...c].reverse();
    wall(b, cw, z0, cw, z1);
    fillPolygon(b, c, [], z1, false);
    if (m.hidden) fillPolygon(b, c, [], z0, true);
  }
  return { mesh: b.build(), magnets };
}
