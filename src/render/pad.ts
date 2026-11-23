import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  CRYO_TANKS,
  LAUNCH_DECK_HEIGHT,
  LIGHTNING_MASTS,
  LIGHTNING_MAST_HEIGHT,
  LIGHTNING_TOWER_HEIGHT,
  ML1,
  ML_MOUNTS,
  ML_TOWER_FACE,
  PAD_ELEVATION,
  ROCKET_ON_ML,
  SUPPORT_POST_HEIGHT,
  TSMU_HEIGHT,
  WATER_TOWER,
} from '../sim/constants';
import { Vec3 } from '../sim/math/vec3';
import { MET_ROFI, countdownStatus } from '../sim/mission/countdown';
import { G0 } from '../sim/vehicle';
import { TRENCH, groundZ, padRelief } from './padGround';
import { PAD_ANCHOR_STATION, SRB_Y, padSurfaceNorth } from './vehicle';

/*
 * The launch pad in the 3D view (launch plan, §4.3): Mobile Launcher 1 and LC‑39B, built like the
 * vehicle model (render/vehicle.ts): pieces in meters, procedural geometry merged by material and
 * canvas textures, with no logos or lettering.
 *
 * Frame: east-north-up meters from the sea-level point under the rocket's axis (the simulated launch
 * point), the frame of the pad's ground (padGround.ts), with its floating origin and turning with
 * Earth. Things stand on the ground with `groundZ` (relief and curvature).
 *
 * Sources: the Mobile Launcher's size [ML1], the umbilicals [UMB], the trench and the masts [39B], the
 * positions [OSM] (all in sim/constants.ts); where the arms meet the rocket, the tower's face and
 * where the rocket stands on the launcher, measured on NASA photos (launch plan §2 and ROCKET_ON_ML).
 * What no source gives is marked "assumption" (a guess about the real thing) or "drawing choice"
 * (how it is drawn). The pad is drawn only in 3D and only near the camera (scene.ts).
 *
 * Moving parts (launch plan §4.4): the tower's arms and the tail service masts are their own groups,
 * each with its hinge, and the hydrogen burn-off igniters throw sparks. All of it is a pure function
 * of the mission time (`padMotion`, `rofiSparks`, through countdownStatus), so the drawing does not
 * depend on how the frames cut the time, and nothing moves that the real sequence does not move.
 */

const M = 1000;
/** Pad surface, deck top (m above the sea-level sphere) and the support posts' height (m). */
const PAD = PAD_ELEVATION * M;
export const DECK = PAD + LAUNCH_DECK_HEIGHT * M;
const POST = SUPPORT_POST_HEIGHT * M;

type P3 = readonly [number, number, number];

/** An [OSM] position (km from the Mobile Launcher mounts' center) in meters east and north of the rocket's axis. */
const local = (p: { readonly east: number; readonly north: number }): readonly [number, number] => [
  (p.east - ROCKET_ON_ML.east) * M,
  (p.north - ROCKET_ON_ML.north) * M,
];

/** Height above the deck (m) of vehicle station `x` while the rocket stands on its support posts. */
export const deckHeight = (x: number): number => x - PAD_ANCHOR_STATION + POST;

/** Rectangle in east-north meters (from the rocket's axis). */
export interface Rect {
  readonly e0: number;
  readonly e1: number;
  readonly n0: number;
  readonly n1: number;
}

// ---------- Mobile Launcher layout ----------

const MOUNTS = ML_MOUNTS.map(local);
/** The base is centered on its mounts (OSM); the side photo puts its ends within a meter of that. */
const BASE_NORTH = (Math.min(...MOUNTS.map((m) => m[1])) + Math.max(...MOUNTS.map((m) => m[1]))) / 2;
const TOWER_SIDE = ML1.towerSide * M;
/**
 * The tower's main frame ends at 99/108 of its height and the machinery room fills the rest: the
 * proportions measured in the side photo (launch plan §2: 99 m and 108 m above the deck there, 3 %
 * more than [ML1]'s 345 ft, so they are scaled to it).
 */
const TOWER_FRAME = 99 / 108;

export const ML_LAYOUT = {
  mounts: MOUNTS,
  base: {
    e0: -ML1.baseWidth * 500,
    e1: ML1.baseWidth * 500,
    n0: BASE_NORTH - ML1.baseLength * 500,
    n1: BASE_NORTH + ML1.baseLength * 500,
    z0: DECK - ML1.baseHeight * M,
    z1: DECK,
  },
  /** North of the rocket, its face ML_TOWER_FACE away; centered east-west (assumption, within ~2 m of the launch photo). */
  tower: {
    e0: -TOWER_SIDE / 2,
    e1: TOWER_SIDE / 2,
    n0: ML_TOWER_FACE * M,
    n1: ML_TOWER_FACE * M + TOWER_SIDE,
    z0: DECK,
    z1: DECK + ML1.towerHeight * M,
  },
  /** Top of the tower's mast: [ML1] ~400 ft above the ground (the pad surface). */
  top: PAD + ML1.totalHeight * M,
} as const;

/**
 * Holes in the deck. [ML1] gives a 34 × 64 ft opening (10.4 × 19.5 m) and the posts under the
 * boosters' aft skirts; the opening's shape is not published. Assumption: three holes inside that
 * rectangle, one for the core stage's engines (the published 10.4 m north-south; the RS‑25 exits
 * reach 3.05 m east and west) and one under each booster (its nozzle exit is 1.9 m in radius), with
 * each booster's four posts on the deck around its hole. Together they span 16.6 of the 19.5 m.
 */
const CORE_HOLE = 3.6;
const BOOSTER_HOLE = 2.0;
export const DECK_HOLES: readonly Rect[] = [
  { e0: -CORE_HOLE, e1: CORE_HOLE, n0: -ML1.openingWidth * 500, n1: ML1.openingWidth * 500 },
  ...[1, -1].map((s) => ({ e0: s * SRB_Y - BOOSTER_HOLE, e1: s * SRB_Y + BOOSTER_HOLE, n0: -BOOSTER_HOLE, n1: BOOSTER_HOLE })),
];
/**
 * The eight vehicle support posts ([UMB]: four per booster, 5 ft, under the aft skirt). Assumption:
 * east, west, north and south of each booster's axis, 2.3 m out, so they stand under the skirt's rim
 * (2.55 m) and outside the holes. Their tops are the simulated point (LAUNCH_SITE_HEIGHT).
 */
const POST_R = 2.3;
export const POST_HALF = 0.25;
export const SUPPORT_POSTS: readonly (readonly [number, number])[] = [1, -1].flatMap((s) => [
  [s * SRB_Y + POST_R, 0] as const,
  [s * SRB_Y - POST_R, 0] as const,
  [s * SRB_Y, POST_R] as const,
  [s * SRB_Y, -POST_R] as const,
]);

/**
 * The tail service mast umbilicals ([UMB]: ~33 ft, to the core stage's engine section). The side
 * photos put them on the south side, ~9.7 m from the axis (the elevated photo shows the two side by
 * side). Assumption: 3 × 4 m each, 2.6 m east and west of the axis.
 */
export const TSMUS: readonly Rect[] = [-1, 1].map((s) => ({ e0: s * 2.6 - 1.5, e1: s * 2.6 + 1.5, n0: -11.7, n1: -7.7 }));
const TSMU_H = TSMU_HEIGHT * M;
/** Their umbilical plates meet the engine section between these heights above the deck (drawing choice). */
const TSMU_PLATE = { z0: 5.5, z1: 7.5, halfWidth: 0.5 } as const;

/** Gap left between a contact (white room, umbilical plate) and the rocket's surface (m, drawing choice). */
export const CONTACT_GAP = 0.03;

export type ArmId = 'CAA' | 'OSMU' | 'ICPS' | 'STAB' | 'CSFSU' | 'CSITU';

