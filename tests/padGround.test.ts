import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PAD_SPHERE_SECTORS, earthGeoMatrix, latLongSphere, padMeshSag, padSphereRings } from '../src/render/bodies';
import {
  GROUND_RADIUS_M,
  PAD_CAMERA,
  PAD_ENU_LOCAL,
  buildGroundGeometry,
  groundPoint,
  liftAboveGround,
  padAxes,
  padCameraEye,
  padRelief,
} from '../src/render/padGround';
import { AUTO_PAD_UNTIL, effectiveCameraMode } from '../src/render/scene';
import {
  EARTH_ROTATION_IN_PLANE,
  LAUNCH_LATITUDE_DEG,
  LAUNCH_LONGITUDE_DEG,
  LAUNCH_SITE_HEIGHT,
  PAD_ELEVATION,
  PAD_SLOPE_RUN,
  PAD_TOP_NORTH,
  PAD_TOP_RADIUS,
  PAD_TOP_SOUTH,
  R_EARTH,
} from '../src/sim/constants';
import { Vec3, add, angleBetween, cross, distance, dot, length, normalize, scale, sub, vec3 } from '../src/sim/math/vec3';
import { MISSION_PARAMS } from '../src/sim/mission/params';
import { ephemerisOf, padState } from '../src/sim/state';

const R_M = R_EARTH * 1000;
const at = (a: ArrayLike<number>, i: number): Vec3 => vec3(a[3 * i], a[3 * i + 1], a[3 * i + 2]);

interface Mesh {
  readonly positions: ArrayLike<number>;
  readonly index: ArrayLike<number>;
}

/**
 * Chord error of a triangle inscribed in the unit sphere: how far inside the sphere its deepest
 * point is (1 − the smallest |p| over the triangle). That point is the foot of the perpendicular
 * from the center (the circumcenter) if it falls inside; otherwise an edge's midpoint.
 */
function chordError(a: Vec3, b: Vec3, c: Vec3): number {
  const n = cross(sub(b, a), sub(c, a));
  const nl = length(n);
  if (nl === 0) return 0;
  const nh = scale(n, 1 / nl);
  const d = dot(nh, a);
  const foot = scale(nh, d);
  const side = (p: Vec3, q: Vec3): number => dot(cross(sub(q, p), sub(foot, p)), n);
  if (side(a, b) >= 0 && side(b, c) >= 0 && side(c, a) >= 0) return 1 - Math.abs(d);
  const mid = (p: Vec3, q: Vec3): number => 1 - length(scale(add(p, q), 0.5));
  return Math.max(mid(a, b), mid(b, c), mid(c, a));
}

/** Angle (rad) of a unit-sphere point from the pad, which is local +y (well conditioned near it). */
const fromPad = (p: Vec3): number => Math.atan2(Math.hypot(p.x, p.z), p.y);

/** The current sphere (THREE.SphereGeometry(1, 192, 96)), in double precision. */
function oldSphere(): Mesh {
  const thetas = Array.from({ length: 97 }, (_, k) => (k * Math.PI) / 96);
  return latLongSphere(thetas, 192);
}
/** bodies.ts turns it with rotateX(π/2): (x, y, z) → (x, −z, y). The pad is local +y after that. */
const OLD_TO_LOCAL = (p: Vec3): Vec3 => vec3(p.x, -p.z, p.y);
const LOCAL_TO_OLD = (p: Vec3): Vec3 => vec3(p.x, p.z, -p.y);

/**
 * Where a ray from the center along `u` (in the builder's frame) meets the mesh: the surface
 * radius there. Both meshes are rings around their pole, so only the triangles of the cells around
 * the one `u` falls in are checked.
 */
