import { describe, expect, it } from 'vitest';
import { flyFrom } from '../scripts/lib/calibration';
import { ARMS, CONTACT_GAP, DECK, DECK_HOLES, ML_LAYOUT, MASTS, POST_HALF, Rect, SUPPORT_POSTS, TSMUS, deckHeight, rectMinusHoles, surfaceNorthOver } from '../src/render/pad';
import { TRENCH, padRelief } from '../src/render/padGround';
import { CM_HATCH, PAD_ANCHOR_STATION, SRB_Y, STATIONS, padSurfaceNorth } from '../src/render/vehicle';
import { FT_TO_KM, LAUNCH_SITE_HEIGHT, PAD_ELEVATION, R_EARTH, ROCKET_ON_ML, WATER_TOWER } from '../src/sim/constants';
import { length, sub } from '../src/sim/math/vec3';
import { ASCENT_SEQUENCE } from '../src/sim/mission/ascent';
import { MISSION_PARAMS } from '../src/sim/mission/params';
import { createInitialState, ephemerisOf } from '../src/sim/state';

const arm = (id: string) => {
  const a = ARMS.find((x) => x.id === id);
  if (!a) throw new Error(id);
  return a;
};
const inside = (r: Rect, e: number, n: number, margin = 0): boolean => e > r.e0 + margin && e < r.e1 - margin && n > r.n0 + margin && n < r.n1 - margin;
const area = (r: Rect): number => (r.e1 - r.e0) * (r.n1 - r.n0);

describe('Pad model cross-checks (launch plan §4.3)', () => {
  it('puts the crew access arm at the height of the CM hatch, facing it', () => {
    const caa = arm('CAA');
    const room = caa.contact!;
    const hatchCenter = (CM_HATCH.x0 + CM_HATCH.x1) / 2;
    // The white room's floor is at the hatch's sill and its ceiling above the hatch.
    expect(room.x0).toBeLessThanOrEqual(hatchCenter);
    expect(room.x1).toBeGreaterThan(CM_HATCH.x1);
    expect(Math.abs(room.x0 - CM_HATCH.x0)).toBeLessThan(0.5);
    // The hatch faces the tower (θ = 0 is north on the pad) and fits in the room's width.
    expect(CM_HATCH.theta).toBe(0);
    expect(caa.east - room.width / 2).toBeLessThan(-CM_HATCH.w / 2);
    expect(caa.east + room.width / 2).toBeGreaterThan(CM_HATCH.w / 2);
    // [UMB] puts the arm 274 ft above the deck: the hatch is there within 0.5 m (the photo and the fact sheet agree).
    expect(Math.abs(deckHeight(hatchCenter) - 274 * FT_TO_KM * 1000)).toBeLessThan(0.5);
  });

  it('puts the ICPS umbilical on the ICPS', () => {
    const icps = arm('ICPS');
    const plate = icps.contact!;
    // On the stretch of the ICPS that is not covered by the stage adapter below or the Orion adapter above.
    expect(plate.x0).toBeGreaterThanOrEqual(STATIONS.lvsaTop);
    expect(plate.x1).toBeLessThanOrEqual(STATIONS.icpsTop);
    // [UMB]'s 240 ft level (above the deck) falls on it too.
    const station = 240 * FT_TO_KM * 1000 - deckHeight(0);
    expect(station).toBeGreaterThan(plate.x0);
    expect(station).toBeLessThan(plate.x1);
  });

  it('keeps the tower clear of the rocket, and every arm out of it', () => {
    const { tower } = ML_LAYOUT;
    let closest = -Infinity;
    for (let x = STATIONS.srbExit; x <= STATIONS.lasTip; x += 0.25)
      for (let e = tower.e0; e <= tower.e1; e += 0.25) closest = Math.max(closest, padSurfaceNorth(x, e));
    // The rocket reaches ~4.7 m north (the LOX feedline); the tower's face is 14.7 m away.
    expect(closest).toBeGreaterThan(4);
    expect(tower.n0 - closest).toBeGreaterThan(9);
    for (const a of ARMS) {
      const e0 = a.east - a.width / 2;
      const e1 = a.east + a.width / 2;
      expect(surfaceNorthOver(a.x0, a.x1, e0, e1), a.id).toBeLessThan(a.reach);
      expect(a.reach, a.id).toBeLessThan(tower.n0);
      if (!a.contact) continue;
      const c = a.contact;
      const surface = surfaceNorthOver(c.x0, c.x1, a.east - c.width / 2, a.east + c.width / 2);
      // The contact touches the rocket (within CONTACT_GAP) without going into it.
      expect(c.reach - surface, a.id).toBeCloseTo(CONTACT_GAP, 9);
      expect(c.reach, a.id).toBeLessThan(a.reach);
    }
    // The arm that does not reach the rocket in the photos stays well away from it.
    expect(arm('CSFSU').reach - surfaceNorthOver(arm('CSFSU').x0, arm('CSFSU').x1, -1, 1)).toBeGreaterThan(4);
  });

  it('has the base of the rocket above the top of the tower at MET 7 s (tower cleared)', () => {
    const s = flyFrom(createInitialState(MISSION_PARAMS, { headless: true, autoCrew: true }), ASCENT_SEQUENCE.pitchStart);
    expect(s.t).toBeCloseTo(ASCENT_SEQUENCE.pitchStart, 6);
    const anchor = (length(sub(s.ship.r, ephemerisOf(s).earth(s.t).r)) - R_EARTH) * 1000;
    // The lowest point is the boosters' nozzle exits, below the simulated point (the aft skirts).
    const base = anchor - (PAD_ANCHOR_STATION - STATIONS.srbExit);
    expect(base).toBeGreaterThan(ML_LAYOUT.top);
    // At T‑0 it was 107 m below it.
    expect(ML_LAYOUT.top - (LAUNCH_SITE_HEIGHT * 1000 - (PAD_ANCHOR_STATION - STATIONS.srbExit))).toBeGreaterThan(100);
  });
});