/**
 * A tower arm. Its vertical extent goes in vehicle stations (m), where the side photo shows it (launch
 * plan §2, "Dónde tocan el cohete los brazos"), not at [UMB]'s published levels, two of which do not
 * match the photos. It runs south from the tower's face to `reach` (m north of the axis), `width`
 * wide around `east`. `contact` is the piece that meets the rocket (the crew access arm's white
 * room, an umbilical plate), from `reach` to the rocket's surface plus CONTACT_GAP.
 */
export interface Arm {
  readonly id: ArmId;
  readonly x0: number;
  readonly x1: number;
  readonly east: number;
  readonly width: number;
  readonly reach: number;
  readonly contact: { readonly x0: number; readonly x1: number; readonly width: number; readonly reach: number } | null;
}

interface ArmSpec {
  readonly id: ArmId;
  readonly x0: number;
  readonly x1: number;
  readonly east: number;
  readonly width: number;
  /** Depth of the contact piece (m), or, without contact, how far the arm reaches (assumption). */
  readonly depth: number;
  readonly contact: { readonly x0: number; readonly x1: number; readonly width: number } | null;
}

/**
 * The arms, top to bottom. The widths and depths are drawing choices.
 * - CAA (crew access arm): white room from +1.1 to +4.1, on the crew hatch (which faces the tower).
 * - OSMU (Orion service module umbilical): +1.1 to −1.3, hoses at ~0, under the CAA.
 * - ICPS umbilical: structure −13.8 to −3.7; its plate on the exposed ICPS, within the hoses' −12.6 to −6.3.
 * - The arm to the forward skirt (identified as the vehicle stabilizer): −20.4 to −17.4, touching at −20.0.
 * - The short arm at −27.3 that does not reach the rocket in the photos (identified as the CSFSU):
 *   assumption, it ends 9.5 m from the axis.
 * - CSITU (intertank): −37.2 to −34.7, touching at −36.1. Drawing choice: 2.2 m west of the axis, so
 *   it clears the LOX feedline, which runs down the tower side of the core stage in the model.
 */
const ARM_SPECS: readonly ArmSpec[] = [
  { id: 'CAA', x0: 1.6, x1: 4.1, east: 0, width: 2.4, depth: 3.2, contact: { x0: 1.1, x1: 4.1, width: 3.0 } },
  { id: 'OSMU', x0: -1.3, x1: 1.1, east: 0, width: 2.0, depth: 0.8, contact: { x0: -0.4, x1: 0.4, width: 1.2 } },
  { id: 'ICPS', x0: -13.8, x1: -3.7, east: 0, width: 3.0, depth: 1.0, contact: { x0: -10.0, x1: -6.6, width: 1.2 } },
  { id: 'STAB', x0: -20.4, x1: -17.4, east: 0, width: 1.6, depth: 0.4, contact: { x0: -20.4, x1: -19.6, width: 1.0 } },
  { id: 'CSFSU', x0: -27.8, x1: -26.8, east: 0, width: 1.4, depth: 9.5, contact: null },
  { id: 'CSITU', x0: -37.2, x1: -34.7, east: -2.2, width: 1.8, depth: 0.3, contact: { x0: -36.6, x1: -35.6, width: 0.8 } },
];

/** Farthest north the rocket's surface reaches over a rectangle of stations × east offsets. */
export function surfaceNorthOver(x0: number, x1: number, e0: number, e1: number): number {
  let north = -Infinity;
  for (let i = 0; i <= 24; i++)
    for (let j = 0; j <= 12; j++) north = Math.max(north, padSurfaceNorth(x0 + ((x1 - x0) * i) / 24, e0 + ((e1 - e0) * j) / 12));
  return north;
}

/**
 * How far the trusses keep from the rocket (m, drawing choice). An arm that swings about a corner of
 * its root first brings its far corner nearer the rocket, by ~width² / (2 · length): 0.4 m for the
 * ICPS umbilical. The contact bridges the rest.
 */
const TRUSS_CLEARANCE = 1.0;

/** The arms with their contacts set against the model's rocket: each ends CONTACT_GAP short of its surface. */
export const ARMS: readonly Arm[] = ARM_SPECS.map((a) => {
  const half = a.width / 2;
  const clear = surfaceNorthOver(a.x0, a.x1, a.east - half, a.east + half) + TRUSS_CLEARANCE;
  if (!a.contact) return { id: a.id, x0: a.x0, x1: a.x1, east: a.east, width: a.width, reach: Math.max(a.depth, clear), contact: null };
  const c = a.contact;
  const touch = surfaceNorthOver(c.x0, c.x1, a.east - c.width / 2, a.east + c.width / 2) + CONTACT_GAP;
  return { id: a.id, x0: a.x0, x1: a.x1, east: a.east, width: a.width, reach: Math.max(touch + a.depth, clear), contact: { ...c, reach: touch } };
});

// ---------- Moving parts (launch plan §4.4) ----------

/*
 * What moves, quoted from [UMB] (FS‑2021‑08‑727‑KSC):
 * - Crew access arm: "The arm rotates from its retracted position and interfaces with the SLS rocket
 *   at the Orion crew hatch"; "The arm retracts from the Orion spacecraft before launch" (at T‑8 min
 *   [CNT], for ACCESS_ARM_RETRACT_DURATION, an assumption of countdown.ts).
 * - ICPS umbilical, core stage forward skirt (CSFSU) and intertank (CSITU) umbilicals: each "swings
 *   away at launch".
 * - Orion service module umbilical: "The umbilical tilts back at launch."
 * - Vehicle stabilizer: "The stabilizer drops down and away from the SLS at launch."
 * - Tail service masts: "The umbilicals tilt back before launch to ensure all hardware safely and
 *   reliably disconnects and retracts from the rocket during liftoff."
 *
 * Which way and about what (the photos and the model; none of it is published):
 * - The crew access arm swings east about a hinge at the tower's southeast corner. The photo from the
 *   southwest lightning mast shows its white room retracted east of the tower, and NASA's illustration
 *   in [UMB] shows the arm retracted sticking out east of it; a 12 m arm from that corner, pointing due
 *   east, puts the white room where the photo does (within ~1 m). So its truss runs diagonally from
 *   the corner to the white room, which stays square to the hatch.
 * - The three swing arms fold west, flat in front of the tower's face, about a hinge at the west corner
 *   of their root. In the launch photo the ICPS umbilical's hoses hang in front of the face, west of the
 *   rocket; the intertank arm is on the west flank of the core stage, where only a westward swing moves
 *   its plate away from it; the forward skirt arm is assumed to do the same.
 * - The service module umbilical tilts about a horizontal hinge at the bottom of its root (its tip goes
 *   up and back), the stabilizer about one at the top of its root (its tip drops): with the hinge on the
 *   other edge, the face against the rocket would move towards it first.
 * - A flat plate square to the rocket cannot swing sideways without sliding into it (the white room
 *   would cut 1 m into the boost protective cover): each contact first backs off ("disconnects and
 *   retracts", as [UMB] says of the tail masts), then its arm moves.
 * - Tail masts: their plates are mated until liftoff ([UMB]), so the drawing starts the tilt at T‑0,
 *   once the plate is in (ASSUMPTION: [UMB] says "before launch" with no time).
 * Angles and durations are drawing choices (below); tests/padMotion.test.ts checks that no piece
 * touches the rocket, with the rise flown by the simulation.
 */

/** Rigid motion of the pad frame, p ↦ R·p + T, with R a row-major 3 × 3 rotation. */
export interface Rigid {
  readonly r: readonly number[];
  readonly t: P3;
}

