import { BodyState } from './bodies';
import { Vec3, cross, dot, length, normalize, rotateAbout, scale, sub, vec3 } from './math/vec3';

/**
 * Three-axis attitude: frames, Euler angles and rotations between frames.
 *
 * Body axes follow the usual spacecraft convention (Orion, Shuttle): +X along the
 * thrust axis (towards the nose), +Y the pitch axis ("right wing") and +Z = X × Y
 * (the "belly"). With zero roll and yaw relative to LVLH, +Y points against the
 * orbital angular momentum and +Z towards the body below.
 */

/** Right-handed orthonormal frame: three unit axes expressed in the inertial frame. */
export interface Axes {
  readonly x: Vec3;
  readonly y: Vec3;
  readonly z: Vec3;
}

/** Euler angles (rad) in the pitch → yaw → roll sequence. */
export interface Euler {
  /** Rotation about the reference Y axis; positive = nose up (towards −Z). Range ±π. */
  readonly pitch: number;
  /** Rotation about the pitched Z axis; positive = nose towards +Y. Range ±π/2. */
  readonly yaw: number;
  /** Rotation about the body X axis; positive = right-handed about X. Range ±π. */
  readonly roll: number;
}

/** Normal of the model plane (the Moon's orbital plane). */
const PLANE_NORMAL = vec3(0, 0, 1);

/** Builds a frame from its X axis and an approximate Y axis (re-orthogonalized). */
export function axesFrom(x: Vec3, yApprox: Vec3): Axes {
  const xn = normalize(x);
  const y = normalize(sub(yApprox, scale(xn, dot(yApprox, xn))));
  return { x: xn, y, z: cross(xn, y) };
}

/**
 * LVLH frame (local vertical, local horizontal) relative to a body, as Orion and the
 * Shuttle define it: Z towards the body's center (nadir), Y against the orbital angular
 * momentum and X = Y × Z (the local horizontal, towards the motion).
 */
export function lvlh(r: Vec3, v: Vec3, body: BodyState): Axes {
  const rRel = sub(r, body.r);
  const vRel = sub(v, body.v);
  const z = normalize(scale(rRel, -1));
  const h = cross(rRel, vRel);
  // Purely radial motion (or at rest): the model plane's normal stands in for the orbit normal.
  const normal = length(h) > 1e-9 * length(rRel) * length(vRel) && length(h) > 0 ? normalize(h) : PLANE_NORMAL;
  const y = normalize(sub(scale(normal, -1), scale(z, -dot(normal, z))));
  return { x: cross(y, z), y, z };
}

/**
 * Inertial reference of the attitude display. The model has no celestial frame (it lives in
 * one plane), so it uses the pad's LVLH at T‑0, frozen: X east, Y towards −z, Z down.
 * At liftoff both references give the same angles (drawing choice, not a NASA convention).
 */
export const INERTIAL_REF: Axes = { x: vec3(-1, 0, 0), y: vec3(0, 0, -1), z: vec3(0, -1, 0) };

/** Components of an inertial vector in a frame. */
export const toFrame = (a: Axes, v: Vec3): Vec3 => vec3(dot(v, a.x), dot(v, a.y), dot(v, a.z));

/** Inertial vector from its components in a frame. */
export const fromFrame = (a: Axes, c: Vec3): Vec3 =>
  vec3(
    a.x.x * c.x + a.y.x * c.y + a.z.x * c.z,
    a.x.y * c.x + a.y.y * c.y + a.z.y * c.z,
    a.x.z * c.x + a.y.z * c.y + a.z.z * c.z,
  );

/** Euler angles of the body frame relative to a reference frame. */
export function eulerOf(body: Axes, ref: Axes): Euler {
  const x1 = dot(body.x, ref.x);
  const x2 = dot(body.x, ref.y);
  const x3 = dot(body.x, ref.z);
  const pitch = Math.atan2(-x3, x1);
  const yaw = Math.asin(Math.max(-1, Math.min(1, x2)));
  // Zero-roll Y axis: the reference Y projected perpendicular to the body X axis.
  const y0raw = sub(ref.y, scale(body.x, x2));
  const ly = length(y0raw);
  if (ly < 1e-9) return { pitch, yaw, roll: 0 };
  const y0 = scale(y0raw, 1 / ly);
  const z0 = cross(body.x, y0);
  return { pitch, yaw, roll: Math.atan2(dot(body.y, z0), dot(body.y, y0)) };
}