function radiusAlong(mesh: Mesh, thetas: readonly number[], sectors: number, cells: Map<number, number[]>, u: Vec3): number {
  const theta = Math.atan2(Math.hypot(u.x, u.z), u.y);
  let phi = Math.atan2(u.z, -u.x);
  if (phi < 0) phi += 2 * Math.PI;
  let lo = 0;
  let hi = thetas.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (thetas[m] <= theta) lo = m;
    else hi = m;
  }
  const j = Math.floor(phi / ((2 * Math.PI) / sectors));
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const key = (lo + di) * (sectors + 1) + (((j + dj) % sectors) + sectors) % sectors;
      for (const t of cells.get(key) ?? []) {
        const a = at(mesh.positions, mesh.index[3 * t]);
        const b = at(mesh.positions, mesh.index[3 * t + 1]);
        const c = at(mesh.positions, mesh.index[3 * t + 2]);
        // Möller–Trumbore from the origin.
        const e1 = sub(b, a);
        const e2 = sub(c, a);
        const p = cross(u, e2);
        const det = dot(e1, p);
        if (Math.abs(det) < 1e-300) continue;
        const s = scale(a, -1);
        const bu = dot(s, p) / det;
        const q = cross(s, e1);
        const bv = dot(u, q) / det;
        const eps = 1e-9;
        if (bu < -eps || bv < -eps || bu + bv > 1 + eps) continue;
        return dot(e2, q) / det;
      }
    }
  }
  throw new Error('no triangle along the ray');
}

/** Triangles of a ring mesh grouped by the cell of their first vertex (the layout of latLongSphere). */
function cellsOf(mesh: Mesh, sectors: number): Map<number, number[]> {
  const cells = new Map<number, number[]>();
  for (let t = 0; t < mesh.index.length / 3; t++) {
    const key = Math.min(mesh.index[3 * t], mesh.index[3 * t + 1], mesh.index[3 * t + 2]);
    const list = cells.get(key) ?? [];
    list.push(t);
    cells.set(key, list);
  }
  // Keys are vertex indices; sectors + 1 vertices per ring, the last one repeating the first.
  void sectors;
  return cells;
}