export const applyRigid = (m: Rigid, p: P3): P3 => [
  m.r[0] * p[0] + m.r[1] * p[1] + m.r[2] * p[2] + m.t[0],
  m.r[3] * p[0] + m.r[4] * p[1] + m.r[5] * p[2] + m.t[1],
  m.r[6] * p[0] + m.r[7] * p[1] + m.r[8] * p[2] + m.t[2],
];

/** `a` after `b`: p ↦ a(b(p)). */
function compose(a: Rigid, b: Rigid): Rigid {
  const r: number[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(a.r[3 * i] * b.r[j] + a.r[3 * i + 1] * b.r[3 + j] + a.r[3 * i + 2] * b.r[6 + j]);
  return { r, t: applyRigid(a, b.t) };
}

const translation = (d: P3): Rigid => ({ r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: d });

/** Rotation by `angle` (rad, right-handed) about the line through `pivot` pointing up (+z) or east (+x). */
function rotationAbout(pivot: P3, axis: 'up' | 'east', angle: number): Rigid {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const r = axis === 'up' ? [c, -s, 0, s, c, 0, 0, 0, 1] : [1, 0, 0, 0, c, -s, 0, s, c];
  const turned = applyRigid({ r, t: [0, 0, 0] }, pivot);
  return { r, t: [pivot[0] - turned[0], pivot[1] - turned[1], pivot[2] - turned[2]] };
}

/** Box along the horizontal segment from `a` to `b` (east, north m), `width` across it, between heights z0 and z1 (pad frame). */
export interface PadBox {
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
  readonly width: number;
  readonly z0: number;
  readonly z1: number;
}

/** A moving group of the pad model. */
export type PadNode = `arm:${ArmId}` | `contact:${ArmId}` | `tsmu:${number}` | `tsmuPlate:${number}` | `bonnet:${number}`;

const TOWER = ML_LAYOUT.tower;
const armById = (id: ArmId): Arm => ARMS.find((a) => a.id === id) as Arm;
/** Pad-frame height of vehicle station x while the rocket stands on its posts. */
const zOf = (x: number): number => DECK + deckHeight(x);
const DEG = Math.PI / 180;

/** The crew access arm's hinge (the tower's southeast corner) and its truss's direction, from there to the white room. */
const CAA_HINGE = [TOWER.e1, TOWER.n0] as const;
const CAA_DIR = ((): readonly [number, number] => {
  const caa = armById('CAA');
  const de = caa.east - CAA_HINGE[0];
  const dn = caa.reach - CAA_HINGE[1];
  const l = Math.hypot(de, dn);
  return [de / l, dn / l];
})();
/** Its truss starts this far from the hinge, held by a yoke, so its root stays out of the tower as it swings (drawing choice). */
const CAA_ROOT = 1.3;

export interface ArmHinge {
  readonly axis: 'up' | 'east';
  readonly pivot: P3;
}

const westCorner = (id: ArmId): ArmHinge => {
  const a = armById(id);
  return { axis: 'up', pivot: [a.east - a.width / 2, TOWER.n0, 0] };
};

export const ARM_HINGES: Readonly<Record<ArmId, ArmHinge>> = {
  CAA: { axis: 'up', pivot: [CAA_HINGE[0], CAA_HINGE[1], 0] },
  OSMU: { axis: 'east', pivot: [0, TOWER.n0, zOf(armById('OSMU').x0)] },
  ICPS: westCorner('ICPS'),
  STAB: { axis: 'east', pivot: [0, TOWER.n0, zOf(armById('STAB').x1)] },
  CSFSU: westCorner('CSFSU'),
  CSITU: westCorner('CSITU'),
};

/** Each arm's truss and the piece that meets the rocket, extended (the white room stays square to the hatch). */
export const ARM_BOXES: Readonly<Record<ArmId, { readonly truss: PadBox; readonly contact: PadBox | null }>> = Object.fromEntries(
  ARMS.map((a) => {
    const root: readonly [number, number] =
      a.id === 'CAA' ? [CAA_HINGE[0] + CAA_DIR[0] * CAA_ROOT, CAA_HINGE[1] + CAA_DIR[1] * CAA_ROOT] : [a.east, TOWER.n0];
    const truss: PadBox = { a: root, b: [a.east, a.reach], width: a.width, z0: zOf(a.x0), z1: zOf(a.x1) };
    const c = a.contact;
    const contact: PadBox | null = c ? { a: [a.east, a.reach], b: [a.east, c.reach], width: c.width, z0: zOf(c.x0), z1: zOf(c.x1) } : null;
    return [a.id, { truss, contact }];
  }),
) as Record<ArmId, { truss: PadBox; contact: PadBox | null }>;

/** Which way each contact backs off before its arm moves (unit, pad frame): along the crew access arm, towards the tower for the rest. */
const PULL_DIR: Readonly<Record<ArmId, P3>> = {
  CAA: [-CAA_DIR[0], -CAA_DIR[1], 0],
  OSMU: [0, 1, 0],
  ICPS: [0, 1, 0],
  STAB: [0, 1, 0],
  CSFSU: [0, 1, 0],
  CSITU: [0, 1, 0],
};

/**
 * The tail service masts' plates go into the mast and a bonnet closes over where they were: a flap on
 * the mast's face towards the rocket, hinged at its bottom, hanging down while the plate is out and
 * turning up over it at liftoff (drawing choice of [UMB]'s "retracts"; sizes in m, heights above the deck).
 */
const BONNET = { width: 1.8, height: 2.8, thick: 0.12, hinge: 5.0 } as const;

export interface TsmuBoxes {
  readonly mast: PadBox;
  readonly plate: PadBox;
  readonly bonnet: PadBox;
  /** The mast tilts about the south edge of its foot; the bonnet turns about its bottom edge. */
  readonly pivot: P3;
  readonly bonnetPivot: P3;
}

export const TSMU_BOXES: readonly TsmuBoxes[] = TSMUS.map((r) => {
  const eM = (r.e0 + r.e1) / 2;
  const pe0 = eM - TSMU_PLATE.halfWidth;
  const pe1 = eM + TSMU_PLATE.halfWidth;
  // The core stage is a solid of revolution there: its south side mirrors the north one.
  const x0 = TSMU_PLATE.z0 + PAD_ANCHOR_STATION - POST;
  const reach = -(surfaceNorthOver(x0, x0 + TSMU_PLATE.z1 - TSMU_PLATE.z0, pe0, pe1) + CONTACT_GAP);
  return {
    mast: { a: [eM, r.n0], b: [eM, r.n1], width: r.e1 - r.e0, z0: DECK, z1: DECK + TSMU_H },
    plate: { a: [eM, r.n1], b: [eM, reach], width: pe1 - pe0, z0: DECK + TSMU_PLATE.z0, z1: DECK + TSMU_PLATE.z1 },
    bonnet: { a: [eM, r.n1], b: [eM, r.n1 + BONNET.thick], width: BONNET.width, z0: DECK + BONNET.hinge - BONNET.height, z1: DECK + BONNET.hinge },
    pivot: [eM, r.n0, DECK],
    bonnetPivot: [eM, r.n1 + BONNET.thick / 2, DECK + BONNET.hinge],
  };
});

/**
 * Drawing choices for the motions. The crew access arm's white room backs off CAA_SLIDE along the arm
 * in the first sixth of its travel (10 of the 60 s), then the arm swings until it points due east (as
 * in the photo). At T‑0 each plate backs off PLATE_PULL, the swing arms turn 60° west (the ICPS
 * umbilical's hoses end ~14 m west of the rocket's axis in the launch photo, roughly what 60° gives),
 * the service module umbilical tilts up 45°, the stabilizer drops 30°, and the tail masts pull their
 * plates in, close the bonnet and tilt back 12°.
 */
const CAA_SLIDE = 1.6;
const CAA_SLIDE_PART = 1 / 6;
const CAA_SWING = -Math.atan2(CAA_DIR[1], CAA_DIR[0]);
const PLATE_PULL = 0.5;
const SWING_WEST = -60 * DEG;
const OSMU_TILT = -45 * DEG;
const STAB_DROP = 30 * DEG;
const TSMU_TILT = 12 * DEG;
const TSMU_PULL = Math.max(...TSMU_BOXES.map((b) => Math.abs(b.plate.b[1] - b.plate.a[1])));

interface Window {
  readonly start: number;
  readonly duration: number;
}
/** When each motion runs, in seconds after the umbilicals release at T‑0 (drawing choices). */
const AT_RELEASE = {
  pull: { start: 0, duration: 0.3 },
  swing: { start: 0.1, duration: 3 },
  osmu: { start: 0.1, duration: 2 },
  stab: { start: 0.1, duration: 2.5 },
  tsmuPlate: { start: 0, duration: 0.5 },
  bonnet: { start: 0.5, duration: 1 },
  tsmuTilt: { start: 0.5, duration: 2 },
} as const satisfies Record<string, Window>;
/** Seconds after T‑0 when every arm and mast has stopped. */
export const RELEASE_MOTION_END = Math.max(...Object.values(AT_RELEASE).map((w) => w.start + w.duration));

const clamp01 = (u: number): number => (u > 0 ? (u < 1 ? u : 1) : 0);
/** Starts and stops gently (the crew access arm, with nothing else moving). */
const smooth = (u: number): number => {
  const v = clamp01(u);
  return v * v * (3 - 2 * v);
};
/** Starts at full speed (at liftoff the arms have to clear the rising rocket). */
const easeOut = (u: number): number => 1 - (1 - clamp01(u)) ** 3;

export interface PadMotion {
  /** Each arm: its rotation about its hinge (rad, right-handed about ARM_HINGES' axis) and how far its contact has backed off (m). */
  readonly arms: Readonly<Record<ArmId, { readonly angle: number; readonly pull: number }>>;
  /** Both tail service masts: plate pulled in (m), tilt back (rad) and bonnet (rad, π closed). */
  readonly tsmu: { readonly pull: number; readonly tilt: number; readonly bonnet: number };
}

/** Where every moving part is at MET t (s): a function of time only, through countdownStatus. */
export function padMotion(t: number): PadMotion {
  const cd = countdownStatus(t);
  const f = cd.accessArmTravel;
  // Seconds since the umbilicals released at T‑0, or −∞ while they are attached.
  const since = cd.attached ? -Infinity : t;
  const at = (w: Window, ease: (u: number) => number): number => ease((since - w.start) / w.duration);
  const pull = PLATE_PULL * at(AT_RELEASE.pull, smooth);
  const swing = SWING_WEST * at(AT_RELEASE.swing, easeOut);
  return {
    arms: {
      CAA: { angle: CAA_SWING * smooth((f - CAA_SLIDE_PART) / (1 - CAA_SLIDE_PART)), pull: CAA_SLIDE * smooth(f / CAA_SLIDE_PART) },
      OSMU: { angle: OSMU_TILT * at(AT_RELEASE.osmu, easeOut), pull },
      ICPS: { angle: swing, pull },
      STAB: { angle: STAB_DROP * at(AT_RELEASE.stab, easeOut), pull },
      CSFSU: { angle: swing, pull: 0 },
      CSITU: { angle: swing, pull },
    },
    tsmu: {
      pull: TSMU_PULL * at(AT_RELEASE.tsmuPlate, smooth),
      tilt: TSMU_TILT * at(AT_RELEASE.tsmuTilt, smooth),
      bonnet: Math.PI * at(AT_RELEASE.bonnet, smooth),
    },
  };
}

/** Where an arm's truss and its contact are: rigid motions of the pad frame. */
export function armTransforms(id: ArmId, m: PadMotion): { readonly body: Rigid; readonly contact: Rigid } {
  const h = ARM_HINGES[id];
  const body = rotationAbout(h.pivot, h.axis, m.arms[id].angle);
  const d = PULL_DIR[id];
  const p = m.arms[id].pull;
  return { body, contact: compose(body, translation([d[0] * p, d[1] * p, d[2] * p])) };
}

/** Where a tail service mast, its plate and its bonnet are. */
export function tsmuTransforms(i: number, m: PadMotion): { readonly mast: Rigid; readonly plate: Rigid; readonly bonnet: Rigid } {
  const b = TSMU_BOXES[i];
  const mast = rotationAbout(b.pivot, 'east', m.tsmu.tilt);
  return {
    mast,
    plate: compose(mast, translation([0, -m.tsmu.pull, 0])),
    bonnet: compose(mast, rotationAbout(b.bonnetPivot, 'east', m.tsmu.bonnet)),
  };
}

export function nodeTransform(node: PadNode, m: PadMotion): Rigid {
  const [kind, key] = node.split(':');
  if (kind === 'arm' || kind === 'contact') {
    const tr = armTransforms(key as ArmId, m);
    return kind === 'arm' ? tr.body : tr.contact;
  }
  const tr = tsmuTransforms(Number(key), m);
  return kind === 'tsmu' ? tr.mast : kind === 'tsmuPlate' ? tr.plate : tr.bonnet;
}

/** Height of a pad-frame point as a station of the rocket, once it has risen `rise` m. */
export const stationAt = (z: number, rise: number): number => z - DECK - POST + PAD_ANCHOR_STATION - rise;

// ---------- Hydrogen burn-off igniter sparks ----------

/**
 * [CNT] T‑12 s: the hydrogen burn-off igniters (ROFI) light under the RS‑25s; they burn off the
 * hydrogen the engines release as they start. countdownStatus keeps them lit until T‑0 (assumption).
 * Drawing choices: eight igniters on the east and west walls of the core stage's deck hole, 1 m below
 * the deck (just under the nozzle exits), throwing sparks inwards and down; each spark lives 1.2–2 s
 * and burns out when it reaches the pad's surface, so they fall through the hole and show under the
 * Mobile Launcher's base. Deterministic: each spark is a function of the time since it was thrown.
 */
const ROFI = {
  z: DECK - 1,
  norths: [-2.6, -0.9, 0.9, 2.6],
  perIgniter: 16,
  life: [1.2, 2],
  speedAcross: [1, 3],
  speedUp: [-3, 1],
  spread: 30 * DEG,
  tail: 0.06,
} as const;
const IGNITERS: readonly P3[] = [1, -1].flatMap((s) => ROFI.norths.map((n): P3 => [s * (CORE_HOLE - 0.1), n, ROFI.z]));
export const ROFI_SPARK_COUNT = IGNITERS.length * ROFI.perIgniter;
/** After this MET no spark is left. */
export const ROFI_SPARKS_END = ROFI.life[1];

/** Deterministic hash of three integers to [0, 1). */
export function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a + 1, 0x27d4eb2d) ^ Math.imul(b + 1, 0x165667b1) ^ Math.imul(c + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The sparks alive at MET t, as line segments (head, then a point ROFI.tail s back along its path)
 * written into `out` (6 numbers each, pad frame). Returns how many it wrote.
 */
export function rofiSparks(t: number, out: Float32Array): number {
  if (t < MET_ROFI || t > ROFI_SPARKS_END) return 0;
  const lerp = (r: readonly [number, number], u: number): number => r[0] + (r[1] - r[0]) * u;
  let k = 0;
  IGNITERS.forEach(([e0, n0, z0], i) => {
    const inward = e0 > 0 ? -1 : 1;
    for (let j = 0; j < ROFI.perIgniter; j++) {
      const life = lerp(ROFI.life, hash3(i, j, 0));
      const phase = life * hash3(i, j, 1);
      const since = t - MET_ROFI - phase;
      if (since < 0) continue;
      let cycle = Math.floor(since / life);
      // Only while the igniters burn: after T‑0 the last spark is the last one they threw.
      if (!countdownStatus(MET_ROFI + phase + cycle * life).rofi) cycle = Math.ceil((0 - MET_ROFI - phase) / life) - 1;
      if (cycle < 0) continue;
      const age = t - (MET_ROFI + phase + cycle * life);
      if (age < 0 || age >= life) continue;
      const azimuth = (2 * hash3(i, j, 3 * cycle + 2) - 1) * ROFI.spread;
      const across = lerp(ROFI.speedAcross, hash3(i, j, 3 * cycle + 3));
      const up = lerp(ROFI.speedUp, hash3(i, j, 3 * cycle + 4));
      const at = (a: number): P3 => [e0 + inward * across * Math.cos(azimuth) * a, n0 + across * Math.sin(azimuth) * a, z0 + up * a - 0.5 * G0 * a * a];
      const head = at(age);
      if (head[2] < PAD) continue;
      out.set(head, 6 * k);
      out.set(at(Math.max(0, age - ROFI.tail)), 6 * k + 3);
      k++;
    }
  });
  return k;
}

/**
 * Emergency egress ([ML1]: baskets on cables, like chairlifts, down to the pad's perimeter).
 * Assumption: four cables from the crew access level of the tower's west face, 400 m to the west,
 * with their baskets parked at the tower.
 */
const EGRESS = { level: deckHeight(2.6), run: 400, norths: [16.6, 19.1, 21.6, 24.1], sag: 0.02 } as const;

// ---------- LC‑39B layout ----------

/**
 * Lightning masts: [39B] 600 ft, [OSM] a 146.4 m lattice tower with the mast on top. Drawing choices
 * measured roughly in the side photo: a square lattice tapering from 20 m to 3.5 m in twelve panels,
 * and a fiberglass mast tapering from 1.8 m to 0.9 m.
 */
const MAST = { baseHalf: 10, topHalf: 1.75, panels: 12, rodBottom: 0.9, rodTop: 0.45 } as const;
/** Catenary wires: between the masts' tops, sagging 5 % of the span, and one from each top to a ground anchor 220 m out (drawing choices). */
const WIRES = { sag: 0.05, anchor: 220 } as const;
/** Water tower legs (drawing choice from the launch photo): four, 8 m from the axis at the ground and 5 m under the tank. */
const WATER_LEGS = { base: 8, top: 5, levels: 5 } as const;

export const MASTS = LIGHTNING_MASTS.map(local);

// ---------- Geometry helpers ----------

type Mat = 'steel' | 'clad' | 'base' | 'hood' | 'white' | 'fiberglass' | 'concrete' | 'floor' | 'plates';
type Add = (mat: Mat, geo: THREE.BufferGeometry) => void;

/** Box from (e0, n0, z0) to (e1, n1, z1). */
const block = (e0: number, e1: number, n0: number, n1: number, z0: number, z1: number): THREE.BufferGeometry =>
  new THREE.BoxGeometry(e1 - e0, n1 - n0, z1 - z0).translate((e0 + e1) / 2, (n0 + n1) / 2, (z0 + z1) / 2);

const Z_AXIS = new THREE.Vector3(0, 0, 1);
/** Square-section member of side `size` from a to b. */
function strut(a: P3, b: P3, size: number): THREE.BufferGeometry {
  const va = new THREE.Vector3(a[0], a[1], a[2]);
  const vb = new THREE.Vector3(b[0], b[1], b[2]);
  const g = new THREE.BoxGeometry(size, size, va.distanceTo(vb));
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Z_AXIS, vb.clone().sub(va).normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

/** Vertical cylinder (z up) of radii r0 (bottom) and r1 (top) between heights z0 and z1. */
function column(e: number, n: number, z0: number, z1: number, r0: number, r1 = r0, segments = 16, open = false): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r1, r0, z1 - z0, segments, 1, open).rotateX(Math.PI / 2).translate(e, n, (z0 + z1) / 2);
}

