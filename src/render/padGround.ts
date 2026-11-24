import * as THREE from 'three';
import { FLAME_TRENCH, ML1, PAD_ELEVATION, PAD_SLOPE_RUN, PAD_TOP_NORTH, PAD_TOP_RADIUS, PAD_TOP_SOUTH, R_EARTH } from '../sim/constants';
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
 * own close far plane (scene.ts), so it hides the spacecraft and the pad at millimeter precision.
 * Its colors are Earth's texture with the ground's own layout over it (padLayout.ts: concrete, grass,
 * roads, the crawlerway, the beach and the sea), which fades into that texture before the edge.
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

const TOP_M = PAD_TOP_RADIUS * 1000;
const RUN_M = PAD_SLOPE_RUN * 1000;
const PAD_M = PAD_ELEVATION * 1000;
/** Ends of the elevated pad's spine (m north of the launch point): its top is every point within TOP_M of it. */
const SPINE = { south: -PAD_TOP_SOUTH * 1000, north: PAD_TOP_NORTH * 1000 } as const;
/** Farthest the elevated pad reaches from the launch point (m). */
export const PAD_REACH_M = Math.max(-SPINE.south, SPINE.north) + TOP_M + RUN_M;

/** Horizontal distance (m) from (east, north) to the elevated pad's spine, and the unit vector away from it. */
function fromSpine(east: number, north: number): { d: number; ue: number; un: number } {
  const dn = north - Math.min(SPINE.north, Math.max(SPINE.south, north));
  const d = Math.hypot(east, dn);
  return d > 1e-9 ? { d, ue: east / d, un: dn / d } : { d: 0, ue: 0, un: 0 };
}

/**
 * Height of the ground above the sea-level sphere (m) at `east`, `north` (m from the launch point):
 * the elevated pad (constants.ts, assumptions) with a cosine shoulder. The flame trench is cut out
 * of it separately (TRENCH, render/pad.ts).
 */
export function padRelief(east: number, north: number): number {
  const { d } = fromSpine(east, north);
  if (d <= TOP_M) return PAD_M;
  if (d >= TOP_M + RUN_M) return 0;
  return PAD_M * 0.5 * (1 + Math.cos((Math.PI * (d - TOP_M)) / RUN_M));
}

/** Gradient of `padRelief` (dh/d east, dh/d north). */
function padReliefGradient(east: number, north: number): [number, number] {
  const { d, ue, un } = fromSpine(east, north);
  if (d <= TOP_M || d >= TOP_M + RUN_M) return [0, 0];
  const slope = -PAD_M * 0.5 * (Math.PI / RUN_M) * Math.sin((Math.PI * (d - TOP_M)) / RUN_M);
  return [slope * ue, slope * un];
}

/**
 * The flame trench, in meters from the launch point (launch plan §4.3): it runs north from under the
 * rocket with the [39B] width and depth. Its south end is the top of the flame deflector, 0.8 m south of
 * the deck opening (drawing choice: the deflector turns the plume from straight down to due north over
 * the trench's depth); its north end is where its floor meets the slope (PAD_TOP_NORTH). While the pad
 * is drawn, the ground leaves this rectangle out and render/pad.ts draws the walls, floor and deflector.
 * The south side of the trench (old concrete, [39B]) is not drawn: no source gives its size.
 */
export const TRENCH = {
  halfWidth: FLAME_TRENCH.width * 500,
  south: -(ML1.openingWidth * 500 + 0.8),
  north: FLAME_TRENCH.length * 1000,
  floor: (PAD_ELEVATION - FLAME_TRENCH.depth) * 1000,
} as const;

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
export const groundPoint = (rho: number, azimuth: number): Vec3 =>
  surfacePoint(rho, azimuth, padRelief(rho * Math.sin(azimuth), rho * Math.cos(azimuth)));

/**
 * Up coordinate (m, east-north-up from the sea-level point under the launch site) of the ground's
 * surface at `east`, `north`, with the relief and the curvature: where something standing there rests.
 */
