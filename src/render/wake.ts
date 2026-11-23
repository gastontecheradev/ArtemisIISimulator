import * as THREE from 'three';
import { airDensity } from '../sim/atmosphere';
import { Ephemeris } from '../sim/bodies';
import { EARTH_ROTATION_IN_PLANE, MET_MECO, R_EARTH } from '../sim/constants';
import { Vec3, add, distance, length, rotateZ, scale, sub } from '../sim/math/vec3';
import { TrailPoint } from '../sim/state';
import { RS25_START_BEFORE_LIFTOFF, rs25Throttle, srbThrustEach } from '../sim/vehicle';
import { SPLIT_FRAGMENT, SPLIT_PARS_FRAGMENT, SPLIT_PARS_VERTEX, SPLIT_VERTEX, SplitMode, setSplit, splitUniforms } from './depthSplit';
import { KM_TO_SCENE, ViewFrame, worldToScene } from './worldToScene';

/*
 * Exhaust wake of the ascent in 3D: the smoke the rocket leaves in the air.
 *
 * Where it is comes from the flight: each point is where the vehicle was (the flown trail) and,
 * from then on, it moves with the air, which in the model turns with Earth (`airVelocity` in
 * sim/atmosphere.ts). That is what keeps the smoke column standing on the pad while the pad,
 * in the inertial frame, moves 0.4 km every second. How much smoke there is and how it looks
 * are drawing choices, without a source, listed below. Its colors are those of the launch photos
 * (stage 5 of the launch plan): tan where it is the boosters' smoke, as the column of this launch
 * shows it in the low Sun, and the white of the steam where only the RS‑25s' vapor is left, the
 * same two colors as the launch cloud on the pad (padCloud.ts), where the column is born.
 */

/** Altitude (km) where the wake is gone: the Kármán line, the conventional edge of space (FAI). */
export const WAKE_TOP_KM = 100;
/** Below this altitude (km) the smoke shows at full strength; above it, it fades out. Drawing choice. */
const WAKE_FADE_FROM_KM = 40;
/** Width of the fresh wake (m): about the rocket across its boosters (2 × 6.3 m + 2 × 1.85 m). */
const WAKE_WIDTH_M = 16;
/** How fast the smoke spreads (m of width per s of age). Drawing choice. */
const WAKE_SPREAD = 1.5;
/** Smoke that fades by itself: e-folding time (s), and age (s) after which it is no longer drawn. Drawing choice. */
const WAKE_LIFE = 600;
const WAKE_MAX_AGE = 3600;
/**
 * The boosters' smoke (solid propellant: aluminum oxide) is what makes the thick white column;
 * the RS‑25s burn hydrogen and oxygen and leave water vapor, almost transparent. Opacity of the
 * vapor relative to the boosters' smoke at full thrust. Drawing choice.
 */
export const WAKE_VAPOR = 0.3;
/** Opacity of the densest smoke. Drawing choice. */
const WAKE_OPACITY = 0.85;
/** Behind the nozzles the wake fades in over this distance (m): about the boosters' flame (render/vehicle.ts). */
const WAKE_RAMP_M = 40;
/** Narrower than this on screen (px), the wake is drawn this wide and dimmer: the same coverage, no flicker. */
const WAKE_MIN_PX = 2;
/** Points closer than this (km) to the previous one are merged (the pad during the hold-down). */
const MIN_STEP_KM = 5e-4;

const SRB_FULL_THRUST = srbThrustEach(0);
const LN_RHO_FADE = Math.log(airDensity(WAKE_FADE_FROM_KM));
const LN_RHO_TOP = Math.log(airDensity(WAKE_TOP_KM));

const smoothstep = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/**
 * Smoke the rocket leaves at MET `t` (0–1): the boosters' propellant flow relative to full
 * thrust or, with only the RS‑25s, their vapor. Nothing after MECO.
 */
export function smokeAt(t: number): number {
  if (t < -RS25_START_BEFORE_LIFTOFF || t > MET_MECO) return 0;
  return Math.max(srbThrustEach(t) / SRB_FULL_THRUST, WAKE_VAPOR * rs25Throttle(t));
}

/**
 * Visibility of the smoke at an altitude (km): full up to WAKE_FADE_FROM_KM, then it fades as the
 * air thins (smoothly in the logarithm of the density, that is, in scale heights) and is gone
 * at WAKE_TOP_KM.
 */
export function airFade(altitude: number): number {
  if (altitude >= WAKE_TOP_KM) return 0;
  return smoothstep((Math.log(airDensity(altitude)) - LN_RHO_TOP) / (LN_RHO_FADE - LN_RHO_TOP));
}

export interface WakeSample {
  /** Inertial position now (km): where the vehicle left it, carried since then by the air. */
  readonly r: Vec3;
  /** Seconds since the vehicle passed there. */
  readonly age: number;
  /** Width (m). */
  readonly width: number;
  /** Opacity (0–1). */
  readonly alpha: number;
  /** How much of it is the boosters' smoke (1, tan) rather than the RS‑25s' vapor (0, white). */
  readonly tan: number;
}

