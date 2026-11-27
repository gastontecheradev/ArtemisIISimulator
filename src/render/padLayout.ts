import * as THREE from 'three';
import { COASTLINE, CRAWLERWAY, CRYO_TANKS, PAD_SLOPE_RUN, PAD_TOP_NORTH, PAD_TOP_RADIUS, PAD_TOP_SOUTH, WATER_TOWER } from '../sim/constants';
import type { SurfaceLayout } from './bodies';
import { MASTS, darker, padLocal } from './pad';
import { GROUND_RADIUS_M, TRENCH } from './padGround';

/*
 * What the ground around the pad is made of (launch plan §4.2, point 3; stage 6): a layout of its own,
 * generic (D6, changed in session 42: no map or photo is traced), with the orientation the sources give:
 * the flame trench to the north ([39B]), the crawlerway from the south, the Atlantic to the east. It is a
 * list of shapes in meters east and north of the rocket's axis, painted into two canvas textures (near
 * and far) that the ground's material samples by its position, in flat colors (since session 50, at
 * Gastón's request, without the slab joints and the detail noise it had); the whole layout fades into
 * Earth's texture before the ground's edge, so the seam with the sphere does not show.
 *
 * Sources and choices:
 * - The crawlerway ([CRW] in constants.ts, CRAWLERWAY): two 40 ft gravel lanes either side of a 50 ft
 *   median, from the south (launch plan §2), straight and on the rocket's axis (drawing choice). The median
 *   is grass (the KSC master plan, as a web search summarized it; the page now answers 404: unverified).
 *   The 5 % ramp is not in the relief (padGround.ts): the lanes end at the foot of the slope.
 * - The shoreline (COASTLINE in constants.ts), measured on NASA's Earth texture: ~1.9 km east-northeast
 *   of the pad, good to about ±1 km. The photo from the top of a lightning mast (`ML-1-image-1.jpg`) shows
 *   the sea beyond lagoons and scrub, consistent; it is not measured. Its lagoons are not drawn: nothing
 *   places them (the texture's pixels only mix them with land).
 * - Everything else is a drawing choice (marked in LAYOUT): the mowed grounds and their perimeter road,
 *   the access road and the service roads to the tanks, the concrete aprons under the tanks, the water
 *   tower and the masts, the beach's width and the apron at the trench's exit. The
 *   elevated pad (its top and its slope) is concrete, as in the photos of the pad (`ML1-image-3.jpg`,
 *   `ML-1-image-1.jpg`).
 * - Colors: the palette sampled from `ML-1-image-1.jpg` (npm run palette), plus two tones derived from
 *   it by mixing with black (the crawlerway's gravel and the trench floor).
 */

/** What a point of the ground is made of. */
export type Surface = 'scrub' | 'grass' | 'sand' | 'water' | 'road' | 'crawler' | 'concrete' | 'trench';

type P2 = readonly [number, number];

/** A shape of the layout, in meters east and north of the rocket's axis. */
export type LayoutShape =
  | { readonly kind: 'polygon'; readonly surface: Surface; readonly points: readonly P2[] }
  /** A band of `width` along a polyline, with round ends and joints (as a canvas stroke draws it). */
  | { readonly kind: 'stroke'; readonly surface: Surface; readonly points: readonly P2[]; readonly width: number }
  | { readonly kind: 'disc'; readonly surface: Surface; readonly center: P2; readonly radius: number };

/** Surface where no shape is: the scrub that covers the cape around the mowed grounds. */
export const BASE_SURFACE: Surface = 'scrub';

/** [CRW] The crawlerway in meters: two lanes either side of the median. */
export const CRAWLER_M = { lane: CRAWLERWAY.lane * 1000, median: CRAWLERWAY.median * 1000, total: CRAWLERWAY.total * 1000 } as const;

/** East coordinate (m) of the shoreline (COASTLINE) at `north` (m). */
export const coastEast = (north: number): number => {
  const n = north / 1000;
  return (COASTLINE.a + COASTLINE.b * n + COASTLINE.c * n * n) * 1000;
};

