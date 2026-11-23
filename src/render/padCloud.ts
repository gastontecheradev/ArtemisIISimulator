import * as THREE from 'three';
import { Ephemeris } from '../sim/bodies';
import { EARTH_ROTATION_IN_PLANE, LAUNCH_SITE_HEIGHT, PAD_ELEVATION, R_EARTH } from '../sim/constants';
import { Vec3, add, dot, length, scale, sub, vec3 } from '../sim/math/vec3';
import { COUNT_START, MET_TANK_PRESS, MET_WATER, WATER_DURATION, countdownStatus } from '../sim/mission/countdown';
import { TrailPoint } from '../sim/state';
import { G0, RS25_START_BEFORE_LIFTOFF, rs25Throttle, srbThrustEach } from '../sim/vehicle';
import { SPLIT_FRAGMENT, SPLIT_PARS_FRAGMENT, SPLIT_PARS_VERTEX, SPLIT_VERTEX, SplitMode, setSplit, splitUniforms } from './depthSplit';
import { ARM_BOXES, DECK, PadBox, hash3 } from './pad';
import { TRENCH, groundZ, padRelief } from './padGround';
import { WAKE_VAPOR } from './wake';

/*
 * Vapor, water and the launch cloud on the pad (launch plan, §4.5): the boil-off vapor at the vents
 * until the tanks are pressurized, the sound suppression water, and the cloud the exhaust raises out
 * of the flame trench and off the Mobile Launcher's deck.
 *
 * Particles, each a pure function of the time since it was emitted. The emitters have fixed slots
 * in time (every `dt` s on an absolute grid), each with its own seed (`hash3`), so what is drawn at
 * MET t does not depend on how the frames cut the time, and a slot that emits at all does so for a
 * reason the real sequence has (rule 4): the vents while they are open (countdownStatus), the water
 * while it flows, the exhaust while the engines burn and their flame reaches the deflector.
 *
 * Frame: the pad's east-north-up meters (pad.ts, padGround.ts), which turn with Earth and so with the
 * air (sim/atmosphere.ts, `airVelocity`): a particle at rest there moves with the air, like the points
 * of the exhaust wake (wake.ts). Without wind (assumption: still air over the ground; wind is out of
 * scope, launch plan §7).
 *
 * Sources: when, from countdownStatus ([CNT], [39B]); where the hydrogen is vented, [UMB]; what the
 * cloud looks like, the launch photos (launch plan §2): about 4.4 s after liftoff (launch-1, from the
 * south-southwest) the tan cloud is centered on the trench's north mouth, 50–75 m tall, and white
 * steam spreads from the base of the Mobile Launcher; about 13 s after liftoff (launch-2) the white
 * cloud reaches ~600 m to one side and ~350 m to the other, 70–210 m tall, with the tan column rising
 * from the pad. The speeds, sizes and lives below are drawing choices set to look like that.
 */

const M = 1000;
/** Pad surface (m above the sea-level sphere): the top of the flame deflector. */
const PAD = PAD_ELEVATION * M;
/** How high the rocket's base (the simulated point) stands above the pad's surface while held down (m). */
const HOLD_ABOVE_PAD = (LAUNCH_SITE_HEIGHT - PAD_ELEVATION) * M;

type P3 = readonly [number, number, number];

export type CloudKind = 'vent' | 'water' | 'trench' | 'deck';
const KINDS: readonly CloudKind[] = ['vent', 'water', 'trench', 'deck'];

// ---------- Where the rocket is ----------

/** Rise (m) of the rocket's base above where it was held down, at MET `te`: 0 until liftoff. */
export type RiseAt = (te: number) => number;

/** The flame reaches the flame deflector while the rocket's base is this low above the pad (m; the launch plan's ~100 m, an assumption). */
export const FLAME_REACH = { full: 70, none: 100 } as const;

/** Only the first seconds matter: the flame leaves the deflector long before this MET (s). */
const RISE_TRACK = 60;

/**
 * The rise as the simulation flew it: linear between the flown trail's points (each with its
 * altitude) and the vehicle now. Like the wake, it reads the trail, so a stretch between two trail
 * points is drawn from the vehicle's current position until the next point is recorded.
 */
