import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DebrisKind } from '../sim/state';
import { EngineId, VehicleConfig } from '../sim/vehicle';

/**
 * Vehicle model by parts. Everything is in meters, with the long axis along +x (nose towards
 * +x) and the origin at the bottom of the capsule's heat shield. Around each axis the angle θ
 * is measured from +z towards +y; +z is the side the 3D camera usually sees (with no roll it
 * is the north of the orbital plane, see `orient` in `scene.ts`).
 *
 * Published dimensions: stack of 98.1 m (322 ft), core stage of 64.6 m × 8.4 m, boosters of
 * 54 m × 3.7 m and ICPS of 13.7 m × 5.1 m [SLS]; capsule of 3.35 m × 5.03 m, capsule plus
 * service module 7.9 m, Orion with the abort tower 20.4 m, and solar arrays of three 2 × 2 m
 * panels, 18.9 m tip to tip [ORG]. The other proportions (adapters, tanks, skirts, tower,
 * nozzles) are measured on NASA's Artemis II SLS cutaway and on an SLS/Orion blueprint (with
 * its 98.3 m and 5 m scale bars), and the details (windows, docking system, radiators,
 * auxiliary engines, RCS pods, LOX feedline, booster joints and photo targets) follow that
 * blueprint and an exploded view of Orion and SLS. The detail is our own and simplified: it
 * is a drawing, not data. No logos, flags or lettering.
 */

export interface VehicleColors {
  readonly hull: string;
  readonly dark: string;
  readonly solar: string;
  readonly core: string;
  readonly flame: string;
  readonly metal: string;
  readonly gold: string;
}

type PartId = 'CM' | 'LAS' | 'FAIRING' | 'SM' | 'ICPS' | 'CORE' | 'SRB_L' | 'SRB_R';

/**
 * Stations along the axis (m). Published: capsule 3.35 m tall, capsule plus service module
 * 7.9 m, Orion with the tower 20.4 m [ORG]; stack 98.1 m, core stage 64.6 m, boosters 54 m and
 * ICPS 13.7 m [SLS]. The rest is measured on the illustrations (see the header).
 */
const ST = {
  lasTip: 15.85, // 20.4 m above the main engine exit
  cmTop: 3.35,
  bayTop: 3.05, // forward bay cover, under the docking system
  smTop: 0.25, // the heat shield nests in the crew module adapter
  esmTop: -0.85,
  esmBottom: -3.6,
  mainExit: -4.55, // 7.9 m below the top of the capsule
  osaTop: -5,
  icpsTop: -6.2,
  lvsaTop: -10.5,
  coreTop: -17.65, // 64.6 m above the RS‑25 exits
  icpsExit: -19.9, // 13.7 m below the top of the ICPS: the RL10 hangs inside the LVSA
  loxTankTop: -20.15,
  intertankTop: -30.65,
  intertankBottom: -35.65,
  engineSection: -71.95,
  boatTail: -75.65,
  coreBase: -79.15,
  rs25Exit: -82.25, // the stack's 98.1 m end here
  srbTip: -28.35, // 54 m above the booster nozzle exits
  srbNose: -32.05,
  srbSkirt: -77.85,
  srbBase: -80.45,
  srbExit: -82.35,
} as const;

/** Radii (m): published diameters [SLS] [ORG]; the adapter and the fairings from the illustrations. */
const RAD = {
  cm: 2.515,
  cma: 2.5,
  esm: 2,
  fairing: 2.62,
  icps: 2.55,
  core: 4.2,
  srb: 1.86,
  srbSkirt: 2.55,
} as const;

/** Distance from the core stage axis to each booster's axis (m). */
const SRB_Y = 6.3;

/** Ends of each part along the x axis (m) and its lateral offset. */
const EXTENT: Readonly<Record<PartId, { x0: number; x1: number; y: number }>> = {
  CM: { x0: 0, x1: ST.cmTop, y: 0 },
  LAS: { x0: -0.05, x1: ST.lasTip, y: 0 },
  FAIRING: { x0: ST.osaTop, x1: -0.05, y: 0 },
  SM: { x0: ST.mainExit, x1: ST.smTop, y: 0 },
  ICPS: { x0: ST.icpsExit, x1: ST.esmBottom, y: 0 },
  CORE: { x0: ST.rs25Exit, x1: ST.lvsaTop, y: 0 },
  SRB_L: { x0: ST.srbExit, x1: ST.srbTip, y: SRB_Y },
  SRB_R: { x0: ST.srbExit, x1: ST.srbTip, y: -SRB_Y },
};

const partsOf = (cfg: VehicleConfig): PartId[] => {
  const parts: PartId[] = ['CM'];
  if (!cfg.cmSeparated) parts.push('SM');
  if (!cfg.lasJettisoned) parts.push('LAS', 'FAIRING');
  if (!cfg.icpsSeparated) parts.push('ICPS');
  if (!cfg.coreSeparated) parts.push('CORE');
  if (!cfg.srbSeparated) parts.push('SRB_L', 'SRB_R');
  return parts;
};

/** Ends of the whole vehicle in its current configuration (m). */
export function vehicleExtent(cfg: VehicleConfig): { x0: number; x1: number; length: number; center: number } {
  const { x0, x1 } = extentOf(partsOf(cfg));
  return { x0, x1, length: x1 - x0, center: (x0 + x1) / 2 };
}

const DEBRIS_PART: Readonly<Record<string, PartId>> = {
  'SRB-L': 'SRB_L',
  'SRB-R': 'SRB_R',
  LAS: 'LAS',
  FAIRING: 'FAIRING',
  CORE: 'CORE',
  ICPS: 'ICPS',
  SM: 'SM',
};

/** The CubeSats are 12U boxes: 0.37 × 0.24 × 0.22 m [SLS]. */
const CUBESAT_SIZE = { x: 0.366, y: 0.239, z: 0.224 };
const isCubesat = (id: string): boolean => id.startsWith('CUBESAT');

/** Length (m) of a jettisoned part, to scale it on screen. */
export const debrisLength = (id: string): number => {
  if (isCubesat(id)) return CUBESAT_SIZE.x;
  const e = EXTENT[DEBRIS_PART[id] ?? 'SM'];
  return e.x1 - e.x0;
};

// ---------- Shared geometry (3D and 2D icon) ----------

/**
 * Materials. The textured ones carry a map of seams, joints and marks drawn in the browser
 * (`createTextures`); the 2D icon reduces them to four classes (`ICON_CLASS`).
 */
type Mat =
  | 'hull'
  | 'cm'
  | 'shield'
  | 'esm'
  | 'srb'
  | 'sa'
  | 'metal'
  | 'gold'
  | 'dark'
  | 'core'
  | 'intertank'
  | 'pipe'
  | 'solar'
  | 'solarBack';

const ICON_CLASS: Readonly<Record<Mat, string>> = {
  hull: 'hull',
  cm: 'hull',
  shield: 'dark',
  esm: 'hull',
  srb: 'hull',
  sa: 'hull',
  metal: 'hull',
  gold: 'hull',
  dark: 'dark',
  core: 'core',
  intertank: 'core',
  pipe: 'core',
  solar: 'solar',
  solarBack: 'solar',
};

type P2 = readonly [number, number];

/**
 * Solid-of-revolution piece: outline of (x, r) points walked from the bottom up (from the axis
 * outwards at the bottom and back towards it at the top, so the normals point out), with its
 * axis shifted to (y, z). The 3D model revolves it; the 2D icon draws the outline seen from +z,
 * which is how the map looks. Where the outline turns sharply the shading breaks (an edge).
 */
interface Piece {
  readonly pts: readonly P2[];
  readonly mat: Mat;
  readonly y?: number;
  readonly z?: number;
  /** Center and width (rad) of a piece that does not go all the way round (window, panel). */
  readonly arc?: readonly [number, number];
  /** false: left out of the 2D icon (too small to see there, or the same outline as another piece). */
  readonly icon?: boolean;
}

const piece = (pts: readonly P2[], mat: Mat, more: Partial<Piece> = {}): Piece => ({ pts, mat, ...more });

