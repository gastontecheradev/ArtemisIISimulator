import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { KM_TO_SCENE } from './worldToScene';

/**
 * Camera abstraction. The rest of render/ does not know whether the view is top-down (2D)
 * or perspective (3D): with the floating origin, the camera always looks at the scene
 * origin and only changes how much it covers (`viewRadius`, in km).
 */
export interface CameraRig {
  readonly kind: '2d' | '3d';
  /** The camera the view is drawn with. */
  readonly camera: THREE.Camera;
  /**
   * The camera the user moves (orbit controls in 3D). It is `camera` itself except while a fixed
   * view is shown (setFixedView): then it keeps its own pose, to go back to it.
   */
  readonly control: THREE.Camera;
  resize(width: number, height: number): void;
  /** Visible half-height in km (2D) or framed radius (3D). */
  getViewRadius(): number;
  setViewRadius(km: number): void;
  /**
   * Manual offset of the view center (km, in screen axes). Only the
   * 2D camera moves it (drag and zoom towards the cursor); in 3D it is always zero.
   */
  getPan(): { x: number; y: number };
  setPan(x: number, y: number): void;
  /** Only the active camera handles the wheel and gestures. */
  setActive(on: boolean): void;
  /** Wheel/pinch zoom speed of the 3D camera (1 = OrbitControls default). The 2D camera ignores it. */
  setZoomSpeed(speed: number): void;
  /**
   * 3D only: a fixed view (scene units) shown with weight `weight` (0 = the orbit camera, 1 = the
   * fixed view; in between, a mix of both). While it weighs more than half, the wheel changes its
   * field of view (a telescope zoom) and the orbit controls are idle. The 2D camera ignores it.
   */
  setFixedView(view: FixedView | null, weight: number): void;
  /** Field of view of the fixed view (degrees). */
  setFixedFov(deg: number): void;
  /** Applies the controls and composes the camera. `constrain` may move the orbit camera's position (scene units). */
  update(constrain?: (position: THREE.Vector3) => void): void;
  dispose(): void;
}

/** A camera standing at `eye`, looking at `target`, with `up` as its vertical. */
export interface FixedView {
  readonly eye: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly up: THREE.Vector3;
}

/** Minimum framing: a few meters, to see the spacecraft at real scale. */
const MIN_RADIUS = 0.004; // km
const MAX_RADIUS = 3e6;
const clampRadius = (km: number): number => Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, km));

/**
 * Top-down orthographic camera (looks from +z, with +x to the right and +y up: it never
 * mirrors). Wheel and pinch zoom towards the cursor; dragging pans the view.
 */
export function createOrthoRig(dom: HTMLElement): CameraRig {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
  camera.position.set(0, 0, 2000);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  let radius = 300000;
  let aspect = 1;
  let active = true;
  let panX = 0;
  let panY = 0;

  /** Visible half-height in km (the radius applies to the smaller dimension). */
  const halfHeight = (): number => radius * (aspect >= 1 ? 1 : 1 / aspect);
  const apply = (): void => {
    const h = halfHeight() * KM_TO_SCENE;
    camera.top = h;
    camera.bottom = -h;
    camera.left = -h * aspect;
    camera.right = h * aspect;
    camera.updateProjectionMatrix();
  };
  /** km per screen pixel. */
  const kmPerPx = (): number => (2 * halfHeight()) / Math.max(1, dom.clientHeight);
  /** Screen point relative to the view center, in km (y up). */
  const offsetKm = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = dom.getBoundingClientRect();
    const f = kmPerPx();
    return { x: (clientX - rect.left - rect.width / 2) * f, y: -(clientY - rect.top - rect.height / 2) * f };
  };
  /** Changes the radius keeping fixed the screen point under (clientX, clientY). */
  const zoomAt = (next: number, clientX: number, clientY: number): void => {
    const before = offsetKm(clientX, clientY);
    const r = clampRadius(next);
    const keep = 1 - r / radius;
    panX += before.x * keep;
    panY += before.y * keep;
    radius = r;
    apply();
  };

  const onWheel = (e: WheelEvent): void => {
    if (!active) return;
    e.preventDefault();
    zoomAt(radius * Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY);
  };
  const touches = new Map<number, { x: number; y: number }>();
  let pinchStart = 0;
  let radiusStart = 0;
  const spread = (): number => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onDown = (e: PointerEvent): void => {
    if (!active) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dom.setPointerCapture?.(e.pointerId);
    if (touches.size === 2) {
      pinchStart = spread();
      radiusStart = radius;
    }
  };
  const onMove = (e: PointerEvent): void => {
    const last = touches.get(e.pointerId);
    if (!last || !active) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2 && pinchStart > 0) {
      const [a, b] = [...touches.values()];
      zoomAt((radiusStart * pinchStart) / Math.max(1, spread()), (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (touches.size === 1) {
      // Drag: the grabbed point follows the pointer.
      const f = kmPerPx();
      panX -= (e.clientX - last.x) * f;
      panY += (e.clientY - last.y) * f;
    }
  };
  const onUp = (e: PointerEvent): void => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinchStart = 0;
  };
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('pointerdown', onDown);
  dom.addEventListener('pointermove', onMove);
  dom.addEventListener('pointerup', onUp);
  dom.addEventListener('pointercancel', onUp);

  return {
    kind: '2d',
    camera,
    control: camera,
    resize(w, h) {
      aspect = w / Math.max(1, h);
      apply();
    },
    getViewRadius: () => radius,
    setViewRadius(km) {
      radius = clampRadius(km);
      apply();
    },
    getPan: () => ({ x: panX, y: panY }),
    setPan(x, y) {
      panX = x;
      panY = y;
    },
    setActive(on) {
      active = on;
      if (!on) touches.clear();
    },
    setZoomSpeed: () => undefined,
    setFixedView: () => undefined,
    setFixedFov: () => undefined,
    update: () => undefined,
    dispose() {
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointercancel', onUp);
    },
  };
}