export function riseFromTrail(trail: readonly TrailPoint[], tip: { t: number; r: Vec3 }, eph: Ephemeris): RiseAt {
  const ts = [0];
  const hs = [0];
  const push = (t: number, alt: number): void => {
    ts.push(t);
    hs.push(Math.max(0, (alt - LAUNCH_SITE_HEIGHT) * M));
  };
  for (const p of trail) {
    if (p.t <= 0) continue;
    if (p.t >= tip.t) break;
    push(p.t, p.alt);
    if (p.t > RISE_TRACK) break;
  }
  if (tip.t > ts[ts.length - 1] && ts[ts.length - 1] <= RISE_TRACK) push(tip.t, length(sub(tip.r, eph.earth(tip.t).r)) - R_EARTH);
  return (te) => {
    if (te <= 0) return 0;
    const n = ts.length;
    if (te >= ts[n - 1]) return hs[n - 1];
    let i = 1;
    while (ts[i] < te) i++;
    return hs[i - 1] + ((hs[i] - hs[i - 1]) * (te - ts[i - 1])) / (ts[i] - ts[i - 1]);
  };
}

/** The pad's east, north and up at MET t, inertial (the pad is on +y at liftoff and turns with Earth: state.ts, padState). */
function padAxesAt(t: number): { east: Vec3; north: Vec3; up: Vec3 } {
  const a = EARTH_ROTATION_IN_PLANE * t;
  return { east: vec3(-Math.cos(a), -Math.sin(a), 0), north: vec3(0, 0, 1), up: vec3(-Math.sin(a), Math.cos(a), 0) };
}

/** A point of the pad's frame (east-north-up m from the sea-level point under the launch site) in inertial km at MET t. */
export function padToInertial(p: Vec3, t: number, eph: Ephemeris): Vec3 {
  const { east, north, up } = padAxesAt(t);
  return add(eph.earth(t).r, add(scale(up, R_EARTH + p.z / M), add(scale(east, p.x / M), scale(north, p.y / M))));
}

/** The inverse: an inertial point (km) in the pad's frame (m) at MET t. */
export function inertialToPad(r: Vec3, t: number, eph: Ephemeris): Vec3 {
  const { east, north, up } = padAxesAt(t);
  const rel = sub(r, eph.earth(t).r);
  return vec3(dot(rel, east) * M, dot(rel, north) * M, (dot(rel, up) - R_EARTH) * M);
}

// ---------- What comes out, and when ----------

const SRB_FULL = srbThrustEach(0);
/**
 * Steam the sound suppression water gives where the exhaust meets it, relative to the boosters' smoke
 * at full thrust, growing with the exhaust (drawing choice: the water flashes to steam, [39B] gives no
 * amount).
 */
const WATER_STEAM = 0.35;
/**
 * The deck takes some of the boosters' plume once the nozzles leave its holes: smoke relative to the
 * trench's (drawing choice; the deck cloud is mostly white steam in both launch photos).
 */
const DECK_SMOKE = 0.15;

const smooth = (u: number): number => {
  const v = u > 0 ? (u < 1 ? u : 1) : 0;
  return v * v * (3 - 2 * v);
};

/**
 * The exhaust at MET te: the boosters' smoke relative to full thrust, the RS‑25s' vapor with the
 * wake's criterion (WAKE_VAPOR), and the steam of the water it boils while the water flows.
 */
export function exhaustAt(te: number): { srb: number; vapor: number; steam: number } {
  const srb = srbThrustEach(te) / SRB_FULL;
  const vapor = te >= -RS25_START_BEFORE_LIFTOFF ? WAKE_VAPOR * rs25Throttle(te) : 0;
  const steam = countdownStatus(te).water === 'flowing' ? WATER_STEAM * Math.min(1, srb + rs25Throttle(te)) : 0;
  return { srb, vapor, steam };
}

/** How much of the flame reaches the deflector (0–1) at MET te, with the rocket's rise. */
export function flameReach(te: number, riseAt: RiseAt): number {
  const h = riseAt(te) + HOLD_ABOVE_PAD;
  return 1 - smooth((h - FLAME_REACH.full) / (FLAME_REACH.none - FLAME_REACH.full));
}

// ---------- The emitters ----------

/** A particle drifting with the air: an initial push that the air slows down and a buoyant rise (or a sinking, for cold vapor). */
interface Puff {
  readonly p0: P3;
  /** Initial velocity (m/s), lost with time constant `tau` (s). */
  readonly v0: P3;
  readonly tau: number;
  /** Terminal vertical speed (m/s, negative sinks), reached with time constant `tauB` (s). */
  readonly buoy: number;
  readonly tauB: number;
  /** Size (m): s0 + grow · age^growPow. */
  readonly s0: number;
  readonly grow: number;
  readonly growPow: number;
  readonly life: number;
  readonly alpha: number;
  readonly tan: number;
  /** Stays above the ground (and the trench floor). */
  readonly floor: boolean;
}

interface Emitter {
  readonly kind: CloudKind;
  /** Slot spacing (s) and particles per slot. */
  readonly dt: number;
  readonly per: number;
  /** Slots with emission time in [start, end) (MET, s). */
  readonly start: number;
  readonly end: number;
  readonly maxLife: number;
}

