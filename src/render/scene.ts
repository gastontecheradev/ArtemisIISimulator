import * as THREE from 'three';
import { cruiseSense, runningEngines } from '../sim/advance';
import { sunDirection } from '../sim/bodies';
import { EARTH_ROTATION_IN_PLANE, MOON_SOI, R_EARTH, R_MOON } from '../sim/constants';
import { getLocale } from '../sim/i18n';
import { Vec3, ZERO, add, angleBetween, cross, dot, length, normalize, rotateAbout, rotateZ, scale, sub } from '../sim/math/vec3';
import nominalRaw from '../sim/mission/nominal-path.json';
import { MissionParams } from '../sim/mission/params';
import { timeline } from '../sim/mission/timeline';
import { Prediction } from '../sim/propagate';
import { Marker, SimState, TrailPoint, ephemerisOf } from '../sim/state';
import { VehicleConfig } from '../sim/vehicle';
import { createAtmosphere } from './atmosphere';
import { createBodies } from './bodies';
import { CameraRig, createOrthoRig, createPerspectiveRig } from './camera';
import { createOverlay } from './markers';
import { createPadModel } from './pad';
import { createPadCloud, riseFromTrail } from './padCloud';
import { createPadGround, liftAboveGround, padAxes, padCameraEye } from './padGround';
import { createGroundLayout } from './padLayout';
import { createStars } from './stars';
import { createTrails } from './trails';
import { PAD_ANCHOR_STATION, createDebrisModels, createVehicleModel, debrisLength, vehicleExtent, vehicleIconSvg } from './vehicle';
import { createWake } from './wake';
import { KM_TO_SCENE, ViewFrame, toDisplayFrame, worldToScene } from './worldToScene';

/**
 * 'auto' watches the launch from the pad camera and then follows the spacecraft up close (3D). The
 * fixed modes frame the spacecraft, Earth, the Moon or the whole system, or stand on the ground by
 * the pad ('pad', with the local vertical up).
 */
export type CameraMode = 'auto' | 'overview' | 'ship' | 'earth' | 'moon' | 'pad';
type FixedMode = Exclude<CameraMode, 'auto'>;

/**
 * AUTO uses the pad camera until this MET (s) and the spacecraft camera afterwards (D5 of the launch
 * plan). Drawing choice: by then the rocket is a few km up and small from the ground.
 */
export const AUTO_PAD_UNTIL = 30;
/** Real seconds AUTO takes to go from the pad camera to the spacecraft camera (drawing choice). */
const PAD_BLEND_S = 2.5;

/** The camera a 3D view actually uses at time `t` with the chosen mode. */
export function effectiveCameraMode(mode: CameraMode, t: number): FixedMode {
  if (mode !== 'auto') return mode;
  return t < AUTO_PAD_UNTIL ? 'pad' : 'ship';
}
/**
 * Three views: the 2D map (static, fixed scale covering the whole mission, in the
 * rotating or inertial frame), the Earth-vicinity inset (static, centered on Earth) and the
 * 3D perspective view.
 */
export type ViewDim = '2d' | 'inset' | '3d';

export interface ViewSettings {
  readonly cameraMode: CameraMode;
  readonly frame: 'inertial' | 'rotating';
  /** 2D map frame: rotating (Earth and Moon still) or inertial (the Moon travels along its orbit). */
  readonly mapFrame: 'inertial' | 'rotating';
}

export interface TrajectoryViewDeps {
  /** Read-only: render never modifies the simulation. */
  getState(): SimState;
  getSettings(): ViewSettings;
  /** Called once per frame, before drawing, with the real dt in seconds. */
  onFrame?(dt: number): void;
}

/** Nominal plan sampled by scripts/nominal-path.ts: [MET, x, y] in inertial km. */
const NOMINAL_PATH = nominalRaw as unknown as readonly (readonly [number, number, number])[];

const Z: Vec3 = { x: 0, y: 0, z: 1 };
/** 1 m in scene units. */
const M_TO_SCENE = KM_TO_SCENE / 1000;
/** Fixed radii of the Earth-vicinity inset (km): low-orbit phase and afterwards. */
const INSET_RADIUS_LOW = 9000;
const INSET_RADIUS_HIGH = 95000;
/**
 * On the way back the inset returns to the initial scale from CM/SM separation (E13)
 * or, if it does not separate, below this distance from Earth's center (km), with the
 * spacecraft already inside the view.
 */
const INSET_LANDING_DISTANCE = 0.9 * INSET_RADIUS_LOW;
/**
 * Moon-vicinity inset: fixed radius (km), halfway between the framing on
 * entering the sphere of influence (1.1 × SOI) and that of the flyby (12,000 km). It used to
 * follow the spacecraft's distance and looked like a continuous zoom.
 */
const LUNAR_RADIUS = (12000 + MOON_SOI * 1.1) / 2;

/**
 * What the inset shows: the Earth vicinity or, inside the lunar sphere of
 * influence (the same criterion the physics uses for the burn frame), the Moon vicinity.
 */
export function insetTarget(s: SimState): 'earth' | 'moon' {
  return length(sub(s.ship.r, ephemerisOf(s).moon(s.t).r)) < MOON_SOI ? 'moon' : 'earth';
}

/**
 * Orientation of the 2D map (rotation subtracted from the drawing). The camera looks from +z
 * (north), so any rotation keeps the real sense: Earth spins, the spacecraft
 * orbits Earth and the Moon orbits its own counterclockwise, and in the rotating frame the
 * flyby goes around the Moon clockwise over the far side (as in NASA's mission map, which
 * is drawn with Earth on the left: this is that view rotated 180°, not mirrored).
 * Rotating: the Moon (on +x in the frame) ends up on the left and Earth on the right.
 * Inertial: the Moon at the nominal flyby ends up to the left of Earth.
 */
