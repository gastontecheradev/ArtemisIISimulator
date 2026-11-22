import * as THREE from 'three';
import { PAD_ELEVATION, PAD_SLOPE_RUN, PAD_TOP_RADIUS, R_EARTH } from '../sim/constants';
import { Vec3, rotateZ, vec3 } from '../sim/math/vec3';

/*
 * The ground around the launch pad in the 3D view (launch plan, §4.2).
 *
 * Earth is a unit sphere scaled to 6,378 km: in float32 its surface lands within ~0.5 m, and near
 * the pad that is enough to make a flat ground flicker against it. This ground is a mesh of its own,
 * in meters, in the pad's east-north-up frame and with its own floating origin (the sea-level point
 * under the launch site), with the real curvature and the elevated pad as relief. Earth discards its
 * fragments inside GROUND_RADIUS_M (bodies.ts), so the two never overlap.
 *
 * Drawing: the color goes in the main pass, with the same lights and texture as Earth so the two
 * blend. It is drawn right after the atmosphere, which ends its lines of sight on the sea-level
 * sphere and would otherwise paint the sky over the elevated pad (from the ground it is above the
 * horizon), and it adds the same haze itself (atmosphere.ts). The exhaust wake comes after it and
 * is hidden by it where it should be. The spacecraft pass writes the ground's depth again with its
 * own close far plane (scene.ts), so it hides the spacecraft and, later, the pad at millimeter
 * precision. Until the layout of stage 6 it wears Earth's texture.
 */

/**
 * Radius of the pad's ground (m). Drawing choice: from a camera 2 m above the ground the horizon is
 * 5.05 km away, so beyond this the sphere is enough.
 */
export const GROUND_RADIUS_M = 5000;
export const GROUND_SECTORS = 256;
/**
 * How far the ground reaches past the circle Earth discards (m). Earth's surface lands within
 * ~0.5 m in float32, so with the edges just touching, cracks opened along the seam (seen from above
 * as a dotted line). In this band both are drawn, with the same texture and light.
 */
const GROUND_OVERLAP_M = 10;
/** Depth of the skirt that hangs from the edge and covers any crack with Earth (m). */
const SKIRT_M = 50;
/** Earth's radius in meters. */
const R_M = R_EARTH * 1000;

/**
 * The pad's east, north and up in the local axes of Earth's mesh (bodies.ts, `earthGeoMatrix`):
 * local +y is the pad, local −x the direction the rocket flies at the pad (the model plane's
 * azimuth, east) and local +z the plane's normal (north at the pad). A test checks them against
 * the geographic directions at LC‑39B.
 */
export const PAD_ENU_LOCAL: { readonly east: Vec3; readonly north: Vec3; readonly up: Vec3 } = {
  east: vec3(-1, 0, 0),
  north: vec3(0, 0, 1),
  up: vec3(0, 1, 0),
};

/** The pad's east, north and up in the drawing frame, with Earth's mesh turned `earthRotation` about z. */
export function padAxes(earthRotation: number): { east: Vec3; north: Vec3; up: Vec3 } {
  return {
    east: rotateZ(PAD_ENU_LOCAL.east, earthRotation),
    north: rotateZ(PAD_ENU_LOCAL.north, earthRotation),
    up: rotateZ(PAD_ENU_LOCAL.up, earthRotation),
  };
}

/**
 * Height of the ground above the sea-level sphere (m) at an arc distance `rho` (m) from the launch
 * point: the elevated pad (PAD_TOP_RADIUS, PAD_SLOPE_RUN, assumptions) with a cosine shoulder.
 */
export function padRelief(rho: number): number {
  const top = PAD_TOP_RADIUS * 1000;
  const run = PAD_SLOPE_RUN * 1000;
  const h = PAD_ELEVATION * 1000;
  if (rho <= top) return h;
  if (rho >= top + run) return 0;
  return h * 0.5 * (1 + Math.cos((Math.PI * (rho - top)) / run));
}

/** Slope of `padRelief` (dh/drho). */
function padReliefSlope(rho: number): number {
  const top = PAD_TOP_RADIUS * 1000;
  const run = PAD_SLOPE_RUN * 1000;
  if (rho <= top || rho >= top + run) return 0;
  return -PAD_ELEVATION * 1000 * 0.5 * (Math.PI / run) * Math.sin((Math.PI * (rho - top)) / run);
}