/**
 * Boil-off vapor at the vents, until the tanks are pressurized at T‑6 min ([CNT], countdownStatus
 * `ventsOpen`). [UMB]: the core stage intertank umbilical's "main function is to vent gaseous hydrogen,
 * which is boil off from the extremely cold liquid hydrogen fuel, from the core stage". ASSUMPTION: the
 * ICPS umbilical, which "supplies fuel, oxidizer" to the ICPS, vents too (the photos show no plume to
 * place it, and [UMB] does not say so), and both stop with the core stage's pressurization. The visible
 * vapor is the air's moisture condensing on the cold gas: drawing choices, it puffs out of each plate
 * towards the tower and sinks (cold, heavier than the air), growing and fading in 5–8 s. It was
 * already venting when the count starts, so the slots begin a life before T‑10 min.
 */
const VENT = { dt: 0.08, life: [5, 8], speed: [0.3, 1.2], sink: [-0.45, -0.1], s0: 0.8, grow: 0.9, alpha: 0.45 } as const;
const VENT_PLATES: readonly PadBox[] = (['CSITU', 'ICPS'] as const).map((id) => ARM_BOXES[id].contact as PadBox);

/**
 * Sound suppression water ([39B]: ~400,000 gallons "on the mobile launcher and in the flame trench" in
 * less than 30 s, countdownStatus `water`). No source places the nozzles. Drawing choices: seven jets on
 * the deck around the exhaust holes, throwing across them (12 m/s, 35° up), and eight along the trench
 * walls under the deflector, throwing inwards and down; each drop falls until it lands.
 */
const WATER = { dt: 0.06, per: 2, lifeMax: 3, alpha: 0.55, s0: 0.5, grow: 1.6 } as const;
interface Nozzle {
  readonly p: P3;
  /** Azimuth (rad from north, east positive), elevation (rad), speed (m/s), and the height where the drops land. */
  readonly az: number;
  readonly el: number;
  readonly speed: number;
  readonly land: number;
}
const DEG = Math.PI / 180;
const NOZZLE_Z = DECK + 1;
const NOZZLES: readonly Nozzle[] = [
  ...[-6, 0, 6].map((e): Nozzle => ({ p: [e, 7.5, NOZZLE_Z], az: Math.PI, el: 35 * DEG, speed: 12, land: DECK })),
  ...[-7, 7].map((e): Nozzle => ({ p: [e, -6, NOZZLE_Z], az: 0, el: 35 * DEG, speed: 12, land: DECK })),
  ...[1, -1].map((s): Nozzle => ({ p: [s * 11, 0, NOZZLE_Z], az: s > 0 ? -Math.PI / 2 : Math.PI / 2, el: 35 * DEG, speed: 12, land: DECK })),
  ...[1, -1].flatMap((s) =>
    [8, 16, 24, 32].map((d): Nozzle => ({
      p: [s * (TRENCH.halfWidth - 0.3), TRENCH.south + d, PAD - 1.5],
      az: s > 0 ? -Math.PI / 2 : Math.PI / 2,
      el: -15 * DEG,
      speed: 7,
      land: TRENCH.floor,
    })),
  ),
];

/**
 * The exhaust out of the flame trench: the deflector turns it north ([39B]) and it leaves by the
 * trench's north end, where the trench floor meets the slope (TRENCH), spreading over the last stretch
 * of the open trench. Drawing choices: a cone 40° to each side of north, 4°–22° up, at 25 m/s with the
 * RS‑25s' vapor and 110 m/s with the boosters' smoke (×0.6–1.2), slowed by the air in 5.5 s, so it
 * reaches ~500 m; rising at 3–14 m/s (the smoke is hot); puffs 7 m across growing as √age (~56 m at
 * 13 s), living 90–150 s.
 */
const TRENCH_CLOUD = {
  dt: 0.04,
  per: 5,
  spill: 20,
  cone: 40 * DEG,
  el: [4 * DEG, 22 * DEG],
  speed: [12, 45],
  spread: [0.6, 1.4],
  tau: 15,
  buoy: [3, 12],
  tauB: 5,
  s0: 7,
  grow: 14,
  life: [90, 150],
  alpha: 0.6,
} as const;

/**
 * The cloud off the Mobile Launcher's deck: from T‑0, the boosters' plume splashing on the deck and
 * boiling its water, rushing out in every direction around the base of the exhaust column (wake.ts),
 * pouring off the deck and rising. Drawing choices: born within 3–12 m of the rocket's axis, 0.5–3.5 m
 * over the deck, out at 25–60 m/s (slowed in 5 s), 8 m/s down to 3 m/s up at first; rising at 2–10 m/s;
 * puffs of 6 m growing as √age; living 80–140 s.
 */
