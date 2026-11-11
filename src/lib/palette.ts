import { colorDistance } from './color';

export interface Filament {
  id: string;
  name: string;
  hex: string;
  /** Filaments you have on hand. Auto-mapping only picks from these. */
  owned: boolean;
}

export const DEFAULT_FILAMENTS: Filament[] = [
  { id: 'black', name: 'Black', hex: '#1b1b1d', owned: true },
  { id: 'white', name: 'White', hex: '#f2f2ee', owned: true },
  { id: 'gray', name: 'Gray', hex: '#8a8d91', owned: true },
  { id: 'silver', name: 'Light Gray', hex: '#c4c6c8', owned: false },
  { id: 'dark-gray', name: 'Charcoal', hex: '#4a4c50', owned: false },
  { id: 'red', name: 'Red', hex: '#c8202a', owned: true },
  { id: 'maroon', name: 'Maroon', hex: '#7a1a24', owned: false },
  { id: 'orange', name: 'Orange', hex: '#f07a1a', owned: false },
  { id: 'yellow', name: 'Yellow', hex: '#f5cf1d', owned: true },
  { id: 'beige', name: 'Beige', hex: '#e6c9a0', owned: false },
  { id: 'skin', name: 'Peach', hex: '#f2b38a', owned: false },
  { id: 'brown', name: 'Brown', hex: '#7b4a26', owned: false },
  { id: 'green', name: 'Green', hex: '#2e9e44', owned: true },
  { id: 'dark-green', name: 'Dark Green', hex: '#1d5b31', owned: false },
  { id: 'lime', name: 'Lime', hex: '#9fd23a', owned: false },
  { id: 'cyan', name: 'Cyan', hex: '#1fb3d4', owned: false },
  { id: 'blue', name: 'Blue', hex: '#1f4fbf', owned: true },
  { id: 'navy', name: 'Navy', hex: '#1a2550', owned: false },
  { id: 'purple', name: 'Purple', hex: '#6b3aa8', owned: false },
  { id: 'pink', name: 'Pink', hex: '#ef7fb0', owned: false },
];

export interface ColorCount {
  hex: string;
  count: number;
}

export type ColorMapping = Record<string, string>; // sprite hex -> filament id

export function nearestFilament(hex: string, filaments: Filament[]): Filament | undefined {
  let best: Filament | undefined;
  let bestD = Infinity;
  for (const f of filaments) {
    const d = colorDistance(hex, f.hex);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

/**
 * Map every sprite color to its nearest owned filament, then merge the
 * smallest groups until at most `maxColors` filaments are in use
 * (e.g. 4 for a single AMS unit).
 */
export function autoMap(colors: ColorCount[], filaments: Filament[], maxColors: number): ColorMapping {
  const pool = filaments.filter((f) => f.owned);
  const candidates = pool.length ? pool : filaments;
  const mapping: ColorMapping = {};
  for (const c of colors) {
    const f = nearestFilament(c.hex, candidates);
    if (f) mapping[c.hex] = f.id;
  }
  const byId = new Map(filaments.map((f) => [f.id, f]));
  const limit = Math.max(1, maxColors);
  for (;;) {
    const totals = new Map<string, number>();
    for (const c of colors) totals.set(mapping[c.hex], (totals.get(mapping[c.hex]) ?? 0) + c.count);
    if (totals.size <= limit) break;
    // Drop the filament that covers the fewest pixels.
    const [dropId] = [...totals.entries()].sort((a, b) => a[1] - b[1])[0];
    const remaining = [...totals.keys()].filter((id) => id !== dropId).map((id) => byId.get(id)!).filter(Boolean);
    for (const c of colors) {
      if (mapping[c.hex] === dropId) mapping[c.hex] = nearestFilament(c.hex, remaining)!.id;
    }
  }
  return mapping;
}

export function usedFilaments(mapping: ColorMapping, colors: ColorCount[]): string[] {
  const set = new Set<string>();
  for (const c of colors) if (mapping[c.hex]) set.add(mapping[c.hex]);
  return [...set];
}