/** Joins outlines, dropping repeated points (a zero-length segment has no normal). */
function join(...lists: readonly (readonly P2[])[]): P2[] {
  const out: P2[] = [];
  for (const list of lists)
    for (const p of list) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push(p);
    }
  return out;
}

/** Points of a curve, t from 0 to 1. */
const curve = (n: number, f: (t: number) => P2): P2[] => Array.from({ length: n + 1 }, (_, i) => f(i / n));

/** Bell nozzle walked from its exit (xe, re) up to its top (xt, rt): walls almost parallel at the exit, flaring fast at the top. */
const bell = (xe: number, re: number, xt: number, rt: number, n = 8): P2[] =>
  curve(n, (t) => [xe + (xt - xe) * t, rt + (re - rt) * (1 - Math.pow(t, 1.7))]);

/** Ellipsoidal tank centered at x (semi-axes r radial and h axial), from its bottom pole to its top pole. */
const ellipsoid = (x: number, r: number, h: number, n = 16): P2[] =>
  curve(n, (t) => {
    const a = -Math.PI / 2 + Math.PI * t;
    return [x + h * Math.sin(a), r * Math.cos(a)];
  });

/** Dome over the equator at x ('up': from the equator to the pole) or under it (from the pole to the equator). */
const dome = (x: number, r: number, h: number, up: boolean, n = 10): P2[] =>
  curve(n, (t) => {
    const a = up ? (Math.PI / 2) * t : -Math.PI / 2 + (Math.PI / 2) * t;
    return [x + h * Math.sin(a), r * Math.cos(a)];
  });

/** Point of a surface of revolution: station x, angle θ (from +z towards +y), radius r. */
const polar = (x: number, theta: number, r: number): [number, number, number] => [x, r * Math.sin(theta), r * Math.cos(theta)];

// --- Crew module ---

/**
 * Capsule outline: a shallow spherical heat shield (0.3 m sag, a drawing choice), a rounded
 * shoulder at the published 5.03 m diameter and the back shell at 32.5° from the axis (the
 * usual figure for Orion; the blueprint gives ~33°) up to the forward bay cover (1.72 m across,
 * from the blueprint).
 */
const CAPSULE = (() => {
  const sphere = 9.9;
  const rho = 0.12;
  const halfAngle = THREE.MathUtils.degToRad(32.5);
  const bayR = 0.86;
  // Shoulder torus tangent to the sphere and reaching the published radius.
  const capR = (RAD.cm - rho) / (1 - rho / sphere);
  const capS = Math.sqrt(sphere * sphere - capR * capR);
  const center: P2 = [sphere - capS * (1 - rho / sphere), RAD.cm - rho];
  const arc = (deg0: number, deg1: number, n: number): P2[] =>
    curve(n, (t) => {
      const a = THREE.MathUtils.degToRad(deg0 + (deg1 - deg0) * t);
      return [center[0] + rho * Math.cos(a), center[1] + rho * Math.sin(a)];
    });
  const startDeg = THREE.MathUtils.radToDeg(Math.atan2(capR, -capS));
  const endDeg = 90 - 32.5;
  const shellStart: P2 = [center[0] + rho * Math.sin(halfAngle), center[1] + rho * Math.cos(halfAngle)];
  const shellR = (x: number): number => shellStart[1] - (x - shellStart[0]) * Math.tan(halfAngle);
  const topX = shellStart[0] + (shellStart[1] - bayR) / Math.tan(halfAngle);
  return {
    shield: join(
      curve(8, (t) => {
        const r = capR * t;
        return [sphere - Math.sqrt(sphere * sphere - r * r), r];
      }),
      arc(startDeg, 95, 7),
    ),
    ring: arc(95, 75, 2),
    shell: join(arc(75, endDeg, 2), [[topX, bayR]]),
    shellR,
    bayR,
    topX,
  };
})();

const QUARTERS = [0, 1, 2, 3].map((k) => Math.PI / 4 + (k * Math.PI) / 2);

/**
 * Openings painted on a surface's texture (windows, hatch, thruster ports): stations x0–x1,
 * centered at θ and `w` m wide. They go in the texture and not as raised patches because,
 * a few centimeters off the surface, the depth buffer could not tell them apart from it.
 */
interface Opening {
  readonly x0: number;
  readonly x1: number;
  readonly theta: number;
  readonly w: number;
  readonly kind: 'window' | 'frame' | 'outline' | 'port';
}
const opening = (x0: number, x1: number, theta: number, w: number, kind: Opening['kind']): Opening => ({ x0, x1, theta, w, kind });
const framedWindow = (x0: number, x1: number, theta: number, w: number): Opening[] => [
  opening(x0 - 0.04, x1 + 0.04, theta, w + 0.08, 'frame'),
  opening(x0, x1, theta, w, 'window'),
];

/**
 * Back shell openings: two docking windows and two side windows (blueprint front view), the
 * hatch between them with its window, and twelve RCS thruster ports in four groups.
 */
const CM_OPENINGS: readonly Opening[] = [
  ...[-0.16, 0.16].flatMap((t) => framedWindow(2.15, 2.5, t, 0.3)),
  ...[-1.2, 1.2].flatMap((t) => framedWindow(1.5, 1.9, t, 0.34)),
  opening(0.8, 1.95, 0, 0.95, 'outline'),
  ...framedWindow(1.35, 1.65, 0, 0.28),
  ...QUARTERS.flatMap((t) => [
    opening(2.72, 2.84, t, 0.14, 'port'),
    opening(0.95, 1.07, t - 0.07, 0.12, 'port'),
    opening(0.95, 1.07, t + 0.07, 0.12, 'port'),
  ]),
];

const CM_PIECES: Piece[] = [
  piece(CAPSULE.shield, 'shield'),
  piece(CAPSULE.ring, 'metal'),
  piece(CAPSULE.shell, 'cm'),
  // Forward bay cover and NASA Docking System (the gold ring of the exploded view).
  piece([[CAPSULE.topX, CAPSULE.bayR], [ST.bayTop + 0.03, CAPSULE.bayR - 0.06], [ST.bayTop + 0.03, 0.62]], 'hull'),
  piece([[ST.bayTop + 0.03, 0.62], [3.26, 0.62]], 'gold'),
  piece([[3.26, 0.62], [3.26, 0.7], [ST.cmTop, 0.7], [ST.cmTop, 0.46]], 'metal'),
  piece([[ST.cmTop, 0.46], [3.31, 0.42], [3.31, 0]], 'dark', { icon: false }),
];

// --- Service module ---

/** The eight auxiliary engines, in four pairs around the main engine (blueprint front view): (y, z). */
const AUX_POS: readonly (readonly [number, number])[] = [0, 1, 2, 3].flatMap((k) =>
  [-0.17, 0.17].map((d) => {
    const p = polar(0, (k * Math.PI) / 2 + d, 1.45);
    return [p[1], p[2]] as const;
  }),
);
const AUX_EXIT = -3.98;
/** The 24 RCS thrusters, in six pods of four on the lower edge of the module. */
const RCS_THETA = [0, 1, 2, 3, 4, 5].map((k) => (k * Math.PI) / 3);
const RCS_X = -3.4;

const SM_PIECES: Piece[] = [
  piece([[ST.esmBottom, 0.95], [ST.esmBottom, RAD.esm]], 'metal'),
  // European Service Module with its radiators, under the crew module adapter.
  piece([[ST.esmBottom, RAD.esm], [ST.esmTop, RAD.esm]], 'esm'),
  piece([[ST.esmTop, RAD.esm], [-0.6, RAD.cma], [ST.smTop, RAD.cma]], 'hull'),
  piece([[ST.smTop, RAD.cma], [ST.smTop, 0]], 'gold', { icon: false }),
  // Skirt around the main engine and the OMS‑E engine itself.
  piece([[-3.86, 0.52], [ST.esmBottom, 0.95]], 'gold'),
  piece(bell(ST.mainExit, 0.58, -3.8, 0.22), 'dark'),
  piece([[-3.8, 0.22], [-3.62, 0.22]], 'metal', { icon: false }),
  ...AUX_POS.map(([y, z]) => piece(bell(AUX_EXIT, 0.1, ST.esmBottom, 0.045, 5), 'dark', { y, z, icon: false })),
];