describe('Pad-centered Earth mesh (3D)', () => {
  const thetas = padSphereRings();
  const mesh = latLongSphere(thetas, PAD_SPHERE_SECTORS);

  it('replicates the current sphere exactly when given its rings', () => {
    // So the comparison below is against the sphere the app drew until now.
    const three = new THREE.SphereGeometry(1, 192, 96).rotateX(Math.PI / 2);
    const old = oldSphere();
    const pos = three.getAttribute('position');
    expect(pos.count).toBe(old.positions.length / 3);
    let worst = 0;
    for (let i = 0; i < pos.count; i++) {
      const p = OLD_TO_LOCAL(at(old.positions, i));
      worst = Math.max(worst, Math.abs(p.x - pos.getX(i)), Math.abs(p.y - pos.getY(i)), Math.abs(p.z - pos.getZ(i)));
    }
    expect(worst).toBeLessThan(1e-6);
    expect(Array.from(three.getIndex()!.array)).toEqual(Array.from(old.index));
  });

  it('has its triangles facing outwards and a reasonable size', () => {
    const n = mesh.index.length / 3;
    for (let t = 0; t < n; t++) {
      const a = at(mesh.positions, mesh.index[3 * t]);
      const b = at(mesh.positions, mesh.index[3 * t + 1]);
      const c = at(mesh.positions, mesh.index[3 * t + 2]);
      expect(dot(cross(sub(b, a), sub(c, a)), add(add(a, b), c))).toBeGreaterThan(0);
    }
    expect(mesh.positions.length / 3).toBeGreaterThan(75000);
    expect(mesh.positions.length / 3).toBeLessThan(120000);
    expect(thetas[0]).toBe(0);
    expect(thetas[thetas.length - 1]).toBe(Math.PI);
  });

  it('has a chord error under 2 cm within 10 km of the pad', () => {
    const limit = 10000 / R_M;
    let worst = 0;
    let count = 0;
    for (let t = 0; t < mesh.index.length / 3; t++) {
      const a = at(mesh.positions, mesh.index[3 * t]);
      const b = at(mesh.positions, mesh.index[3 * t + 1]);
      const c = at(mesh.positions, mesh.index[3 * t + 2]);
      if (Math.max(fromPad(a), fromPad(b), fromPad(c)) > limit) continue;
      worst = Math.max(worst, chordError(a, b, c));
      count++;
    }
    expect(count).toBeGreaterThan(10000);
    expect(worst * R_M).toBeLessThan(0.02);
    // The current sphere drops 16 m per km from the pad (the pad is on a vertex of 1.875° facets).
    expect(worst * R_M).toBeGreaterThan(0.001);
  });

  it('is never less precise than the current sphere, at any distance from the pad', () => {
    const triangles = (m: Mesh): number => {
      let worst = 0;
      for (let t = 0; t < m.index.length / 3; t++) {
        worst = Math.max(worst, chordError(at(m.positions, m.index[3 * t]), at(m.positions, m.index[3 * t + 1]), at(m.positions, m.index[3 * t + 2])));
      }
      return worst;
    };
    const old = oldSphere();
    const oldThetas = Array.from({ length: 97 }, (_, k) => (k * Math.PI) / 96);
    // Over the whole sphere: ~1.7 km before.
    const worstOld = triangles(old);
    const worstNew = triangles(mesh);
    expect(worstOld * R_EARTH).toBeGreaterThan(1.5);
    expect(worstNew).toBeLessThan(worstOld);
    // On circles around the pad, from 1 m to near the antipode: the largest error sampled on each.
    const newCells = cellsOf(mesh, PAD_SPHERE_SECTORS);
    const oldCells = cellsOf(old, 192);
    const pad = vec3(0, 1, 0);
    for (let s = 1; s < Math.PI * R_M; s *= 1.6) {
      const a = s / R_M;
      let maxNew = 0;
      let maxOld = 0;
      for (let k = 0; k < 720; k++) {
        const psi = ((k + 0.37) * 2 * Math.PI) / 720;
        const u = normalize(add(scale(pad, Math.cos(a)), scale(vec3(Math.cos(psi), 0, Math.sin(psi)), Math.sin(a))));
        maxNew = Math.max(maxNew, 1 - radiusAlong(mesh, thetas, PAD_SPHERE_SECTORS, newCells, u));
        maxOld = Math.max(maxOld, 1 - radiusAlong(old, oldThetas, 192, oldCells, LOCAL_TO_OLD(u)));
      }
      expect(maxNew, `${(s / 1000).toFixed(3)} km from the pad`).toBeLessThanOrEqual(maxOld);
    }
  });

  it('never sinks below the sphere more than padMeshSag says (what the atmosphere takes as ground)', () => {
    const cells = cellsOf(mesh, PAD_SPHERE_SECTORS);
    const pad = vec3(0, 1, 0);
    let tightest = Infinity;
    for (let s = 1; s < Math.PI * R_M; s *= 1.3) {
      const a = s / R_M;
      let deepest = 0;
      for (let k = 0; k < 720; k++) {
        const psi = ((k + 0.37) * 2 * Math.PI) / 720;
        const u = normalize(add(scale(pad, Math.cos(a)), scale(vec3(Math.cos(psi), 0, Math.sin(psi)), Math.sin(a))));
        deepest = Math.max(deepest, (1 - radiusAlong(mesh, thetas, PAD_SPHERE_SECTORS, cells, u)) * R_EARTH);
      }
      expect(deepest, `${(s / 1000).toFixed(3)} km from the pad`).toBeLessThanOrEqual(padMeshSag(a));
      if (deepest > 1e-6) tightest = Math.min(tightest, padMeshSag(a) / deepest);
    }
    // A bound, not a guess: never more than ~4 times the real sag where there is one to speak of.
    expect(tightest).toBeLessThan(4);
    // The numbers in its comment.
    expect(padMeshSag(36 / R_EARTH)).toBeLessThan(0.0003);
    expect(padMeshSag(Math.PI / 2)).toBeGreaterThan(0.4);
  });
});