/** Grid of quads through rows of points (each row the same length), indexed, with normals. */
function grid(rows: readonly (readonly P3[])[]): THREE.BufferGeometry {
  const cols = rows[0].length;
  const positions = new Float32Array(rows.length * cols * 3);
  rows.forEach((row, i) => row.forEach((p, j) => positions.set(p, (i * cols + j) * 3)));
  const index: number[] = [];
  for (let i = 0; i + 1 < rows.length; i++)
    for (let j = 0; j + 1 < cols; j++) {
      const a = i * cols + j;
      index.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(rows.length * cols * 2), 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * Texture coordinates projected along the dominant axis of each vertex's normal (top faces by east
 * and north, the walls by their horizontal direction and the height), in tiles of `tile` m, so the
 * same texture keeps its scale on every piece of a merged mesh.
 */
function projectUV(geo: THREE.BufferGeometry, tile: number): void {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    const [u, v] = az >= ax && az >= ay ? [pos.getX(i), pos.getY(i)] : ax >= ay ? [pos.getY(i), pos.getZ(i)] : [pos.getX(i), pos.getZ(i)];
    uv[2 * i] = u / tile;
    uv[2 * i + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Rectangle minus the holes inside it, as rectangles (bands between the holes' north and south edges). */
export function rectMinusHoles(outer: Rect, holes: readonly Rect[]): Rect[] {
  const ns = [...new Set([outer.n0, outer.n1, ...holes.flatMap((h) => [h.n0, h.n1])])].filter((n) => n >= outer.n0 && n <= outer.n1).sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let i = 0; i + 1 < ns.length; i++) {
    const [n0, n1] = [ns[i], ns[i + 1]];
    const mid = (n0 + n1) / 2;
    let e = outer.e0;
    for (const h of holes.filter((q) => q.n0 < mid && mid < q.n1).sort((a, b) => a.e0 - b.e0)) {
      if (h.e0 > e) out.push({ e0: e, e1: h.e0, n0, n1 });
      e = Math.max(e, h.e1);
    }
    if (outer.e1 > e) out.push({ e0: e, e1: outer.e1, n0, n1 });
  }
  return out;
}

/** Points of a sagging wire (a parabola in height) from a to b. */
function sagging(a: P3, b: P3, sag: number, segments: number): P3[] {
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = i / segments;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - 4 * sag * span * t * (1 - t)] as const;
  });
}