const DECK_CLOUD = {
  dt: 0.04,
  per: 5,
  r: [3, 12],
  z: [0.5, 3.5],
  speed: [25, 60],
  vz: [-8, 3],
  tau: 5,
  buoy: [2, 10],
  tauB: 6,
  s0: 6,
  grow: 12,
  life: [80, 140],
  alpha: 0.75,
} as const;

/**
 * How much each particle's tan (the boosters' aluminum oxide) differs from its slot's, either way, where
 * smoke and steam are half and half (drawing choice: the photos' white and tan zones). Pure steam stays
 * white and pure smoke tan.
 */
const TAN_MOTTLE = 0.35;
const mottle = (tan: number, h: number): number => Math.min(1, Math.max(0, tan + (2 * h - 1) * TAN_MOTTLE * 4 * tan * (1 - tan)));
/** The bigger a puff, the thinner: opacity × (s0 / size)^THIN (drawing choice). */
const THIN = 0.5;
/** Puffs fade in over this age (s). */
const FADE_IN = 0.3;

/** The exhaust stops reaching the deflector within the first seconds; slots are looked at until this MET (s). */
const EXHAUST_END = 30;

const EMITTERS: Readonly<Record<CloudKind, Emitter>> = {
  vent: { kind: 'vent', dt: VENT.dt, per: VENT_PLATES.length, start: COUNT_START - VENT.life[1], end: MET_TANK_PRESS, maxLife: VENT.life[1] },
  water: { kind: 'water', dt: WATER.dt, per: WATER.per * NOZZLES.length, start: MET_WATER, end: MET_WATER + WATER_DURATION, maxLife: WATER.lifeMax },
  trench: { kind: 'trench', dt: TRENCH_CLOUD.dt, per: TRENCH_CLOUD.per, start: -RS25_START_BEFORE_LIFTOFF, end: EXHAUST_END, maxLife: TRENCH_CLOUD.life[1] },
  deck: { kind: 'deck', dt: DECK_CLOUD.dt, per: DECK_CLOUD.per, start: 0, end: EXHAUST_END, maxLife: DECK_CLOUD.life[1] },
};

/** Each emitter's window: particles emitted in [start, end) and gone `maxLife` s after the last. */
export const CLOUD_WINDOWS: Readonly<Record<CloudKind, { readonly start: number; readonly end: number; readonly maxLife: number }>> = EMITTERS;

/** The most particles drawn at once (instances); more are dropped. Measured on the nominal flight by tests/padCloud.test.ts. */
export const CLOUD_MAX = 4096;

const lerp = (r: readonly [number, number], u: number): number => r[0] + (r[1] - r[0]) * u;
const drift = (a: number, tau: number): number => tau * (1 - Math.exp(-a / tau));

/** Height of what a particle rests on at (e, n): the ground with its relief, or the trench floor inside the trench. */
function floorUnder(e: number, n: number): number {
  const g = groundZ(e, n);
  const inTrench = Math.abs(e) < TRENCH.halfWidth && n > TRENCH.south && n < TRENCH.north;
  return inTrench ? g - padRelief(e, n) + TRENCH.floor : g;
}

/**
 * Called for each particle alive: its kind, emission MET, age and life (s), where it is and where it
 * was emitted (pad frame, m), its size (m), opacity, tan (0 white steam, 1 the boosters' smoke) and a
 * random number for drawing.
 */
type Emit = (
  kind: CloudKind,
  te: number,
  age: number,
  life: number,
  e: number,
  n: number,
  z: number,
  e0: number,
  n0: number,
  z0: number,
  size: number,
  alpha: number,
  tan: number,
  rand: number,
) => void;

function emitPuff(emit: Emit, kind: CloudKind, te: number, a: number, p: Puff, rand: number, strength: number): void {
  if (a >= p.life) return;
  const k = drift(a, p.tau);
  const rise = p.buoy * (a - drift(a, p.tauB));
  const e = p.p0[0] + p.v0[0] * k;
  const n = p.p0[1] + p.v0[1] * k;
  const size = p.s0 + p.grow * a ** p.growPow;
  let z = p.p0[2] + p.v0[2] * k + rise;
  if (p.floor) z = Math.max(z, floorUnder(e, n) + 0.3 * size);
  const u = a / p.life;
  const alpha = p.alpha * strength * smooth(a / FADE_IN) * (1 - u) ** 1.5 * (p.s0 / size) ** THIN;
  if (alpha <= 0) return;
  emit(kind, te, a, p.life, e, n, z, p.p0[0], p.p0[1], p.p0[2], size, alpha, p.tan, rand);
}

