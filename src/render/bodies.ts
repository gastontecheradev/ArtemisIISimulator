import * as THREE from 'three';
import {
  EARTH_MOON_DISTANCE,
  EI_ALTITUDE,
  GM_EARTH,
  GM_MOON,
  LAUNCH_LATITUDE_DEG,
  LAUNCH_LONGITUDE_DEG,
  MODEL_PLANE_AZIMUTH_DEG,
  MOON_SOI,
  R_EARTH,
  R_MOON,
} from '../sim/constants';
import { Vec3 } from '../sim/math/vec3';
import type { Haze } from './atmosphere';
import { EARTH_DETAIL } from './earthDetail';
import { GROUND_RADIUS_M } from './padGround';
import { KM_TO_SCENE } from './worldToScene';

/** Earth's own glow in 3D (fraction of its color), only so the night side is visible. */
const EARTH_NIGHT_GLOW = 0.35;
/** Lightening of the lit Earth's color in 3D (mix with white). Low so it stays blue. */
const EARTH_DAY_LIFT = 0.12;

export interface BodyMeshes {
  readonly group: THREE.Group;
  readonly earth: THREE.Mesh;
  readonly moon: THREE.Mesh;
  /** Lunar orbit around the barycenter (reference; ellipse, inertial, without the drawing rotation). */
  readonly moonOrbit: THREE.LineLoop;
  /** Replaces the lunar orbit with these points (km, inertial, relative to the barycenter). */
  setMoonOrbit(points: readonly Vec3[]): void;
  /** Entry interface altitude (400,000 ft) around Earth. */
  readonly eiRing: THREE.LineLoop;
  /** Lunar sphere of influence (in the orbital plane). */
  readonly soiRing: THREE.Line;
  /** In 3D the bodies are lit by the "Sun"; in 2D they are flat disks. */
  setLit(on: boolean): void;
  /** Earth writing only its depth (for the spacecraft pass), with the same hole as Earth. */
  readonly earthDepthMaterial: THREE.Material;
  /** Earth's lit material for the pad's ground (padGround.ts), or null without `padCentered`. */
  readonly groundMaterial: THREE.Material | null;
  dispose(): void;
}

/**
 * Sphere sampled on rings around a pole, with the vertex layout and triangles of
 * THREE.SphereGeometry (pole on +y, vertex (i, j) at polar angle `thetas[i]` and azimuth 2πj/sectors,
 * x = −cos φ sin θ, z = sin φ sin θ). In double precision, so tests can measure the geometry as
 * designed; `thetas` goes from 0 to π.
 */
export function latLongSphere(thetas: readonly number[], sectors: number): { positions: Float64Array; index: Uint32Array } {
  const cols = sectors + 1;
  const positions = new Float64Array(thetas.length * cols * 3);
  let k = 0;
  for (const theta of thetas) {
    for (let j = 0; j < cols; j++) {
      const phi = (2 * Math.PI * j) / sectors;
      positions[k++] = -Math.cos(phi) * Math.sin(theta);
      positions[k++] = Math.cos(theta);
      positions[k++] = Math.sin(phi) * Math.sin(theta);
    }
  }
  const index: number[] = [];
  const last = thetas.length - 2;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j < sectors; j++) {
      const a = i * cols + j + 1;
      const b = i * cols + j;
      const c = (i + 1) * cols + j;
      const d = (i + 1) * cols + j + 1;
      if (i !== 0) index.push(a, b, d);
      if (i !== last) index.push(b, c, d);
    }
  }
  return { positions, index: Uint32Array.from(index) };
}

/** Sectors of the pad-centered Earth mesh. */
export const PAD_SPHERE_SECTORS = 256;

/**
 * Polar angles (rad) of the rings of the pad-centered Earth mesh (launch plan, §4.2): the first ring
 * 10 m from the pad, each one 8 % farther from the previous until the spacing reaches 0.5°, and
 * uniform from there to the antipode. The chord error stays at ~1 cm 10 km from the pad, where the
 * old sphere (facets of 1.875°) dropped 16 m per km, and below the old sphere's everywhere else.
 */
