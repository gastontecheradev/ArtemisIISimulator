import { describe, expect, it } from 'vitest';
import { flyFrom } from '../scripts/lib/calibration';
import {
  ARMS,
  ARM_BOXES,
  CONTACT_GAP,
  DECK,
  DECK_HOLES,
  ML_LAYOUT,
  PadBox,
  PadMotion,
  RELEASE_MOTION_END,
  ROFI_SPARKS_END,
  ROFI_SPARK_COUNT,
  Rigid,
  TSMU_BOXES,
  applyRigid,
  armTransforms,
  padMotion,
  rofiSparks,
  stationAt,
  tsmuTransforms,
} from '../src/render/pad';
import { padSurfaceNorth, padSurfaceSouth } from '../src/render/vehicle';
import { LAUNCH_SITE_HEIGHT, R_EARTH } from '../src/sim/constants';
import { cross, length, normalize, sub } from '../src/sim/math/vec3';
import { ACCESS_ARM_RETRACT_DURATION, MET_ACCESS_ARM_RETRACT, MET_ROFI } from '../src/sim/mission/countdown';
import { MISSION_PARAMS } from '../src/sim/mission/params';
import { createInitialState, ephemerisOf, padState } from '../src/sim/state';

type P3 = readonly [number, number, number];

/** Every scalar of a PadMotion, by name. */
function scalars(m: PadMotion): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, a] of Object.entries(m.arms)) {
    out[`${id}.angle`] = a.angle;
    out[`${id}.pull`] = a.pull;
  }
  out['TSMU.pull'] = m.tsmu.pull;
  out['TSMU.tilt'] = m.tsmu.tilt;
  out['TSMU.bonnet'] = m.tsmu.bonnet;
  return out;
}

/** When each scalar may start and must have stopped (MET, s). */
const window = (name: string): readonly [number, number] =>
  name.startsWith('CAA.') ? [MET_ACCESS_ARM_RETRACT, MET_ACCESS_ARM_RETRACT + ACCESS_ARM_RETRACT_DURATION] : [0, RELEASE_MOTION_END];

/** Points on the faces of a PadBox, every `step` m, grown by `grow` m on every side. */
function boxPoints(box: PadBox, step: number, grow = 0): P3[] {
  const [ae, an] = box.a;
  const [be, bn] = box.b;
  const len = Math.hypot(be - ae, bn - an);
  const ue = (be - ae) / len;
  const un = (bn - an) / len;
  const range = (a: number, b: number): number[] => {
    const n = Math.max(1, Math.ceil((b - a) / step));
    return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  };
  const [s0, s1, k0, k1, z0, z1] = [-grow, len + grow, -box.width / 2 - grow, box.width / 2 + grow, box.z0 - grow, box.z1 + grow];
  const out: P3[] = [];
  const push = (s: number, k: number, z: number): void => void out.push([ae + ue * s - un * k, an + un * s + ue * k, z]);
  for (const s of range(s0, s1)) for (const k of range(k0, k1)) [z0, z1].forEach((z) => push(s, k, z));
  for (const s of range(s0, s1)) for (const z of range(z0, z1)) [k0, k1].forEach((k) => push(s, k, z));
  for (const k of range(k0, k1)) for (const z of range(z0, z1)) [s0, s1].forEach((s) => push(s, k, z));
  return out;
}

/**
 * How far a pad-frame point is outside the rocket (m) once it has risen `rise` m: north of the
 * surface's farthest north in its column (padSurfaceNorth), or south of its farthest south
 * (padSurfaceSouth) on the south side. Positive is clear; a point in a gap between two pieces of the
 * same column counts as inside (conservative). Far from the axis it returns a bound, without the search.
 */
function clearance(p: P3, rise: number): number {
  const [e, n, z] = p;
  // The rocket reaches 4.69 m north (the LOX feedline) and 8.85 m east and west (the boosters' skirts).
  if (Math.abs(n) > 5) return Math.abs(n) - 4.7;
  if (Math.abs(e) > 9) return Math.abs(e) - 8.85;
  const x = stationAt(z, rise);
  return n >= 0 ? n - padSurfaceNorth(x, e) : padSurfaceSouth(x, e) - n;
}

interface Piece {
  readonly name: string;
  readonly points: readonly P3[];
  readonly place: (m: PadMotion) => Rigid;
}