export function groundZ(east: number, north: number): number {
  return surfacePoint(Math.hypot(east, north), Math.atan2(east, north), padRelief(east, north)).z;
}

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
  const min = R_M + padRelief(p.x, p.y) + margin;
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
  const d = PAD_CAMERA.distance;
  return surfacePoint(d, az, padRelief(d * Math.sin(az), d * Math.cos(az)) + PAD_CAMERA.eyeHeight);
}

/** Radii of the ground's rings (m): fine across the elevated pad, then growing 5 % per ring to the edge. */
export function groundRings(): number[] {
  // The outer polygon circumscribes a circle GROUND_OVERLAP_M past the one Earth discards.
  const edge = (GROUND_RADIUS_M + GROUND_OVERLAP_M) / Math.cos(Math.PI / GROUND_SECTORS);
  const fine = 2.5;
  const fineUntil = PAD_REACH_M + 30;
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
  const rows: { rho: number; height: number | null; skirt: boolean }[] = rings.map((rho) => ({ rho, height: null, skirt: false }));
  rows.push({ rho: edge, height: 0, skirt: true }, { rho: edge, height: -SKIRT_M, skirt: true });
  const n = rows.length * cols;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const geoDirs = new Float32Array(n * 3);
  let k = 0;
  for (const row of rows) {
    const a = row.rho / R_M;
    for (let j = 0; j < cols; j++) {
      const az = (2 * Math.PI * j) / GROUND_SECTORS;
      const sx = Math.sin(az);
      const sy = Math.cos(az);
      // The relief goes by east and north; within the pad's ground the arc and the horizontal distance differ by less than a millimeter.
      const height = row.height ?? padRelief(row.rho * sx, row.rho * sy);
      const [ge, gn] = row.skirt ? [0, 0] : padReliefGradient(row.rho * sx, row.rho * sy);
      const p = surfacePoint(row.rho, az, height);
      // Radial (up at that point) and horizontal-outwards unit vectors there.
      const radial = vec3(Math.sin(a) * sx, Math.sin(a) * sy, Math.cos(a));
      const outward = vec3(Math.cos(a) * sx, Math.cos(a) * sy, -Math.sin(a));
      // Normal of the height field over the sphere: radial·(R + h)/R − ∇h (east and north, which tilt
      // by less than 1e-3 rad from the local ones across the ground). The skirt faces out.
      const nr = row.skirt ? outward : vec3(
        radial.x * (1 + height / R_M) - ge,
        radial.y * (1 + height / R_M) - gn,
        radial.z * (1 + height / R_M),
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

/**
 * Makes `material` (drawn on the ground's mesh, whose positions are east-north-up meters) discard its
 * fragments inside the flame trench while `on.value` is 1: the pad model draws the trench there.
 */
function cutTrench(material: THREE.Material, on: { value: number }): void {
  const before = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|trench`;
  const f = (x: number): string => x.toFixed(3);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.uniforms.uTrenchOn = on;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTrenchEN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrenchEN = position.xy;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTrenchEN;\nuniform float uTrenchOn;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (uTrenchOn > 0.5 && abs(vTrenchEN.x) < ${f(TRENCH.halfWidth)} && vTrenchEN.y > ${f(TRENCH.south)} && vTrenchEN.y < ${f(TRENCH.north)}) discard;`,
      );
  };
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
  /** Opens the flame trench in the ground (while the pad model, which draws it, is drawn) or closes it. */
  setTrench(open: boolean): void;
  dispose(): void;
}

/** The pad's ground with `material` (Earth's lit material, sampling by `geoDir`, with the layout; see bodies.ts). */
export function createPadGround(material: THREE.Material): PadGround {
  const geometry = buildGroundGeometry();
  // In the transparent queue only for its place in it: after the atmosphere (−1), before the
  // exhaust wake and the lines (0). It stays opaque (opacity 1) and writes its depth.
  material.transparent = true;
  const trenchOn = { value: 0 };
  cutTrench(material, trenchOn);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -0.5;
  const depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });
  cutTrench(depthMaterial, trenchOn);
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
    setTrench(open) {
      trenchOn.value = open ? 1 : 0;
    },
    dispose() {
      geometry.dispose();
      depthMaterial.dispose();
    },
  };
}