/**
 * Solar wings in an X (blueprint top view), each with a yoke and three 2 × 2 m panels [ORG]. The
 * wing hinges on the module wall at `x`, faces the spacecraft axis (seen face-on looking at the
 * spacecraft from the front) and is tilted `tilt` backwards (a pose: the real wings turn to track
 * the Sun). Tip to tip ~18.6 m (published 18.9 m).
 */
const WING = { x: -3.2, root: RAD.esm, yoke: 1.2, panel: 2, gap: 0.12, tilt: 0.2 };
const PANEL_START = [0, 1, 2].map((k) => WING.yoke + k * (WING.panel + WING.gap));
const WING_TIP = WING.yoke + 3 * WING.panel + 2 * WING.gap;
const ARM_ANGLES = [0, 1, 2, 3].map((i) => Math.PI / 4 + (i * Math.PI) / 2);

/** The solar arrays deploy once in orbit, without the protective fairings. */
const arraysDeployed = (cfg: VehicleConfig): boolean => cfg.lasJettisoned && cfg.coreSeparated;

// --- Launch abort system and fairings ---

const LAS_PIECES: Piece[] = [
  // Fairing over the capsule, ogive and tower adapter (cutaway and blueprint).
  piece(
    join(
      [[-0.05, RAD.fairing]],
      curve(10, (t) => [0.9 + 3.85 * t, 1.15 + (RAD.fairing - 1.15) * (1 - t * t)]),
      [
        [7.05, 0.72],
        [7.2, 0.62],
        [9.15, 0.62],
      ],
    ),
    'hull',
  ),
  // Abort motor nozzle collar, jettison motor, attitude control motor and nose.
  piece([[9.15, 0.62], [9.15, 0.7], [9.85, 0.7], [10.05, 0.55]], 'metal'),
  piece([[10.05, 0.55], [12.7, 0.5], [12.7, 0.44]], 'hull'),
  piece([[12.7, 0.44], [13.5, 0.44]], 'dark'),
  piece(
    join(
      [
        [13.5, 0.44],
        [15.05, 0.34],
      ],
      curve(6, (t) => [15.05 + (ST.lasTip - 15.05) * t, 0.34 * Math.pow(1 - t, 0.7)]),
    ),
    'hull',
  ),
];

/** Service module fairings: three panels around it. In the 2D icon one stands for the three. */
const FAIRING_PIECES: Piece[] = [0, 1, 2].map((i) =>
  piece([[ST.osaTop, RAD.fairing], [-0.05, RAD.fairing]], 'hull', { arc: [Math.PI / 6 + (i * 2 * Math.PI) / 3, (2 * Math.PI) / 3 - 0.02], icon: i === 0 }),
);

// --- ICPS with the Orion stage adapter and the spacecraft adapter ---

const ICPS_PIECES: Piece[] = [
  piece(bell(ST.icpsExit, 0.98, -17.2, 0.33, 10), 'dark'),
  piece([[-17.2, 0.33], [-16.6, 0.3]], 'metal', { icon: false }),
  // Thrust structure, liquid oxygen tank and liquid hydrogen tank.
  piece([[-16.6, 0.3], [-15.6, 0.99]], 'metal'),
  piece(ellipsoid(-14.5, 1.6, 1.4), 'metal'),
  piece(join(dome(-12, RAD.icps, 1, false), [[ST.icpsTop, RAD.icps]]), 'hull'),
  // Orion stage adapter (with its flanges) and spacecraft adapter.
  piece([[ST.icpsTop, RAD.icps], [ST.icpsTop, 2.6], [-6.1, 2.6], [-6.1, 2.56]], 'metal', { icon: false }),
  piece([[-6.1, 2.56], [-5.12, 2.56]], 'hull'),
  piece([[-5.12, 2.56], [-5.12, 2.6], [ST.osaTop, 2.6], [ST.osaTop, 2.55]], 'metal', { icon: false }),
  piece([[ST.osaTop, 2.55], [ST.esmBottom, 2.05]], 'sa'),
  piece([[ST.esmBottom, 2.05], [ST.esmBottom, 0]], 'metal', { icon: false }),
];

// --- Core stage with the LVSA ---

const RS25_POS: readonly (readonly [number, number])[] = [
  [1.9, 1.9],
  [1.9, -1.9],
  [-1.9, 1.9],
  [-1.9, -1.9],
];

/** RS‑25: bell nozzle, dark below and with the light thermal blankets of the cutaway at the top. */
function rs25(y: number, z: number): Piece[] {
  const b = bell(ST.rs25Exit, 1.15, ST.coreBase, 0.55, 12);
  const icon = z > 0;
  return [piece(b.slice(0, 10), 'dark', { y, z, icon }), piece(b.slice(9), 'metal', { y, z, icon: false })];
}

/** LOX feedline down the side of the hydrogen tank (exploded view and blueprint): axis offset and ends. */
const FEEDLINE = { z: RAD.core + 0.27, r: 0.22, x0: -72.6, x1: -34.6 };

const CORE_PIECES: Piece[] = [
  piece([[ST.coreBase, 0], [ST.coreBase, RAD.core]], 'dark'),
  // Boat tail (white in the exploded view), engine section and tanks, intertank, LOX tank and forward skirt.
  piece([[ST.coreBase, RAD.core], [ST.boatTail, RAD.core]], 'hull'),
  piece([[ST.boatTail, RAD.core], [ST.intertankBottom, RAD.core]], 'core'),
  piece([[ST.intertankBottom, RAD.core], [ST.intertankTop, RAD.core]], 'intertank'),
  piece([[ST.intertankTop, RAD.core], [ST.coreTop, RAD.core]], 'core'),
  // Launch vehicle stage adapter (orange in the exploded view) and its top flange.
  piece([[ST.coreTop, RAD.core], [ST.lvsaTop, 2.62]], 'core'),
  piece([[ST.lvsaTop, 2.62], [ST.lvsaTop, 2.56]], 'metal', { icon: false }),
  // Forward bulkhead of the LOX tank: only seen through the LVSA once the stage is alone.
  piece(dome(ST.loxTankTop, RAD.core - 0.02, 0.2, true), 'pipe', { icon: false }),
  ...RS25_POS.flatMap(([y, z]) => rs25(y, z)),
  piece([[FEEDLINE.x0, FEEDLINE.r], [FEEDLINE.x1, FEEDLINE.r]], 'pipe', { z: FEEDLINE.z, icon: false }),
];

// --- Solid rocket boosters ---

/** Nose cone radius at station x (slightly convex ogive). */
const srbNoseR = (x: number): number => RAD.srb * Math.pow(1 - (x - ST.srbNose) / (ST.srbTip - ST.srbNose), 0.8);

function srbPieces(y: number): Piece[] {
  return [
    // Nozzle and the underside of the aft skirt.
    piece(join(bell(ST.srbExit, 1.9, ST.srbBase, 1.45, 6), [[ST.srbBase, RAD.srbSkirt]]), 'dark', { y }),
    // Flared aft skirt and motor case (joints and marks in the texture).
    piece([[ST.srbBase, RAD.srbSkirt], [-80.15, RAD.srbSkirt], [ST.srbSkirt, RAD.srb], [ST.srbNose, RAD.srb]], 'srb', { y }),
    // Nose cone (with the ports of the forward separation motors in the texture).
    piece(
      join(
        [[ST.srbNose, RAD.srb]],
        curve(8, (t) => {
          const x = ST.srbNose + (ST.srbTip - ST.srbNose) * t;
          return [x, srbNoseR(x)];
        }),
      ),
      'srb',
      { y },
    ),
    // Aft attach ring.
    piece([[-75.15, RAD.srb], [-75.15, 1.95], [-74.65, 1.95], [-74.65, RAD.srb]], 'metal', { y, icon: false }),
  ];
}

