import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Vec3 } from '../sim/math/vec3';
import { TrajectoryPoint } from '../sim/propagate';
import { TrailPoint } from '../sim/state';
import { KM_TO_SCENE, ViewFrame, worldToScene } from './worldToScene';

export interface TrailColors {
  readonly out: string;
  readonly ret: string;
  readonly prox: string;
  readonly predicted: string;
}

export interface Trails {
  readonly group: THREE.Group;
  /**
   * Flown trail (solid), colored by phase as in NASA's mission map. With `wake` (scene units,
   * only in a view created with `fade`) it fades out with the distance to the spacecraft and is
   * gone at that radius.
   */
  setTraveled(points: readonly TrailPoint[], tip: { t: number; r: Vec3 }, frame: ViewFrame, wake?: number): void;
  /** Predicted trajectory (dashed), from the spacecraft forward. */
  setPredicted(points: readonly TrajectoryPoint[], tip: { t: number; r: Vec3 }, frame: ViewFrame): void;
  /** Whole nominal plan (faint), drawn from the start. `points` = [t, x, y] in inertial km. */
  setNominal(points: readonly (readonly [number, number, number])[], frame: ViewFrame): void;
  /** Repositions the geometries according to the current floating origin. */
  place(frame: ViewFrame): void;
  setResolution(width: number, height: number): void;
  /** Constant on-screen dash length: takes the visible half-height in scene units. */
  setDashScale(viewRadiusScene: number): void;
  dispose(): void;
}

/** Fraction of the wake radius up to which the trail keeps its full color. */
const WAKE_SOLID = 0.35;

/**
 * Parameters t in (0, 1), sorted, where the segment a → b crosses the spheres of radius
 * `radii` around c: there the fade gets a vertex of its own, so it follows the distance.
 */
function crossings(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, radii: readonly number[]): number[] {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Vector3().subVectors(a, c);
  const A = d.dot(d);
  if (A === 0) return [];
  const B = 2 * m.dot(d);
  const out: number[] = [];
  for (const r of radii) {
    const disc = B * B - 4 * A * (m.dot(m) - r * r);
    if (disc <= 0) continue;
    const q = Math.sqrt(disc);
    for (const t of [(-B - q) / (2 * A), (-B + q) / (2 * A)]) if (t > 0 && t < 1) out.push(t);
  }
  return out.sort((x, y) => x - y);
}

/**
 * The line material only takes an RGB color per vertex: this adds an opacity per vertex
 * (`instanceFadeStart`/`End`, one pair per segment like the colors). It is not done additively
 * because there the overlapping ends of the segments add up and the line looks dotted.
 */
function addVertexFade(material: LineMaterial): void {
  material.vertexShader = material.vertexShader.replace(
    'void main() {',
    'attribute float instanceFadeStart;\nattribute float instanceFadeEnd;\nvarying float vFade;\nvoid main() {\n\tvFade = ( position.y < 0.5 ) ? instanceFadeStart : instanceFadeEnd;',
  );
  material.fragmentShader = material.fragmentShader
    .replace('void main() {', 'varying float vFade;\nvoid main() {')
    .replace('float alpha = opacity;', 'float alpha = opacity * vFade;');
}

/** Opacity of each vertex of a polyline, in the pairs format of the line geometry. */
function setFade(geometry: LineGeometry, fade: readonly number[]): void {
  const pairs = new Float32Array(2 * (fade.length - 1));
  for (let i = 0; i < fade.length - 1; i++) {
    pairs[2 * i] = fade[i];
    pairs[2 * i + 1] = fade[i + 1];
  }
  const buffer = new THREE.InstancedInterleavedBuffer(pairs, 2, 1);
  geometry.setAttribute('instanceFadeStart', new THREE.InterleavedBufferAttribute(buffer, 1, 0));
  geometry.setAttribute('instanceFadeEnd', new THREE.InterleavedBufferAttribute(buffer, 1, 1));
}