// ---------- The pieces ----------

function mobileLauncher(add: Add): void {
  const { base, tower } = ML_LAYOUT;
  // Base with the exhaust holes through it, on its six mounts.
  for (const r of rectMinusHoles(base, DECK_HOLES)) add('base', block(r.e0, r.e1, r.n0, r.n1, base.z0, base.z1));
  for (const [e, n] of MOUNTS) add('base', block(e - 1.2, e + 1.2, n - 1.2, n + 1.2, groundZ(e, n) - 0.3, base.z0));
  for (const [e, n] of SUPPORT_POSTS) add('base', block(e - POST_HALF, e + POST_HALF, n - POST_HALF, n + POST_HALF, DECK, DECK + POST));

  // Tower: corner and mid-face columns, a floor every [ML1] 20 ft, diagonals in each bay, a clad core
  // and, on top, the machinery room and the mast. The member sizes are drawing choices.
  const frameTop = DECK + ML1.towerHeight * M * TOWER_FRAME;
  const levels: number[] = [];
  for (let z = DECK; z < frameTop - 1; z += ML1.floorSpacing * M) levels.push(z);
  levels.push(frameTop);
  const eMid = (tower.e0 + tower.e1) / 2;
  const nMid = (tower.n0 + tower.n1) / 2;
  const corners: (readonly [number, number])[] = [
    [tower.e0, tower.n0],
    [tower.e1, tower.n0],
    [tower.e1, tower.n1],
    [tower.e0, tower.n1],
  ];
  const mids: (readonly [number, number])[] = [
    [eMid, tower.n0],
    [tower.e1, nMid],
    [eMid, tower.n1],
    [tower.e0, nMid],
  ];
  for (const [e, n] of corners) add('steel', strut([e, n, DECK], [e, n, frameTop], 0.9));
  for (const [e, n] of mids) add('steel', strut([e, n, DECK], [e, n, frameTop], 0.6));
  levels.forEach((z, k) => {
    for (let f = 0; f < 4; f++) {
      const a = corners[f];
      const b = corners[(f + 1) % 4];
      add('steel', strut([a[0], a[1], z], [b[0], b[1], z], 0.55));
      const next = levels[k + 1];
      if (next === undefined) continue;
      // Two diagonals per face and level, from the corners to the mid column, alternating up and down.
      const m = mids[f];
      const [z0, z1] = k % 2 === 0 ? [z, next] : [next, z];
      add('steel', strut([a[0], a[1], z0], [m[0], m[1], z1], 0.35));
      add('steel', strut([b[0], b[1], z0], [m[0], m[1], z1], 0.35));
    }
  });
  add('clad', block(eMid - 3.4, eMid + 3.4, nMid - 3.4, nMid + 3.4, DECK, frameTop));
  add('clad', block(tower.e0, tower.e1, tower.n0, tower.n1, frameTop, tower.z1));
  add('steel', strut([eMid, nMid, tower.z1], [eMid, nMid, ML_LAYOUT.top], 0.3));
  // Insulated pipes up the west face (the side photo shows them along the tower; drawing choice).
  for (const n of [16.2, 17.2, 23.4]) add('white', strut([tower.e0 - 0.6, n, DECK], [tower.e0 - 0.6, n, frameTop], 0.45));

  // Egress baskets, parked under their cables by the tower.
  for (const n of EGRESS.norths) {
    const e = tower.e0 - 4;
    const z = DECK + EGRESS.level;
    add('steel', strut([e, n, z], [e, n, z - 1.6], 0.08));
    add('hood', block(e - 0.9, e + 0.9, n - 0.9, n + 0.9, z - 3.0, z - 1.6));
  }
}