/** Ports of the four forward separation motors on each booster's nose cone. */
const SRB_OPENINGS: readonly Opening[] = QUARTERS.map((t) => opening(-30.7, -30.3, t, 0.3, 'port'));

/** Revolution pieces of each part. */
const PROFILE: Readonly<Record<PartId, readonly Piece[]>> = {
  CM: CM_PIECES,
  LAS: LAS_PIECES,
  FAIRING: FAIRING_PIECES,
  SM: SM_PIECES,
  ICPS: ICPS_PIECES,
  CORE: CORE_PIECES,
  SRB_L: srbPieces(EXTENT.SRB_L.y),
  SRB_R: srbPieces(EXTENT.SRB_R.y),
};

/**
 * Flame of each engine, at its nozzle exit (x, y, z) and towards −x. `glow` is its opacity:
 * the boosters' plume is bright; the hydrogen engines' is fainter.
 */
interface Flame {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly len: number;
  readonly glow: number;
}
const flameAt = (x: number, y: number, z: number, radius: number, len: number, glow: number): Flame => ({ x, y, z, radius, len, glow });

const FLAMES: Readonly<Record<EngineId, readonly Flame[]>> = {
  SRB: [flameAt(ST.srbExit, SRB_Y, 0, 1.9, 42, 0.95), flameAt(ST.srbExit, -SRB_Y, 0, 1.9, 42, 0.95)],
  RS25: RS25_POS.map(([y, z]) => flameAt(ST.rs25Exit, y, z, 1.1, 18, 0.6)),
  RL10: [flameAt(ST.icpsExit, 0, 0, 0.95, 9, 0.5)],
  MAIN: [flameAt(ST.mainExit, 0, 0, 0.56, 5, 0.6)],
  AUX: AUX_POS.map(([y, z]) => flameAt(AUX_EXIT, y, z, 0.1, 1.6, 0.65)),
  RCS: RCS_THETA.map((t) => {
    const p = polar(0, t, RAD.esm + 0.13);
    return flameAt(RCS_X - 0.2, p[1], p[2], 0.05, 0.7, 0.75);
  }),
  CMRCS: QUARTERS.map((t) => {
    const p = polar(0, t, CAPSULE.shellR(0.75) + 0.05);
    return flameAt(0.75, p[1], p[2], 0.05, 0.4, 0.75);
  }),
};

// ---------- 3D geometry ----------

type Adder = (mat: Mat, geo: THREE.BufferGeometry) => void;

/** Above this turn between two segments of an outline the shading breaks (rad). */
const SMOOTH_LIMIT = THREE.MathUtils.degToRad(12);

/** Splits an outline where it turns more than `SMOOTH_LIMIT`, so each run is shaded smooth. */
function smoothRuns(pts: readonly P2[]): P2[][] {
  const runs: P2[][] = [];
  let run: P2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    run.push(pts[i]);
    if (i < pts.length - 1) {
      const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
      const b = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      let d = Math.abs(b - a);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d > SMOOTH_LIMIT) {
        runs.push(run);
        run = [pts[i]];
      }
    }
  }
  runs.push(run);
  return runs.filter((r) => r.length >= 2);
}

/**
 * Range along the axis (m) of each textured material's map: v goes from x0 to x1 and u once
 * around (u = 0 at θ = 0, growing towards −θ).
 */
const TEX_RANGE: Partial<Record<Mat, readonly [number, number]>> = {
  cm: [0.45, 3.06],
  shield: [0, 0.41],
  esm: [ST.esmBottom, ST.esmTop],
  sa: [ST.osaTop, ST.esmBottom],
  srb: [ST.srbExit, ST.srbTip],
  core: [ST.coreBase, ST.lvsaTop],
  intertank: [ST.intertankBottom, ST.intertankTop],
};

/** Revolves an outline around the x axis (three.js revolves around y: it is turned afterwards). */
function revolve(pts: readonly P2[], segments: number, phiStart = 0, phiLength = Math.PI * 2, range?: readonly [number, number]): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(
    pts.map(([x, r]) => new THREE.Vector2(Math.max(r, 0), x)),
    segments,
    phiStart,
    phiLength,
  );
  if (range) {
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, (pos.getY(i) - range[0]) / (range[1] - range[0]));
  }
  geo.rotateZ(-Math.PI / 2);
  return geo;
}

function pieceGeometries(p: Piece): THREE.BufferGeometry[] {
  const maxR = Math.max(...p.pts.map((q) => q[1]));
  // θ = −φ of three.js: the arc [center, width] starts at φ = −center − width/2.
  const [phiStart, phiLength] = p.arc ? [-p.arc[0] - p.arc[1] / 2, p.arc[1]] : [0, Math.PI * 2];
  const full = Math.max(12, Math.min(72, Math.round(14 + maxR * 14)));
  const segments = Math.max(2, Math.ceil((full * phiLength) / (Math.PI * 2)));
  return smoothRuns(p.pts).map((run) => {
    const geo = revolve(run, segments, phiStart, phiLength, TEX_RANGE[p.mat]);
    geo.translate(0, p.y ?? 0, p.z ?? 0);
    return geo;
  });
}

/** Box centered on the surface at station x, angle θ and radius r; sizes along x, around and outwards. */
function boxAt(x: number, theta: number, r: number, sx: number, st: number, sr: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(sx, st, sr);
  g.translate(x, 0, r);
  g.rotateX(-theta);
  return g;
}

/** Closed cylinder of radius `radius` from point a to point b. */
function rod(a: readonly number[], b: readonly number[], radius: number, segments = 8): THREE.BufferGeometry {
  const va = new THREE.Vector3(a[0], a[1], a[2]);
  const vb = new THREE.Vector3(b[0], b[1], b[2]);
  const g = new THREE.CylinderGeometry(radius, radius, va.distanceTo(vb), segments);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}

/** Small bell nozzle whose top is at `top` and whose exhaust points along `dir`. */
function nozzle(top: readonly number[], dir: readonly number[], len: number, re: number, rt: number): THREE.BufferGeometry {
  const g = revolve(bell(-len, re, 0, rt, 5), 12);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(dir[0], dir[1], dir[2]).normalize()));
  g.translate(top[0], top[1], top[2]);
  return g;
}

/** Outward direction at angle θ, tilted `cant` from −x: the exhaust of a canted nozzle. */
const canted = (theta: number, cant: number): [number, number, number] => {
  const p = polar(0, theta, Math.sin(cant));
  return [-Math.cos(cant), p[1], p[2]];
};

/** Details that are not solids of revolution around the part's axis (3D only). */
const EXTRAS: Partial<Record<PartId, (add: Adder) => void>> = {
  LAS: (add) => {
    // Four abort motor nozzles canted outwards, and the four small ones of the jettison motor.
    for (const t of QUARTERS) add('dark', nozzle(polar(9.55, t, 0.58), canted(t, 0.45), 0.7, 0.22, 0.13));
    for (const t of QUARTERS) add('dark', nozzle(polar(12.5, t - Math.PI / 4, 0.47), canted(t - Math.PI / 4, 0.6), 0.3, 0.09, 0.05));
  },
  SM: (add) => {
    // RCS pods: a box with four nozzles (aft, forward and both sides).
    for (const t of RCS_THETA) {
      add('metal', boxAt(RCS_X, t, RAD.esm + 0.09, 0.32, 0.24, 0.18));
      const r = RAD.esm + 0.13;
      add('dark', nozzle(polar(RCS_X - 0.16, t, r), [-1, 0, 0], 0.08, 0.045, 0.02));
      add('dark', nozzle(polar(RCS_X + 0.16, t, r), [1, 0, 0], 0.08, 0.045, 0.02));
      for (const s of [-1, 1]) {
        const side = polar(0, t + (s * Math.PI) / 2, 1);
        add('dark', nozzle(polar(RCS_X, t + s * 0.06, r), side, 0.08, 0.045, 0.02));
      }
    }
  },
  ICPS: (add) => {
    // Truss between the hydrogen tank and the oxygen tank, in a zigzag.
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const bottom = polar(-14.5, a + Math.PI / 8, 1.58);
      add('metal', rod(polar(-12.05, a, 2.5), bottom, 0.045));
      add('metal', rod(polar(-12.05, a + Math.PI / 4, 2.5), bottom, 0.045));
    }
    // RL10 turbopumps beside the thrust chamber.
    for (const t of [Math.PI / 2, -Math.PI / 2]) add('gold', rod(polar(-17.1, t, 0.5), polar(-16.5, t, 0.5), 0.14, 12));
  },
  CORE: (add) => {
    // LOX feedline: elbows into the tank and brackets.
    for (const x of [FEEDLINE.x0, FEEDLINE.x1]) {
      add('pipe', rod([x, 0, RAD.core - 0.05], [x, 0, FEEDLINE.z], FEEDLINE.r, 12));
      add('pipe', new THREE.SphereGeometry(FEEDLINE.r, 12, 8).translate(x, 0, FEEDLINE.z));
    }
    for (let x = FEEDLINE.x0 + 2.5; x < FEEDLINE.x1 - 1; x += 3.8) add('metal', boxAt(x, 0, RAD.core + 0.14, 0.25, 0.55, 0.28));
    // Booster attach fittings: forward on the intertank and aft on the engine section.
    for (const t of [Math.PI / 2, -Math.PI / 2]) {
      add('metal', boxAt(-33.4, t, RAD.core + 0.12, 0.7, 0.6, 0.26));
      add('metal', boxAt(-74.9, t, RAD.core + 0.12, 0.35, 1.4, 0.26));
    }
  },
};