/** Visits every slot of an emitter that may have a particle alive at MET t. */
function slots(em: Emitter, t: number, visit: (k: number, te: number, age: number) => void): void {
  const k0 = Math.ceil(Math.max(em.start, t - em.maxLife) / em.dt - 1e-9);
  const k1 = Math.floor(Math.min(t, em.end) / em.dt + 1e-9);
  for (let k = k0; k <= k1; k++) {
    const te = k * em.dt;
    if (te < em.start || te >= em.end || te > t) continue;
    visit(k, te, t - te);
  }
}

const KIND_ID: Readonly<Record<CloudKind, number>> = { vent: 1, water: 2, trench: 3, deck: 4 };
/** Random number j of particle `i` of slot k of an emitter. */
const rnd = (kind: CloudKind, k: number, i: number, j: number): number => hash3(KIND_ID[kind] * 4096 + i, k, j);

/** Every particle alive at MET t, given the rocket's rise. Pure: a function of t and riseAt only. */
function eachParticle(t: number, riseAt: RiseAt, emit: Emit): void {
  slots(EMITTERS.vent, t, (k, te, a) => {
    if (!countdownStatus(te).ventsOpen) return;
    VENT_PLATES.forEach((plate, i) => {
      const h = (j: number): number => rnd('vent', k, i, j);
      const life = lerp(VENT.life, h(0));
      const speed = lerp(VENT.speed, h(1));
      const side = (2 * h(2) - 1) * 0.6;
      // From the plate's face against the rocket (its `b` end), anywhere across it.
      const p0: P3 = [plate.b[0] + (2 * h(3) - 1) * plate.width * 0.5, plate.b[1] + 0.2, lerp([plate.z0, plate.z1], h(4))];
      const puff: Puff = {
        p0,
        v0: [side, speed, 0],
        tau: 2,
        buoy: lerp(VENT.sink, h(5)),
        tauB: 3,
        s0: VENT.s0,
        grow: VENT.grow,
        growPow: 1,
        life,
        alpha: VENT.alpha,
        tan: 0,
        floor: false,
      };
      emitPuff(emit, 'vent', te, a, puff, h(6), 1);
    });
  });

  slots(EMITTERS.water, t, (k, te, a) => {
    if (countdownStatus(te).water !== 'flowing') return;
    NOZZLES.forEach((nz, i) => {
      for (let q = 0; q < WATER.per; q++) {
        const h = (j: number): number => rnd('water', k, i * WATER.per + q, j);
        const az = nz.az + (2 * h(0) - 1) * 15 * DEG;
        const el = nz.el + (2 * h(1) - 1) * 8 * DEG;
        const v = nz.speed * (0.85 + 0.3 * h(2));
        const vh = v * Math.cos(el);
        const ve = vh * Math.sin(az);
        const vn = vh * Math.cos(az);
        const vz = v * Math.sin(el);
        // Until it lands (falling back to its landing height).
        const drop = nz.p[2] - nz.land;
        const life = Math.min(WATER.lifeMax, (vz + Math.sqrt(vz * vz + 2 * G0 * drop)) / G0);
        if (a >= life) continue;
        const size = WATER.s0 + WATER.grow * a;
        const alpha = WATER.alpha * smooth(a / 0.08) * (1 - (a / life) ** 3);
        emit('water', te, a, life, nz.p[0] + ve * a, nz.p[1] + vn * a, nz.p[2] + vz * a - 0.5 * G0 * a * a, nz.p[0], nz.p[1], nz.p[2], size, alpha, 0, h(3));
      }
    });
  });

  slots(EMITTERS.trench, t, (k, te, a) => {
    const x = exhaustAt(te);
    const strength = (Math.max(x.srb, x.vapor) + x.steam) * flameReach(te, riseAt);
    if (strength <= 0) return;
    const tan = x.srb / (x.srb + x.vapor + x.steam);
    const C = TRENCH_CLOUD;
    for (let i = 0; i < C.per; i++) {
      const h = (j: number): number => rnd('trench', k, i, j);
      const az = (2 * h(0) - 1) * C.cone;
      const el = lerp(C.el, h(1));
      const speed = lerp(C.speed, Math.min(1, x.srb)) * lerp(C.spread, h(2));
      const p0: P3 = [(2 * h(3) - 1) * (TRENCH.halfWidth - 2), TRENCH.north - C.spill * h(4), TRENCH.floor + 1 + 7 * h(5)];
      const ptan = mottle(tan, h(6));
      const puff: Puff = {
        p0,
        v0: [speed * Math.cos(el) * Math.sin(az), speed * Math.cos(el) * Math.cos(az), speed * Math.sin(el)],
        tau: C.tau,
        buoy: lerp(C.buoy, h(7)) + 2 * ptan,
        tauB: C.tauB,
        s0: C.s0,
        grow: C.grow,
        growPow: 0.5,
        life: lerp(C.life, h(8)),
        alpha: C.alpha,
        tan: ptan,
        floor: true,
      };
      emitPuff(emit, 'trench', te, a, puff, h(9), strength);
    }
  });

  slots(EMITTERS.deck, t, (k, te, a) => {
    const x = exhaustAt(te);
    if (x.srb <= 0) return;
    const smoke = DECK_SMOKE * x.srb;
    const strength = (smoke + x.steam) * flameReach(te, riseAt);
    if (strength <= 0) return;
    const tan = smoke / (smoke + x.steam);
    const C = DECK_CLOUD;
    for (let i = 0; i < C.per; i++) {
      const h = (j: number): number => rnd('deck', k, i, j);
      const phi = 2 * Math.PI * h(0);
      const r = lerp(C.r, h(1));
      const speed = lerp(C.speed, h(2));
      const p0: P3 = [r * Math.sin(phi), r * Math.cos(phi), DECK + lerp(C.z, h(3))];
      const ptan = mottle(tan, h(4));
      const puff: Puff = {
        p0,
        v0: [speed * Math.sin(phi), speed * Math.cos(phi), lerp(C.vz, h(5))],
        tau: C.tau,
        buoy: lerp(C.buoy, h(6)) + 2 * ptan,
        tauB: C.tauB,
        s0: C.s0,
        grow: C.grow,
        growPow: 0.5,
        life: lerp(C.life, h(7)),
        alpha: C.alpha,
        tan: ptan,
        floor: true,
      };
      emitPuff(emit, 'deck', te, a, puff, h(8), strength);
    }
  });
}