export function padSphereRings(): number[] {
  const first = 0.01 / R_EARTH;
  const max = (0.5 * Math.PI) / 180;
  const thetas = [0];
  let theta = 0;
  for (let step = first; step < max; step *= 1.08) {
    theta += step;
    thetas.push(theta);
  }
  const n = Math.ceil((Math.PI - theta) / max);
  for (let k = 1; k <= n; k++) thetas.push(k === n ? Math.PI : theta + ((Math.PI - theta) * k) / n);
  return thetas;
}

/**
 * Earth mesh for the 3D view: a unit sphere with its pole on the pad (local +y, where the Earth
 * mesh always has the launch site; scene.ts turns it with the pad). Fine near the pad and coarse
 * far from it. Normals are the positions; the texture does not use the UVs (see sampleGeographic).
 */
export function padSphereGeometry(): THREE.BufferGeometry {
  const { positions, index } = latLongSphere(padSphereRings(), PAD_SPHERE_SECTORS);
  const p32 = Float32Array.from(positions);
  const n = p32.length / 3;
  const uv = new Float32Array(n * 2);
  const cols = PAD_SPHERE_SECTORS + 1;
  for (let k = 0; k < n; k++) {
    uv[2 * k] = (k % cols) / PAD_SPHERE_SECTORS;
    uv[2 * k + 1] = 1 - Math.acos(Math.max(-1, Math.min(1, positions[3 * k + 1]))) / Math.PI;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(p32, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(p32), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * sin² of the angle, seen from Earth's center, of the circle around the pad where Earth discards
 * its fragments: the pad's own ground (padGround.ts) is drawn there.
 */
const HOLE_SIN2 = Math.sin(GROUND_RADIUS_M / 1000 / R_EARTH) ** 2;

function circle(radius: number, segments: number, closed: boolean): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const n = closed ? segments : segments + 1;
  for (let i = 0; i < n; i++) {
    const a = (i / segments) * 2 * Math.PI;
    pts.push(new THREE.Vector3(radius * Math.cos(a), radius * Math.sin(a), 0));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/** NASA textures (registered in ASSETS.md), equirectangular, made by `npm run images`. */
export interface BodyTextures {
  readonly size: '2k' | '4k';
  readonly anisotropy: number;
  /** Also load the high-resolution patch around the pad (EARTH_DETAIL). */
  readonly detail: boolean;
}

/** Uniforms of the pad patch, shared by both Earth materials so one load updates both. */
interface DetailUniforms {
  uDetail: { value: THREE.Texture | null };
  /** lonMin, lonMax, latMin, latMax (radians). */
  uDetailBounds: { value: THREE.Vector4 };
  uDetailFade: { value: number };
  uDetailOn: { value: number };
}

/**
 * Geographic direction of each local direction of the Earth mesh (columns of the matrix).
 * The model is planar and the pad lies in the plane: local +y is the pad, local −x the
 * direction the rocket flies at the pad (the plane's azimuth, MODEL_PLANE_AZIMUTH_DEG)
 * and local +z the plane's normal. Geographic axes: x towards (0°, 0°), y towards
 * (0°, 90° E), z the north pole.
 */
export function earthGeoMatrix(): THREE.Matrix3 {
  const rad = Math.PI / 180;
  const lat = LAUNCH_LATITUDE_DEG * rad;
  const lon = LAUNCH_LONGITUDE_DEG * rad;
  const az = MODEL_PLANE_AZIMUTH_DEG * rad;
  const up = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
  const east = new THREE.Vector3(-Math.sin(lon), Math.cos(lon), 0);
  const north = new THREE.Vector3(-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat));
  const heading = east.multiplyScalar(Math.sin(az)).add(north.multiplyScalar(Math.cos(az)));
  const x = heading.clone().negate();
  const z = new THREE.Vector3().crossVectors(up, heading);
  return new THREE.Matrix3().set(x.x, up.x, z.x, x.y, up.y, z.y, x.z, up.z, z.z);
}

/**
 * Makes `material` sample its map (and, if lit, its emissive glow) by geographic
 * latitude and longitude computed per fragment through `geo`, instead of by the
 * sphere's UVs. That tilts the texture without tilting the geometry, so the pad still
 * falls on a vertex and the rocket rests on the ground. The texture derivative is taken
 * across the seam with the smaller jump (Tarini's method), so no line appears there.
 * Inside the pad patch (`detail`, once loaded) the texture comes from the patch, fading
 * into the global one over the last `fade` degrees of its edge.
 * `dir` says where each vertex's direction in Earth-mesh local axes comes from: the position (Earth)
 * or the `geoDir` attribute (the pad's ground). With `hole`, the fragments inside the pad's ground
 * circle are discarded (the test uses the horizontal components, which keep their precision there).
 */
function sampleGeographic(
  material: THREE.Material,
  geo: THREE.Matrix3,
  detail: DetailUniforms,
  opts: { dir: 'position' | 'geoDir'; hole: boolean; haze?: Haze } = { dir: 'position', hole: false },
): void {
  // Each variant needs its own program: by default Three keys it on this function's source text.
  material.customProgramCacheKey = () => `geographic|${opts.dir}|${opts.hole}|${opts.haze ? 'haze' : ''}`;
  const haze = opts.haze;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uGeo: { value: geo }, ...detail }, haze?.uniforms ?? {});
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vGeoDir;${opts.dir === 'geoDir' ? '\nattribute vec3 geoDir;' : ''}${haze ? '\nvarying vec3 vHazeWorld;' : ''}`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvGeoDir = ${opts.dir};`)
      .replace('#include <project_vertex>', `#include <project_vertex>${haze ? '\nvHazeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      // Drawn after the atmosphere, the surface hazes itself (atmosphere.ts).
      .replace('#include <colorspace_fragment>', haze ? `#include <colorspace_fragment>\n${haze.apply}` : '#include <colorspace_fragment>')
      .replace(
        '#include <clipping_planes_fragment>',
        opts.hole
          ? `#include <clipping_planes_fragment>
          if (vGeoDir.y > 0.0 && dot(vGeoDir.xz, vGeoDir.xz) < ${HOLE_SIN2.toExponential(10)} * dot(vGeoDir, vGeoDir)) discard;`
          : '#include <clipping_planes_fragment>',
      )
      .replace(
        '#include <common>',
        `#include <common>
        ${haze ? `varying vec3 vHazeWorld;\n${haze.head}` : ''}
        varying vec3 vGeoDir;
        uniform mat3 uGeo;
        uniform sampler2D uDetail;
        uniform vec4 uDetailBounds;
        uniform float uDetailFade;
        uniform float uDetailOn;
        vec4 geoTexel = vec4(1.0);`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec3 g = normalize(uGeo * vGeoDir);
          float lon = atan(g.y, g.x);
          float lat = asin(clamp(g.z, -1.0, 1.0));
          float u = lon / (2.0 * PI) + 0.5;
          float v = lat / PI + 0.5;
          float u2 = fract(u + 0.5) - 0.5;
          float dux = abs(dFdx(u)) <= abs(dFdx(u2)) ? dFdx(u) : dFdx(u2);
          float duy = abs(dFdy(u)) <= abs(dFdy(u2)) ? dFdy(u) : dFdy(u2);
          geoTexel = textureGrad(map, vec2(u, v), vec2(dux, dFdx(v)), vec2(duy, dFdy(v)));
          // Pad patch: same longitude derivative (it does not cross the seam), rescaled.
          vec2 span = vec2(uDetailBounds.y - uDetailBounds.x, uDetailBounds.w - uDetailBounds.z);
          vec2 duv = vec2((lon - uDetailBounds.x) / span.x, (lat - uDetailBounds.z) / span.y);
          vec2 edge = min(vec2(lon - uDetailBounds.x, lat - uDetailBounds.z), vec2(uDetailBounds.y - lon, uDetailBounds.w - lat));
          float w = uDetailOn * smoothstep(0.0, uDetailFade, min(edge.x, edge.y));
          if (w > 0.0) {
            vec2 scale = vec2(2.0 * PI, PI) / span;
            vec4 fine = textureGrad(uDetail, duv, vec2(dux, dFdx(v)) * scale, vec2(duy, dFdy(v)) * scale);
            geoTexel = mix(geoTexel, fine, w);
          }
          diffuseColor *= geoTexel;
        #endif`,
      )
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= geoTexel.rgb;');
  };
}