/** `fade`: the flown trail can fade out (`wake` in `setTraveled`). The 3D view uses it. */
export function createTrails(colors: TrailColors, options: { fade?: boolean } = {}): Trails {
  const group = new THREE.Group();
  const fades = options.fade === true;
  const traveledMaterial = new LineMaterial({
    linewidth: 2.5,
    vertexColors: true,
    worldUnits: false,
    ...(fades ? { transparent: true, depthWrite: false } : {}),
  });
  if (fades) addVertexFade(traveledMaterial);
  const predictedMaterial = new LineMaterial({
    color: new THREE.Color(colors.predicted).getHex(),
    linewidth: 1.5,
    worldUnits: false,
    dashed: true,
    dashSize: 1,
    gapSize: 1,
    transparent: true,
    opacity: 0.75,
  });
  const nominalMaterial = new LineMaterial({
    color: new THREE.Color(colors.predicted).getHex(),
    linewidth: 1.2,
    worldUnits: false,
    transparent: true,
    opacity: 0.28,
  });
  let traveled: Line2 | null = null;
  let predicted: Line2 | null = null;
  let nominal: Line2 | null = null;
  let nominalAnchor: Vec3 = { x: 0, y: 0, z: 0 };
  // Each geometry is built relative to the floating origin of the moment: that way the vertices
  // (float32) are small numbers near the spacecraft and the trail does not jitter in close-ups.
  let traveledAnchor: Vec3 = { x: 0, y: 0, z: 0 };
  let predictedAnchor: Vec3 = { x: 0, y: 0, z: 0 };

  const c = {
    out: new THREE.Color(colors.out),
    ret: new THREE.Color(colors.ret),
    prox: new THREE.Color(colors.prox),
  };
  const colorOf = (p: TrailPoint): THREE.Color => {
    if (p.prox) return c.prox;
    return p.phase === 'REGRESO' || p.phase === 'ENTRADA' ? c.ret : c.out;
  };

  const replace = (old: Line2 | null, positions: number[], cols: number[] | null, material: LineMaterial, fade?: number[]): Line2 | null => {
    if (old) {
      group.remove(old);
      old.geometry.dispose();
    }
    if (positions.length < 6) return null;
    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    if (cols) geometry.setColors(cols);
    if (fade) setFade(geometry, fade);
    const line = new Line2(geometry, material);
    line.computeLineDistances();
    line.frustumCulled = false;
    group.add(line);
    return line;
  };

  const v = new THREE.Vector3();
  return {
    group,
    setTraveled(points, tip, frame, wake) {
      const f = frame;
      traveledAnchor = frame.origin;
      const positions: number[] = [];
      const cols: number[] = [];
      const fade: number[] = [];
      const ship = worldToScene(tip.r, tip.t, f, new THREE.Vector3());
      const solid = wake !== undefined ? wake * WAKE_SOLID : 0;
      // Opacity at a point: full near the spacecraft, down to zero at the wake radius.
      const shade = (q: THREE.Vector3): number => {
        if (wake === undefined) return 1;
        const d = q.distanceTo(ship);
        return d <= solid ? 1 : d >= wake ? 0 : 1 - (d - solid) / (wake - solid);
      };
      const push = (q: THREE.Vector3, col: THREE.Color): void => {
        positions.push(q.x, q.y, q.z);
        cols.push(col.r, col.g, col.b);
        fade.push(shade(q));
      };
      const prev = new THREE.Vector3();
      const mid = new THREE.Vector3();
      let started = false;
      const visit = (q: THREE.Vector3, col: THREE.Color): void => {
        if (wake !== undefined && started)
          for (const t of crossings(prev, q, ship, [solid, wake])) push(mid.lerpVectors(prev, q, t), col);
        push(q, col);
        prev.copy(q);
        started = true;
      };
      let last = c.out;
      for (const p of points) {
        worldToScene(p.r, p.t, f, v);
        last = colorOf(p);
        visit(v, last);
      }
      visit(ship, last);
      traveled = replace(traveled, positions, cols, traveledMaterial, fades ? fade : undefined);
    },
    setPredicted(points, tip, frame) {
      const f = frame;
      predictedAnchor = frame.origin;
      const positions: number[] = [];
      worldToScene(tip.r, tip.t, f, v);
      positions.push(v.x, v.y, v.z);
      for (const p of points) {
        if (p.t <= tip.t) continue;
        worldToScene(p.r, p.t, f, v);
        positions.push(v.x, v.y, v.z);
      }
      predicted = replace(predicted, positions, null, predictedMaterial);
    },
    setNominal(points, frame) {
      nominalAnchor = frame.origin;
      const positions: number[] = [];
      for (const [t, x, y] of points) {
        worldToScene({ x, y, z: 0 }, t, frame, v);
        positions.push(v.x, v.y, v.z);
      }
      nominal = replace(nominal, positions, null, nominalMaterial);
      if (nominal) nominal.renderOrder = -1;
    },
    place(frame) {
      const o = frame.origin;
      traveled?.position.set((traveledAnchor.x - o.x) * KM_TO_SCENE, (traveledAnchor.y - o.y) * KM_TO_SCENE, (traveledAnchor.z - o.z) * KM_TO_SCENE);
      predicted?.position.set((predictedAnchor.x - o.x) * KM_TO_SCENE, (predictedAnchor.y - o.y) * KM_TO_SCENE, (predictedAnchor.z - o.z) * KM_TO_SCENE);
      nominal?.position.set((nominalAnchor.x - o.x) * KM_TO_SCENE, (nominalAnchor.y - o.y) * KM_TO_SCENE, (nominalAnchor.z - o.z) * KM_TO_SCENE);
    },
    setResolution(width, height) {
      traveledMaterial.resolution.set(width, height);
      predictedMaterial.resolution.set(width, height);
      nominalMaterial.resolution.set(width, height);
    },
    setDashScale(viewRadiusScene) {
      predictedMaterial.dashScale = 45 / Math.max(1e-9, viewRadiusScene);
    },
    dispose() {
      traveled?.geometry.dispose();
      predicted?.geometry.dispose();
      nominal?.geometry.dispose();
      traveledMaterial.dispose();
      predictedMaterial.dispose();
      nominalMaterial.dispose();
    },
  };
}