/** Every moving piece of the pad, sampled: the trusses grown by their members' half thickness (0.15 m). */
const PIECES: readonly Piece[] = [
  ...ARMS.flatMap((a): Piece[] => {
    const { truss, contact } = ARM_BOXES[a.id];
    const body: Piece = { name: `${a.id} truss`, points: boxPoints(truss, 0.3, 0.15), place: (m) => armTransforms(a.id, m).body };
    return contact ? [body, { name: `${a.id} contact`, points: boxPoints(contact, 0.2), place: (m) => armTransforms(a.id, m).contact }] : [body];
  }),
  ...TSMU_BOXES.flatMap((b, i): Piece[] => [
    { name: `TSMU ${i} mast`, points: boxPoints(b.mast, 0.3), place: (m) => tsmuTransforms(i, m).mast },
    { name: `TSMU ${i} plate`, points: boxPoints(b.plate, 0.2), place: (m) => tsmuTransforms(i, m).plate },
    { name: `TSMU ${i} bonnet`, points: boxPoints(b.bonnet, 0.2), place: (m) => tsmuTransforms(i, m).bonnet },
  ]),
];

/** The smallest clearance of the pieces at MET t with the rocket risen `rise` m, and which piece it is. */
function worst(t: number, rise: number, pieces: readonly Piece[]): { gap: number; piece: string } {
  const m = padMotion(t);
  let gap = Infinity;
  let piece = '';
  for (const p of pieces) {
    const place = p.place(m);
    for (const q of p.points) {
      const c = clearance(applyRigid(place, q), rise);
      if (c < gap) [gap, piece] = [c, p.name];
    }
  }
  return { gap, piece };
}

