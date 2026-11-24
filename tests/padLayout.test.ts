import { describe, expect, it } from 'vitest';
import { MASTS, padLocal } from '../src/render/pad';
import { GROUND_RADIUS_M, TRENCH, groundRings, padCameraEye, padRelief } from '../src/render/padGround';
import {
  CRAWLER_M,
  GROUND_LAYOUT,
  LAYOUT,
  LAYOUT_FADE,
  LAYOUT_GLSL,
  LAYOUT_TEXTURES,
  type LayoutShape,
  type Surface,
  buildGroundLayout,
  coastEast,
  layoutWeight,
  nearWeight,
  paintLayout,
  surfaceAt,
} from '../src/render/padLayout';
import { CRYO_TANKS, WATER_TOWER } from '../src/sim/constants';

const SURFACES: readonly Surface[] = ['scrub', 'grass', 'sand', 'water', 'road', 'crawler', 'concrete', 'trench'];
/** Outermost ring of the ground's mesh (m): the overlap band past the circle Earth discards. */
const OUTER = groundRings()[groundRings().length - 1];
const inTrench = (e: number, n: number): boolean => Math.abs(e) <= TRENCH.halfWidth && n >= TRENCH.south && n <= TRENCH.north;

describe('Layout of the pad ground (stage 6)', () => {
  it('covers the whole ground with no gaps', () => {
    // Every shape is well formed.
    for (const s of GROUND_LAYOUT) {
      expect(SURFACES).toContain(s.surface);
      if (s.kind === 'disc') {
        expect(s.radius).toBeGreaterThan(0);
        expect(s.center.every(Number.isFinite)).toBe(true);
      } else {
        expect(s.points.length).toBeGreaterThanOrEqual(s.kind === 'polygon' ? 3 : 2);
        expect(s.points.every((p) => p.every(Number.isFinite))).toBe(true);
        if (s.kind === 'stroke') expect(s.width).toBeGreaterThan(0);
      }
    }
    // The far texture reaches past the ground's last ring (and its skirt, which hangs from it) in every
    // direction, and the near one holds the whole mowed grounds at full weight.
    expect(LAYOUT_TEXTURES.far.half).toBeGreaterThan(OUTER);
    const { center, apothem } = LAYOUT.grounds;
    const r = apothem / Math.cos(Math.PI / 8) + LAYOUT.road / 2;
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k * Math.PI) / 4;
      expect(nearWeight(center[0] + r * Math.cos(a), center[1] + r * Math.sin(a))).toBe(1);
    }
    // Every point of the ground has a surface.
    for (let rho = 0; rho <= OUTER; rho += 97) {
      for (let k = 0; k < 64; k++) {
        const a = (2 * Math.PI * k) / 64;
        expect(SURFACES).toContain(surfaceAt(rho * Math.sin(a), rho * Math.cos(a)));
      }
    }
    // Where two shapes should meet, nothing shows between them: the beach and the sea along the shore...
    for (let n = -GROUND_RADIUS_M; n <= GROUND_RADIUS_M; n += 250) {
      const e = coastEast(n);
      expect(surfaceAt(e - 1, n)).toBe('sand');
      expect(surfaceAt(e - LAYOUT.beach + 1, n)).toBe('sand');
      expect(surfaceAt(e + 1, n)).toBe('water');
    }
    // ...the crawlerway's lanes and the pad's concrete...
    const laneE = (CRAWLER_M.median + CRAWLER_M.lane) / 2;
    for (const s of [-1, 1]) {
      for (let n = -GROUND_RADIUS_M; n <= 0; n += 0.5) expect(['crawler', 'concrete', 'road']).toContain(surfaceAt(s * laneE, n));
    }
    // ...and the roads from the pad to the tanks, which end on their aprons.
    const roads = GROUND_LAYOUT.filter((s): s is Extract<LayoutShape, { kind: 'stroke' }> => s.kind === 'stroke' && s.surface === 'road');
    for (const road of roads) {
      for (let i = 0; i + 1 < road.points.length; i++) {
        const [a, b] = [road.points[i], road.points[i + 1]];
        for (let t = 0; t <= 1; t += 0.01) {
          const e = a[0] + t * (b[0] - a[0]);
          const n = a[1] + t * (b[1] - a[1]);
          expect(['road', 'concrete', 'crawler']).toContain(surfaceAt(e, n));
        }
      }
    }
  });

  it('puts the elevated pad and the edges of the flame trench on concrete', () => {
    let onPad = 0;
    for (let e = -120; e <= 120; e += 1) {
      for (let n = -160; n <= 200; n += 1) {
        if (inTrench(e, n)) expect(surfaceAt(e, n)).toBe('trench');
        else if (padRelief(e, n) > 0) {
          expect(surfaceAt(e, n)).toBe('concrete');
          onPad++;
        }
      }
    }
    expect(onPad).toBeGreaterThan(40000);
    // The copings of the trench (0.6 m over the ground on each side, pad.ts) and its exit.
    for (let n = TRENCH.south; n <= TRENCH.north; n += 0.5) {
      for (const s of [-1, 1]) {
        expect(surfaceAt(s * (TRENCH.halfWidth + 0.05), n)).toBe('concrete');
        expect(surfaceAt(s * (TRENCH.halfWidth + 0.6), n)).toBe('concrete');
      }
    }
    for (let e = -TRENCH.halfWidth; e <= TRENCH.halfWidth; e += 0.5) expect(surfaceAt(e, TRENCH.north + 0.5)).toBe('concrete');
    // What stands on the grounds (pad.ts) stands on concrete aprons.
    for (const [e, n] of [...MASTS, ...CRYO_TANKS.map(padLocal), padLocal(WATER_TOWER)]) expect(surfaceAt(e, n)).toBe('concrete');
  });

  it('lays the crawlerway from the south, the sea to the east and the pad camera on the grass', () => {
    // [CRW] Two 40 ft lanes either side of a 50 ft grass median, on the rocket's axis, from beyond the ground's edge.
    const laneE = (CRAWLER_M.median + CRAWLER_M.lane) / 2;
    expect(CRAWLER_M.median + 2 * CRAWLER_M.lane).toBeCloseTo(CRAWLER_M.total, 6);
    for (const n of [-300, -1500, -4900]) {
      expect(surfaceAt(0, n)).toBe('grass');
      expect(surfaceAt(laneE, n)).toBe('crawler');
      expect(surfaceAt(-laneE, n)).toBe('crawler');
      expect(surfaceAt(CRAWLER_M.total / 2 - 0.5, n)).toBe('crawler');
      expect(surfaceAt(CRAWLER_M.median / 2 - 0.5, n)).toBe('grass');
    }
    // The shore measured on NASA's texture: ~1.9 km east-northeast of the pad, sea beyond it.
    let closest = Infinity;
    for (let n = -GROUND_RADIUS_M; n <= GROUND_RADIUS_M; n += 1) closest = Math.min(closest, Math.hypot(coastEast(n), n));
    expect(closest).toBeGreaterThan(1500);
    expect(closest).toBeLessThan(2300);
    expect(surfaceAt(4000, 0)).toBe('water');
    expect(surfaceAt(-4000, 0)).toBe('scrub');
    expect(surfaceAt(0, 4900)).toBe('water');
    const eye = padCameraEye();
    expect(surfaceAt(eye.x, eye.y)).toBe('grass');
  });

  it('fades into Earth texture at the edge of the ground', () => {
    expect(LAYOUT_FADE.end).toBe(GROUND_RADIUS_M);
    for (let rho = 0; rho <= LAYOUT_FADE.start; rho += 10) expect(layoutWeight(rho)).toBe(1);
    // From the circle Earth discards, through the overlap band and the skirt (which hangs from the last
    // ring), the ground shows Earth's texel exactly, as the sphere beyond it does.
    for (let rho = GROUND_RADIUS_M; rho <= OUTER + 1; rho += 0.5) expect(layoutWeight(rho)).toBe(0);
    let prev = layoutWeight(0);
    for (let rho = 0; rho <= GROUND_RADIUS_M; rho += 1) {
      const w = layoutWeight(rho);
      expect(w).toBeLessThanOrEqual(prev);
      expect(prev - w).toBeLessThan(0.002);
      prev = w;
    }
    // The shader uses the same fade, and it weighs the whole layout, detail noise and water included.
    expect(LAYOUT_GLSL.apply).toContain(`smoothstep(${LAYOUT_FADE.start.toFixed(4)}, ${LAYOUT_FADE.end.toFixed(4)}, length(en))`);
    expect(LAYOUT_GLSL.apply).toContain('geoTexel = mix(geoTexel, vec4(lay.rgb, 1.0), w);');
    expect(LAYOUT_GLSL.apply).toContain('groundWater = lay.a * w;');
    expect(LAYOUT_GLSL.roughness).toContain('groundWater');
  });

  it('is deterministic', () => {
    expect(buildGroundLayout()).toEqual(GROUND_LAYOUT);
    const sample = (): string => {
      const out: string[] = [];
      for (let e = -5000; e <= 5000; e += 125) for (let n = -5000; n <= 5000; n += 125) out.push(surfaceAt(e, n));
      return out.join(',');
    };
    expect(sample()).toBe(sample());
    // The painter issues the same calls every time, and its transform puts east right and north up.
    const record = (): string[] => {
      const calls: string[] = [];
      const ctx = new Proxy({} as Record<string, unknown>, {
        get: (_, k: string) => (...args: unknown[]) => calls.push(`${k}(${args.join(',')})`),
        set: (_, k: string, v: unknown) => (calls.push(`${k}=${String(v)}`), true),
      });
      paintLayout(ctx as unknown as CanvasRenderingContext2D, 2048, 800, (s) => s);
      return calls;
    };
    const a = record();
    expect(a).toEqual(record());
    const k = 2048 / 1600;
    expect(a).toContain(`setTransform(${k},0,0,${-k},1024,1024)`);
  });
});
