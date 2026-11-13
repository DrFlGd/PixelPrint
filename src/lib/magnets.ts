export interface MagnetSettings {
  enabled: boolean;
  /** Magnet size, mm. */
  diameter: number;
  thickness: number;
  /** Extra room added to the pocket diameter, mm. */
  clearance: number;
  count: number;
  /** Seal the pocket inside the print; you pause the print to drop the magnets in. */
  hidden: boolean;
}

export const MAGNET_SIZES: [number, number][] = [
  [5, 2],
  [6, 2],
  [6, 3],
  [8, 2],
  [8, 3],
  [10, 2],
  [10, 3],
  [12, 3],
];

/** Solid layers under a hidden pocket (3 layers at 0.2 mm). */
export const HIDDEN_FLOOR = 0.6;
/** Minimum plastic around a pocket, mm. */
export const MAGNET_WALL = 0.8;
/** Extra depth so the magnet sits flush or slightly below the surface. */
export const DEPTH_ALLOWANCE = 0.2;

export function pocketRadius(m: MagnetSettings) {
  return (m.diameter + m.clearance) / 2;
}

export function pocketZ(m: MagnetSettings): [number, number] {
  const z0 = m.hidden ? HIDDEN_FLOOR : 0;
  return [z0, z0 + m.thickness + DEPTH_ALLOWANCE];
}

export const DEFAULT_MAGNETS: MagnetSettings = {
  enabled: false,
  diameter: 6,
  thickness: 2,
  clearance: 0.2,
  count: 1,
  hidden: false,
};

export interface MagnetReport {
  requested: number;
  placed: [number, number][];
  /** Height to pause the print at, for hidden pockets. */
  pauseZ: number | null;
  warnings: string[];
}