function mapAngleFor(rotating: boolean, eph: ReturnType<typeof ephemerisOf>, flybyMet: number): number {
  return rotating ? Math.PI : eph.moonAngle(flybyMet) + Math.PI;
}

/**
 * Intensity of the light that fills the spacecraft from the camera (the Sun gives 2.6 and the
 * ambient 0.16): a drawing choice so the shaded side is not black.
 */
const SHIP_FILL = 0.45;

/**
 * Reach (km) of the spacecraft's own depth pass. The scene's far plane covers the whole
 * mission, and with the logarithmic depth buffer that leaves ~0.7 m of depth resolution near
 * the spacecraft: pieces a few centimeters apart flicker. With a far plane this close (the
 * spacecraft's distance plus this reach) it drops to ~3 mm. Parts farther than this are a dot.
 * The launch pad (pad.ts) is only drawn in that pass, while the camera is this close to it.
 */
const SHIP_DEPTH_KM = 50;

/**
 * The launch cloud (padCloud.ts) is at most a few km across: farther than this (km) from the camera
 * it is a few pixels and is not computed.
 */
const CLOUD_DRAW_KM = 300;

/**
 * Zoom of the spacecraft camera (drawing choice): each wheel step multiplies the distance by
 * ~1.05, so going from meters to thousands of km took hundreds of steps. While the spacecraft is
 * at least ZOOM_SHIP_PX_SLOW px long the zoom keeps its normal speed; as it shrinks to
 * ZOOM_SHIP_PX_FAST px (almost a dot) it speeds up (log-interpolated) to ZOOM_FAST times.
 */
const ZOOM_SHIP_PX_SLOW = 180;
const ZOOM_SHIP_PX_FAST = 18;
const ZOOM_FAST = 3;
const shipZoomSpeed = (shipPx: number): number => {
  const k = Math.log(ZOOM_SHIP_PX_SLOW / Math.max(shipPx, 1e-9)) / Math.log(ZOOM_SHIP_PX_SLOW / ZOOM_SHIP_PX_FAST);
  return 1 + (ZOOM_FAST - 1) * Math.min(1, Math.max(0, k));
};

const NO_MARKERS: readonly Marker[] = [];

/** Time constant (real s) with which the spacecraft drawing turns towards its heading. */
const HEADING_SMOOTHING = 0.12;

/**
 * Direction of the trail as drawn: the velocity in the drawing frame (in the
 * rotating one it includes the frame's own motion). Derived numerically with a 1 s step.
 */
function displayVelocityDir(r: Vec3, v: Vec3, t: number, frame: ViewFrame): Vec3 {
  return normalize(sub(toDisplayFrame(add(r, v), t + 1, frame), toDisplayFrame(r, t, frame)));
}

/** Turns `from` towards `to` by a fraction `k` of the angle between them. */
function turnToward(from: Vec3, to: Vec3, k: number): Vec3 {
  const angle = angleBetween(from, to);
  if (angle < 1e-6 || k >= 1) return to;
  const n = cross(from, to);
  const axis = length(n) > 1e-9 ? normalize(n) : Z;
  return normalize(rotateAbout(from, axis, angle * k));
}

/** Spacecraft close-up in 3D: fits entirely at real scale. */
const closeRadius = (cfg: VehicleConfig): number => Math.max(0.006, (vehicleExtent(cfg).length * 0.72) / 1000);

/** Default visible half-height (km) for each 3D camera mode. */
function defaultRadius(mode: FixedMode, rotating: boolean, cfg: VehicleConfig): number {
  switch (mode) {
    case 'overview':
      return rotating ? 290000 : 470000;
    // The pad camera does not orbit: this only sets up the orbit camera it hands over to.
    case 'ship':
    case 'pad':
      return closeRadius(cfg);
    // Bodies at real scale in 3D: framings of about three times their radius plus low orbit.
    case 'earth':
      return 22000;
    case 'moon':
      return 7000;
  }
}

const cssVar = (el: Element, name: string): string => getComputedStyle(el).getPropertyValue(name).trim() || '#888888';

/**
 * Map framing: the rectangle that contains the whole nominal plan and both
 * bodies (in the inertial frame, the Moon along its whole path during the mission), with
 * a margin. Returns the center and the half-height that fit everything in a view of
 * `px.width` × `px.height`, leaving `px.top` and `px.bottom` pixels free.
 */
function mapFraming(
  eph: ReturnType<typeof ephemerisOf>,
  px: { width: number; height: number; top: number; bottom: number },
  frame: ViewFrame,
): { center: Vec3; radius: number } {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  const take = (p: Vec3): void => {
    xMin = Math.min(xMin, p.x);
    xMax = Math.max(xMax, p.x);
    yMin = Math.min(yMin, p.y);
    yMax = Math.max(yMax, p.y);
  };
  for (const [t, x, y] of NOMINAL_PATH) take(toDisplayFrame({ x, y, z: 0 }, t, frame));
  const earth = toDisplayFrame(eph.earth(0).r, 0, frame);
  const re = R_EARTH;
  take(add(earth, { x: re, y: re, z: 0 }));
  take(add(earth, { x: -re, y: -re, z: 0 }));
  if (frame.rotating) {
    // The Moon with its whole (dashed) sphere of influence.
    const moon = toDisplayFrame(eph.moon(0).r, 0, frame);
    take(add(moon, { x: MOON_SOI, y: MOON_SOI, z: 0 }));
    take(add(moon, { x: -MOON_SOI, y: -MOON_SOI, z: 0 }));
  } else {
    // The Moon moves: its whole arc fits, from launch to the end of the plan.
    const tEnd = NOMINAL_PATH.length ? NOMINAL_PATH[NOMINAL_PATH.length - 1][0] : 0;
    const r = R_MOON * 2;
    for (let i = 0; i <= 64; i++) {
      const m = toDisplayFrame(eph.moon((tEnd * i) / 64).r, 0, frame);
      take(add(m, { x: r, y: r, z: 0 }));
      take(add(m, { x: -r, y: -r, z: 0 }));
    }
  }
  // Pixels per km: the rectangle (with margin) fits in width and in the free height between
  // the toolbar and the HUD.
  const boxW = Math.max(1, xMax - xMin) * 1.12;
  const boxH = Math.max(1, yMax - yMin) * 1.12;
  const k = Math.min(px.width / boxW, Math.max(1, px.height - px.top - px.bottom) / boxH);
  // The orthographic camera applies the radius to the smaller dimension (see camera.ts).
  const radius = Math.min(px.width, px.height) / 2 / k;
  // The view center is shifted so the rectangle is centered in the free height.
  const cy = (yMin + yMax) / 2 + (px.top - px.bottom) / (2 * k);
  return { center: { x: (xMin + xMax) / 2, y: cy, z: 0 }, radius };
}