/** Box geometry of a PadBox (its length along a → b). */
function orientedBlock(box: PadBox): THREE.BufferGeometry {
  const [ae, an] = box.a;
  const [be, bn] = box.b;
  return new THREE.BoxGeometry(box.width, Math.hypot(be - ae, bn - an), box.z1 - box.z0)
    .rotateZ(Math.atan2(bn - an, be - ae) - Math.PI / 2)
    .translate((ae + be) / 2, (an + bn) / 2, (box.z0 + box.z1) / 2);
}

/** A box truss filling a PadBox: four chords, a frame every ~2 m and alternating diagonals on its sides (sizes are drawing choices). */
function trussAlong(add: Add, box: PadBox): void {
  const [ae, an] = box.a;
  const [be, bn] = box.b;
  const len = Math.hypot(be - ae, bn - an);
  const ue = (be - ae) / len;
  const un = (bn - an) / len;
  const at = (s: number, k: number, z: number): P3 => [ae + ue * s - un * k, an + un * s + ue * k, z];
  const h = box.width / 2;
  const { z0, z1 } = box;
  for (const k of [-h, h]) for (const z of [z0, z1]) add('steel', strut(at(0, k, z), at(len, k, z), 0.3));
  const bays = Math.max(1, Math.round(len / 2));
  for (let i = 0; i <= bays; i++) {
    const s = (len * i) / bays;
    add('steel', strut(at(s, -h, z0), at(s, h, z0), 0.2));
    add('steel', strut(at(s, -h, z1), at(s, h, z1), 0.2));
    for (const k of [-h, h]) add('steel', strut(at(s, k, z0), at(s, k, z1), 0.2));
    if (i === bays) continue;
    const next = (len * (i + 1)) / bays;
    for (const k of [-h, h]) add('steel', strut(at(s, k, i % 2 ? z0 : z1), at(next, k, i % 2 ? z1 : z0), 0.15));
  }
}

/** The tower's arms, each in its own group with its contact in another, and their hinges on the tower. */
function towerArms(node: (n: PadNode) => Add, fixed: Add): void {
  for (const arm of ARMS) {
    const { truss, contact } = ARM_BOXES[arm.id];
    const body = node(`arm:${arm.id}`);
    trussAlong(body, truss);
    const hinge = ARM_HINGES[arm.id];
    if (arm.id === 'CAA') {
      // The yoke from the hinge to the root of the truss.
      const [ae, an] = truss.a;
      for (const k of [-truss.width / 2, truss.width / 2])
        for (const z of [truss.z0, truss.z1]) body('steel', strut([hinge.pivot[0], hinge.pivot[1], z], [ae - CAA_DIR[1] * k, an + CAA_DIR[0] * k, z], 0.3));
    }
    // A post for the arms that swing, a pin for those that tilt (drawing choices).
    if (hinge.axis === 'up') fixed('steel', column(hinge.pivot[0], hinge.pivot[1], truss.z0 - 0.6, truss.z1 + 0.6, 0.3, 0.3, 12));
    else fixed('steel', new THREE.CylinderGeometry(0.18, 0.18, truss.width + 0.6, 12).rotateZ(Math.PI / 2).translate(arm.east, hinge.pivot[1], hinge.pivot[2]));
    if (contact) node(`contact:${arm.id}`)(arm.id === 'CAA' ? 'white' : 'hood', orientedBlock(contact));
  }
}

/** Tail service masts, south of the core stage, with a rounded hood, their umbilical plate and their bonnet. */
function tailMasts(node: (n: PadNode) => Add): void {
  TSMUS.forEach((r, i) => {
    const b = TSMU_BOXES[i];
    const mast = node(`tsmu:${i}`);
    const half = (r.n1 - r.n0) / 2;
    const eM = (r.e0 + r.e1) / 2;
    mast('hood', block(r.e0, r.e1, r.n0, r.n1, DECK, DECK + TSMU_H - half));
    mast('hood', new THREE.CylinderGeometry(half, half, r.e1 - r.e0, 16).rotateZ(Math.PI / 2).translate(eM, (r.n0 + r.n1) / 2, DECK + TSMU_H - half));
    node(`tsmuPlate:${i}`)('base', orientedBlock(b.plate));
    node(`bonnet:${i}`)('hood', orientedBlock(b.bonnet));
  });
}

function lightningMasts(add: Add): void {
  const towerH = LIGHTNING_TOWER_HEIGHT * M;
  const mastH = LIGHTNING_MAST_HEIGHT * M;
  for (const [e, n] of MASTS) {
    const z0 = groundZ(e, n);
    const half = (h: number): number => MAST.baseHalf + ((MAST.topHalf - MAST.baseHalf) * h) / towerH;
    const corner = (k: number, c: number): P3 => {
      const h = (towerH * k) / MAST.panels;
      const w = half(h);
      const sx = c === 0 || c === 3 ? -1 : 1;
      const sy = c < 2 ? -1 : 1;
      return [e + sx * w, n + sy * w, z0 + h];
    };
    for (let k = 0; k <= MAST.panels; k++)
      for (let c = 0; c < 4; c++) {
        add('steel', strut(corner(k, c), corner(k, (c + 1) % 4), 0.35));
        if (k === MAST.panels) continue;
        add('steel', strut(corner(k, c), corner(k + 1, c), 0.6));
        add('steel', strut(corner(k, c), corner(k + 1, (c + 1) % 4), 0.25));
        add('steel', strut(corner(k, (c + 1) % 4), corner(k + 1, c), 0.25));
      }
    const w = MAST.topHalf;
    add('steel', block(e - w, e + w, n - w, n + w, z0 + towerH - 0.3, z0 + towerH + 0.3));
    add('fiberglass', column(e, n, z0 + towerH + 0.3, z0 + mastH, MAST.rodBottom, MAST.rodTop, 12, true));
  }
}