/** Where the deck cloud is born (pad frame, m): around the base of the exhaust column, over the deck. */
export const DECK_CLOUD_SOURCE = { radius: DECK_CLOUD.r[1], z0: DECK + DECK_CLOUD.z[0], z1: DECK + DECK_CLOUD.z[1] } as const;
/** Where the trench cloud is born: across the trench's last `spill` m, from its floor up. */
export const TRENCH_CLOUD_SOURCE = { halfWidth: TRENCH.halfWidth - 2, n0: TRENCH.north - TRENCH_CLOUD.spill, n1: TRENCH.north, z0: TRENCH.floor + 1, z1: TRENCH.floor + 8 } as const;

export interface CloudParticle {
  readonly kind: CloudKind;
  /** Emission MET, age and life (s). */
  readonly te: number;
  readonly age: number;
  readonly life: number;
  /** Where it is and where it was emitted (pad frame, m). */
  readonly p: P3;
  readonly p0: P3;
  readonly size: number;
  readonly alpha: number;
  readonly tan: number;
}

/** The particles alive at MET t (for the tests; the drawing writes them straight into its buffers). */
export function cloudParticles(t: number, riseAt: RiseAt): CloudParticle[] {
  const out: CloudParticle[] = [];
  eachParticle(t, riseAt, (kind, te, age, life, e, n, z, e0, n0, z0, size, alpha, tan) =>
    out.push({ kind, te, age, life, p: [e, n, z], p0: [e0, n0, z0], size, alpha, tan }),
  );
  return out;
}

/** Floats per particle in the drawing's buffer: east, north, up, size, opacity, tan, random. */
const STRIDE = 7;

/** Writes the particles alive at MET t into `out` (STRIDE floats each, at most CLOUD_MAX) and returns how many. */
export function writeCloud(t: number, riseAt: RiseAt, out: Float32Array): number {
  let k = 0;
  const cap = Math.min(CLOUD_MAX, Math.floor(out.length / STRIDE));
  eachParticle(t, riseAt, (_kind, _te, _age, _life, e, n, z, _e0, _n0, _z0, size, alpha, tan, rand) => {
    if (k >= cap) return;
    out.set([e, n, z, size, alpha, tan, rand], STRIDE * k);
    k++;
  });
  return k;
}

/** Whether anything may be alive at MET t (cheap test before computing). */
export function cloudActive(t: number): boolean {
  return KINDS.some((kind) => {
    const em = EMITTERS[kind];
    return t >= em.start && t < em.end + em.maxLife;
  });
}