const FOV = 40;
/** Camera distance that frames a given radius with the vertical FOV. */
const distanceFor = (radiusKm: number): number =>
  (radiusKm * KM_TO_SCENE) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));

/** Limits of the fixed view's field of view (degrees): from a telescope to a wide angle. */
const FIXED_FOV_MIN = 0.3;
const FIXED_FOV_MAX = 70;
/** Near plane of the fixed view (km): its eye stands a couple of meters above the ground. */
const FIXED_NEAR_KM = 0.0005;

/**
 * Perspective camera with OrbitControls (the orbital plane is xy; z is "up"), plus an optional
 * fixed view with its own vertical (the pad camera), mixed with the orbit camera to switch smoothly.
 */
export function createPerspectiveRig(dom: HTMLElement): CameraRig {
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1e-7, 1e5);
  camera.up.set(0, 0, 1);
  // The orbit controls move their own camera; the drawn one copies it or mixes it with the fixed view.
  const control = new THREE.PerspectiveCamera(FOV, 1, 1e-7, 1e5);
  control.up.set(0, 0, 1);
  const d0 = distanceFor(300000);
  control.position.set(0, -d0 * 0.75, d0 * 0.66);
  const controls = new OrbitControls(control, dom);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = distanceFor(MIN_RADIUS);
  controls.maxDistance = distanceFor(MAX_RADIUS);
  controls.target.set(0, 0, 0);
  controls.update();

  let active = true;
  let fixed: FixedView | null = null;
  let weight = 0;
  let fixedFov = 20;
  const look = new THREE.Matrix4();
  const fixedQuat = new THREE.Quaternion();
  const turn = new THREE.Quaternion();
  const dirA = new THREE.Vector3();
  const dirB = new THREE.Vector3();
  const showsFixed = (): boolean => fixed !== null && weight > 0;
  const syncControls = (): void => {
    controls.enabled = active && !showsFixed();
  };

  /** The fixed view's wheel: the field of view, towards a telescope or a wide angle. */
  const onWheel = (e: WheelEvent): void => {
    if (!active || !fixed || weight < 0.5) return;
    e.preventDefault();
    fixedFov = Math.max(FIXED_FOV_MIN, Math.min(FIXED_FOV_MAX, fixedFov * Math.exp(e.deltaY * 0.0015)));
  };
  dom.addEventListener('wheel', onWheel, { passive: false });

  /** The drawn camera: the orbit camera, the fixed view, or a mix of both. */
  const compose = (): void => {
    if (!fixed || weight <= 0) {
      camera.position.copy(control.position);
      camera.quaternion.copy(control.quaternion);
      camera.fov = FOV;
    } else {
      look.lookAt(fixed.eye, fixed.target, fixed.up);
      fixedQuat.setFromRotationMatrix(look);
      if (weight >= 1) {
        camera.position.copy(fixed.eye);
        camera.quaternion.copy(fixedQuat);
        camera.fov = fixedFov;
      } else {
        // Both look at about the scene origin: the direction turns along the great circle and the
        // distance changes geometrically, so the approach does not rush at the end.
        const da = control.position.length();
        const db = fixed.eye.length();
        dirA.copy(control.position).normalize();
        dirB.copy(fixed.eye).normalize();
        turn.setFromUnitVectors(dirA, dirB);
        turn.slerpQuaternions(new THREE.Quaternion(), turn, weight);
        camera.position.copy(dirA.applyQuaternion(turn)).multiplyScalar(Math.exp(Math.log(da) + (Math.log(db) - Math.log(da)) * weight));
        camera.quaternion.slerpQuaternions(control.quaternion, fixedQuat, weight);
        camera.fov = FOV + (fixedFov - FOV) * weight;
      }
    }
    // The near plane follows the zoom: from meters (spacecraft at real scale) to hundreds of thousands of km.
    const near = Math.max(1e-9, camera.position.length() * 0.02);
    camera.near = showsFixed() ? Math.min(near, FIXED_NEAR_KM * KM_TO_SCENE) : near;
    camera.updateProjectionMatrix();
  };
  compose();

  return {
    kind: '3d',
    camera,
    control,
    resize(w, h) {
      camera.aspect = control.aspect = w / Math.max(1, h);
      control.updateProjectionMatrix();
      camera.updateProjectionMatrix();
    },
    getViewRadius: () => (camera.position.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / KM_TO_SCENE,
    setViewRadius(km) {
      control.position.setLength(distanceFor(clampRadius(km)));
      controls.update();
      compose();
    },
    getPan: () => ({ x: 0, y: 0 }),
    setPan: () => undefined,
    setActive(on) {
      active = on;
      syncControls();
    },
    setZoomSpeed(speed) {
      controls.zoomSpeed = speed;
    },
    setFixedView(view, w) {
      fixed = view;
      weight = view ? Math.max(0, Math.min(1, w)) : 0;
      syncControls();
    },
    setFixedFov(deg) {
      fixedFov = Math.max(FIXED_FOV_MIN, Math.min(FIXED_FOV_MAX, deg));
    },
    update(constrain) {
      controls.update();
      constrain?.(control.position);
      compose();
    },
    dispose: () => {
      dom.removeEventListener('wheel', onWheel);
      controls.dispose();
    },
  };
}
