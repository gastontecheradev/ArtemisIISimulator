import * as THREE from 'three';
import { ATMOSPHERE_LAYERS, SEA_LEVEL_DENSITY, airDensity } from '../sim/atmosphere';
import { EI_ALTITUDE, R_EARTH, R_MOON } from '../sim/constants';
import { KM_TO_SCENE } from './worldToScene';

/*
 * Earth's atmosphere in 3D: the air around the planet, with its gradient towards space.
 *
 * Each pixel follows its line of sight through the air and adds up the sunlight the air scatters
 * towards the camera (single scattering) and how much of what lies behind it gets through. The
 * density is the same layered atmosphere the physics uses (sim/atmosphere.ts) and the Sun is the
 * one that lights the scene, so the gradient, the bright limb, the twilight band past the
 * terminator and the dark night side all come out of the integral. It is drawn at real scale:
 * from far away it is a thin line on the limb, as in photographs of Earth.
 */

/** Top of the drawn atmosphere (km): the entry interface, 400,000 ft. Above it the air adds nothing visible. */
const TOP_KM = EI_ALTITUDE;

/**
 * Air column above sea level (km of air at sea-level density): the integral of the density.
 * With the model's table it is ~7.2 km; the real one (surface pressure / g / sea-level density)
 * is ~8.4 km, because the table's lowest layer falls too fast. The optical depth below is
 * normalized with this same column, so the drawn air keeps the intended vertical depth.
 */
export const AIR_COLUMN_KM = ((): number => {
  const dh = 0.01;
  let sum = 0;
  for (let h = dh / 2; h < 200; h += dh) sum += airDensity(h) * dh;
  return sum / SEA_LEVEL_DENSITY;
})();

/**
 * Rayleigh optical depth of the whole atmosphere, vertically, at ~450 nm (blue): 0.22.
 * Bodhaine et al. (1999), "On Rayleigh optical depth calculations", J. Atmos. Oceanic Technol.;
 * value from memory, NOT checked against the paper. With the scattering, the air between the camera
 * and the scene dims what is behind it.
 */
const RAYLEIGH_DEPTH = 0.22;

/**
 * Brightness of the scattered light relative to the sky color (drawing choice). A single value
 * has to serve two looks: through a lot of air (the limb, the horizon) the sky reaches the
 * palette's sky color, never more; through the thin vertical column, from space, the day side
 * only gets a light haze. With 1.6 that haze hid the continents, with 0.6 it still washed them,
 * and 0.45 was a bit too bright (Gastón).
 */
const EXPOSURE = 0.35;

/** Steps along each line of sight. */
const STEPS = 32;

const VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const n = ATMOSPHERE_LAYERS.length;
/**
 * The air along a line of sight, shared with the pad's ground (padGround.ts), which is drawn after
 * the atmosphere and adds the same haze itself. Distances in km, from Earth's center.
 */
const AIR_GLSL = /* glsl */ `
#define AIR_LAYERS ${n}
#define AIR_STEPS ${STEPS}
uniform vec3 uEarth;
uniform vec3 uSun;
uniform vec3 uAirColor;
uniform float uSigma;
uniform float uLayerBase[AIR_LAYERS];
uniform float uLayerLnRho[AIR_LAYERS];
uniform float uLayerScale[AIR_LAYERS];

const float AIR_KM = ${(1 / KM_TO_SCENE).toFixed(1)};
const float AIR_R_E = ${R_EARTH.toFixed(3)};
const float AIR_R_TOP = ${(R_EARTH + TOP_KM).toFixed(3)};

// Air density relative to sea level at an altitude (km): the layers of sim/atmosphere.ts.
float airDensity(float h) {
  if (h >= ${TOP_KM.toFixed(3)}) return 0.0;
  h = max(h, 0.0);
  for (int k = AIR_LAYERS - 1; k > 0; k--) {
    if (h >= uLayerBase[k]) return exp(uLayerLnRho[k] - (h - uLayerBase[k]) / uLayerScale[k]);
  }
  return exp(uLayerLnRho[0] - h / uLayerScale[0]);
}

// Distances along the ray to where it enters and leaves a sphere centered at the origin (x > y: no hit).
vec2 airSphere(vec3 o, vec3 d, float r) {
  float b = dot(o, d);
  float h = b * b - (dot(o, o) - r * r);
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

// Sunlight the air scatters towards the camera between t0 and t1 along d (already exposed and
// capped, as a color) and the optical depth there.
vec4 airScatter(vec3 o, vec3 d, float t0, float t1) {
  float ds = (t1 - t0) / float(AIR_STEPS);
  float mu = dot(d, uSun);
  float phase = 0.75 * (1.0 + mu * mu); // Rayleigh
  float tau = 0.0;
  float light = 0.0;
  for (int i = 0; i < AIR_STEPS; i++) {
    vec3 p = o + d * (t0 + (float(i) + 0.5) * ds);
    float r = length(p);
    float dTau = uSigma * airDensity(r - AIR_R_E) * ds;
    // Sunlit where the Sun is above that point's horizon (a bit past the terminator at altitude).
    float dip = -sqrt(max(0.0, 1.0 - (AIR_R_E * AIR_R_E) / (r * r)));
    float lit = smoothstep(dip - 0.01, dip + 0.01, dot(p, uSun) / r);
    light += lit * phase * exp(-tau) * (1.0 - exp(-dTau));
    tau += dTau;
  }
  return vec4(uAirColor * min(light * ${EXPOSURE.toFixed(2)}, 1.0), tau);
}
`;