describe('Pad animations (launch plan §4.4)', () => {
  it('keeps each piece still before its milestone, moves it one way only and leaves it at its final position', () => {
    const final = scalars(padMotion(1e6));
    for (const [name, v] of Object.entries(final)) if (name !== 'CSFSU.pull') expect(Math.abs(v), name).toBeGreaterThan(0);
    const failures: string[] = [];
    let prev = scalars(padMotion(-600));
    // Every 10 ms from the start of the terminal count to T+10 s.
    for (let i = 0; i <= 61000; i++) {
      const t = -600 + i / 100;
      const now = scalars(padMotion(t));
      for (const [name, v] of Object.entries(now)) {
        const [start, end] = window(name);
        if (t < start && v !== 0) failures.push(`${name} moved at ${t}`);
        if (t >= end && Math.abs(v - final[name]) > 1e-12) failures.push(`${name} not final at ${t}`);
        if (Math.sign(final[name]) * (v - prev[name]) < -1e-12) failures.push(`${name} went back at ${t}`);
      }
      prev = now;
    }
    expect(failures.slice(0, 10)).toEqual([]);
    // The milestones: the crew access arm from T‑8 min ([CNT]) for its 60 s, the rest from T‑0.
    expect(scalars(padMotion(-481))['CAA.pull']).toBe(0);
    expect(scalars(padMotion(-420))['CAA.angle']).toBe(final['CAA.angle']);
    expect(Object.entries(scalars(padMotion(-0.001))).filter(([n, v]) => !n.startsWith('CAA.') && v !== 0)).toEqual([]);
  });

  it('retracts the crew access arm to point due east, its white room east of the tower (as in the photo)', () => {
    const m = padMotion(0);
    const { truss, contact } = ARM_BOXES.CAA;
    const { body, contact: room } = armTransforms('CAA', m);
    const a = applyRigid(body, [truss.a[0], truss.a[1], truss.z0]);
    const b = applyRigid(body, [truss.b[0], truss.b[1], truss.z0]);
    expect(Math.atan2(b[1] - a[1], b[0] - a[0])).toBeCloseTo(0, 9);
    const c = contact!;
    const center = applyRigid(room, [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2, c.z0]);
    expect(center[0]).toBeGreaterThan(ML_LAYOUT.tower.e1 + 8);
    expect(Math.abs(center[1] - ML_LAYOUT.tower.n0)).toBeLessThan(2);
  });

  it('never lets an arm or a tail mast touch the rocket: the access arm on the pad, the rest as it lifts off', () => {
    // T‑8 min: the crew access arm swings with the rocket still on its posts (the rest stays still).
    const caaPieces = PIECES.filter((p) => p.name.startsWith('CAA'));
    let caa = { gap: Infinity, piece: '', t: 0 };
    for (let i = 0; i <= 320; i++) {
      const t = MET_ACCESS_ARM_RETRACT - 2 + i / 5;
      const w = worst(t, 0, caaPieces);
      if (w.gap < caa.gap) caa = { ...w, t };
    }
    // Its white room rests 3 cm from the hatch and backs off before it swings (0.032 m measured).
    expect(caa.gap, `${caa.piece} at ${caa.t}`).toBeGreaterThan(CONTACT_GAP - 1e-6);

    // T‑0: the rise flown by the simulation, every 40 ms until T+8 s (the rocket clears the tower at T+7 s).
    let s = flyFrom(createInitialState(MISSION_PARAMS, { headless: true, autoCrew: true }), -0.48);
    const eph = ephemerisOf(s);
    // From T‑0 on, and once everything is moving (T+1 s on).
    let released = { gap: Infinity, piece: '', t: 0 };
    let moving = { gap: Infinity, piece: '', t: 0 };
    let drift = 0;
    for (let i = 0; i <= 212; i++) {
      const t = -0.48 + i * 0.04;
      s = flyFrom(s, t);
      const fromEarth = sub(s.ship.r, eph.earth(t).r);
      const rise = (length(fromEarth) - R_EARTH - LAUNCH_SITE_HEIGHT) * 1000;
      // The rocket rises along the pad's vertical: it drifts sideways by a few centimeters (most after the pitch-over at T+7 s).
      const pad = normalize(sub(padState(t, eph).r, eph.earth(t).r));
      const sideways = length(cross(pad, normalize(fromEarth))) * length(fromEarth) * 1000;
      drift = Math.max(drift, sideways);
      // The clearance is measured along the pad's vertical; the sideways drift is taken off it.
      const w = worst(t, rise, PIECES);
      const gap = w.gap - sideways;
      if (t >= 0 && gap < released.gap) released = { gap, piece: w.piece, t };
      if (t >= 1 && gap < moving.gap) moving = { gap, piece: w.piece, t };
    }
    expect(s.t).toBeCloseTo(8, 6);
    expect(drift).toBeLessThan(0.05);
    // Never nearer than the contacts' resting gap (3 cm), and by then more than 25 cm (0.31 m measured).
    expect(released.gap, `${released.piece} at ${released.t}`).toBeGreaterThan(CONTACT_GAP - 1e-6);
    expect(moving.gap, `${moving.piece} at ${moving.t}`).toBeGreaterThan(0.25);
  });

  it('throws the igniter sparks from T‑12 s to T‑0, under the deck and inside its hole, the same way every time', () => {
    const buffer = new Float32Array(ROFI_SPARK_COUNT * 6);
    expect(rofiSparks(MET_ROFI - 0.001, buffer)).toBe(0);
    expect(rofiSparks(ROFI_SPARKS_END + 0.001, buffer)).toBe(0);
    const hole = DECK_HOLES[0];
    const base = ML_LAYOUT.base;
    let previous = Infinity;
    for (let i = 0; i <= (ROFI_SPARKS_END - MET_ROFI) * 50; i++) {
      const t = MET_ROFI + i / 50;
      const n = rofiSparks(t, buffer);
      if (t > MET_ROFI + 0.5 && t < 0) expect(n, `t = ${t}`).toBeGreaterThan(10);
      // After T‑0 no spark is thrown: there are fewer and fewer.
      if (t > 0) expect(n).toBeLessThanOrEqual(previous);
      previous = n;
      for (let k = 0; k < 2 * n; k++) {
        const [e, nn, z] = [buffer[3 * k], buffer[3 * k + 1], buffer[3 * k + 2]];
        expect(z).toBeLessThan(DECK);
        if (z > base.z0) expect(e > hole.e0 && e < hole.e1 && nn > hole.n0 && nn < hole.n1, `${e}, ${nn}, ${z}`).toBe(true);
      }
    }
    const a = new Float32Array(buffer.length);
    const b = new Float32Array(buffer.length);
    const na = rofiSparks(-3.217, a);
    rofiSparks(-1, b);
    const nb = rofiSparks(-3.217, b);
    expect(nb).toBe(na);
    expect(Array.from(b.subarray(0, 6 * nb))).toEqual(Array.from(a.subarray(0, 6 * na)));
  });
});
