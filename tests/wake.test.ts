import { describe, expect, it } from 'vitest';
import { fly } from '../scripts/lib/calibration';
import { WAKE_TOP_KM, smokeAt, wakeSamples } from '../src/render/wake';
import { airVelocity } from '../src/sim/atmosphere';
import { LAUNCH_SITE_HEIGHT, MET_MECO, R_EARTH } from '../src/sim/constants';
import { angleBetween, distance, length, normalize, scale, sub } from '../src/sim/math/vec3';
import { MISSION_PARAMS } from '../src/sim/mission/params';
import { SimState, ephemerisOf } from '../src/sim/state';
import { SRB_BURN_TIME } from '../src/sim/vehicle';

const P = MISSION_PARAMS;
const deg = (rad: number): number => (rad * 180) / Math.PI;
const wakeOf = (s: SimState) => wakeSamples(s.trail, { t: s.t, r: s.ship.r }, ephemerisOf(s));

describe('Exhaust wake in 3D', () => {
  it('stays on the pad, which moves with Earth, during the hold-down', () => {
    // At T−1 s the rocket is still held down: the smoke left since the RS‑25 start (T−6.36 s) is
    // under it, on the pad (within the 0.5 m that merges points), so there is nothing to draw yet.
    // In the inertial frame the pad has moved since the first trail point (T−10 min).
    const s = fly(P, -1);
    expect(distance(s.trail[0].r, s.ship.r)).toBeGreaterThan(1.5);
    expect(wakeOf(s).length).toBe(0);
    const late = fly(P, 20);
    const pad = wakeOf(late)[0];
    // At the height of the rocket's support on the Mobile Launcher deck.
    const height = length(sub(pad.r, ephemerisOf(late).earth(late.t).r)) - R_EARTH;
    expect(Math.abs(height - LAUNCH_SITE_HEIGHT)).toBeLessThan(0.002);
    // That bottom of the column is where the pad is now: the trail point of the hold-down
    // carried by the air, not where it was in the inertial frame (8 km away by then).
    const padThen = late.trail[0];
    expect(distance(pad.r, padThen.r)).toBeGreaterThan(5);
  });

  it('leaves the nozzles straight back along the velocity relative to the air', () => {
    for (const met of [10, 60]) {
      const s = fly(P, met);
      const w = wakeOf(s);
      const eph = ephemerisOf(s);
      const vRel = sub(s.ship.v, airVelocity(s.ship.r, eph.earth(s.t)));
      // The newest point more than a rocket length behind the nozzles.
      let i = w.length - 1;
      while (i > 0 && distance(w[i].r, s.ship.r) < 0.1) i--;
      const dir = normalize(sub(w[i].r, s.ship.r));
      expect(deg(angleBetween(dir, normalize(scale(vRel, -1))))).toBeLessThan(1);
      // Without the air's rotation it would come out sideways: the pad moves at ~0.4 km/s.
      const vIn = sub(s.ship.v, eph.earth(s.t).v);
      expect(deg(angleBetween(normalize(vIn), normalize(vRel)))).toBeGreaterThan(15);
    }
  });

  it('thins out with the boosters and with altitude, and is gone after MECO', () => {
    expect(smokeAt(10)).toBe(1);
    expect(smokeAt(SRB_BURN_TIME + 10)).toBeLessThanOrEqual(0.3);
    expect(smokeAt(MET_MECO + 1)).toBe(0);
    const s = fly(P, 400);
    const w = wakeOf(s);
    expect(w.length).toBeGreaterThan(10);
    const earth = ephemerisOf(s).earth(s.t).r;
    // Above the atmosphere the wake does not reach the vehicle, and what is drawn above the
    // limit (one vertex to fade out) has no opacity.
    expect(length(sub(s.ship.r, earth)) - R_EARTH).toBeGreaterThan(WAKE_TOP_KM);
    for (const p of w) if (length(sub(p.r, earth)) - R_EARTH >= WAKE_TOP_KM) expect(p.alpha).toBe(0);
    expect(wakeOf(fly(P, MET_MECO + 3700))).toEqual([]);
  });
});