/** Height covered by the map's toolbar and HUD (px), when the framing needs it. */
const MAP_PAD_TOP = 40;
const MAP_PAD_BOTTOM = 100;

/** A length in px from a CSS custom property of `el`, or `fallback` when it is not set. */
function cssPx(el: Element, name: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

/** Creates a trajectory view inside `container` and starts its draw loop. */
export function createTrajectoryView(container: HTMLElement, dim: ViewDim, deps: TrajectoryViewDeps): { dispose(): void } {
  const is3d = dim === '3d';
  const isMap = dim === '2d';
  const isInset = dim === 'inset';
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(cssVar(container, '--c-screen'));
  renderer.autoClear = false;
  renderer.domElement.className = 'view-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // The Sun: its direction comes from the simulation every frame (sunDirection, the date and
  // time of the launch window) and is the same for Earth, the Moon and the spacecraft.
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  scene.add(sun, new THREE.AmbientLight(0xffffff, 0.16));

  const vehicleColors = {
    hull: cssVar(container, '--c-ship-hull'),
    dark: cssVar(container, '--c-ship-dark'),
    solar: cssVar(container, '--c-ship-solar'),
    core: cssVar(container, '--c-ship-core'),
    flame: cssVar(container, '--c-trail-prox'),
    metal: cssVar(container, '--c-ship-metal'),
    gold: cssVar(container, '--c-ship-gold'),
  };
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  // Earth's atmosphere (atmosphere.ts), with the sky color of the attitude ball: only in 3D,
  // the map and the inset keep their flat infographic style.
  const atmosphere = is3d ? createAtmosphere(cssVar(container, '--c-adi-sky')) : null;
  // In 3D the stars fade where the sky is bright (the same air as the atmosphere).
  const stars = createStars(cssVar(container, '--c-label'), undefined, atmosphere?.haze ?? null);
  const starEye = new THREE.Vector3();
  /** The pad's vertical in the scene (the atmosphere bounds the Earth mesh's sag by the angle from it). */
  const padUp = new THREE.Vector3();
  // What the pad's ground is made of (padLayout.ts), with the colors of the photo of the pad: only in 3D.
  const groundLayout = is3d
    ? createGroundLayout(
        {
          grass: cssVar(container, '--c-ground-grass'),
          scrub: cssVar(container, '--c-ground-scrub'),
          sand: cssVar(container, '--c-ground-sand'),
          water: cssVar(container, '--c-ground-water'),
          road: cssVar(container, '--c-ground-road'),
          concrete: cssVar(container, '--c-pad-concrete'),
        },
        anisotropy,
      )
    : null;
  const bodies = createBodies({
    earth: cssVar(container, '--c-body-earth'),
    moon: cssVar(container, '--c-body-moon'),
    orbit: cssVar(container, '--c-label'),
    ei: cssVar(container, '--c-caution'),
  }, isMap, is3d ? { size: '4k', anisotropy: renderer.capabilities.getMaxAnisotropy(), detail: true } : null, atmosphere ? { haze: atmosphere.haze, layout: groundLayout?.surface } : null);
  bodies.setLit(is3d);
  // The pad's own ground (padGround.ts), only in 3D: Earth leaves a hole for it.
  const ground = is3d && bodies.groundMaterial ? createPadGround(bodies.groundMaterial) : null;
  // The entry interface ring stays on the map and the inset (where it reads as a
  // reference); in 3D it is hidden: next to the textured Earth it looked like the equator.
  bodies.eiRing.visible = !is3d;
  const trails = createTrails({
    out: cssVar(container, '--c-trail-out'),
    ret: cssVar(container, '--c-trail-return'),
    prox: cssVar(container, '--c-trail-prox'),
    predicted: cssVar(container, '--c-label'),
  });
  // The model only exists in 3D: the map and the inset draw the spacecraft as a 2D icon.
  const model = is3d ? createVehicleModel(vehicleColors, anisotropy) : null;
  const debrisModels = is3d ? createDebrisModels(vehicleColors, anisotropy) : null;
  // The Mobile Launcher and LC‑39B (pad.ts), only in 3D, in the spacecraft's pass.
  const padModel = is3d
    ? createPadModel(
        {
          steel: cssVar(container, '--c-pad-steel'),
          base: cssVar(container, '--c-pad-base'),
          concrete: cssVar(container, '--c-pad-concrete'),
          tank: cssVar(container, '--c-pad-tank'),
          hood: cssVar(container, '--c-pad-hood'),
          spark: vehicleColors.flame,
        },
      )
    : null;
  const debrisGroup = new THREE.Group();
  scene.add(bodies.group, trails.group);
  if (ground) scene.add(ground.mesh);
  // The ascent's exhaust wake in the air (wake.ts), at real scale, and the vapor, water and launch
  // cloud on the pad (padCloud.ts): only in 3D, with the colors of the launch photos.
  const smoke = { steam: cssVar(container, '--c-smoke-steam'), tan: cssVar(container, '--c-smoke-tan') };
  const wake = is3d ? createWake(smoke) : null;
  const cloud = is3d ? createPadCloud(smoke) : null;
  // Soft transparent things, drawn in two halves by distance (depthSplit.ts): what lies beyond the
  // precise pass's reach after the scene, the rest in that pass after the pad and the spacecraft, so
  // the tower no longer paints over the smoke in front of it. Among them, the cloud before the wake
  // (it is lower, mostly behind the column's base), and both before the additive flames and sparks.
  const fxScene = new THREE.Scene();
  const fx: THREE.Mesh[] = [];
  if (cloud) {
    cloud.mesh.renderOrder = -0.2;
    fx.push(cloud.mesh);
  }
  if (wake) {
    wake.mesh.renderOrder = -0.1;
    fx.push(wake.mesh);
  }
  if (atmosphere) scene.add(atmosphere.mesh);
  // The spacecraft and its parts are drawn in a pass of their own, after the scene and with
  // its depth: the same Sun plus a dim fill from the camera, so the side in shadow still shows
  // its shape (a drawing choice, not physics). Earth and the Moon keep only the Sun.
  const shipScene = new THREE.Scene();
  const shipSun = new THREE.DirectionalLight(0xffffff, 2.6);
  const shipFill = new THREE.DirectionalLight(0xffffff, SHIP_FILL);
  shipScene.add(shipSun, shipFill, new THREE.AmbientLight(0xffffff, 0.16), debrisGroup);
  if (model) shipScene.add(model.group);
  if (padModel) shipScene.add(padModel.group);
  // Near the spacecraft (or the pad) that pass uses its own far plane (see SHIP_DEPTH_KM), and Earth
  // only writes its depth there, so the ground still hides what is under it (the flames on the pad).
  // The pad's ground writes its depth there too, at the same precision as the spacecraft.
  const shipCamera = new THREE.PerspectiveCamera();
  const earthDepth = new THREE.Mesh(bodies.earth.geometry, bodies.earthDepthMaterial);
  earthDepth.matrixAutoUpdate = false;
  shipScene.add(earthDepth);
  if (ground) shipScene.add(ground.depth);
  const overlay = createOverlay(container);
  const rig: CameraRig = is3d ? createPerspectiveRig(renderer.domElement) : createOrthoRig(renderer.domElement);
  // The inset is static. The map has zoom (wheel or pinch, towards the cursor) and can be
  // dragged; double-click returns to the whole-mission framing.
  if (isInset) rig.setActive(false);
  const onDoubleClick = (): void => {
    lastCameraKey = '';
  };
  if (isMap) renderer.domElement.addEventListener('dblclick', onDoubleClick);

  // Key of the last applied framing (invalidated on resize).
  let lastCameraKey = '';
  let width = 1;
  let height = 1;
  const resize = (): void => {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height);
    rig.resize(width, height);
    trails.setResolution(width, height);
    wake?.setResolution(height);
    lastCameraKey = '';
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  // Caches so geometries are not rebuilt needlessly.
  let lastTrail: TrailPoint[] | null = null;
  let lastTrailKey = '';
  let lastWakeTrail: TrailPoint[] | null = null;
  let lastWakeKey = '';
  let lastPrediction: Prediction | null | undefined;
  let lastPredictionKey = '';
  let lastNominalKey = '';
  let lastIconKey = '';
  let lastEngines = '';
  let lastParams: MissionParams | null = null;
  let eventNames: ReadonlyMap<string, string> = new Map();
  let mapCenter: Vec3 = ZERO;
  /** Ephemeris the drawn lunar orbit was built with. */
  let orbitEph: ReturnType<typeof ephemerisOf> | null = null;
  /** Heading the spacecraft is drawn with (drawing frame), smoothed between frames. */
  let heading: Vec3 | null = null;
  let lastT = -Infinity;
  /** Weight of the pad camera (0 = orbit camera, 1 = pad camera); AUTO moves it smoothly. */
  let padWeight = 0;
  let lastCameraSetting: CameraMode | null = null;
  let lastCameraT = -Infinity;
  /** The pad camera's field of view is reset to frame the rocket the next time it is placed. */
  let padFovPending = true;
  /** Sea-level point under the launch site (scene units) and the pad's axes in the drawing frame. */
  const padOrigin = new THREE.Vector3();
  let axes = padAxes(0);
  const fixedEye = new THREE.Vector3();
  const fixedTarget = new THREE.Vector3();
  const fixedUp = new THREE.Vector3();
  const fixedView = { eye: fixedEye, target: fixedTarget, up: fixedUp };
  let frameCount = 0;
  let lastTime = performance.now();
  let raf = 0;
  const basis = new THREE.Matrix4();
  const vx = new THREE.Vector3();
  const vy = new THREE.Vector3();
  const vz = new THREE.Vector3();

  /**
   * Orients an object with its +x axis along `dir`. Its +y axis goes towards `belly` (the
   * spacecraft's body +Z, so the model rolls with the attitude) or, without it, in the orbital plane.
   */
  const orient = (object: THREE.Object3D, dir: Vec3, belly?: Vec3): void => {
    const onPlane = belly ? sub(belly, scale(dir, dot(belly, dir))) : cross(Z, dir);
    const fallback = cross(Z, dir);
    const y = length(onPlane) > 1e-6 ? normalize(onPlane) : length(fallback) > 1e-6 ? normalize(fallback) : { x: 0, y: 1, z: 0 };
    const z = cross(dir, y);
    basis.makeBasis(vx.set(dir.x, dir.y, dir.z), vy.set(y.x, y.y, y.z), vz.set(z.x, z.y, z.z));
    object.quaternion.setFromRotationMatrix(basis);
  };

  /**
   * Initial 3D framing of the spacecraft: from the side (tangent to the local vertical) and from
   * above the orbital plane, with a bit of height. Looking from the planet's side the
   * camera would end up underground on the pad.
   */
  const aimFromSide = (pos: THREE.Vector3, s: SimState): void => {
    const eph = ephemerisOf(s);
    const e = eph.earth(s.t).r;
    const m = eph.moon(s.t).r;
    const body = length(sub(s.ship.r, m)) < MOON_SOI ? m : e;
    const rotating = deps.getSettings().frame === 'rotating';
    const f: ViewFrame = { eph, rotating, origin: ZERO };
    const up = normalize(sub(toDisplayFrame(s.ship.r, s.t, f), toDisplayFrame(body, s.t, f)));
    const side = normalize(cross(Z, up));
    const d = add(add(scale(side, -0.72), scale(Z, 0.62)), scale(up, 0.3));
    const dist = pos.length();
    pos.set(d.x, d.y, d.z).setLength(dist);
  };
  const tmp = new THREE.Vector3();
  const keepOutside = (pos: THREE.Vector3, center: THREE.Vector3, radius: number): void => {
    tmp.subVectors(pos, center);
    const min = radius * (1 + 1e-6) + pos.length() * 0.05;
    if (tmp.length() < min) pos.copy(center).addScaledVector(tmp.normalize(), min);
  };
  /** East-north-up meters from the pad's sea-level point to scene units. */
  const enuToScene = (p: Vec3, out: THREE.Vector3): THREE.Vector3 =>
    out
      .copy(padOrigin)
      .addScaledVector(vy.set(axes.east.x, axes.east.y, axes.east.z), p.x * M_TO_SCENE)
      .addScaledVector(vy.set(axes.north.x, axes.north.y, axes.north.z), p.y * M_TO_SCENE)
      .addScaledVector(vy.set(axes.up.x, axes.up.y, axes.up.z), p.z * M_TO_SCENE);
  /** Over the pad's ground (with its relief), the orbit camera stays a little above it. */
  const keepAboveGround = (pos: THREE.Vector3): void => {
    tmp.subVectors(pos, padOrigin).divideScalar(M_TO_SCENE);
    const t3 = { x: tmp.x, y: tmp.y, z: tmp.z };
    const enu = { x: dot(t3, axes.east), y: dot(t3, axes.north), z: dot(t3, axes.up) };
    const lifted = liftAboveGround(enu, Math.max(1, (0.05 * pos.length()) / M_TO_SCENE));
    if (lifted !== enu) enuToScene(lifted, pos);
  };

  const draw = (now: number): void => {
    raf = requestAnimationFrame(draw);
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    deps.onFrame?.(dt);
    frameCount++;

    const s = deps.getState();
    const settings = deps.getSettings();
    const eph = ephemerisOf(s);
    // The inset lives in the rotating frame; the map, in the chosen one (rotating by default).
    const rotating = is3d ? settings.frame === 'rotating' : isMap ? settings.mapFrame === 'rotating' : true;
    const earth = eph.earth(s.t);
    const moon = eph.moon(s.t);
    // 2D map and inset: Earth on the right and the Moon on the left (see mapAngleFor).
    const flybyMet = s.params.nominal.flybyMet;
    const mapAngle = is3d ? 0 : mapAngleFor(rotating, eph, flybyMet);
    const frameAngle = rotating ? eph.moonAngle(s.t) + mapAngle : mapAngle;
    /** Inertial direction brought into the drawing frame. */
    const displayDir = (d: Vec3): Vec3 => (frameAngle ? rotateZ(d, -frameAngle) : d);
    const toSun = displayDir(sunDirection(s.t));
    sun.position.set(toSun.x, toSun.y, toSun.z);
    shipSun.position.copy(sun.position);

    // --- Camera: effective mode and framing ---
    const base: ViewFrame = { eph, rotating, angle: mapAngle, origin: ZERO };
    let camera: { mode: FixedMode; radius: number };
    if (isMap) {
      const key = `map|${settings.mapFrame}|${width}x${height}|${s.params.moonAngle0Deg}`;
      if (key !== lastCameraKey) {
        // With the rotation, the rotating frame ends up vertical: both frames need the margins.
        // A narrow view lays the toolbar and the HUD out of the map (styles.css sets the pads to 0).
        const pad = { top: cssPx(container, '--map-pad-top', MAP_PAD_TOP), bottom: cssPx(container, '--map-pad-bottom', MAP_PAD_BOTTOM) };
        const f = mapFraming(eph, { width, height, ...pad }, base);
        mapCenter = f.center;
        rig.setViewRadius(f.radius);
        rig.setPan(0, 0);
        lastCameraKey = key;
      }
      camera = { mode: 'overview', radius: rig.getViewRadius() };
    } else if (isInset) {
      if (insetTarget(s) === 'moon') {
        // Moon vicinity: centered on the Moon, with a fixed scale.
        camera = { mode: 'moon', radius: LUNAR_RADIUS };
        if (lastCameraKey !== 'inset|moon') {
          rig.setViewRadius(camera.radius);
          lastCameraKey = 'inset|moon';
        }
      } else {
        // From E13 (CM/SM separation) or, if the crew does not separate, near Earth.
        const landing =
          (s.phase === 'REGRESO' || s.phase === 'ENTRADA') &&
          (s.vehicle.cmSeparated || length(sub(s.ship.r, earth.r)) < INSET_LANDING_DISTANCE);
        const high = !landing && (s.autoBurns.E5.status === 'done' || s.autoBurns.E5.status === 'burning' || s.vehicle.icpsSeparated);
        camera = { mode: 'earth', radius: high ? INSET_RADIUS_HIGH : INSET_RADIUS_LOW };
        const key = `inset|${camera.radius}`;
        if (key !== lastCameraKey) {
          rig.setViewRadius(camera.radius);
          lastCameraKey = key;
        }
      }
    } else {
      const mode = effectiveCameraMode(settings.cameraMode, s.t);
      const radius = defaultRadius(mode, rotating, s.vehicle);
      camera = { mode, radius };
      const cameraKey = `${settings.cameraMode}|${mode}|${radius}|${settings.frame}`;
      if (cameraKey !== lastCameraKey) {
        // Only reframes when the mode or the stage changes: in between, the manual zoom is respected.
        rig.setViewRadius(radius);
        if (mode === 'ship') aimFromSide(rig.control.position, s);
        if (mode === 'pad') padFovPending = true;
        lastCameraKey = cameraKey;
      }
      // Pad camera weight: a mode picked by hand, or time going back, switches at once; AUTO
      // handing over from the pad to the spacecraft camera blends over PAD_BLEND_S real seconds.
      const target = mode === 'pad' ? 1 : 0;
      if (settings.cameraMode !== lastCameraSetting || s.t < lastCameraT) padWeight = target;
      else padWeight += Math.max(-dt / PAD_BLEND_S, Math.min(dt / PAD_BLEND_S, target - padWeight));
      lastCameraSetting = settings.cameraMode;
      lastCameraT = s.t;
    }

    // --- Drawing frame and floating origin ---
    const cfg = s.vehicle;
    const shipDir = displayDir(s.attitude.dir);
    // Body +Z (the "belly"): with no roll it lies in the orbital plane, as the model was always drawn.
    const shipBelly = displayDir(cross(s.attitude.dir, s.attitude.pitchAxis));
    // Drawn heading: in cruise, along the trail (forwards, or backwards with the
    // capsule alone); otherwise (ascent, burns, pre-burn orientation, DAP in INRTL or MAN),
    // the actual attitude. The switch between the two is smoothed so it does not jump.
    const sense = cruiseSense(s);
    const headingTarget = sense !== 0 ? scale(displayVelocityDir(s.ship.r, s.ship.v, s.t, base), sense) : shipDir;
    heading = !heading || s.t < lastT ? headingTarget : turnToward(heading, headingTarget, 1 - Math.exp(-dt / HEADING_SMOOTHING));
    lastT = s.t;
    // While the core stage is attached, the model hangs from the base of the boosters' aft skirts
    // (the simulated point), so on the pad it rests on the support posts; the camera looks at its center.
    const anchorBase = !cfg.coreSeparated;
    const shipCenterKm = anchorBase ? (vehicleExtent(cfg).center - PAD_ANCHOR_STATION) / 1000 : 0;
    const focus = (): Vec3 => {
      if (isMap) {
        const pan = rig.getPan();
        return { x: mapCenter.x + pan.x, y: mapCenter.y + pan.y, z: 0 };
      }
      if (camera.mode === 'ship' || camera.mode === 'pad') return add(toDisplayFrame(s.ship.r, s.t, base), scale(shipDir, shipCenterKm));
      if (camera.mode === 'earth') return toDisplayFrame(earth.r, s.t, base);
      if (camera.mode === 'moon') return toDisplayFrame(moon.r, s.t, base);
      return rotating ? scale(add(toDisplayFrame(earth.r, s.t, base), toDisplayFrame(moon.r, s.t, base)), 0.5) : ZERO;
    };
    const frame: ViewFrame = { eph, rotating, angle: mapAngle, origin: focus() };

    // --- Bodies and references ---
    worldToScene(earth.r, s.t, frame, bodies.earth.position);
    worldToScene(moon.r, s.t, frame, bodies.moon.position);
    // Earth rotates with the pad: that way the launch site always falls on a
    // vertex of the sphere and the rocket rests on the ground, not on a lower facet.
    bodies.earth.rotation.z = EARTH_ROTATION_IN_PLANE * s.t - frameAngle;
    // The pad's frame turns with Earth's mesh (its local +y is the pad). Its sea-level point is
    // computed in double precision, relative to the floating origin like everything else.
    axes = padAxes(bodies.earth.rotation.z);
    padOrigin.copy(bodies.earth.position).addScaledVector(vx.set(axes.up.x, axes.up.y, axes.up.z), R_EARTH * KM_TO_SCENE);
    ground?.place(padOrigin, axes, M_TO_SCENE);
    padModel?.place(padOrigin, axes, M_TO_SCENE);
    cloud?.place(padOrigin, axes, M_TO_SCENE);
    // Arms, tail masts and igniter sparks: a function of the mission time only (pad.ts).
    padModel?.animate(s.t);
    // Synchronous rotation: the Moon's near side (longitude 0 of its map, local +x)
    // always faces Earth. Libration is ignored.
    bodies.moon.rotation.z = Math.atan2(bodies.earth.position.y - bodies.moon.position.y, bodies.earth.position.x - bodies.moon.position.x);
    bodies.eiRing.position.copy(bodies.earth.position);
    bodies.soiRing.position.copy(bodies.moon.position);
    atmosphere?.update(bodies.earth.position, bodies.moon.position, sun.position, padUp.set(axes.up.x, axes.up.y, axes.up.z));
    worldToScene(ZERO, s.t, frame, bodies.moonOrbit.position);
    // The lunar orbit is an ellipse that depends on the phase: rebuilt if the ephemeris changes.
    if (eph !== orbitEph) {
      const pts: Vec3[] = [];
      for (let i = 0; i < 360; i++) pts.push(eph.moon((eph.moonPeriod * i) / 360).r);
      bodies.setMoonOrbit(pts);
      orbitEph = eph;
    }
    bodies.moonOrbit.rotation.z = -frameAngle;
    // In the rotating frame the Moon barely moves: its orbit adds nothing.
    // With the spacecraft camera the orbital plane is seen edge-on and the lunar orbit and the
    // sphere of influence were just a line on the horizon: hidden there, and from the pad camera.
    const shipCamera3d = is3d && (camera.mode === 'ship' || camera.mode === 'pad');
    bodies.moonOrbit.visible = !rotating && !shipCamera3d;
    bodies.soiRing.visible = !shipCamera3d;

    // --- Trails ---
    const tip = { t: s.t, r: s.ship.r };
    const viewKey = `${rotating}|${camera.mode}`;
    const trailEvery = s.trail.length > 6000 ? 6 : 1;
    // With the spacecraft camera (AUTO or SHIP) the 3D view draws no trail (Gastón's request): the
    // orbital plane is seen edge-on and the trail was a straight line to the horizon. The Earth,
    // Moon and overview cameras, the map and the inset keep it.
    trails.group.visible = !shipCamera3d;
    const trailKey = `${viewKey}|${s.trail.length}|${s.t}`;
    if (!shipCamera3d && (s.trail !== lastTrail || (trailKey !== lastTrailKey && frameCount % trailEvery === 0))) {
      trails.setTraveled(s.trail, tip, frame);
      lastTrail = s.trail;
      lastTrailKey = trailKey;
    }
    // The exhaust wake moves with the air even while nothing else changes: rebuilt whenever the
    // time does (it is a few hundred vertices, and nothing at all once the smoke is gone).
    if (wake) {
      const wakeKey = `${viewKey}|${s.t}`;
      if (s.trail !== lastWakeTrail || wakeKey !== lastWakeKey) {
        wake.update(s.trail, tip, eph, frame);
        lastWakeTrail = s.trail;
        lastWakeKey = wakeKey;
      }
    }
    // The 3D view only draws what has been flown: the remaining trajectory is left to the map and the inset.
    const predictionKey = `${viewKey}|${Math.floor(frameCount / 10)}|${s.t}`;
    if (!is3d && (s.prediction !== lastPrediction || predictionKey !== lastPredictionKey)) {
      trails.setPredicted(s.prediction ? s.prediction.points : [], tip, frame);
      lastPrediction = s.prediction;
      lastPredictionKey = predictionKey;
    }
    // The nominal plan is only drawn on the map and the inset, and only rebuilt if the origin changes.
    if (!is3d) {
      const nominalKey = `${rotating}|${frame.origin.x.toFixed(0)}|${frame.origin.y.toFixed(0)}|${s.params.moonAngle0Deg}`;
      if (nominalKey !== lastNominalKey) {
        trails.setNominal(NOMINAL_PATH, frame);
        lastNominalKey = nominalKey;
      }
    }
    trails.place(frame);
    const viewRadiusScene = rig.getViewRadius() * KM_TO_SCENE;
    trails.setDashScale(viewRadiusScene);

    // --- Spacecraft: oriented by its attitude, with the parts of the current stage ---
    const engines = runningEngines(s);
    const enginesKey = engines.join(',');
    const iconKey = `${cfg.srbSeparated}${cfg.lasJettisoned}${cfg.coreSeparated}${cfg.icpsSeparated}${cfg.cmSeparated}|${enginesKey}`;
    let shipLengthM = 0;
    if (model) {
      shipLengthM = model.update(cfg, engines, anchorBase);
      worldToScene(s.ship.r, s.t, frame, model.group.position);
      orient(model.group, heading, shipBelly);
      // Always at real scale; when it is smaller than a few pixels, the HTML layer marks it with a dot.
      model.group.scale.setScalar(M_TO_SCENE);
    } else if (iconKey !== lastIconKey) {
      overlay.setShipIcon(vehicleIconSvg(cfg, engines));
    }
    lastIconKey = iconKey;
    // Flash when an engine ignites.
    if (lastEngines !== enginesKey && engines.some((e) => !lastEngines.split(',').includes(e)) && frameCount > 1) overlay.flash();
    lastEngines = enginesKey;

    // --- Jettisoned parts ---
    if (debrisModels) {
      const alive = new Set(s.debris.map((b) => b.id));
      for (const child of [...debrisGroup.children]) if (!alive.has(child.name)) debrisGroup.remove(child);
      for (const b of s.debris) {
        const g = debrisModels.get(b.id);
        if (g.parent !== debrisGroup) {
          g.name = b.id;
          debrisGroup.add(g);
        }
        worldToScene(b.ship.r, b.t, frame, g.position);
        orient(g, displayDir(b.dir));
        g.scale.setScalar(M_TO_SCENE);
      }
    }

    // --- HTML layer ---
    if (s.params !== lastParams) {
      eventNames = new Map(timeline(s.params).map((e) => [e.id, e.name]));
      lastParams = s.params;
    }
    // The numbered event markers stay on the map and the inset: in 3D they piled up on the horizon.
    overlay.setMarkers(is3d ? NO_MARKERS : s.markers, eventNames);
    if (is3d) {
      const shipPxNow = (shipLengthM * M_TO_SCENE * Math.min(width, height)) / 2 / viewRadiusScene;
      rig.setZoomSpeed(camera.mode === 'ship' ? shipZoomSpeed(shipPxNow) : 1);
      // Pad camera: on the ground by the pad, with the local vertical up, looking a bit below the
      // vehicle's center so the ground under it shows; it follows the rocket as it climbs.
      if (padWeight > 0) {
        enuToScene(padCameraEye(), fixedEye);
        const lengthM = vehicleExtent(cfg).length;
        fixedTarget.set(shipDir.x, shipDir.y, shipDir.z).multiplyScalar(-0.15 * lengthM * M_TO_SCENE);
        fixedUp.set(axes.up.x, axes.up.y, axes.up.z);
        if (padFovPending) {
          // The vehicle fills ~60 % of the height; the wheel zooms from there.
          const d = fixedEye.distanceTo(fixedTarget) / M_TO_SCENE;
          rig.setFixedFov(1.6 * THREE.MathUtils.radToDeg(2 * Math.atan(lengthM / 2 / d)));
          padFovPending = false;
        }
        const w = padWeight * padWeight * (3 - 2 * padWeight);
        rig.setFixedView(fixedView, w);
      } else {
        rig.setFixedView(null, 0);
      }
    }
    // The orbit camera never ends up inside a body (at real scale, near the spacecraft in
    // low orbit, the surface is meters away) nor under the pad's ground: it is pushed outside, along the vertical.
    rig.update(
      is3d
        ? (position) => {
            keepOutside(position, bodies.earth.position, R_EARTH * KM_TO_SCENE);
            keepOutside(position, bodies.moon.position, R_MOON * KM_TO_SCENE);
            keepAboveGround(position);
          }
        : undefined,
    );
    rig.camera.updateMatrixWorld();
    const pxPerScene = Math.min(width, height) / 2 / viewRadiusScene;
    const es = getLocale() === 'es';
    overlay.update(rig.camera, width, height, frame, {
      earth: earth.r,
      moon: moon.r,
      ship: s.ship.r,
      t: s.t,
      shipAngle: Math.atan2(heading.y, heading.x),
      shipPx: is3d ? shipLengthM * M_TO_SCENE * pxPerScene : Infinity,
      showIcons: !is3d,
      radiusPx: {
        earth: R_EARTH * KM_TO_SCENE * pxPerScene,
        moon: R_MOON * KM_TO_SCENE * pxPerScene,
      },
      debris: s.debris.map((item) => {
        const d = displayDir(item.dir);
        return { item, angle: Math.atan2(d.y, d.x), px: is3d ? debrisLength(item.id) * M_TO_SCENE * pxPerScene : Infinity };
      }),
      labels: { earth: es ? 'TIERRA' : 'EARTH', moon: es ? 'LUNA' : 'MOON' },
      // Inertial map: where the Moon will be when the spacecraft arrives (nominal flyby).
      ghost:
        isMap && !rotating && s.t < flybyMet
          ? {
              r: eph.moon(flybyMet).r,
              t: flybyMet,
              radiusPx: R_MOON * KM_TO_SCENE * pxPerScene,
              label: es ? 'LUNA EN EL SOBREVUELO' : 'MOON AT FLYBY',
            }
          : null,
    });

    // --- Drawing: star background and, on top, the scene ---
    const cam = rig.camera;
    const reach = SHIP_DEPTH_KM * KM_TO_SCENE;
    const padDistance = cam.position.distanceTo(padOrigin);
    // The pad is drawn only near the camera, in the precise pass; meanwhile the ground leaves the
    // flame trench open for it (in the main pass too, so the trench shows through the ground).
    const padNear = padModel !== null && cam instanceof THREE.PerspectiveCamera && padDistance < reach;
    ground?.setTrench(padNear);
    const shipDistance = model ? cam.position.distanceTo(model.group.position) : Infinity;
    const shipNear = cam instanceof THREE.PerspectiveCamera && shipDistance < reach;
    // The precise pass (spacecraft and pad near the camera) reaches this view depth.
    const precise = shipNear || padNear;
    const preciseFar = Math.max(shipNear ? shipDistance : 0, padNear ? padDistance : 0) + reach;
    if (cloud) {
      if (padDistance < CLOUD_DRAW_KM * KM_TO_SCENE) cloud.update(s.t, riseFromTrail(s.trail, tip, eph), cam.position, sun.position);
      else cloud.mesh.visible = false;
    }
    for (const o of fx) fxScene.add(o);
    cloud?.setSplit(precise ? 'far' : 'all', preciseFar);
    wake?.setSplit(precise ? 'far' : 'all', preciseFar);
    renderer.clear();
    // The camera relative to Earth's center, in km, for the sky brightness behind each star.
    stars.render(renderer, cam, width / height, frameAngle, atmosphere ? starEye.copy(cam.position).sub(bodies.earth.position).divideScalar(KM_TO_SCENE) : undefined);
    renderer.clearDepth();
    atmosphere?.setEye(cam.position);
    renderer.render(scene, cam);
    renderer.render(fxScene, cam);
    if (model) {
      // The fill comes from the camera's side (the scene origin is the point it looks at).
      shipFill.position.copy(cam.position);
      if (padModel) padModel.group.visible = false;
      if (!shipNear) {
        // Far from the camera: the spacecraft and its parts with the scene's camera and depth.
        earthDepth.visible = false;
        if (ground) ground.depth.visible = false;
        model.group.visible = true;
        debrisGroup.visible = true;
        renderer.render(shipScene, cam);
      }
      if (precise && cam instanceof THREE.PerspectiveCamera) {
        shipCamera.copy(cam);
        shipCamera.far = preciseFar;
        shipCamera.updateProjectionMatrix();
        // Earth's and the ground's world matrices as the main pass just computed them.
        earthDepth.matrix.copy(bodies.earth.matrixWorld);
        earthDepth.matrixWorldNeedsUpdate = true;
        earthDepth.visible = true;
        if (ground) {
          ground.depth.matrix.copy(ground.mesh.matrixWorld);
          ground.depth.matrixWorldNeedsUpdate = true;
          ground.depth.visible = true;
        }
        model.group.visible = shipNear;
        debrisGroup.visible = shipNear;
        if (padModel) padModel.group.visible = padNear;
        // The near half of the cloud and the wake, after the opaque pad and spacecraft.
        for (const o of fx) shipScene.add(o);
        cloud?.setSplit('near', preciseFar);
        wake?.setSplit('near', preciseFar);
        renderer.clearDepth();
        renderer.render(shipScene, shipCamera);
      }
    }
  };
  raf = requestAnimationFrame(draw);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.domElement.removeEventListener('dblclick', onDoubleClick);
      rig.dispose();
      overlay.dispose();
      bodies.dispose();
      trails.dispose();
      wake?.dispose();
      cloud?.dispose();
      atmosphere?.dispose();
      stars.dispose();
      model?.dispose();
      debrisModels?.dispose();
      ground?.dispose();
      groundLayout?.dispose();
      padModel?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