/**
 * Point at arc distance `rho` (m, along the sea-level sphere) from the launch point, towards
 * `azimuth` (rad from north, east positive), at `height` (m) above the sphere. East-north-up meters
 * from the sea-level point under the launch site: x east, y north, z up (with the curvature).
 */
export function surfacePoint(rho: number, azimuth: number, height: number): Vec3 {
  const a = rho / R_M;
  const horizontal = (R_M + height) * Math.sin(a);
  // (R + h)·cos a − R, without the cancellation.
  const up = height * Math.cos(a) - 2 * R_M * Math.sin(a / 2) ** 2;
  return vec3(horizontal * Math.sin(azimuth), horizontal * Math.cos(azimuth), up);
}

/** The ground's surface (with the relief) at arc distance `rho` towards `azimuth`. */
export const groundPoint = (rho: number, azimuth: number): Vec3 => surfacePoint(rho, azimuth, padRelief(rho));

/**
 * A point (east-north-up m) lifted, along its vertical, to at least `margin` m above the ground,
 * if it is over the pad's ground. Returns the same object when nothing changes.
 */
export function liftAboveGround(p: Vec3, margin: number): Vec3 {
  const cz = p.z + R_M;
  const horizontal = Math.hypot(p.x, p.y);
  const rho = Math.atan2(horizontal, cz) * R_M;
  if (rho > GROUND_RADIUS_M) return p;
  const r = Math.hypot(horizontal, cz);
  const min = R_M + padRelief(rho) + margin;
  if (r >= min) return p;
  const k = min / r;
  return vec3(p.x * k, p.y * k, cz * k - R_M);
}

/**
 * The pad camera (PLATAFORMA): a fixed camera on the ground around the pad. Drawing choices: 400 m
 * from the launch point (outside the elevated pad), at eye height, towards the south-southwest. From
 * there the Sun, low in the west at liftoff, lights the side the camera sees, the rocket flies to the
 * right (east), and no lightning mast stands on the line of sight (the nearest, at 221° and 157 m per
 * OpenStreetMap, is 56 m to one side of it; launch plan, §2). The launch photo taken from the
 * south-southwest frames the rocket the same way.
 */
export const PAD_CAMERA = { distance: 400, azimuthDeg: 200, eyeHeight: 2 } as const;

/** Eye of the pad camera, in east-north-up meters from the sea-level point under the launch site. */
export function padCameraEye(): Vec3 {
  const az = (PAD_CAMERA.azimuthDeg * Math.PI) / 180;
  return surfacePoint(PAD_CAMERA.distance, az, padRelief(PAD_CAMERA.distance) + PAD_CAMERA.eyeHeight);
}

/** Radii of the ground's rings (m): fine across the elevated pad, then growing 5 % per ring to the edge. */
export function groundRings(): number[] {
  // The outer polygon circumscribes a circle GROUND_OVERLAP_M past the one Earth discards.
  const edge = (GROUND_RADIUS_M + GROUND_OVERLAP_M) / Math.cos(Math.PI / GROUND_SECTORS);
  const fine = 2.5;
  const fineUntil = (PAD_TOP_RADIUS + PAD_SLOPE_RUN) * 1000 + 30;
  const rings = [0];
  let r = 0;
  while (r + fine <= fineUntil) {
    r += fine;
    rings.push(r);
  }
  let step = fine;
  while (r < edge) {
    step *= 1.05;
    r = Math.min(edge, r + step);
    rings.push(r);
  }
  return rings;
}

/**
 * Ground mesh: positions in east-north-up meters, normals, `geoDir` (the direction from Earth's
 * center in the local axes of Earth's mesh, which the texture is sampled with, as on Earth) and a
 * skirt hanging from the edge. Triangles face up (and the skirt outwards).
 */