/** Drawing choices of the layout (m). */
export const LAYOUT = {
  /** Mowed grounds: a regular octagon (flat sides facing the cardinal points) around the pad, holding the tanks. */
  grounds: { center: [0, 60] as P2, apothem: 560 },
  /** Paved roads. */
  road: 7,
  /** Grass shoulders on each side of the crawlerway. */
  crawlerShoulder: 4,
  /** Where the crawlerway's lanes end (north), under the concrete of the slope. */
  crawlerEnd: -120,
  /** The access road, beside the crawlerway (centerline east of the rocket's axis). */
  accessEast: 34,
  /** Beach width on the land side of the shoreline. */
  beach: 40,
  /** Margin of the pad's concrete past the foot of the slope. */
  padMargin: 3,
  /** Concrete apron at the trench's exit: half-width and how far north it reaches. */
  trenchApron: { halfWidth: 16, north: 215 },
  /** Aprons around the tanks (past their radius), the water tower and the masts' bases. */
  tankApron: 10,
  waterTowerApron: 14,
  mastApron: 16,
} as const;

/** Polylines (m) south of the disk's edge: the crawlerway and the access road come from beyond it. */
const FAR_SOUTH = -GROUND_RADIUS_M - 300;

function octagon(center: P2, apothem: number): P2[] {
  const r = apothem / Math.cos(Math.PI / 8);
  return Array.from({ length: 8 }, (_, k): P2 => {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    return [center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)];
  });
}

/** The layout's shapes, bottom to top: a point is made of the last shape that holds it. */
export function buildGroundLayout(): LayoutShape[] {
  const out: LayoutShape[] = [];
  const { grounds } = LAYOUT;
  const ring = octagon(grounds.center, grounds.apothem);
  out.push({ kind: 'polygon', surface: 'grass', points: ring });
  // The crawlerway's grass median and shoulders, along its whole length.
  out.push({ kind: 'stroke', surface: 'grass', points: [[0, FAR_SOUTH], [0, LAYOUT.crawlerEnd]], width: CRAWLER_M.total + 2 * LAYOUT.crawlerShoulder });
  // The beach and, over it, the sea: the band of the shoreline left on the land side is the beach.
  const coast: P2[] = [];
  const reach = GROUND_RADIUS_M + 600;
  for (let n = reach; n >= -reach; n -= 50) coast.push([coastEast(n), n]);
  out.push({ kind: 'stroke', surface: 'sand', points: coast, width: 2 * LAYOUT.beach });
  out.push({ kind: 'polygon', surface: 'water', points: [...coast, [reach + 3000, -reach], [reach + 3000, reach]] });
  // Roads: the grounds' perimeter, the access road beside the crawlerway and the roads to the tanks.
  out.push({ kind: 'stroke', surface: 'road', points: [...ring, ring[0]], width: LAYOUT.road });
  out.push({ kind: 'stroke', surface: 'road', points: [[LAYOUT.accessEast, FAR_SOUTH], [LAYOUT.accessEast, -140]], width: LAYOUT.road });
  const [lh2a, lh2b, lox] = CRYO_TANKS.map(padLocal);
  const fork: P2 = [240, 110];
  out.push({ kind: 'stroke', surface: 'road', points: [[105, -10], fork, lh2a], width: LAYOUT.road });
  out.push({ kind: 'stroke', surface: 'road', points: [fork, lh2b], width: LAYOUT.road });
  out.push({ kind: 'stroke', surface: 'road', points: [[-105, -10], [-240, 110], lox], width: LAYOUT.road });
  // [CRW] The crawlerway's two gravel lanes.
  const laneE = (CRAWLER_M.median + CRAWLER_M.lane) / 2;
  for (const s of [-1, 1]) out.push({ kind: 'stroke', surface: 'crawler', points: [[s * laneE, FAR_SOUTH], [s * laneE, LAYOUT.crawlerEnd]], width: CRAWLER_M.lane });
  // Concrete aprons under what stands on the grounds (pad.ts).
  CRYO_TANKS.forEach((t) => out.push({ kind: 'disc', surface: 'concrete', center: padLocal(t), radius: (t.diameter * 1000) / 2 + LAYOUT.tankApron }));
  out.push({ kind: 'disc', surface: 'concrete', center: padLocal(WATER_TOWER), radius: LAYOUT.waterTowerApron });
  for (const m of MASTS) out.push({ kind: 'disc', surface: 'concrete', center: m, radius: LAYOUT.mastApron });
  // The elevated pad, top and slope (padGround.ts: every point within PAD_TOP_RADIUS + PAD_SLOPE_RUN of its spine).
  out.push({
    kind: 'stroke',
    surface: 'concrete',
    points: [[0, -PAD_TOP_SOUTH * 1000], [0, PAD_TOP_NORTH * 1000]],
    width: 2 * ((PAD_TOP_RADIUS + PAD_SLOPE_RUN) * 1000 + LAYOUT.padMargin),
  });
  const apron = LAYOUT.trenchApron;
  out.push({ kind: 'polygon', surface: 'concrete', points: [[-apron.halfWidth, TRENCH.north - 4], [apron.halfWidth, TRENCH.north - 4], [apron.halfWidth, apron.north], [-apron.halfWidth, apron.north]] });
  // The trench floor, for when the pad model (which draws the trench) is not drawn.
  out.push({ kind: 'polygon', surface: 'trench', points: [[-TRENCH.halfWidth, TRENCH.south], [TRENCH.halfWidth, TRENCH.south], [TRENCH.halfWidth, TRENCH.north], [-TRENCH.halfWidth, TRENCH.north]] });
  return out;
}