/**
 * Earth and Moon, plus the geometric references that do not depend on images. With
 * `textures` (only the 3D view) they wear the NASA maps (Blue Marble, CGI Moon Kit);
 * until those load, and on the 2D map and the inset, they are plain-colored spheres.
 * With `pad` (only the 3D view) Earth uses the pad-centered mesh, leaves a hole where the pad's own
 * ground goes, and offers the material for that ground, which adds the atmosphere's `haze` itself
 * (it is drawn after the atmosphere).
 */
export function createBodies(
  colors: { earth: string; moon: string; orbit: string; ei: string },
  /** 2D map: lightened Moon (mixed with white, no new hues) and a more visible orbit. */
  contrast = false,
  textures: BodyTextures | null = null,
  pad: { haze: Haze } | null = null,
): BodyMeshes {
  const padCentered = pad !== null;
  const group = new THREE.Group();
  const moonColor = contrast ? `#${new THREE.Color(colors.moon).lerp(new THREE.Color(0xffffff), 0.35).getHexString()}` : colors.moon;
  const geometry = new THREE.SphereGeometry(1, 192, 96);
  // The sphere's poles lie along z (perpendicular to the orbital plane).
  geometry.rotateX(Math.PI / 2);
  const earthGeometry = padCentered ? padSphereGeometry() : geometry;

  const lighten = (color: string, k: number): string => `#${new THREE.Color(color).lerp(new THREE.Color(0xffffff), k).getHexString()}`;
  const make = (color: string, glow = 0, dayLift = 0): { flat: THREE.MeshBasicMaterial; lit: THREE.MeshStandardMaterial } => ({
    flat: new THREE.MeshBasicMaterial({ color }),
    lit: new THREE.MeshStandardMaterial({ color: lighten(color, dayLift), roughness: 0.95, metalness: 0, emissive: color, emissiveIntensity: glow }),
  });
  // In 3D Earth has a faint glow of its own (its same color) so the night side
  // stands out from the background, and the day side is lightened (mixed with white, no
  // new hues) so the terminator reads. Not the Moon: its dark side stays dark.
  const earthMat = make(colors.earth, EARTH_NIGHT_GLOW, EARTH_DAY_LIFT);
  const moonMat = make(moonColor);
  // The pad's ground: the same lit material as Earth, so the two blend at its edge.
  const groundMat = padCentered ? make(colors.earth, EARTH_NIGHT_GLOW, EARTH_DAY_LIFT).lit : null;
  const earthDepthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });
  const earth: THREE.Mesh = new THREE.Mesh(earthGeometry, earthMat.flat);
  const moon: THREE.Mesh = new THREE.Mesh(geometry, moonMat.flat);

  // NASA textures: WebP, with the JPG fallback if the browser does not decode it. On
  // load the colors go to white (the texture already carries them) and the Earth's
  // glow takes the texture's color, so its night side is a dim Earth, not a flat disk.
  let disposed = false;
  const loaded: THREE.Texture[] = [];
  const load = (file: string, apply: (texture: THREE.Texture) => void): void => {
    if (!textures) return;
    const loader = new THREE.TextureLoader();
    const base = `${import.meta.env.BASE_URL}assets/nasa/${file}`;
    const done = (texture: THREE.Texture): void => {
      if (disposed) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = textures.anisotropy;
      loaded.push(texture);
      apply(texture);
    };
    // If neither format loads (e.g. the patch was not generated), the body keeps what it had.
    loader.load(`${base}.webp`, done, undefined, () => loader.load(`${base}.jpg`, done, undefined, () => undefined));
  };
  const rad = Math.PI / 180;
  const detail: DetailUniforms = {
    uDetail: { value: null },
    uDetailBounds: { value: new THREE.Vector4(EARTH_DETAIL.lonMin * rad, EARTH_DETAIL.lonMax * rad, EARTH_DETAIL.latMin * rad, EARTH_DETAIL.latMax * rad) },
    uDetailFade: { value: EARTH_DETAIL.fade * rad },
    uDetailOn: { value: 0 },
  };
  if (textures || padCentered) {
    const geo = earthGeoMatrix();
    const opts = { dir: 'position', hole: padCentered } as const;
    sampleGeographic(earthMat.flat, geo, detail, opts);
    sampleGeographic(earthMat.lit, geo, detail, opts);
    if (padCentered) sampleGeographic(earthDepthMaterial, geo, detail, opts);
    if (groundMat && pad) sampleGeographic(groundMat, geo, detail, { dir: 'geoDir', hole: false, haze: pad.haze });
  }
  const size = textures?.size ?? '2k';
  if (textures?.detail) {
    load(EARTH_DETAIL.name, (texture) => {
      detail.uDetail.value = texture;
      detail.uDetailOn.value = 1;
    });
  }
  load(`earth-day-${size}`, (texture) => {
    for (const m of [earthMat.flat, earthMat.lit, ...(groundMat ? [groundMat] : [])]) {
      m.map = texture;
      m.color.set(0xffffff);
      m.needsUpdate = true;
    }
    earthMat.lit.emissive.set(0xffffff);
    groundMat?.emissive.set(0xffffff);
  });
  load(`moon-color-${size}`, (texture) => {
    for (const m of [moonMat.flat, moonMat.lit]) {
      m.map = texture;
      m.color.set(0xffffff);
      m.needsUpdate = true;
    }
  });

  // Mean circle until the scene passes the real orbit with `setMoonOrbit`.
  const mu = GM_MOON / (GM_EARTH + GM_MOON);
  let orbitGeometry = circle((1 - mu) * EARTH_MOON_DISTANCE * KM_TO_SCENE, 256, true);
  const orbitMaterial = new THREE.LineBasicMaterial({ color: colors.orbit, transparent: true, opacity: contrast ? 0.42 : 0.18 });
  const moonOrbit = new THREE.LineLoop(orbitGeometry, orbitMaterial);

  const eiGeometry = circle((R_EARTH + EI_ALTITUDE) * KM_TO_SCENE, 720, true);
  const eiMaterial = new THREE.LineBasicMaterial({ color: colors.ei, transparent: true, opacity: 0.7 });
  const eiRing = new THREE.LineLoop(eiGeometry, eiMaterial);

  const soiGeometry = circle(MOON_SOI * KM_TO_SCENE, 180, false);
  const soiMaterial = new THREE.LineDashedMaterial({ color: colors.orbit, transparent: true, opacity: contrast ? 0.5 : 0.3, dashSize: 2.2, gapSize: 2.4 });
  const soiRing = new THREE.Line(soiGeometry, soiMaterial);
  soiRing.computeLineDistances();

  group.add(earth, moon, moonOrbit, eiRing, soiRing);

  // Earth and Moon always at real scale, in all three views.
  earth.scale.setScalar(R_EARTH * KM_TO_SCENE);
  moon.scale.setScalar(R_MOON * KM_TO_SCENE);

  return {
    group,
    earth,
    moon,
    moonOrbit,
    eiRing,
    soiRing,
    setMoonOrbit(points) {
      const next = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x * KM_TO_SCENE, p.y * KM_TO_SCENE, p.z * KM_TO_SCENE)));
      orbitGeometry.dispose();
      orbitGeometry = next;
      moonOrbit.geometry = next;
    },
    setLit(on) {
      earth.material = on ? earthMat.lit : earthMat.flat;
      moon.material = on ? moonMat.lit : moonMat.flat;
    },
    earthDepthMaterial,
    groundMaterial: groundMat,
    dispose() {
      disposed = true;
      for (const t of loaded) t.dispose();
      for (const g of new Set([geometry, earthGeometry, orbitGeometry, eiGeometry, soiGeometry])) g.dispose();
      for (const m of [orbitMaterial, eiMaterial, soiMaterial, earthDepthMaterial]) m.dispose();
      groundMat?.dispose();
      for (const m of [earthMat, moonMat]) {
        m.flat.dispose();
        m.lit.dispose();
      }
    },
  };
}