export function buildGroundGeometry(): THREE.BufferGeometry {
  const rings = groundRings();
  const cols = GROUND_SECTORS + 1;
  const edge = rings[rings.length - 1];
  // Rows: the rings, then the edge again (with horizontal normals) and the bottom of the skirt.
  const rows: { rho: number; height: number; skirt: boolean }[] = rings.map((rho) => ({ rho, height: padRelief(rho), skirt: false }));
  rows.push({ rho: edge, height: 0, skirt: true }, { rho: edge, height: -SKIRT_M, skirt: true });
  const n = rows.length * cols;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const geoDirs = new Float32Array(n * 3);
  let k = 0;
  for (const row of rows) {
    const a = row.rho / R_M;
    const slope = row.skirt ? 0 : padReliefSlope(row.rho);
    for (let j = 0; j < cols; j++) {
      const az = (2 * Math.PI * j) / GROUND_SECTORS;
      const p = surfacePoint(row.rho, az, row.height);
      // Radial (up at that point) and horizontal-outwards unit vectors there.
      const sx = Math.sin(az);
      const sy = Math.cos(az);
      const radial = vec3(Math.sin(a) * sx, Math.sin(a) * sy, Math.cos(a));
      const outward = vec3(Math.cos(a) * sx, Math.cos(a) * sy, -Math.sin(a));
      // Normal of the height field over the sphere: radial·(R + h)/R − (dh/drho)·outward. The skirt faces out.
      const nr = row.skirt ? outward : vec3(
        radial.x * (1 + row.height / R_M) - slope * outward.x,
        radial.y * (1 + row.height / R_M) - slope * outward.y,
        radial.z * (1 + row.height / R_M) - slope * outward.z,
      );
      const nl = Math.hypot(nr.x, nr.y, nr.z);
      positions.set([p.x, p.y, p.z], k * 3);
      normals.set([nr.x / nl, nr.y / nl, nr.z / nl], k * 3);
      // In Earth-mesh local axes: east = −x, north = +z, up = +y, from Earth's center.
      const g = vec3(-p.x, R_M + p.z, p.y);
      const gl = Math.hypot(g.x, g.y, g.z);
      geoDirs.set([g.x / gl, g.y / gl, g.z / gl], k * 3);
      k++;
    }
  }
  const index: number[] = [];
  const quad = (i: number, j: number, skipFirst: boolean): void => {
    const b = i * cols + j;
    const a = b + 1;
    const c = b + cols;
    const d = c + 1;
    // Counterclockwise seen from above (azimuth grows clockwise from north).
    if (!skipFirst) index.push(b, a, d);
    index.push(b, d, c);
  };
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < GROUND_SECTORS; j++) quad(i, j, i === 0);
  for (let j = 0; j < GROUND_SECTORS; j++) quad(rings.length, j, false);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('geoDir', new THREE.BufferAttribute(geoDirs, 3));
  // Not used (the texture goes by geographic direction), but the material's program reads it.
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  return geometry;
}

export interface PadGround {
  /** The ground with its color, for the main pass. */
  readonly mesh: THREE.Mesh;
  /** The same ground writing only its depth, for the spacecraft pass. */
  readonly depth: THREE.Mesh;
  /**
   * Places the ground: `origin` is the sea-level point under the launch site in scene units, the
   * axes are the pad's east, north and up in the drawing frame, `metersToScene` the scale.
   */
  place(origin: THREE.Vector3, axes: { east: Vec3; north: Vec3; up: Vec3 }, metersToScene: number): void;
  dispose(): void;
}

/** The pad's ground with `material` (Earth's lit material, sampling by `geoDir`; see bodies.ts). */
export function createPadGround(material: THREE.Material): PadGround {
  const geometry = buildGroundGeometry();
  // In the transparent queue only for its place in it: after the atmosphere (−1), before the
  // exhaust wake and the lines (0). It stays opaque (opacity 1) and writes its depth.
  material.transparent = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -0.5;
  const depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });
  const depth = new THREE.Mesh(geometry, depthMaterial);
  depth.matrixAutoUpdate = false;
  const basis = new THREE.Matrix4();
  const e = new THREE.Vector3();
  const nn = new THREE.Vector3();
  const u = new THREE.Vector3();
  return {
    mesh,
    depth,
    place(origin, axes, metersToScene) {
      mesh.position.copy(origin);
      basis.makeBasis(e.set(axes.east.x, axes.east.y, axes.east.z), nn.set(axes.north.x, axes.north.y, axes.north.z), u.set(axes.up.x, axes.up.y, axes.up.z));
      mesh.quaternion.setFromRotationMatrix(basis);
      mesh.scale.setScalar(metersToScene);
    },
    dispose() {
      geometry.dispose();
      depthMaterial.dispose();
    },
  };
}