// ---------- Drawing ----------

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${SPLIT_PARS_VERTEX}
uniform float uScale;
attribute vec3 aCenter;
attribute vec4 aData;
varying vec2 vUv;
varying vec2 vView;
varying vec2 vRot;
varying float vAlpha;
varying float vTan;
void main() {
  vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
  // A square facing the camera, turned by the particle's own angle so the puffs do not repeat.
  float ang = aData.w * 6.2831853;
  vec2 c = position.xy;
  vec2 r = vec2(c.x * cos(ang) - c.y * sin(ang), c.x * sin(ang) + c.y * cos(ang));
  mv.xy += r * aData.x * uScale;
  // One of the four puffs of the atlas.
  float cell = floor(fract(aData.w * 7.0) * 4.0);
  vUv = (c + 0.5) * 0.5 + vec2(mod(cell, 2.0), floor(cell / 2.0)) * 0.5;
  vView = r * 2.0;
  vRot = vec2(cos(ang), sin(ang));
  vAlpha = aData.y;
  vTan = aData.z;
  ${SPLIT_VERTEX}
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

/**
 * Each lobe lit by the Sun with its own normal, tilted outwards like a ball facing the camera, and
 * wrapped so the shaded side keeps some light (drawing choices).
 */
const WRAP = 0.4;
const SHADE = 0.55;
const BALL = 0.6;

const FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SPLIT_PARS_FRAGMENT}
uniform sampler2D uPuff;
uniform vec3 uSteam;
uniform vec3 uTan;
uniform vec3 uSun;
varying vec2 vUv;
varying vec2 vView;
varying vec2 vRot;
varying float vAlpha;
varying float vTan;
void main() {
  #include <logdepthbuf_fragment>
  ${SPLIT_FRAGMENT}
  vec4 puff = texture2D(uPuff, vUv);
  float a = puff.a * vAlpha;
  if (a < 0.003) discard;
  // The lobe's normal, turned with the square into view space.
  vec2 lobe = puff.rg * 2.0 - 1.0;
  vec2 turned = vec2(lobe.x * vRot.x - lobe.y * vRot.y, lobe.x * vRot.y + lobe.y * vRot.x);
  vec3 n = normalize(vec3(turned + ${BALL.toFixed(2)} * vView, max(puff.b, 0.05)));
  vec3 l = normalize((viewMatrix * vec4(uSun, 0.0)).xyz);
  float lit = clamp((dot(n, l) + ${WRAP.toFixed(2)}) / ${(1 + WRAP).toFixed(2)}, 0.0, 1.0);
  vec3 color = mix(uSteam, uTan, vTan) * mix(${SHADE.toFixed(2)}, 1.0, lit);
  gl_FragColor = vec4(color, a);
  #include <colorspace_fragment>
}
`;

/** Deterministic pseudo-random sequence (mulberry32), so the puffs look the same every time. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Four puffs in a 2 × 2 atlas, each a heap of round lobes like the photos' "cauliflower" clouds: the
 * alpha is how thick it is there (soft at each lobe's rim), and RGB the lobe's normal (x, y, z), so
 * each lobe is lit and shaded on its own. Generated once, from a fixed seed.
 */
function puffAtlas(): THREE.DataTexture {
  const size = 256;
  const half = size / 2;
  const px = new Uint8Array(size * size * 4);
  const rnd = random(20260401);
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * half;
    const oy = Math.floor(cell / 2) * half;
    const lobes = Array.from({ length: 16 }, () => {
      const r = half * (0.11 + 0.13 * rnd());
      const a = 2 * Math.PI * rnd();
      const d = (half * 0.47 - r) * Math.sqrt(rnd());
      return { x: half / 2 + d * Math.cos(a), y: half / 2 + d * Math.sin(a), r, lift: 0.3 * r * rnd() };
    });
    for (let y = 0; y < half; y++)
      for (let x = 0; x < half; x++) {
        let best = -1;
        let n = [0, 0, 1];
        let rim = 0;
        for (const l of lobes) {
          const dx = x + 0.5 - l.x;
          const dy = y + 0.5 - l.y;
          const q = l.r * l.r - dx * dx - dy * dy;
          if (q <= 0) continue;
          const h = Math.sqrt(q);
          if (h + l.lift > best) {
            best = h + l.lift;
            n = [dx / l.r, dy / l.r, h / l.r];
            rim = h / l.r;
          }
        }
        const k = 4 * ((oy + y) * size + ox + x);
        const alpha = best < 0 ? 0 : Math.min(1, rim / 0.45);
        px[k] = Math.round((n[0] * 0.5 + 0.5) * 255);
        px[k + 1] = Math.round((n[1] * 0.5 + 0.5) * 255);
        px[k + 2] = Math.round(n[2] * 255);
        px[k + 3] = Math.round(alpha * alpha * (3 - 2 * alpha) * 255);
      }
  }
  const tex = new THREE.DataTexture(px, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export interface PadCloudColors {
  /** Steam (white) and the boosters' smoke (tan), both as the photos show them in the Sun. */
  readonly steam: string;
  readonly tan: string;
}

export interface PadCloud {
  readonly mesh: THREE.Mesh;
  /** Places the cloud like the pad (pad.ts): the sea-level point under the launch site (scene units), the pad's axes, the scale. */
  place(origin: THREE.Vector3, axes: { east: Vec3; north: Vec3; up: Vec3 }, metersToScene: number): void;
  /**
   * Computes the particles at MET t and sorts them back to front from `camera` (scene units); `sun`
   * is the direction of the Sun in the scene. Returns how many it draws.
   */
  update(t: number, riseAt: RiseAt, camera: THREE.Vector3, sun: THREE.Vector3): number;
  /** Which fragments this pass draws (depthSplit.ts). */
  setSplit(mode: SplitMode, depth: number): void;
  dispose(): void;
}

/** The pad's vapor, water and launch cloud, drawn as camera-facing puffs (instances). */
export function createPadCloud(colors: PadCloudColors): PadCloud {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  const centers = new Float32Array(CLOUD_MAX * 3);
  const data = new Float32Array(CLOUD_MAX * 4);
  const centerAttr = new THREE.InstancedBufferAttribute(centers, 3).setUsage(THREE.DynamicDrawUsage);
  const dataAttr = new THREE.InstancedBufferAttribute(data, 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aCenter', centerAttr);
  geometry.setAttribute('aData', dataAttr);
  geometry.instanceCount = 0;
  const puff = puffAtlas();
  const split = splitUniforms();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: 1 },
      uPuff: { value: puff },
      uSteam: { value: new THREE.Color(colors.steam) },
      uTan: { value: new THREE.Color(colors.tan) },
      uSun: { value: new THREE.Vector3(0, 0, 1) },
      ...split,
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;

  const raw = new Float32Array(CLOUD_MAX * STRIDE);
  const keys = new Float32Array(CLOUD_MAX);
  const order: number[] = [];
  const basis = new THREE.Matrix4();
  const inverse = new THREE.Matrix4();
  const local = new THREE.Vector3();
  const e = new THREE.Vector3();
  const nn = new THREE.Vector3();
  const u = new THREE.Vector3();
  return {
    mesh,
    place(origin, axes, metersToScene) {
      mesh.position.copy(origin);
      basis.makeBasis(e.set(axes.east.x, axes.east.y, axes.east.z), nn.set(axes.north.x, axes.north.y, axes.north.z), u.set(axes.up.x, axes.up.y, axes.up.z));
      mesh.quaternion.setFromRotationMatrix(basis);
      mesh.scale.setScalar(metersToScene);
      material.uniforms.uScale.value = metersToScene;
    },
    update(t, riseAt, camera, sun) {
      const count = cloudActive(t) ? writeCloud(t, riseAt, raw) : 0;
      mesh.visible = count > 0;
      geometry.instanceCount = count;
      if (count === 0) return 0;
      (material.uniforms.uSun.value as THREE.Vector3).copy(sun);
      // Back to front from the camera, in the pad's frame.
      mesh.updateMatrix();
      inverse.copy(mesh.matrix).invert();
      local.copy(camera).applyMatrix4(inverse);
      order.length = count;
      for (let i = 0; i < count; i++) {
        const dx = raw[STRIDE * i] - local.x;
        const dy = raw[STRIDE * i + 1] - local.y;
        const dz = raw[STRIDE * i + 2] - local.z;
        keys[i] = dx * dx + dy * dy + dz * dz;
        order[i] = i;
      }
      order.sort((a, b) => keys[b] - keys[a]);
      for (let j = 0; j < count; j++) {
        const s = STRIDE * order[j];
        centers[3 * j] = raw[s];
        centers[3 * j + 1] = raw[s + 1];
        centers[3 * j + 2] = raw[s + 2];
        data[4 * j] = raw[s + 3];
        data[4 * j + 1] = raw[s + 4];
        data[4 * j + 2] = raw[s + 5];
        data[4 * j + 3] = raw[s + 6];
      }
      centerAttr.clearUpdateRanges();
      centerAttr.addUpdateRange(0, 3 * count);
      centerAttr.needsUpdate = true;
      dataAttr.clearUpdateRanges();
      dataAttr.addUpdateRange(0, 4 * count);
      dataAttr.needsUpdate = true;
      return count;
    },
    setSplit(mode, depth) {
      setSplit(split, mode, depth);
    },
    dispose() {
      quad.dispose();
      geometry.dispose();
      puff.dispose();
      material.dispose();
    },
  };
}