interface Raw {
  r: Vec3;
  age: number;
  alt: number;
  smoke: number;
  tan: number;
}

/** The boosters' share of the smoke left at MET t: all of it while they burn above the vapor's level. */
const tanAt = (t: number, smoke: number): number => (smoke > 0 ? Math.min(1, srbThrustEach(t) / SRB_FULL_THRUST / smoke) : 0);

/**
 * Center line of the wake at the time of `tip` (the vehicle now), from the oldest smoke to the
 * nozzles. Empty when there is nothing to draw. Pure: it only reads the trail and the ephemeris.
 */
export function wakeSamples(trail: readonly TrailPoint[], tip: { t: number; r: Vec3 }, eph: Ephemeris): WakeSample[] {
  const now = tip.t;
  if (now - MET_MECO > WAKE_MAX_AGE) return [];
  const earthNow = eph.earth(now).r;
  const raw: Raw[] = [];
  const take = (r: Vec3, te: number): void => {
    const age = now - te;
    if (age < 0 || age > WAKE_MAX_AGE) return;
    const smoke = smokeAt(te);
    if (smoke <= 0) return;
    // Relative to Earth's center when it was left, and turned since then with the air.
    const rel = sub(r, eph.earth(te).r);
    const sample: Raw = { r: add(earthNow, rotateZ(rel, EARTH_ROTATION_IN_PLANE * age)), age, alt: length(rel) - R_EARTH, smoke, tan: tanAt(te, smoke) };
    const prev = raw[raw.length - 1];
    if (prev && distance(prev.r, sample.r) < MIN_STEP_KM) raw[raw.length - 1] = sample;
    else raw.push(sample);
  };
  // The trail is in time order and the smoke only comes from the ascent, at its start.
  for (const p of trail) {
    if (p.t > MET_MECO || p.t > now) break;
    take(p.r, p.t);
  }
  const atNozzles = smokeAt(now) > 0;
  if (atNozzles) take(tip.r, now);
  if (raw.length < 2) return [];

  // The fade-in behind the nozzles needs vertices of its own: the newest stretch of the trail
  // can be kilometers long.
  if (atNozzles) {
    const b = raw.pop() as Raw;
    const a = raw[raw.length - 1];
    const span = distance(a.r, b.r) * 1000;
    for (const f of [1, 0.75, 0.5, 0.25]) {
      const k = (WAKE_RAMP_M * f) / span;
      if (k >= 1) continue;
      raw.push({
        r: add(b.r, scale(sub(a.r, b.r), k)),
        age: a.age * k,
        alt: b.alt + (a.alt - b.alt) * k,
        smoke: b.smoke + (a.smoke - b.smoke) * k,
        tan: b.tan + (a.tan - b.tan) * k,
      });
    }
    raw.push(b);
  }

  // Distance (m) from the nozzles back along the wake.
  const behind = new Array<number>(raw.length).fill(0);
  for (let i = raw.length - 2; i >= 0; i--) behind[i] = behind[i + 1] + distance(raw[i].r, raw[i + 1].r) * 1000;

  const out = raw.map((p, i): WakeSample => {
    const width = WAKE_WIDTH_M + WAKE_SPREAD * p.age;
    // The same smoke over a wider band looks thinner (square root: a drawing choice), and it
    // also fades by itself with time.
    const spread = Math.sqrt(WAKE_WIDTH_M / width) * Math.exp(-p.age / WAKE_LIFE);
    const ramp = atNozzles ? smoothstep(behind[i] / WAKE_RAMP_M) : 1;
    return { r: p.r, age: p.age, width, alpha: WAKE_OPACITY * p.smoke * airFade(p.alt) * spread * ramp, tan: p.tan };
  });
  // Without the invisible ends (above the atmosphere), keeping one vertex so it fades to zero.
  let first = out.findIndex((p) => p.alpha > 0);
  if (first < 0) return [];
  let last = out.length - 1;
  while (out[last].alpha <= 0) last--;
  first = Math.max(0, first - 1);
  last = Math.min(out.length - 1, last + 1);
  return last > first ? out.slice(first, last + 1) : [];
}

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${SPLIT_PARS_VERTEX}
uniform float uViewHeight;
attribute vec3 aTangent;
attribute float aSide;
attribute float aWidth;
attribute float aAlpha;
attribute float aTan;
varying float vSide;
varying float vAlpha;
varying float vTan;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // A band that always faces the camera: across the wake and across the line of sight.
  vec3 along = (modelViewMatrix * vec4(aTangent, 0.0)).xyz;
  vec3 across = cross(along, mv.xyz);
  float l = length(across);
  across = l > 0.0 ? across / l : vec3(0.0, 1.0, 0.0);
  // Width on screen (px); below the minimum it is widened and dimmed in the same ratio.
  float px = aWidth * projectionMatrix[1][1] * 0.5 * uViewHeight / max(-mv.z, 1e-12);
  float grow = max(1.0, ${WAKE_MIN_PX.toFixed(1)} / max(px, 1e-9));
  mv.xyz += across * (aSide * 0.5 * aWidth * grow);
  vSide = aSide;
  vAlpha = aAlpha / grow;
  vTan = aTan;
  ${SPLIT_VERTEX}
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SPLIT_PARS_FRAGMENT}
uniform vec3 uColor;
uniform vec3 uTan;
varying float vSide;
varying float vAlpha;
varying float vTan;
void main() {
  #include <logdepthbuf_fragment>
  ${SPLIT_FRAGMENT}
  // Soft edges: denser in the middle of the column.
  float edge = 1.0 - vSide * vSide;
  gl_FragColor = vec4(mix(uColor, uTan, vTan), vAlpha * edge * edge);
  #include <colorspace_fragment>
}
`;

export interface Wake {
  readonly mesh: THREE.Mesh;
  /** Rebuilds the wake for the time of `tip`, relative to the frame's floating origin. */
  update(trail: readonly TrailPoint[], tip: { t: number; r: Vec3 }, eph: Ephemeris, frame: ViewFrame): void;
  /** Height of the view (px), for the minimum width on screen. */
  setResolution(height: number): void;
  /** Which fragments this pass draws (depthSplit.ts). */
  setSplit(mode: SplitMode, depth: number): void;
  dispose(): void;
}

/** The wake with the colors of the steam (white) and of the boosters' smoke (tan). */
export function createWake(colors: { readonly steam: string; readonly tan: string }): Wake {
  const split = splitUniforms();
  const material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(colors.steam) }, uTan: { value: new THREE.Color(colors.tan) }, uViewHeight: { value: 1 }, ...split },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.frustumCulled = false;
  mesh.visible = false;

  // Buffers with room for `capacity` points (two vertices each), reused between frames.
  let capacity = 0;
  let position = new Float32Array(0);
  let tangent = new Float32Array(0);
  let width = new Float32Array(0);
  let alpha = new Float32Array(0);
  let tan = new Float32Array(0);
  const ensure = (n: number): void => {
    if (n <= capacity) return;
    capacity = Math.max(64, 2 ** Math.ceil(Math.log2(n)));
    position = new Float32Array(capacity * 6);
    tangent = new Float32Array(capacity * 6);
    width = new Float32Array(capacity * 2);
    alpha = new Float32Array(capacity * 2);
    tan = new Float32Array(capacity * 2);
    const side = new Float32Array(capacity * 2);
    for (let i = 0; i < capacity; i++) {
      side[2 * i] = -1;
      side[2 * i + 1] = 1;
    }
    const index = new Uint32Array((capacity - 1) * 6);
    for (let i = 0; i < capacity - 1; i++) {
      const v = 2 * i;
      index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], 6 * i);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aTangent', new THREE.BufferAttribute(tangent, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aWidth', new THREE.BufferAttribute(width, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aTan', new THREE.BufferAttribute(tan, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  };

  const a = new THREE.Vector3();
  return {
    mesh,
    update(trail, tip, eph, frame) {
      const samples = wakeSamples(trail, tip, eph);
      mesh.visible = samples.length >= 2;
      if (!mesh.visible) return;
      const n = samples.length;
      ensure(n);
      // Positions relative to the floating origin, so the vertices near the spacecraft are small numbers.
      const pts = samples.map((p) => worldToScene(p.r, tip.t, frame, new THREE.Vector3()));
      let tx = 1;
      let ty = 0;
      let tz = 0;
      for (let i = 0; i < n; i++) {
        a.copy(pts[Math.min(i + 1, n - 1)]).sub(pts[Math.max(i - 1, 0)]);
        const l = a.length();
        if (l > 0) {
          tx = a.x / l;
          ty = a.y / l;
          tz = a.z / l;
        }
        const p = pts[i];
        const w = samples[i].width * (KM_TO_SCENE / 1000);
        for (let k = 0; k < 2; k++) {
          const v = 2 * i + k;
          position.set([p.x, p.y, p.z], 3 * v);
          tangent.set([tx, ty, tz], 3 * v);
          width[v] = w;
          alpha[v] = samples[i].alpha;
          tan[v] = samples[i].tan;
        }
      }
      const g = mesh.geometry;
      for (const name of ['position', 'aTangent', 'aWidth', 'aAlpha', 'aTan']) g.getAttribute(name).needsUpdate = true;
      g.setDrawRange(0, (n - 1) * 6);
    },
    setResolution(height) {
      material.uniforms.uViewHeight.value = height;
    },
    setSplit(mode, depth) {
      setSplit(split, mode, depth);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