describe('Pad model layout', () => {
  it('stands the rocket on its eight posts, with the nozzles in the deck holes', () => {
    expect(SUPPORT_POSTS).toHaveLength(8);
    // The posts' tops are the simulated point.
    expect(DECK + deckHeight(PAD_ANCHOR_STATION) - LAUNCH_SITE_HEIGHT * 1000).toBeCloseTo(0, 9);
    for (const [e, n] of SUPPORT_POSTS) {
      // Under a booster's aft skirt rim (2.55 m in the model) and on the deck, outside every hole.
      const booster = e > 0 ? SRB_Y : -SRB_Y;
      expect(Math.hypot(e - booster, n) + POST_HALF).toBeLessThanOrEqual(2.55 + 1e-9);
      for (const h of DECK_HOLES) {
        const clear = e + POST_HALF <= h.e0 || e - POST_HALF >= h.e1 || n + POST_HALF <= h.n0 || n - POST_HALF >= h.n1;
        expect(clear).toBe(true);
      }
    }
    // Every nozzle exit (boosters 1.9 m, RS‑25 1.15 m in radius) fits in a hole, below the deck's top.
    const nozzles: [number, number, number][] = [
      [SRB_Y, 0, 1.9],
      [-SRB_Y, 0, 1.9],
      ...[1.9, -1.9].flatMap((e) => [1.9, -1.9].map((n): [number, number, number] => [e, n, 1.15])),
    ];
    for (const [e, n, r] of nozzles) expect(DECK_HOLES.some((h) => inside(h, e, n, r)), `${e}, ${n}`).toBe(true);
    expect(deckHeight(STATIONS.srbExit)).toBeLessThan(0);
    expect(deckHeight(STATIONS.rs25Exit)).toBeLessThan(0);
    // The holes stay within the published 34 × 64 ft opening.
    const span = Math.max(...DECK_HOLES.map((h) => h.e1)) - Math.min(...DECK_HOLES.map((h) => h.e0));
    expect(span).toBeLessThanOrEqual(64 * FT_TO_KM * 1000);
  });

  it('builds the base around its holes and on the flat top, with the trench between its mounts', () => {
    const { base, mounts } = ML_LAYOUT;
    const solid = rectMinusHoles(base, DECK_HOLES);
    expect(solid.reduce((s, r) => s + area(r), 0)).toBeCloseTo(area(base) - DECK_HOLES.reduce((s, r) => s + area(r), 0), 6);
    // The side photo shows the base 15.0 m south and 34.8 m north of the rocket.
    expect(Math.abs(base.n0 + 15.0)).toBeLessThan(1);
    expect(Math.abs(base.n1 - 34.8)).toBeLessThan(1);
    for (const e of [base.e0, base.e1]) for (const n of [base.n0, base.n1]) expect(padRelief(e, n)).toBeCloseTo(PAD_ELEVATION * 1000, 9);
    for (const [e] of mounts) expect(Math.abs(e) - 1.2).toBeGreaterThan(TRENCH.halfWidth);
    // The tail service masts stand on the deck, clear of the holes, south of the rocket.
    for (const t of TSMUS) {
      for (const h of DECK_HOLES) expect(t.n1 <= h.n0 || t.n0 >= h.n1 || t.e1 <= h.e0 || t.e0 >= h.e1).toBe(true);
      expect(t.n1).toBeLessThan(0);
    }
  });

  it('opens the trench where its floor meets the slope, and leaves the masts and the water tower off the elevated pad', () => {
    expect(padRelief(0, TRENCH.north)).toBeCloseTo(TRENCH.floor, 2);
    expect(TRENCH.south).toBeLessThan(DECK_HOLES[0].n0);
    for (const [e, n] of MASTS) expect(padRelief(e, n)).toBe(0);
    const water = [(WATER_TOWER.east - ROCKET_ON_ML.east) * 1000, (WATER_TOWER.north - ROCKET_ON_ML.north) * 1000] as const;
    expect(padRelief(water[0], water[1])).toBeLessThan(0.5);
  });
});