const FRAGMENT = /* glsl */ `
${AIR_GLSL}
uniform vec3 uMoon;
varying vec3 vWorld;
const float R_M = ${R_MOON.toFixed(1)};

void main() {
  // In km, relative to Earth's center.
  vec3 o = (cameraPosition - uEarth) * AIR_KM;
  vec3 d = normalize(vWorld - cameraPosition);
  vec2 air = airSphere(o, d, AIR_R_TOP);
  float t0 = max(air.x, 0.0);
  float t1 = air.y;
  // The line of sight ends on the ground or on the Moon.
  vec2 ground = airSphere(o, d, AIR_R_E);
  if (ground.x <= ground.y && ground.y > 0.0) t1 = min(t1, max(ground.x, 0.0));
  vec2 moon = airSphere((cameraPosition - uMoon) * AIR_KM, d, R_M);
  if (moon.x <= moon.y && moon.y > 0.0) t1 = min(t1, max(moon.x, 0.0));
  if (t1 <= t0) discard;
  vec4 s = airScatter(o, d, t0, t1);
  // Scattered light added, and what is behind dimmed by the air in between.
  gl_FragColor = vec4(s.rgb, 1.0 - exp(-s.a));
  #include <colorspace_fragment>
}
`;

/**
 * The atmosphere's haze for a surface drawn after it (the pad's ground): GLSL to declare in the
 * fragment shader, GLSL that hazes `gl_FragColor` once it is in the output color space, given the
 * fragment's world position in `vHazeWorld`, and the uniforms (the atmosphere's own, kept current).
 */
export interface Haze {
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly head: string;
  readonly apply: string;
}

export interface Atmosphere {
  readonly mesh: THREE.Mesh;
  readonly haze: Haze;
  /** Scene positions of Earth and the Moon, and the direction towards the Sun. */
  update(earth: THREE.Vector3, moon: THREE.Vector3, sun: THREE.Vector3): void;
  dispose(): void;
}

/** `color`: the color of the sky (from the palette). */
export function createAtmosphere(color: string): Atmosphere {
  const shared: Record<string, THREE.IUniform> = {
    uEarth: { value: new THREE.Vector3() },
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uAirColor: { value: new THREE.Color(color) },
    uSigma: { value: RAYLEIGH_DEPTH / AIR_COLUMN_KM },
    uLayerBase: { value: ATMOSPHERE_LAYERS.map(([h]) => h) },
    uLayerLnRho: { value: ATMOSPHERE_LAYERS.map(([, rho]) => Math.log(rho / SEA_LEVEL_DENSITY)) },
    uLayerScale: { value: ATMOSPHERE_LAYERS.map(([, , scale]) => scale) },
  };
  const haze: Haze = {
    uniforms: shared,
    head: AIR_GLSL,
    // Same composition as the atmosphere over Earth: the surface dimmed, the scattered light added.
    apply: /* glsl */ `{
      vec3 hzO = (cameraPosition - uEarth) * AIR_KM;
      vec3 hzRay = vHazeWorld - cameraPosition;
      float hzLen = length(hzRay);
      vec3 hzD = hzRay / max(hzLen, 1e-20);
      vec2 hzAir = airSphere(hzO, hzD, AIR_R_TOP);
      float hzT0 = max(hzAir.x, 0.0);
      float hzT1 = min(hzAir.y, hzLen * AIR_KM);
      if (hzT1 > hzT0) {
        vec4 hz = airScatter(hzO, hzD, hzT0, hzT1);
        gl_FragColor.rgb = gl_FragColor.rgb * exp(-hz.a) + linearToOutputTexel(vec4(hz.rgb, 1.0)).rgb;
      }
    }`,
  };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...shared, uMoon: { value: new THREE.Vector3() } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // Premultiplied: color added, background times (1 − alpha).
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    depthWrite: false,
    // The shader ends each line of sight on the ground or the Moon itself; with the depth test,
    // from inside the air (the ascent) the haze over the ground would be lost.
    depthTest: false,
    // The inner side: it covers the whole silhouette from outside and every direction from inside.
    side: THREE.BackSide,
  });
  // A bit larger than the top, so its facets do not cut into the air.
  const mesh = new THREE.Mesh(new THREE.SphereGeometry((R_EARTH + TOP_KM) * 1.002 * KM_TO_SCENE, 96, 48), material);
  mesh.frustumCulled = false;
  // Before the other transparent objects (the exhaust wake, the dashed lines), which are closer.
  mesh.renderOrder = -1;
  const u = material.uniforms;
  return {
    mesh,
    haze,
    update(earth, moon, sun) {
      mesh.position.copy(earth);
      (u.uEarth.value as THREE.Vector3).copy(earth);
      (u.uMoon.value as THREE.Vector3).copy(moon);
      (u.uSun.value as THREE.Vector3).copy(sun).normalize();
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