function waterTower(add: Add): void {
  const [e, n] = local(WATER_TOWER);
  const z0 = groundZ(e, n);
  const tankR = (WATER_TOWER.tankDiameter * M) / 2;
  const tankTop = z0 + WATER_TOWER.tankTop * M;
  const tankBottom = tankTop - WATER_TOWER.tankHeight * M;
  const legTop = tankBottom - 2;
  const leg = (k: number, h: number): P3 => {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const r = WATER_LEGS.base + ((WATER_LEGS.top - WATER_LEGS.base) * (h - z0)) / (legTop - z0);
    return [e + r * Math.cos(a), n + r * Math.sin(a), h];
  };
  const heights = Array.from({ length: WATER_LEGS.levels + 1 }, (_, i) => z0 + ((legTop - z0) * i) / WATER_LEGS.levels);
  for (let k = 0; k < 4; k++) {
    add('steel', strut(leg(k, z0 - 0.3), leg(k, legTop), 0.8));
    heights.forEach((h, i) => {
      if (i === 0) return;
      add('steel', strut(leg(k, h), leg((k + 1) % 4, h), 0.4));
      add('steel', strut(leg(k, heights[i - 1]), leg((k + 1) % 4, h), 0.3));
      add('steel', strut(leg((k + 1) % 4, heights[i - 1]), leg(k, h), 0.3));
    });
  }
  // [OSM] 2.4 m column up the middle, the tank with its bottom cone and its dome, and the top up to 88 m.
  const columnR = (WATER_TOWER.column * M) / 2;
  add('white', column(e, n, z0 - 0.3, legTop, columnR, columnR, 16));
  add('white', column(e, n, legTop, tankBottom, columnR, tankR, 32));
  add('white', column(e, n, tankBottom, tankTop, tankR, tankR, 32));
  const domeH = 3.7;
  add('white', new THREE.SphereGeometry(tankR, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, domeH / tankR, 1).rotateX(Math.PI / 2).translate(e, n, tankTop));
  add('steel', strut([e, n, tankTop + domeH - 0.2], [e, n, z0 + WATER_TOWER.top * M], 0.3));
}

function cryoTanks(add: Add): void {
  for (const t of CRYO_TANKS) {
    const [e, n] = local(t);
    const z0 = groundZ(e, n);
    const r = (t.diameter * M) / 2;
    // Each sphere on a skirt (drawing choice: it clears the ground by 1 m and the skirt meets it at 55 % of its radius).
    const center = z0 + 1 + r;
    add('white', new THREE.SphereGeometry(r, 32, 16).rotateX(Math.PI / 2).translate(e, n, center));
    add('concrete', column(e, n, z0 - 0.3, center - r * Math.sqrt(1 - 0.55 * 0.55) + 0.2, 0.55 * r, 0.55 * r, 24));
  }
}

/** The flame trench (TRENCH, padGround.ts): its walls, floor, the copings over its edges and the deflector. */
function flameTrench(add: Add): void {
  const hw = TRENCH.halfWidth;
  /** Curvature drop at a point (the ground's z minus the relief). */
  const drop = (e: number, n: number): number => groundZ(e, n) - padRelief(e, n);
  const floorZ = (e: number, n: number): number => TRENCH.floor + drop(e, n);
  const ns: number[] = [];
  for (let n = TRENCH.south; n < TRENCH.north; n += 2) ns.push(n);
  ns.push(TRENCH.north);
  // Walls, from the floor up to the ground.
  for (const s of [-1, 1]) {
    const e = s * hw;
    add('concrete', grid(ns.map((n) => [[e, n, Math.max(groundZ(e, n), floorZ(e, n))], [e, n, floorZ(e, n) - 0.05]])));
    // Coping: 0.3 m over the trench and 0.6 m over the ground, 5 cm above it, hiding the seam.
    const ei = s * (hw - 0.3);
    const eo = s * (hw + 0.6);
    add(
      'concrete',
      grid(
        ns.map((n) => {
          const top = Math.max(groundZ(e, n), groundZ(eo, n), floorZ(e, n)) + 0.05;
          return [[eo, n, groundZ(eo, n) - 0.2], [eo, n, top], [ei, n, top], [ei, n, top - 0.4]];
        }),
      ),
    );
  }
  add('concrete', block(-hw - 0.6, hw + 0.6, TRENCH.south - 0.6, TRENCH.south + 0.3, PAD - 0.4, PAD + 0.05));
  // Floor, a little past the exit, where it meets the ground.
  add('floor', grid([...ns, TRENCH.north + 1].map((n) => [[-hw, n, floorZ(-hw, n)], [hw, n, floorZ(hw, n)]])));
  // Deflector: steel plates turning the plume from straight down to due north over the trench's depth.
  const radius = PAD - TRENCH.floor;
  const steps = 16;
  const rows: P3[][] = [];
  const uv: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const phi = ((Math.PI / 2) * i) / steps;
    const n = TRENCH.south + radius * (1 - Math.cos(phi));
    const z = PAD - radius * Math.sin(phi) + drop(0, n);
    rows.push([[hw, n, z], [-hw, n, z]]);
    uv.push(hw / 2.4, (radius * phi) / 1.2, -hw / 2.4, (radius * phi) / 1.2);
  }
  const deflector = grid(rows);
  deflector.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  add('plates', deflector);
}

/** Line segments of the wires: the masts' catenary and the egress cables. */
function wireSegments(): Float32Array {
  const out: number[] = [];
  const line = (pts: readonly P3[]): void => {
    for (let i = 0; i + 1 < pts.length; i++) out.push(...pts[i], ...pts[i + 1]);
  };
  const tops = MASTS.map(([e, n]): P3 => [e, n, groundZ(e, n) + LIGHTNING_MAST_HEIGHT * M]);
  for (let i = 0; i < tops.length; i++) {
    line(sagging(tops[i], tops[(i + 1) % tops.length], WIRES.sag, 32));
    const [e, n] = MASTS[i];
    const d = Math.hypot(e, n);
    const ae = e + (e / d) * WIRES.anchor;
    const an = n + (n / d) * WIRES.anchor;
    line(sagging(tops[i], [ae, an, groundZ(ae, an)], 0.01, 16));
  }
  const { tower } = ML_LAYOUT;
  for (const n of EGRESS.norths) {
    const e = tower.e0 - EGRESS.run;
    line(sagging([tower.e0, n, DECK + EGRESS.level], [e, n, groundZ(e, n) + 2], EGRESS.sag, 32));
  }
  return Float32Array.from(out);
}

// ---------- Materials and textures ----------

export interface PadColors {
  readonly steel: string;
  readonly base: string;
  readonly concrete: string;
  readonly tank: string;
  readonly hood: string;
  /** The igniters' sparks (the flames' color). */
  readonly spark: string;
}

/** Mixes a palette color with black (fraction `f`), as the palette's derived tones do. */
const darker = (c: string, f: number): string => `#${new THREE.Color(c).lerp(new THREE.Color(0x000000), f).getHexString()}`;

/** Deterministic pseudo-random sequence (mulberry32), so the textures look the same every time. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Canvas texture of grays that darken the material's color (white = the color itself). */
function canvasTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, w, h);
  draw(c);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Texture tile (m) of the materials whose coordinates are projected (projectUV). */
const TILE: Partial<Record<Mat, number>> = { clad: 4, base: 4, hood: 4, concrete: 8, floor: 8 };