/** Body frame with the given Euler angles relative to a reference frame. */
export function axesFromEuler(e: Euler, ref: Axes): Axes {
  let x = rotateAbout(ref.x, ref.y, e.pitch);
  let y = ref.y;
  const z = rotateAbout(ref.z, ref.y, e.pitch);
  x = rotateAbout(x, z, e.yaw);
  y = rotateAbout(y, z, e.yaw);
  y = rotateAbout(y, x, e.roll);
  return axesFrom(x, y);
}

/**
 * Frame with its X axis along `dir` and no roll relative to `ref` (its Y as close as possible to
 * the reference Y). If `dir` lies along the reference Y, keeps `fallbackY` instead.
 */
export function alignedAxes(dir: Vec3, ref: Axes, fallbackY: Vec3): Axes {
  const y = sub(ref.y, scale(dir, dot(ref.y, dir)));
  if (length(y) > 1e-6) return axesFrom(dir, y);
  const fb = sub(fallbackY, scale(dir, dot(fallbackY, dir)));
  return axesFrom(dir, length(fb) > 1e-6 ? fb : ref.z);
}

/** Rotates the three axes of a frame about a unit axis. */
export function rotateAxes(a: Axes, axis: Vec3, angle: number): Axes {
  return axesFrom(rotateAbout(a.x, axis, angle), rotateAbout(a.y, axis, angle));
}

/**
 * Single rotation (unit axis, angle in [0, π]) that takes frame `a` to frame `b`.
 * Goes through the quaternion of R = Σ bᵢ aᵢᵀ (Shepperd's method), stable near π.
 */
export function rotationBetween(a: Axes, b: Axes): { axis: Vec3; angle: number } {
  const A = [a.x, a.y, a.z].map((v) => [v.x, v.y, v.z]);
  const B = [b.x, b.y, b.z].map((v) => [v.x, v.y, v.z]);
  const R = [0, 1, 2].map((j) => [0, 1, 2].map((k) => B[0][j] * A[0][k] + B[1][j] * A[1][k] + B[2][j] * A[2][k]));
  const tr = R[0][0] + R[1][1] + R[2][2];
  let w: number;
  let x: number;
  let y: number;
  let z: number;
  if (tr > 0) {
    const S = Math.sqrt(tr + 1) * 2;
    w = 0.25 * S;
    x = (R[2][1] - R[1][2]) / S;
    y = (R[0][2] - R[2][0]) / S;
    z = (R[1][0] - R[0][1]) / S;
  } else if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) {
    const S = Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) * 2;
    w = (R[2][1] - R[1][2]) / S;
    x = 0.25 * S;
    y = (R[0][1] + R[1][0]) / S;
    z = (R[0][2] + R[2][0]) / S;
  } else if (R[1][1] > R[2][2]) {
    const S = Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]) * 2;
    w = (R[0][2] - R[2][0]) / S;
    x = (R[0][1] + R[1][0]) / S;
    y = 0.25 * S;
    z = (R[1][2] + R[2][1]) / S;
  } else {
    const S = Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]) * 2;
    w = (R[1][0] - R[0][1]) / S;
    x = (R[0][2] + R[2][0]) / S;
    y = (R[1][2] + R[2][1]) / S;
    z = 0.25 * S;
  }
  if (w < 0) {
    w = -w;
    x = -x;
    y = -y;
    z = -z;
  }
  const sinHalf = Math.hypot(x, y, z);
  const angle = 2 * Math.atan2(sinHalf, w);
  return { axis: sinHalf > 1e-12 ? vec3(x / sinHalf, y / sinHalf, z / sinHalf) : PLANE_NORMAL, angle };
}

/** Wraps an angle in degrees to [0, 360), as the cockpit tapes show it. */
export const deg360 = (rad: number): number => ((((rad * 180) / Math.PI) % 360) + 360) % 360;