/** Solar wings: drive box, yoke and three panels (cells forward, bare back) per wing. */
function addArrays(add: Adder): void {
  const arm = new THREE.Matrix4();
  const wing = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  for (const a of ARM_ANGLES) {
    arm.makeRotationX(a);
    wing.makeRotationZ(WING.tilt).setPosition(WING.x, WING.root, 0);
    m.multiplyMatrices(arm, wing);
    const put = (mat: Mat, geo: THREE.BufferGeometry): void => add(mat, geo.applyMatrix4(m));
    put('metal', new THREE.BoxGeometry(0.4, 0.3, 0.36).translate(0, 0.05, 0));
    put('metal', new THREE.BoxGeometry(0.06, WING.yoke, 0.14).translate(0, WING.yoke / 2, 0));
    for (const v of PANEL_START) {
      // Two single-sided faces back to back: each one is only drawn from its own side.
      const c = v + WING.panel / 2;
      put('solar', new THREE.PlaneGeometry(WING.panel, WING.panel).rotateY(Math.PI / 2).translate(0.02, c, 0));
      put('solarBack', new THREE.PlaneGeometry(WING.panel, WING.panel).rotateY(-Math.PI / 2).translate(-0.02, c, 0));
    }
    // Hinges between the panels.
    for (const v of PANEL_START.slice(1)) {
      const y = v - WING.gap / 2;
      put('metal', rod([0, y, -WING.panel / 2], [0, y, WING.panel / 2], 0.03));
    }
  }
}

/** Merges the geometries of each material into one mesh (few draw calls for many pieces). */
function addMerged(group: THREE.Group, bins: Map<Mat, THREE.BufferGeometry[]>, kit: Kit): void {
  for (const [mat, geos] of bins) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (merged) {
      if (merged !== geos[0]) geos.forEach((g) => g.dispose());
      group.add(new THREE.Mesh(kit.track(merged), kit.mats[mat]));
    } else {
      for (const g of geos) group.add(new THREE.Mesh(kit.track(g), kit.mats[mat]));
    }
  }
}

function collector(): { bins: Map<Mat, THREE.BufferGeometry[]>; add: Adder } {
  const bins = new Map<Mat, THREE.BufferGeometry[]>();
  return {
    bins,
    add: (mat, geo) => {
      const list = bins.get(mat);
      if (list) list.push(geo);
      else bins.set(mat, [geo]);
    },
  };
}

function buildPart(id: PartId, kit: Kit): THREE.Group {
  const g = new THREE.Group();
  const body = collector();
  for (const p of PROFILE[id]) for (const geo of pieceGeometries(p)) body.add(p.mat, geo);
  EXTRAS[id]?.(body.add);
  addMerged(g, body.bins, kit);
  if (id === 'SM') {
    const arrays = new THREE.Group();
    arrays.name = 'array';
    const wings = collector();
    addArrays(wings.add);
    addMerged(arrays, wings.bins, kit);
    g.add(arrays);
  }
  return g;
}

/** Exhaust plume: walked from its far tip up to the nozzle (x = 0), slightly wider in the middle. */
function plumeGeometry(radius: number, len: number): THREE.BufferGeometry {
  const pts = curve(10, (t) => {
    const s = 1 - t;
    return [-len * s, radius * (1 + 0.25 * s) * Math.sqrt(Math.max(0, 1 - s * s))];
  });
  return revolve(pts, 20, 0, Math.PI * 2, [-len, 0]);
}

/** Flame of one nozzle: an outer plume and a brighter, shorter core, both additive. */
function flame(kit: Kit, f: Flame): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(kit.track(plumeGeometry(f.radius, f.len)), kit.flame(f.glow, false)));
  g.add(new THREE.Mesh(kit.track(plumeGeometry(f.radius * 0.55, f.len * 0.45)), kit.flame(f.glow, true)));
  g.position.set(f.x, f.y, f.z);
  return g;
}

// ---------- Materials and textures ----------

/** Mixes two colors in sRGB (fraction `f` of `b`), as the palette's derived tones do. */
const mix = (a: string, b: string, f: number): string => `#${new THREE.Color(a).lerp(new THREE.Color(b), f).getHexString()}`;

/** Deterministic pseudo-random sequence (mulberry32), so the foam looks the same every time. */
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

interface Painter {
  readonly c: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;
  /** Canvas row of station x (the top row is v = 1). */
  row(x: number): number;
  /** Darkening line across (constant x) or along (constant θ, between two stations). */
  ring(x: number, px: number, alpha: number): void;
  seam(u: number, x0: number, x1: number, px: number, alpha: number): void;
  /** Dark rectangle centered at u, between two stations, `du` wide (fraction of the turn). */
  patch(u: number, x0: number, x1: number, du: number, alpha: number): void;
  /** Openings on a surface of radius `rOf(x)` (only those of one kind, if given). */
  openings(list: readonly Opening[], rOf: (x: number) => number, only?: Opening['kind']): void;
}

const OPENING_ALPHA: Readonly<Record<Opening['kind'], number>> = { window: 0.93, frame: 0.4, outline: 0.55, port: 0.85 };

/**
 * Canvas texture. The detail maps are grays that darken the material's palette color (mixing
 * it with black); the solar cells map carries its own colors, derived from the palette.
 */
function paint(w: number, h: number, range: readonly [number, number], draw: (p: Painter) => void, srgb = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, w, h);
  const row = (x: number): number => (1 - (x - range[0]) / (range[1] - range[0])) * h;
  const p: Painter = {
    c,
    w,
    h,
    row,
    ring(x, px, alpha) {
      c.fillStyle = `rgba(0,0,0,${alpha})`;
      c.fillRect(0, row(x) - px / 2, w, px);
    },
    seam(u, x0, x1, px, alpha) {
      c.fillStyle = `rgba(0,0,0,${alpha})`;
      const y0 = row(Math.max(x0, x1));
      c.fillRect(u * w - px / 2, y0, px, row(Math.min(x0, x1)) - y0);
    },
    patch(u, x0, x1, du, alpha) {
      c.fillStyle = `rgba(0,0,0,${alpha})`;
      const y0 = row(Math.max(x0, x1));
      c.fillRect((u - du / 2) * w, y0, du * w, row(Math.min(x0, x1)) - y0);
    },
    openings(list, rOf, only) {
      for (const o of list) {
        if (only && o.kind !== only) continue;
        // Constant width in meters: on a cone it takes more of the turn where the radius is smaller.
        const uc = -o.theta / (2 * Math.PI);
        const half = (x: number): number => o.w / (4 * Math.PI * rOf(x));
        const pts: P2[] = [
          [uc - half(o.x0), o.x0],
          [uc + half(o.x0), o.x0],
          [uc + half(o.x1), o.x1],
          [uc - half(o.x1), o.x1],
        ];
        const style = `rgba(0,0,0,${OPENING_ALPHA[o.kind]})`;
        // Drawn three times so an opening across u = 0 shows on both sides of the seam.
        for (const k of [-1, 0, 1]) {
          c.beginPath();
          pts.forEach(([u, x], i) => (i === 0 ? c.moveTo((u + k) * w, row(x)) : c.lineTo((u + k) * w, row(x))));
          c.closePath();
          if (o.kind === 'outline') {
            c.strokeStyle = style;
            c.lineWidth = 3;
            c.stroke();
          } else {
            c.fillStyle = style;
            c.fill();
          }
        }
      }
    },
  };
  draw(p);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Sprayed foam: soft blotches a little darker, wrapped around the seam. */
