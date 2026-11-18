import { Ephemeris } from './bodies';
import { C_LIGHT, NSN_MAX_ALTITUDE, R_EARTH, R_MOON } from './constants';
import { Vec3, addScaled, distance, dot, sub } from './math/vec3';

export type Network = 'NSN' | 'DSN';

export interface CommsStatus {
  readonly network: Network;
  /** true if the Moon blocks the line of sight to Earth. */
  readonly los: boolean;
  /** Spacecraft–Earth center distance (km). */
  readonly distance: number;
  /** One-way signal delay (s). */
  readonly delay: number;
}

/**
 * Line-of-sight margin: distance from the Moon's center to the spacecraft–Earth
 * segment minus the lunar radius. Negative = blocked (LOS).
 */
export function losClearance(ship: Vec3, earth: Vec3, moon: Vec3): number {
  const seg = sub(earth, ship);
  const len2 = dot(seg, seg);
  const u = len2 > 0 ? Math.max(0, Math.min(1, dot(sub(moon, ship), seg) / len2)) : 0;
  return distance(addScaled(ship, seg, u), moon) - R_MOON;
}

export const networkForAltitude = (altitude: number): Network =>
  altitude < NSN_MAX_ALTITUDE ? 'NSN' : 'DSN';

/**
 * Next loss (LOS) and next acquisition (AOS) of signal along a predicted trajectory, by linear
 * interpolation of the line-of-sight margin between its points. null if there is none.
 */
export function nextLinkChanges(
  points: readonly { readonly t: number; readonly r: Vec3 }[],
  eph: Ephemeris,
): { los: number | null; aos: number | null } {
  let los: number | null = null;
  let aos: number | null = null;
  let prev: { t: number; m: number } | null = null;
  for (const p of points) {
    const m = losClearance(p.r, eph.earth(p.t).r, eph.moon(p.t).r);
    if (prev) {
      const at = prev.t + ((p.t - prev.t) * prev.m) / (prev.m - m);
      if (prev.m >= 0 && m < 0 && los === null) los = at;
      if (prev.m < 0 && m >= 0 && aos === null) aos = at;
    }
    if (los !== null && aos !== null) break;
    prev = { t: p.t, m };
  }
  return { los, aos };
}

export function commsStatus(ship: Vec3, t: number, eph: Ephemeris): CommsStatus {
  const earth = eph.earth(t).r;
  const moon = eph.moon(t).r;
  const d = distance(ship, earth);
  return {
    network: networkForAltitude(d - R_EARTH),
    los: losClearance(ship, earth, moon) < 0,
    distance: d,
    // The delay is measured to the surface (the antenna), not to the center.
    delay: Math.max(0, d - R_EARTH) / C_LIGHT,
  };
}