describe('The pad frame', () => {
  it('matches the geographic east, north and up at LC‑39B through earthGeoMatrix', () => {
    const rad = Math.PI / 180;
    const lat = LAUNCH_LATITUDE_DEG * rad;
    const lon = LAUNCH_LONGITUDE_DEG * rad;
    const expected = {
      east: vec3(-Math.sin(lon), Math.cos(lon), 0),
      north: vec3(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)),
      up: vec3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)),
    };
    const geo = earthGeoMatrix();
    for (const k of ['east', 'north', 'up'] as const) {
      const local = PAD_ENU_LOCAL[k];
      const g = new THREE.Vector3(local.x, local.y, local.z).applyMatrix3(geo);
      expect(distance(vec3(g.x, g.y, g.z), expected[k]), k).toBeLessThan(1e-12);
    }
    // Right-handed: east × north = up.
    expect(distance(cross(PAD_ENU_LOCAL.east, PAD_ENU_LOCAL.north), PAD_ENU_LOCAL.up)).toBeLessThan(1e-15);
  });

  it('turns with Earth to where the physics has the pad, with east along the ground velocity', () => {
    const eph = ephemerisOf({ params: MISSION_PARAMS });
    for (const t of [-600, -1, 0, 3600, 86400]) {
      const earth = eph.earth(t);
      const pad = padState(t, eph);
      // The Earth mesh turns by EARTH_ROTATION_IN_PLANE·t in the 3D view (inertial frame, no map turn).
      const axes = padAxes(EARTH_ROTATION_IN_PLANE * t);
      const where = add(earth.r, scale(axes.up, R_EARTH + LAUNCH_SITE_HEIGHT));
      expect(distance(where, pad.r) * 1e6, `t = ${t}`).toBeLessThan(1); // mm
      // Sine of the angle (acos cannot resolve less than ~1.5e-8 rad).
      const ground = normalize(sub(pad.v, earth.v));
      expect(length(cross(axes.east, ground))).toBeLessThan(1e-12);
      expect(dot(axes.east, ground)).toBeGreaterThan(0);
      expect(Math.abs(axes.north.z - 1)).toBeLessThan(1e-15);
    }
  });
});