export const GROUND_LAYOUT: readonly LayoutShape[] = buildGroundLayout();

/** Distance (m) from p to the segment a–b. */
function segmentDistance(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Even-odd point-in-polygon test (the canvas fills with the same rule). */
function insidePolygon(p: P2, points: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function shapeHolds(shape: LayoutShape, p: P2): boolean {
  switch (shape.kind) {
    case 'polygon':
      return insidePolygon(p, shape.points);
    case 'disc':
      return Math.hypot(p[0] - shape.center[0], p[1] - shape.center[1]) <= shape.radius;
    case 'stroke': {
      const h = shape.width / 2;
      for (let i = 0; i + 1 < shape.points.length; i++) if (segmentDistance(p, shape.points[i], shape.points[i + 1]) <= h) return true;
      return false;
    }
  }
}

/** What the ground is made of at `east`, `north` (m from the rocket's axis), as the layout paints it. */
export function surfaceAt(east: number, north: number, layout: readonly LayoutShape[] = GROUND_LAYOUT): Surface {
  const p: P2 = [east, north];
  for (let i = layout.length - 1; i >= 0; i--) if (shapeHolds(layout[i], p)) return layout[i].surface;
  return BASE_SURFACE;
}

/**
 * Where the layout fades into Earth's texture (m from the launch point): whole until `start`, nothing
 * from `end`, which is the ground's edge, so the overlap band and the skirt, and the sphere beyond them,
 * show the same texel (drawing choice: a 2 km fade, smooth at both ends).
 */
export const LAYOUT_FADE = { start: 3000, end: GROUND_RADIUS_M } as const;

/** Weight of the layout at horizontal distance `rho` (m) from the launch point. */
export function layoutWeight(rho: number): number {
  const x = Math.min(1, Math.max(0, (rho - LAYOUT_FADE.start) / (LAYOUT_FADE.end - LAYOUT_FADE.start)));
  return 1 - x * x * (3 - 2 * x);
}

/**
 * The two textures: a near one over the mowed grounds (0.78 m per pixel) and a far one over the whole
 * ground (5 m per pixel). The near one fades into the far one over the outer `blend` of its half-width
 * (max-norm), drawing choices: 2048² RGBA each, ~22 MB of video memory with mipmaps.
 */
export const LAYOUT_TEXTURES = {
  near: { half: 800, size: 2048 },
  far: { half: 5120, size: 2048 },
  blend: [0.85, 0.97],
} as const;

/** Weight of the near texture at a point (m). */
export function nearWeight(east: number, north: number): number {
  const m = Math.max(Math.abs(east), Math.abs(north)) / LAYOUT_TEXTURES.near.half;
  const [a, b] = LAYOUT_TEXTURES.blend;
  const x = Math.min(1, Math.max(0, (m - a) / (b - a)));
  return 1 - x * x * (3 - 2 * x);
}

/** Roughness of the water, for the Sun's glint (drawing choice; the land keeps Earth's 0.95). */
const WATER_ROUGHNESS = 0.2;

/** Colors of the surfaces (#rrggbb). */
export type LayoutColors = Readonly<Record<Surface, string>>;

/** Minimal 2D context the painter needs (a browser canvas; tests can pass a recorder). */
type Ctx = Pick<
  CanvasRenderingContext2D,
  | 'setTransform'
  | 'fillRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'fill'
  | 'stroke'
  | 'arc'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
>;

/**
 * Paints the layout into a `size` × `size` canvas covering ±`half` m (east to the right, north up),
 * each surface in `color(surface)`.
 */
export function paintLayout(
  c: Ctx,
  size: number,
  half: number,
  color: (s: Surface) => string,
  layout: readonly LayoutShape[] = GROUND_LAYOUT,
): void {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = color(BASE_SURFACE);
  c.fillRect(0, 0, size, size);
  const k = size / (2 * half);
  c.setTransform(k, 0, 0, -k, size / 2, size / 2);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (const s of layout) {
    c.beginPath();
    if (s.kind === 'disc') {
      c.arc(s.center[0], s.center[1], s.radius, 0, 2 * Math.PI);
      c.fillStyle = color(s.surface);
      c.fill();
      continue;
    }
    s.points.forEach(([e, n], i) => (i === 0 ? c.moveTo(e, n) : c.lineTo(e, n)));
    if (s.kind === 'polygon') {
      c.closePath();
      c.fillStyle = color(s.surface);
      c.fill('evenodd');
    } else {
      c.strokeStyle = color(s.surface);
      c.lineWidth = s.width;
      c.stroke();
    }
  }
}

/**
 * One layout texture: the colors in RGB and, in alpha, where there is water (for its glint). Painted
 * twice in a canvas (colors, then the water mask) and merged, because a canvas stores premultiplied alpha.
 */
function layoutTexture(size: number, half: number, colors: LayoutColors, anisotropy: number): THREE.DataTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  paintLayout(c, size, half, (s) => colors[s]);
  const rgb = c.getImageData(0, 0, size, size).data;
  paintLayout(c, size, half, (s) => (s === 'water' ? '#ffffff' : '#000000'));
  const mask = c.getImageData(0, 0, size, size).data;
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[i];
    data[i + 1] = rgb[i + 1];
    data[i + 2] = rgb[i + 2];
    data[i + 3] = mask[i];
  }
  // Canvas rows go from north to south: row 0 is v = 0 here, so the shader flips north.
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

const f = (x: number): string => x.toFixed(4);

/** GLSL of the layout, from the same constants the tests read. `vGroundEN` is the ground's east-north position (m). */
function layoutGlsl(): { head: string; apply: string; roughness: string } {
  const { near, far, blend } = LAYOUT_TEXTURES;
  return {
    head: `
      uniform sampler2D uLayoutNear;
      uniform sampler2D uLayoutFar;
      float groundWater = 0.0;`,
    apply: `
      {
        vec2 en = vGroundEN;
        vec4 nearT = texture(uLayoutNear, vec2(0.5) + vec2(1.0, -1.0) * en / ${f(2 * near.half)});
        vec4 farT = texture(uLayoutFar, vec2(0.5) + vec2(1.0, -1.0) * en / ${f(2 * far.half)});
        float m = max(abs(en.x), abs(en.y)) / ${f(near.half)};
        vec4 lay = mix(farT, nearT, 1.0 - smoothstep(${f(blend[0])}, ${f(blend[1])}, m));
        float w = 1.0 - smoothstep(${f(LAYOUT_FADE.start)}, ${f(LAYOUT_FADE.end)}, length(en));
        geoTexel = mix(geoTexel, vec4(lay.rgb, 1.0), w);
        groundWater = lay.a * w;
      }`,
    roughness: `roughnessFactor = mix(roughnessFactor, ${f(WATER_ROUGHNESS)}, groundWater);`,
  };
}

/** The GLSL constants, for the tests: the fade and the windows the shader uses. */
export const LAYOUT_GLSL = layoutGlsl();

export interface GroundLayout {
  /** What the ground's material (bodies.ts) adds to Earth's texel. */
  readonly surface: SurfaceLayout;
  dispose(): void;
}

/** The layout's textures and shader code, for the pad's ground (only in the 3D view, in the browser). */
export function createGroundLayout(
  colors: { grass: string; scrub: string; sand: string; water: string; road: string; concrete: string },
  anisotropy = 1,
): GroundLayout {
  const all: LayoutColors = {
    ...colors,
    // Derived tones (mixed with black, no new hues): the crawlerway's river gravel, a little darker than
    // the paved roads, and the trench floor, as dark as pad.ts draws it.
    crawler: darker(colors.road, 0.2),
    trench: darker(colors.concrete, 0.35),
  };
  const nearTex = layoutTexture(LAYOUT_TEXTURES.near.size, LAYOUT_TEXTURES.near.half, all, anisotropy);
  const farTex = layoutTexture(LAYOUT_TEXTURES.far.size, LAYOUT_TEXTURES.far.half, all, anisotropy);
  return {
    surface: {
      uniforms: { uLayoutNear: { value: nearTex }, uLayoutFar: { value: farTex } },
      ...LAYOUT_GLSL,
    },
    dispose() {
      nearTex.dispose();
      farTex.dispose();
    },
  };
}