function createMaterials(colors: PadColors, anisotropy: number): { mats: Record<Mat, THREE.Material>; dispose(): void } {
  const rnd = random(20260401);
  // Cladding: panels 1 m wide and 2 m tall in a 4 m tile, with a few lighter and darker ones.
  const panels = canvasTexture(256, 256, (c) => {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 2; j++) {
        c.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.08})`;
        c.fillRect(i * 64, j * 128, 64, 128);
      }
    c.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 4; i++) c.fillRect(i * 64, 0, 2, 256);
    for (let j = 0; j < 2; j++) c.fillRect(0, j * 128, 256, 3);
  });
  // Concrete: soft blotches and the joints of 4 m slabs in an 8 m tile.
  const concrete = canvasTexture(256, 256, (c) => {
    for (let i = 0; i < 900; i++) {
      c.fillStyle = `rgba(0,0,0,${0.01 + rnd() * 0.03})`;
      c.beginPath();
      c.ellipse(rnd() * 256, rnd() * 256, 2 + rnd() * 10, 2 + rnd() * 8, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.fillRect(0, 0, 256, 2);
    c.fillRect(0, 128, 256, 2);
    c.fillRect(0, 0, 2, 256);
    c.fillRect(128, 0, 2, 256);
  });
  // Deflector plates: 1.2 × 0.6 m in a 2.4 × 1.2 m tile, each a different shade (heat and wear).
  const plates = canvasTexture(256, 128, (c) => {
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        c.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.25})`;
        c.fillRect(i * 128, j * 64, 128, 64);
      }
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(0, 0, 256, 3);
    c.fillRect(0, 64, 256, 3);
    c.fillRect(0, 0, 3, 128);
    c.fillRect(128, 0, 3, 128);
  });
  // Fiberglass masts: the dark spiral wrap of the launch photo (drawing choice: two turns per 6 m).
  const spiral = canvasTexture(64, 64, (c) => {
    c.fillStyle = 'rgba(0,0,0,0.55)';
    for (const dx of [-64, 0, 64]) {
      c.beginPath();
      c.moveTo(dx, 64);
      c.lineTo(dx + 14, 64);
      c.lineTo(dx + 78, 0);
      c.lineTo(dx + 64, 0);
      c.closePath();
      c.fill();
    }
  });
  spiral.repeat.set(2, 12);
  const textures = [panels, concrete, plates, spiral];
  for (const t of textures) t.anisotropy = anisotropy;
  const std = (color: string, more: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...more });
  const two = THREE.DoubleSide;
  const mats: Record<Mat, THREE.Material> = {
    steel: std(colors.steel, { roughness: 0.55, metalness: 0.3 }),
    clad: std(colors.steel, { map: panels, roughness: 0.6, metalness: 0.2 }),
    base: std(colors.base, { map: panels, roughness: 0.65, metalness: 0.2 }),
    hood: std(colors.hood, { map: panels, roughness: 0.6, metalness: 0.2 }),
    white: std(colors.tank, { roughness: 0.5 }),
    fiberglass: std(colors.tank, { map: spiral, roughness: 0.5, side: two }),
    concrete: std(colors.concrete, { map: concrete, roughness: 0.9, metalness: 0, side: two }),
    // The trench floor and the deflector, darkened by the exhaust (mixed with black).
    floor: std(darker(colors.concrete, 0.35), { map: concrete, roughness: 0.95, metalness: 0, side: two }),
    plates: std(darker(colors.base, 0.3), { map: plates, roughness: 0.6, metalness: 0.4, side: two }),
  };
  return {
    mats,
    dispose() {
      textures.forEach((t) => t.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
  };
}

// ---------- The model ----------

export interface PadModel {
  readonly group: THREE.Group;
  /** Places the pad like its ground: `origin` the sea-level point under the launch site (scene units), the pad's axes, the scale. */
  place(origin: THREE.Vector3, axes: { east: Vec3; north: Vec3; up: Vec3 }, metersToScene: number): void;
  /** Moves the arms and the tail masts and throws the igniters' sparks for MET t (s). */
  animate(t: number): void;
  dispose(): void;
}

/** Procedural model of the Mobile Launcher and LC‑39B. */
export function createPadModel(colors: PadColors, anisotropy = 1): PadModel {
  const { mats, dispose: disposeMats } = createMaterials(colors, anisotropy);
  type Bins = Map<Mat, THREE.BufferGeometry[]>;
  const adder =
    (bins: Bins): Add =>
    (mat, geo) => {
      const tile = TILE[mat];
      if (tile) projectUV(geo, tile);
      const list = bins.get(mat);
      if (list) list.push(geo);
      else bins.set(mat, [geo]);
    };
  // The fixed geometry, merged by material, and each moving part in its own bins.
  const fixedBins: Bins = new Map();
  const nodeBins = new Map<PadNode, Bins>();
  const fixed = adder(fixedBins);
  const node = (n: PadNode): Add => {
    let bins = nodeBins.get(n);
    if (!bins) nodeBins.set(n, (bins = new Map()));
    return adder(bins);
  };
  mobileLauncher(fixed);
  towerArms(node, fixed);
  tailMasts(node);
  lightningMasts(fixed);
  waterTower(fixed);
  cryoTanks(fixed);
  flameTrench(fixed);

  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const meshes = (bins: Bins, parent: THREE.Object3D): void => {
    for (const [mat, geos] of bins) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) throw new Error(`pad: could not merge ${mat}`);
      geometries.push(merged);
      parent.add(new THREE.Mesh(merged, mats[mat]));
    }
  };
  meshes(fixedBins, group);
  // Each moving part is built in the pad frame and moved as a whole by its group's matrix, the
  // same rigid motion the tests check (nodeTransform).
  const moving = [...nodeBins].map(([n, bins]) => {
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    meshes(bins, g);
    group.add(g);
    return [n, g] as const;
  });
  const wires = new THREE.BufferGeometry();
  wires.setAttribute('position', new THREE.BufferAttribute(wireSegments(), 3));
  const wireMaterial = new THREE.LineBasicMaterial({ color: darker(colors.base, 0.45) });
  group.add(new THREE.LineSegments(wires, wireMaterial));

  // The igniters' sparks: short glowing streaks, added like the engines' flames.
  const sparkPositions = new Float32Array(ROFI_SPARK_COUNT * 6);
  const sparkAttribute = new THREE.BufferAttribute(sparkPositions, 3).setUsage(THREE.DynamicDrawUsage);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', sparkAttribute);
  sparkGeometry.setDrawRange(0, 0);
  const sparkMaterial = new THREE.LineBasicMaterial({ color: colors.spark, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const sparks = new THREE.LineSegments(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false;
  sparks.visible = false;
  group.add(sparks);

  let animatedAt = NaN;
  const basis = new THREE.Matrix4();
  const e = new THREE.Vector3();
  const n = new THREE.Vector3();
  const u = new THREE.Vector3();
  return {
    group,
    place(origin, axes, metersToScene) {
      group.position.copy(origin);
      basis.makeBasis(e.set(axes.east.x, axes.east.y, axes.east.z), n.set(axes.north.x, axes.north.y, axes.north.z), u.set(axes.up.x, axes.up.y, axes.up.z));
      group.quaternion.setFromRotationMatrix(basis);
      group.scale.setScalar(metersToScene);
    },
    animate(t) {
      if (t === animatedAt) return;
      animatedAt = t;
      const m = padMotion(t);
      for (const [n, g] of moving) {
        const { r, t: d } = nodeTransform(n, m);
        g.matrix.set(r[0], r[1], r[2], d[0], r[3], r[4], r[5], d[1], r[6], r[7], r[8], d[2], 0, 0, 0, 1);
        g.matrixWorldNeedsUpdate = true;
      }
      const count = rofiSparks(t, sparkPositions);
      sparks.visible = count > 0;
      if (count > 0) {
        sparkGeometry.setDrawRange(0, 2 * count);
        sparkAttribute.needsUpdate = true;
      }
    },
    dispose() {
      geometries.forEach((g) => g.dispose());
      wires.dispose();
      wireMaterial.dispose();
      sparkGeometry.dispose();
      sparkMaterial.dispose();
      disposeMats();
    },
  };
}