describe('The pad ground', () => {
  const geometry = buildGroundGeometry();
  const pos = geometry.getAttribute('position');
  const geoDir = geometry.getAttribute('geoDir');
  const index = geometry.getIndex()!;
  const p = (i: number): Vec3 => vec3(pos.getX(i), pos.getY(i), pos.getZ(i));
  /** Height above the sea-level sphere and arc distance from the launch point, of an east-north-up point. */
  const heightOf = (q: Vec3): number => Math.hypot(q.x, q.y, q.z + R_M) - R_M;
  const rhoOf = (q: Vec3): number => Math.atan2(Math.hypot(q.x, q.y), q.z + R_M) * R_M;

  it('has the elevated pad on top and the sea-level sphere around it', () => {
    expect(padRelief(0, 0)).toBeCloseTo(PAD_ELEVATION * 1000, 9);
    expect(groundPoint(0, 0).z).toBeCloseTo(PAD_ELEVATION * 1000, 9);
    // East and west of the spine the top and the slope keep their widths; north and south they start at its ends.
    const flat = (PAD_TOP_RADIUS + PAD_SLOPE_RUN) * 1000;
    expect(padRelief(flat, 0)).toBe(0);
    expect(padRelief(-flat + 1, 0)).toBeGreaterThan(0);
    expect(padRelief(0, -(PAD_TOP_SOUTH * 1000 + flat))).toBe(0);
    expect(padRelief(0, PAD_TOP_NORTH * 1000 + PAD_TOP_RADIUS * 1000)).toBeCloseTo(PAD_ELEVATION * 1000, 9);
    expect(padRelief(0, PAD_TOP_NORTH * 1000 + flat)).toBe(0);
    let worst = 0;
    for (let i = 0; i < pos.count; i++) {
      const q = p(i);
      const rho = rhoOf(q);
      const h = heightOf(q);
      // The skirt hangs below the edge; the rest follows the relief over the curved Earth.
      if (rho > GROUND_RADIUS_M && h < -0.01) continue;
      worst = Math.max(worst, Math.abs(h - padRelief(q.x, q.y)));
    }
    expect(worst).toBeLessThan(0.002);
  });

  it('covers the whole circle Earth leaves out, without gaps', () => {
    // Every chord of the outer polygon stays outside the circle Earth discards.
    const edge = Math.max(...Array.from({ length: pos.count }, (_, i) => rhoOf(p(i))));
    const edgeVertices = Array.from({ length: pos.count }, (_, i) => i).filter((i) => Math.abs(rhoOf(p(i)) - edge) < 1e-3 && heightOf(p(i)) > -1);
    expect(edgeVertices.length).toBeGreaterThan(256);
    let closest = Infinity;
    for (let k = 0; k + 1 < edgeVertices.length; k++) {
      const a = p(edgeVertices[k]);
      const b = p(edgeVertices[k + 1]);
      if (distance(a, b) > 200) continue;
      closest = Math.min(closest, rhoOf(scale(add(a, b), 0.5)));
    }
    // With a margin for the ~0.5 m float32 error of Earth's surface, so no crack opens between them.
    expect(closest).toBeGreaterThanOrEqual(GROUND_RADIUS_M + 5);
    expect(edge - GROUND_RADIUS_M).toBeLessThan(15);
  });

  it('faces up, with the skirt facing out, and samples Earth along its own direction', () => {
    for (let t = 0; t < index.count / 3; t++) {
      const a = p(index.getX(3 * t));
      const b = p(index.getX(3 * t + 1));
      const c = p(index.getX(3 * t + 2));
      const n = cross(sub(b, a), sub(c, a));
      const centroid = scale(add(add(a, b), c), 1 / 3);
      const outward = vec3(centroid.x, centroid.y, 0);
      // Either up (the ground) or outwards (the skirt).
      expect(n.z > 0 || dot(n, outward) > 0).toBe(true);
    }
    // geoDir is the direction from Earth's center in the Earth mesh's local axes (east = −x, north = +z).
    for (const i of [0, 3000, pos.count - 1]) {
      const q = p(i);
      const g = vec3(geoDir.getX(i), geoDir.getY(i), geoDir.getZ(i));
      const expected = normalize(add(add(scale(PAD_ENU_LOCAL.east, q.x), scale(PAD_ENU_LOCAL.north, q.y)), scale(PAD_ENU_LOCAL.up, q.z + R_M)));
      expect(angleBetween(g, expected)).toBeLessThan(1e-6);
    }
  });

  it('places the pad camera at eye height on the ground, off the elevated pad', () => {
    const eye = padCameraEye();
    expect(rhoOf(eye)).toBeCloseTo(PAD_CAMERA.distance, 6);
    expect(heightOf(eye) - padRelief(eye.x, eye.y)).toBeCloseTo(PAD_CAMERA.eyeHeight, 6);
    expect(padRelief(eye.x, eye.y)).toBe(0);
    // South-southwest of the launch point.
    expect(eye.x).toBeLessThan(0);
    expect(eye.y).toBeLessThan(eye.x);
  });

  it('lifts a camera that goes under the ground, and only there', () => {
    const under = vec3(0, 10, 5);
    const lifted = liftAboveGround(under, 1);
    expect(heightOf(lifted)).toBeCloseTo(PAD_ELEVATION * 1000 + 1, 6);
    expect(Math.abs(rhoOf(lifted) - rhoOf(under))).toBeLessThan(1e-6);
    const above = vec3(0, 10, 100);
    expect(liftAboveGround(above, 1)).toBe(above);
    const far = vec3(0, 2 * GROUND_RADIUS_M, -100);
    expect(liftAboveGround(far, 1)).toBe(far);
  });
});

describe('AUTO camera', () => {
  it('watches from the pad until T+30 s and then follows the spacecraft', () => {
    expect(effectiveCameraMode('auto', -600)).toBe('pad');
    expect(effectiveCameraMode('auto', AUTO_PAD_UNTIL - 0.1)).toBe('pad');
    expect(effectiveCameraMode('auto', AUTO_PAD_UNTIL)).toBe('ship');
    expect(effectiveCameraMode('pad', 5000)).toBe('pad');
    expect(effectiveCameraMode('ship', -60)).toBe('ship');
  });
});
