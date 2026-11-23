import { beforeAll, describe, expect, it } from 'vitest';
import { fly } from '../scripts/lib/calibration';
import {
  CLOUD_MAX,
  CLOUD_WINDOWS,
  CloudKind,
  CloudParticle,
  DECK_CLOUD_SOURCE,
  FLAME_REACH,
  RiseAt,
  TRENCH_CLOUD_SOURCE,
  cloudParticles,
  flameReach,
  inertialToPad,
  padToInertial,
  riseFromTrail,
} from '../src/render/padCloud';
import { TRENCH } from '../src/render/padGround';
import { wakeSamples } from '../src/render/wake';
import { airVelocity } from '../src/sim/atmosphere';
import { LAUNCH_SITE_HEIGHT, PAD_ELEVATION } from '../src/sim/constants';
import { distance, length, scale, sub, vec3 } from '../src/sim/math/vec3';
import { COUNT_START, MET_TANK_PRESS, MET_WATER, WATER_DURATION } from '../src/sim/mission/countdown';
import { MISSION_PARAMS } from '../src/sim/mission/params';
import { SimState, ephemerisOf } from '../src/sim/state';
import { RS25_START_BEFORE_LIFTOFF } from '../src/sim/vehicle';

const P = MISSION_PARAMS;
const of = (list: CloudParticle[], kind: CloudKind): CloudParticle[] => list.filter((p) => p.kind === kind);

/** The nominal flight to T+30 s and the rocket's rise as the drawing reads it. */
let flown: SimState;
let rise: RiseAt;
beforeAll(() => {
  flown = fly(P, 30);
  rise = riseFromTrail(flown.trail, { t: flown.t, r: flown.ship.r }, ephemerisOf(flown));
});