function foam(p: Painter, rnd: () => number, count: number): void {
  for (let i = 0; i < count; i++) {
    const x = rnd() * p.w;
    const y = rnd() * p.h;
    const rx = 3 + rnd() * 16;
    const ry = 3 + rnd() * 10;
    p.c.fillStyle = `rgba(0,0,0,${0.005 + rnd() * 0.018})`;
    for (const dx of [0, -p.w, p.w]) {
      if (dx !== 0 && Math.abs(x + dx - p.w / 2) > p.w / 2 + rx) continue;
      p.c.beginPath();
      p.c.ellipse(x + dx, y, rx, ry, 0, 0, Math.PI * 2);
      p.c.fill();
    }
  }
}

type TextureSet = Record<'cm' | 'cmGloss' | 'shield' | 'esm' | 'sa' | 'srb' | 'core' | 'intertank' | 'solar' | 'plume', THREE.Texture>;

function createTextures(colors: VehicleColors): TextureSet {
  const rnd = random(20260401);
  const core = paint(1024, 2048, TEX_RANGE.core ?? [0, 1], (p) => {
    foam(p, rnd, 9000);
    // Welds of the barrels and domes, and the joint with the LVSA.
    for (const x of [ST.boatTail, ST.engineSection, -64.7, -57.45, -50.2, -42.95, ST.intertankBottom, ST.intertankTop, -25.4, ST.loxTankTop, ST.coreTop, -14.1])
      p.ring(x, 3, 0.28);
    // Seams between barrel panels (every 30°) and between LVSA panels (every 45°).
    for (let k = 0; k < 12; k++) p.seam(k / 12 + 1 / 24, ST.engineSection, ST.loxTankTop, 2, 0.09);
    for (let k = 0; k < 8; k++) p.seam(k / 8 + 1 / 16, ST.coreTop, ST.lvsaTop, 2, 0.14);
    // Access doors on the forward skirt and on the engine section.
    for (const u of [0.1, 0.4, 0.65, 0.9]) p.patch(u, -19.35, -18.45, 0.027, 0.45);
    for (const u of [0.2, 0.45, 0.7, 0.95]) p.patch(u, -74.25, -73.35, 0.027, 0.45);
  });
  const intertank = paint(1024, 160, TEX_RANGE.intertank ?? [0, 1], (p) => {
    // Stringers under the foam and the flanges at both ends.
    for (let i = 0; i < 128; i++) p.seam(i / 128, ST.intertankBottom, ST.intertankTop, 3, 0.2);
    p.ring(ST.intertankBottom + 0.12, 8, 0.3);
    p.ring(ST.intertankTop - 0.12, 8, 0.3);
  });
  const srb = paint(512, 2048, TEX_RANGE.srb ?? [0, 1], (p) => {
    // Aft skirt stiffeners.
    for (let k = 0; k < 32; k++) p.seam(k / 32, -80.15, ST.srbSkirt, 2, 0.16);
    // Field joints of the five case segments, and the dark bands of the forward skirt and above the aft skirt.
    const segment = (-33 - ST.srbSkirt) / 5;
    for (let k = 0; k <= 5; k++) p.ring(ST.srbSkirt + k * segment, 3, 0.45);
    p.patch(0.5, -32.95, -32.45, 1, 0.88);
    p.patch(0.5, ST.srbSkirt + 0.05, ST.srbSkirt + 0.45, 1, 0.85);
    // Photo targets: black 2 × 2 checkers of 0.35 m.
    const du = 0.35 / (2 * Math.PI * RAD.srb);
    p.openings(SRB_OPENINGS, srbNoseR);
    for (const [x, u] of [
      [-37.5, 0.04],
      [-37.5, 0.54],
      [-46.5, 0.29],
      [-46.5, 0.79],
      [-55.5, 0.04],
      [-55.5, 0.54],
      [-64.5, 0.29],
      [-64.5, 0.79],
    ] as const) {
      p.patch(u - du / 2, x, x + 0.35, du, 0.92);
      p.patch(u + du / 2, x - 0.35, x, du, 0.92);
    }
  });
  const cm = paint(1024, 512, TEX_RANGE.cm ?? [0, 1], (p) => {
    // Back shell panels.
    for (let k = 0; k < 16; k++) p.seam(k / 16, 0.45, 3.06, 2, 0.2);
    for (const x of [1.05, 1.7, 2.35]) p.ring(x, 2, 0.18);
    p.openings(CM_OPENINGS, CAPSULE.shellR);
  });
  // Roughness of the back shell: the window panes are glossy.
  const cmGloss = paint(1024, 512, TEX_RANGE.cm ?? [0, 1], (p) => p.openings(CM_OPENINGS, CAPSULE.shellR, 'window'));
  const shield = paint(512, 512, TEX_RANGE.shield ?? [0, 1], (p) => {
    // Heat shield blocks in rings (darker towards the shoulder, as in the exploded view). The
    // stations of each ring come from its radius on the 9.9 m sphere.
    const xOf = (r: number): number => 9.9 - Math.sqrt(9.9 * 9.9 - r * r);
    const rings = [0.55, 1.1, 1.6, 2.0, 2.3];
    p.patch(0.5, xOf(2.3), 0.41, 1, 0.3);
    for (const r of rings) p.ring(xOf(r), 3, 0.45);
    rings.forEach((r, i) => {
      const n = [6, 12, 18, 24, 30, 36][i + 1];
      for (let k = 0; k < n; k++) p.seam((k + (i % 2) / 2) / n, xOf(r), xOf(rings[i + 1] ?? 2.42), 3, 0.4);
    });
    for (let k = 0; k < 6; k++) p.seam(k / 6, xOf(0.55), 0, 3, 0.4);
  });
  const esm = paint(1024, 512, TEX_RANGE.esm ?? [0, 1], (p) => {
    // Radiator panels (vertical tubes), with plain bands where the solar wings are hinged.
    const plain = (u: number): number => Math.min(...[0, 1, 2, 3].map((k) => Math.abs(u - (k / 4 + 1 / 8))));
    for (let i = 0; i < p.w; i += 6) if (plain(i / p.w) > 0.035) p.seam(i / p.w, -3.45, -1, 2, 0.16);
    for (let k = 0; k < 4; k++) for (const s of [-0.035, 0.035]) p.seam(k / 4 + 1 / 8 + s, ST.esmBottom, ST.esmTop, 2, 0.25);
    p.ring(-1, 2, 0.25);
    p.ring(-3.45, 2, 0.25);
  });
  const sa = paint(512, 128, TEX_RANGE.sa ?? [0, 1], (p) => {
    // Adapter panels and four access doors (exploded view).
    for (let k = 0; k < 8; k++) p.seam(k / 8, ST.osaTop, ST.esmBottom, 2, 0.2);
    for (let k = 0; k < 4; k++) p.patch(1 / 16 + k / 4, -4.55, -4.1, 0.05, 0.7);
  });
  const solar = paint(
    512,
    512,
    [0, 1],
    ({ c, w }) => {
      // Frame, and a grid of cells (16 × 16 per panel) with light gaps, as in the exploded view.
      const frame = 12;
      const n = 16;
      const cell = (w - 2 * frame) / n;
      c.fillStyle = mix(colors.hull, '#000000', 0.3);
      c.fillRect(0, 0, w, w);
      c.fillStyle = mix(colors.solar, '#ffffff', 0.3);
      c.fillRect(frame, frame, w - 2 * frame, w - 2 * frame);
      c.fillStyle = colors.solar;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c.fillRect(frame + i * cell + 1.5, frame + j * cell + 1.5, cell - 3, cell - 3);
    },
    true,
  );
  // Plume: bright at the nozzle (top row, v = 1) and fading towards its tip.
  const plume = paint(8, 256, [0, 1], ({ c, w, h }) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.3, '#b0b0b0');
    g.addColorStop(0.65, '#4a4a4a');
    g.addColorStop(1, '#000000');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
  return { cm, cmGloss, shield, esm, sa, srb, core, intertank, solar, plume };
}

interface Kit {
  readonly mats: Readonly<Record<Mat, THREE.Material>>;
  flame(glow: number, inner: boolean): THREE.Material;
  track<T extends { dispose(): void }>(x: T): T;
}

function createKit(colors: VehicleColors, anisotropy: number): Kit & { dispose(): void } {
  const items: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T): T => {
    items.push(x);
    return x;
  };
  const tex = createTextures(colors);
  for (const t of Object.values(tex)) {
    t.anisotropy = anisotropy;
    track(t);
  }
  const std = (color: string, more: THREE.MeshStandardMaterialParameters): THREE.Material =>
    track(new THREE.MeshStandardMaterial({ color, ...more }));
  const two = THREE.DoubleSide;
  const mats: Record<Mat, THREE.Material> = {
    hull: std(colors.hull, { roughness: 0.55, metalness: 0.05, side: two }),
    cm: std(colors.hull, { map: tex.cm, roughnessMap: tex.cmGloss, roughness: 0.45, metalness: 0.15 }),
    shield: std(mix(colors.dark, '#ffffff', 0.22), { map: tex.shield, roughness: 0.9 }),
    esm: std(colors.hull, { map: tex.esm, roughness: 0.5, metalness: 0.1 }),
    srb: std(colors.hull, { map: tex.srb, roughness: 0.6, metalness: 0.05 }),
    sa: std(colors.metal, { map: tex.sa, roughness: 0.45, metalness: 0.3, side: two }),
    metal: std(colors.metal, { roughness: 0.45, metalness: 0.3, side: two }),
    gold: std(colors.gold, { roughness: 0.35, metalness: 0.45 }),
    dark: std(colors.dark, { roughness: 0.5, metalness: 0.3, side: two }),
    core: std(colors.core, { map: tex.core, roughness: 0.85, side: two }),
    intertank: std(colors.core, { map: tex.intertank, roughness: 0.8 }),
    pipe: std(colors.core, { roughness: 0.8 }),
    solar: std('#ffffff', { map: tex.solar, roughness: 0.3, metalness: 0.25 }),
    solarBack: std(mix(colors.hull, '#000000', 0.35), { roughness: 0.6 }),
  };
  const flames = new Map<string, THREE.Material>();
  return {
    mats,
    flame(glow, inner) {
      const key = `${glow}|${inner}`;
      let m = flames.get(key);
      if (!m) {
        m = track(
          new THREE.MeshBasicMaterial({
            color: inner ? mix(colors.flame, '#ffffff', 0.55) : colors.flame,
            map: tex.plume,
            transparent: true,
            opacity: glow,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          }),
        );
        flames.set(key, m);
      }
      return m;
    },
    track,
    dispose: () => items.forEach((i) => i.dispose()),
  };
}

/**
 * The model and the jettisoned parts of a view share one kit (materials and textures): it is
 * built on the first request and released with the last.
 */
const kits = new Map<string, { kit: Kit & { dispose(): void }; users: number }>();
function acquireKit(colors: VehicleColors, anisotropy: number): { kit: Kit; release(): void } {
  const key = `${JSON.stringify(colors)}|${anisotropy}`;
  let entry = kits.get(key);
  if (!entry) {
    entry = { kit: createKit(colors, anisotropy), users: 0 };
    kits.set(key, entry);
  }
  entry.users++;
  const e = entry;
  let released = false;
  return {
    kit: e.kit,
    release() {
      if (released) return;
      released = true;
      if (--e.users === 0) {
        e.kit.dispose();
        kits.delete(key);
      }
    },
  };
}

export interface VehicleModel {
  /**
   * Group to orient and position. Its origin is the vehicle's center in the current
   * configuration or, with `anchorBase`, the base (the nozzles), so the rocket rests on the pad.
   */
  readonly group: THREE.Group;
  /** Shows the attached parts and the flames of the firing engines. Returns the current length (m). */
  update(cfg: VehicleConfig, running: readonly EngineId[], anchorBase?: boolean): number;
  dispose(): void;
}

/** Procedural 3D model of the whole spacecraft, with its parts and the engine flames. */
export function createVehicleModel(colors: VehicleColors, anisotropy = 1): VehicleModel {
  const { kit, release } = acquireKit(colors, anisotropy);
  const group = new THREE.Group();
  const stack = new THREE.Group();
  group.add(stack);
  const parts = new Map<PartId, THREE.Group>();
  for (const id of Object.keys(EXTENT) as PartId[]) {
    const g = buildPart(id, kit);
    parts.set(id, g);
    stack.add(g);
  }
  const flames = new Map<EngineId, THREE.Object3D[]>(
    (Object.keys(FLAMES) as EngineId[]).map((id) => [id, FLAMES[id].map((f) => flame(kit, f))]),
  );
  for (const list of flames.values()) for (const f of list) stack.add(f);

  return {
    group,
    update(cfg, running, anchorBase = false) {
      const present = partsOf(cfg);
      for (const [id, g] of parts) g.visible = present.includes(id);
      const deployed = arraysDeployed(cfg);
      parts.get('SM')?.children.forEach((c) => {
        if (c.name === 'array') c.visible = deployed;
      });
      for (const [id, list] of flames) for (const f of list) f.visible = running.includes(id);
      const ext = vehicleExtent(cfg);
      stack.position.x = anchorBase ? -ext.x0 : -ext.center;
      return ext.length;
    },
    dispose: release,
  };
}

export interface DebrisModels {
  /** Model of jettisoned part `id`, centered on its own center. Created the first time. */
  get(id: string): THREE.Group;
  dispose(): void;
}

export function createDebrisModels(colors: VehicleColors, anisotropy = 1): DebrisModels {
  const { kit, release } = acquireKit(colors, anisotropy);
  const cache = new Map<string, THREE.Group>();
  return {
    get(id) {
      let g = cache.get(id);
      if (!g && isCubesat(id)) {
        g = new THREE.Group();
        g.add(new THREE.Mesh(kit.track(new THREE.BoxGeometry(CUBESAT_SIZE.x, CUBESAT_SIZE.y, CUBESAT_SIZE.z)), kit.mats.metal));
        cache.set(id, g);
      }
      if (!g) {
        const part = DEBRIS_PART[id] ?? 'SM';
        const e = EXTENT[part];
        const inner = buildPart(part, kit);
        inner.position.set(-(e.x0 + e.x1) / 2, -e.y, 0);
        g = new THREE.Group();
        g.add(inner);
        cache.set(id, g);
      }
      return g;
    },
    dispose: release,
  };
}

// ---------- 2D icons ----------

/**
 * The 2D icon is the same spacecraft as the 3D model, seen from +z (as the map looks): each
 * revolution piece is seen as its outline and each solar wing as its projection. That way it
 * changes with the same pieces as the 3D model and with its real proportions.
 */
type Pt = readonly [number, number];
interface Shape {
  readonly pts: readonly Pt[];
  readonly cls: string;
}

/** Drawing order: whatever sits inside another piece in 3D goes first (the ICPS nozzle inside the core stage adapter, the capsule under the tower). */
const DRAW_ORDER: readonly PartId[] = ['SM', 'CM', 'ICPS', 'CORE', 'SRB_L', 'SRB_R', 'FAIRING', 'LAS'];
const ALL_PARTS = Object.keys(EXTENT) as PartId[];