describe('Vapor, water and the launch cloud on the pad', () => {
  it('vents only until the tanks are pressurized, already venting when the count starts', () => {
    const start = cloudParticles(COUNT_START, rise);
    expect(of(start, 'vent').length).toBeGreaterThan(100);
    expect(start.every((p) => p.kind === 'vent')).toBe(true);
    const before = of(cloudParticles(MET_TANK_PRESS - 0.5, rise), 'vent');
    expect(before.length).toBeGreaterThan(100);
    for (const p of before) expect(p.te).toBeLessThan(MET_TANK_PRESS);
    // Gone a life after the pressurization, and nothing at all until the water.
    expect(cloudParticles(MET_TANK_PRESS + CLOUD_WINDOWS.vent.maxLife + 0.01, rise)).toEqual([]);
    expect(cloudParticles(-100, rise)).toEqual([]);
    expect(cloudParticles(MET_WATER - 0.01, rise)).toEqual([]);
  });

  it('water only while it flows, the cloud only once the engines burn', () => {
    const water = cloudParticles(MET_WATER + 0.5, rise);
    expect(of(water, 'water').length).toBeGreaterThan(50);
    expect(water.every((p) => p.kind === 'water')).toBe(true);
    for (const p of of(cloudParticles(5, rise), 'water')) {
      expect(p.te).toBeGreaterThanOrEqual(MET_WATER);
      expect(p.te).toBeLessThan(MET_WATER + WATER_DURATION);
    }
    // Nothing out of the trench before the RS‑25s start, only their white vapor and steam until T‑0.
    expect(of(cloudParticles(-RS25_START_BEFORE_LIFTOFF - 0.01, rise), 'trench')).toEqual([]);
    const rs25 = cloudParticles(-0.01, rise);
    expect(of(rs25, 'trench').length).toBeGreaterThan(50);
    for (const p of of(rs25, 'trench')) expect(p.tan).toBe(0);
    expect(of(rs25, 'deck')).toEqual([]);
    // With the boosters, smoke out of the trench and off the deck.
    const srb = cloudParticles(1, rise);
    expect(of(srb, 'deck').length).toBeGreaterThan(30);
    expect(Math.max(...of(srb, 'trench').map((p) => p.tan))).toBeGreaterThan(0.5);
  });

  it('is deterministic and leaves no particle past its life', () => {
    const a = cloudParticles(5, rise);
    cloudParticles(20, rise);
    cloudParticles(-3, rise);
    expect(cloudParticles(5, rise)).toEqual(a);
    for (const t of [-500, -15, -3, 5, 20, 100]) {
      for (const p of cloudParticles(t, rise)) {
        expect(p.age).toBeGreaterThanOrEqual(0);
        expect(p.age).toBeLessThan(p.life);
        expect(p.te + p.age).toBeCloseTo(t, 9);
      }
    }
    // Every emitter's window has closed, a life ago: even a rocket that never rose leaves nothing.
    const end = Math.max(...Object.values(CLOUD_WINDOWS).map((w) => w.end + w.maxLife));
    expect(cloudParticles(end + 0.01, rise)).toEqual([]);
    expect(cloudParticles(end + 0.01, () => 0)).toEqual([]);
  });

  it('leaves the flame trench by its north end while the flame reaches the deflector', () => {
    const t = 5;
    const trench = of(cloudParticles(t, rise), 'trench');
    expect(trench.length).toBeGreaterThan(200);
    for (const p of trench) {
      const [e0, n0, z0] = p.p0;
      // Born across the trench's last stretch, inside it.
      expect(Math.abs(e0)).toBeLessThanOrEqual(TRENCH_CLOUD_SOURCE.halfWidth);
      expect(Math.abs(e0)).toBeLessThan(TRENCH.halfWidth);
      expect(n0).toBeGreaterThanOrEqual(TRENCH_CLOUD_SOURCE.n0);
      expect(n0).toBeLessThanOrEqual(TRENCH.north);
      expect(z0).toBeGreaterThanOrEqual(TRENCH_CLOUD_SOURCE.z0);
      expect(z0).toBeLessThanOrEqual(TRENCH_CLOUD_SOURCE.z1);
      // And going north, out of it.
      expect(p.p[1]).toBeGreaterThan(n0);
      if (p.age > 5) expect(p.p[1]).toBeGreaterThan(TRENCH.north);
    }
    // When the rocket's base is ~100 m over the pad its flame no longer reaches the deflector, and
    // nothing more comes out (the flown rise: about 6–7 s after liftoff).
    const later = of(cloudParticles(30, rise), 'trench');
    const last = Math.max(...later.map((p) => p.te));
    const hold = (LAUNCH_SITE_HEIGHT - PAD_ELEVATION) * 1000;
    expect(rise(last) + hold).toBeLessThan(FLAME_REACH.none);
    expect(flameReach(last + 0.5, rise)).toBe(0);
    expect(last).toBeGreaterThan(4);
    expect(last).toBeLessThan(9);
  });

  it('moves with the air and rises around the base of the wake column', () => {
    const eph = ephemerisOf(flown);
    // A point at rest in the pad's frame moves with the air (airVelocity), as the wake's points do.
    const p = vec3(300, 450, 120);
    for (const t of [-300, 0, 20]) {
      const r = padToInertial(p, t, eph);
      const v = scale(sub(padToInertial(p, t + 0.5, eph), padToInertial(p, t - 0.5, eph)), 1);
      expect(length(sub(v, airVelocity(r, eph.earth(t))))).toBeLessThan(1e-7);
      expect(distance(inertialToPad(r, t, eph), p)).toBeLessThan(1e-6);
    }
    // The wake's column is born at the rocket's base on the pad; the deck cloud around it, at its height.
    const s = fly(P, 20);
    const column = wakeSamples(s.trail, { t: s.t, r: s.ship.r }, ephemerisOf(s));
    const base = inertialToPad(column[0].r, s.t, ephemerisOf(s));
    expect(Math.hypot(base.x, base.y)).toBeLessThan(1);
    expect(base.z).toBeGreaterThan(DECK_CLOUD_SOURCE.z0);
    expect(base.z).toBeLessThan(DECK_CLOUD_SOURCE.z1);
    for (const q of of(cloudParticles(1, rise), 'deck')) {
      expect(Math.hypot(q.p0[0], q.p0[1])).toBeLessThanOrEqual(DECK_CLOUD_SOURCE.radius);
      expect(q.p0[2]).toBeGreaterThanOrEqual(DECK_CLOUD_SOURCE.z0);
      expect(q.p0[2]).toBeLessThanOrEqual(DECK_CLOUD_SOURCE.z1);
    }
  });

  it('stays under its particle cap', () => {
    let most = 0;
    let at = 0;
    const sweep = (from: number, to: number, step: number): void => {
      for (let t = from; t <= to; t += step) {
        const n = cloudParticles(t, rise).length;
        if (n > most) [most, at] = [n, t];
      }
    };
    sweep(COUNT_START - 10, MET_TANK_PRESS + 10, 2);
    sweep(MET_WATER - 1, 40, 0.25);
    sweep(40, 200, 5);
    const at5 = (t: number): number => cloudParticles(t, rise).length;
    console.log(`launch cloud: at most ${most} particles (MET ${at.toFixed(2)} s); T-7 min ${at5(-420)}, T-5 min ${at5(-300)}, T-3 s ${at5(-3)}, T+5 s ${at5(5)}, T+20 s ${at5(20)}`);
    expect(most).toBeLessThanOrEqual(CLOUD_MAX);
  });
});