/** Outline of a piece seen from the side (an arc counts as a whole turn); a flat ring shows nothing. */
function pieceShape(p: Piece): Shape | null {
  const xs = p.pts.map((q) => q[0]);
  if (Math.max(...xs) - Math.min(...xs) < 1e-3) return null;
  const y = p.y ?? 0;
  return {
    pts: [...p.pts.map(([x, r]): Pt => [x, y + r]), ...[...p.pts].reverse().map(([x, r]): Pt => [x, y - r])],
    cls: ICON_CLASS[p.mat],
  };
}

const partShapes = (id: PartId): Shape[] =>
  PROFILE[id].filter((p) => p.icon !== false).flatMap((p) => {
    const s = pieceShape(p);
    return s ? [s] : [];
  });

/** Solar wings (the panels, from the yoke to the tip) projected onto the plane: `near` = the ones on the camera side (+z). */
function wingShapes(near: boolean): Shape[] {
  const { x, root, yoke, panel, tilt } = WING;
  return ARM_ANGLES.filter((a) => Math.sin(a) > 0 === near).map((a) => ({
    pts: ([
      [-1, yoke],
      [1, yoke],
      [1, WING_TIP],
      [-1, WING_TIP],
    ] as const).map(([su, v]): Pt => {
      const u = (su * panel) / 2;
      return [x - v * Math.sin(tilt), (root + v * Math.cos(tilt)) * Math.cos(a) + u * Math.sin(a)];
    }),
    cls: near ? 'solar' : 'solar far',
  }));
}

function sideView(parts: readonly PartId[], arrays: boolean): Shape[] {
  const out: Shape[] = arrays ? wingShapes(false) : [];
  for (const id of DRAW_ORDER) {
    if (!parts.includes(id)) continue;
    out.push(...partShapes(id));
    if (id === 'SM' && arrays) out.push(...wingShapes(true));
  }
  return out;
}

/** Narrowest flame drawn in the icon (m): the auxiliary engines and the RCS would be invisible at map scale. */
const ICON_FLAME_MIN = 0.3;

const flameShape = (f: Flame): Shape => {
  const r = Math.max(f.radius, ICON_FLAME_MIN);
  return {
    pts: [
      [f.x, f.y - r],
      [f.x - f.len, f.y - 0.05],
      [f.x - f.len, f.y + 0.05],
      [f.x, f.y + r],
    ],
    cls: 'flame',
  };
};

function extentOf(parts: readonly PartId[]): { x0: number; x1: number } {
  return { x0: Math.min(...parts.map((p) => EXTENT[p].x0)), x1: Math.max(...parts.map((p) => EXTENT[p].x1)) };
}
const lengthOf = (parts: readonly PartId[]): number => {
  const e = extentOf(parts);
  return e.x1 - e.x0;
};

/**
 * On-screen size: the full rocket measures `ICON_FULL_PX` and each configuration, according
 * to its length raised to `ICON_POWER` (a drawing choice, not data). At linear scale the
 * capsule alone would be 29 times shorter than the rocket; this way it is ~4.5 times shorter and
 * still visible. Within each configuration the proportions are real.
 */
const ICON_FULL_PX = 72;
const ICON_POWER = 0.45;
/** Minimum side (px) of an icon, so a small piece (a CubeSat) does not disappear. */
const ICON_MIN_PX = 5;
const FULL_LENGTH = lengthOf(ALL_PARTS);
const pxPerMeter = (lengthM: number): number => (ICON_FULL_PX * Math.pow(lengthM / FULL_LENGTH, ICON_POWER)) / lengthM;

const fmt = (n: number): string => n.toFixed(2);
const pathOf = (s: Shape): string => `<path d="M ${s.pts.map(([x, y]) => `${fmt(x)} ${fmt(-y)}`).join(' L ')} Z" class="${s.cls}"/>`;

/**
 * SVG with the spacecraft axis towards +x, centered on the pieces (the flames extend past the box).
 * It measures `pxPerM` pixels per meter, multiplied by `--icon-k` (the inset shrinks it).
 */
function iconSvg(shapes: readonly Shape[], flames: readonly Shape[], pxPerM: number): string {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const s of shapes)
    for (const [x, y] of s.pts) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  const w = x1 - x0;
  const h = y1 - y0;
  const k = Math.max(pxPerM, ICON_MIN_PX / Math.max(w, h));
  const size = (m: number): string => `calc(var(--icon-k, 1) * ${(m * k).toFixed(1)}px)`;
  // `data-r`: icon radius in px (without `--icon-k`), to know when it overlaps another one.
  const radius = (Math.max(w, h) * k) / 2;
  // In SVG the y axis points down: it is flipped (y = −y) so the local +y side ends up to the left of the heading.
  return (
    `<svg viewBox="${fmt(x0)} ${fmt(-y1)} ${fmt(w)} ${fmt(h)}" class="ship-icon" data-r="${radius.toFixed(1)}" style="width:${size(w)};height:${size(h)}">` +
    `${[...flames, ...shapes].map(pathOf).join('')}</svg>`
  );
}

/**
 * 2D icon of the spacecraft, pointing towards +x: the same pieces as the 3D model in the
 * current stage (full rocket, without boosters, without tower, ICPS + Orion, Orion, capsule
 * alone), with the solar arrays deployed in orbit and the flame of each firing engine.
 */
export function vehicleIconSvg(cfg: VehicleConfig, running: readonly EngineId[]): string {
  const parts = partsOf(cfg);
  // Seen from +z, the nozzles on the far side (z < 0) fall on top of the near ones.
  const flames = running.flatMap((id) => FLAMES[id].filter((f) => f.z >= 0).map(flameShape));
  // The arrays are mounted on the service module: with the capsule alone they left with it.
  const arrays = arraysDeployed(cfg) && parts.includes('SM');
  return iconSvg(sideView(parts, arrays), flames, pxPerMeter(lengthOf(parts)));
}

/** Piece that represents each type of jettisoned part. */
const DEBRIS_KIND_PART: Readonly<Record<Exclude<DebrisKind, 'CUBESAT'>, PartId>> = {
  SRB: 'SRB_L',
  LAS: 'LAS',
  FAIRING: 'FAIRING',
  CORE: 'CORE',
  ICPS: 'ICPS',
  SM: 'SM',
};

/**
 * Configuration each part is jettisoned from: the part's icon uses the same
 * scale, so on separation it looks the size it had while attached to the spacecraft.
 */
const DEBRIS_PARENT: Readonly<Record<DebrisKind, readonly PartId[]>> = {
  SRB: ALL_PARTS,
  LAS: ALL_PARTS.filter((p) => p !== 'SRB_L' && p !== 'SRB_R'),
  FAIRING: ALL_PARTS.filter((p) => p !== 'SRB_L' && p !== 'SRB_R'),
  CORE: ['CM', 'SM', 'ICPS', 'CORE'],
  ICPS: ['CM', 'SM', 'ICPS'],
  SM: ['CM', 'SM'],
  CUBESAT: ['ICPS'],
};

/** 2D icon of a jettisoned part, centered on its own center (like its 3D model). */
export function debrisIconSvg(kind: DebrisKind): string {
  const scale = pxPerMeter(lengthOf(DEBRIS_PARENT[kind]));
  if (kind === 'CUBESAT') {
    const { x, y } = CUBESAT_SIZE;
    return iconSvg(
      [
        {
          pts: [
            [-x / 2, -y / 2],
            [x / 2, -y / 2],
            [x / 2, y / 2],
            [-x / 2, y / 2],
          ],
          cls: 'hull',
        },
      ],
      [],
      scale,
    );
  }
  const part = DEBRIS_KIND_PART[kind];
  const e = EXTENT[part];
  const dx = -(e.x0 + e.x1) / 2;
  const shapes = sideView([part], part === 'SM').map((s) => ({ ...s, pts: s.pts.map(([x, y]): Pt => [x + dx, y - e.y]) }));
  return iconSvg(shapes, [], scale);
}
