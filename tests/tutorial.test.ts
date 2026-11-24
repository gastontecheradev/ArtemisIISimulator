import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { play, reset, setWarp } from '../src/sim/commands';
import { WARP_LEVELS } from '../src/sim/constants';
import { formatSpan, formatTMinus } from '../src/sim/format';
import { COUNTDOWN, COUNT_START, MET_ALS } from '../src/sim/mission/countdown';
import { MISSION_PARAMS } from '../src/sim/mission/params';
import { SimState } from '../src/sim/state';
import { guideContent } from '../src/ui/guides/content';
import { CAMERA_MODES, DEMO_WARP, simStore, startMission } from '../src/ui/store';
import { TourStep, TourView, tourSteps } from '../src/ui/tutorial/steps';

// --- The interface as written in the source -------------------------------------------------

const UI_DIR = join(__dirname, '..', 'src', 'ui');
const listFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
/** UI sources, without the tutorial (it names the buttons; it does not draw them). */
const SOURCES = listFiles(UI_DIR).filter((f) => !/[\\/]tutorial[\\/]/.test(f));
const ALL = SOURCES.map((f) => readFileSync(f, 'utf8')).join('\n');
const DISPLAY_UNIT = readFileSync(join(UI_DIR, 'panel', 'DisplayUnit.tsx'), 'utf8');

/** Every `data-press=` attribute value as written: `"play"` or a `{...}` expression. */
function pressAttributes(text: string): string[] {
  const out: string[] = [];
  const key = 'data-press=';
  for (let i = text.indexOf(key); i >= 0; i = text.indexOf(key, i + 1)) {
    const j = i + key.length;
    if (text[j] === '"') {
      out.push(text.slice(j, text.indexOf('"', j + 1) + 1));
      continue;
    }
    let depth = 0;
    let k = j;
    do {
      if (text[k] === '{') depth++;
      else if (text[k] === '}') depth--;
      k++;
    } while (depth > 0 && k < text.length);
    out.push(text.slice(j, k));
  }
  return out;
}

/** `press="..."` of every self-closing <Tag ... /> element in the source. */
const pressProps = (tag: string): string[] =>
  [...ALL.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?/>`, 'g'))].flatMap((m) => [...m[0].matchAll(/\bpress="([^"]+)"/g)].map((p) => p[1]));

/**
 * The `data-press` values the interface can render. Literal attributes are read as they are; the
 * forms built from props are expanded with the props found in the source. A form the test does not
 * know fails, so a new kind of button has to be added here.
 */
function renderedPressIds(): Set<string> {
  const ids = new Set<string>();
  for (const a of pressAttributes(ALL)) {
    if (a.startsWith('"')) ids.add(a.slice(1, -1));
    else if (a === '{press}') continue; // Display keys and hold buttons: their props, below.
    else if (a === '{`warp-${w}`}') WARP_LEVELS.forEach((w) => ids.add(`warp-${w}`));
    else if (a === '{`${press}-guard`}' || a === '{`${press}-lever`}') pressProps('EngineSwitch').forEach((p) => ids.add(`${p}-${a.includes('guard') ? 'guard' : 'lever'}`));
    else if (a === '{press ? `${press}-${o.id}` : undefined}') {
      // Toolbar groups: only the 3D camera one carries a prefix.
      for (const p of pressProps('Group')) {
        expect(p).toBe('cam');
        CAMERA_MODES.forEach((c) => ids.add(`${p}-${c}`));
      }
    } else throw new Error(`data-press form unknown to the test: ${a}`);
  }
  for (const m of ALL.matchAll(/\bpress: '([a-z0-9-]+)'/g)) ids.add(m[1]); // side keys of the display pages
  for (const m of DISPLAY_UNIT.matchAll(/'(tab-[a-z]+)'/g)) ids.add(m[1]); // menu keys of the displays
  pressProps('HoldButton').forEach((p) => ids.add(p));
  return ids;
}

const tourTargets = new Set([...ALL.matchAll(/data-tour="([^"]+)"/g)].map((m) => m[1]));

// --- Sample states and views -------------------------------------------------------------------

const s0 = reset(MISSION_PARAMS);
const at = (s: SimState, t: number): SimState => ({ ...s, t });
const armed = (s: SimState): SimState => ({ ...s, switches: { ...s.switches, pyroArm: true, auxArm: true } });
const SAMPLES: SimState[] = [
  s0,
  play(s0),
  play(setWarp(s0, 10)),
  at(play(s0), MET_ALS + 1),
  at(play(s0), 5),
  at(play(setWarp(s0, 1000)), 5),
  { ...at(play(setWarp(s0, 10)), 5), warpRestore: 1000 },
  armed(at(play(s0), 20000)),
];
const VIEWS: TourView[] = CAMERA_MODES.map((camera3d) => ({ camera3d }));

/** Every button a step can point at, over the sample states and cameras. */
const pressesOf = (step: TourStep): string[] =>
  step.press ? SAMPLES.flatMap((s) => VIEWS.map((v) => step.press!(s, v))).filter((x): x is string => x !== null) : [];

const EN = tourSteps('en');
const ES = tourSteps('es');

describe('guided tutorial', () => {
  it('every button the hand points at exists in the interface, and every step target too', () => {
    const ids = renderedPressIds();
    // Sanity: the scan finds the buttons of each kind.
    for (const id of ['play', 'warp-10', 'warp-1000', 'aux-guard', 'aux-lever', 'pyro-arm', 'icps-lever', 'conf-dv', 'tab-procs', 'tab-count', 'cam-pad', 'cam-auto'])
      expect(ids, id).toContain(id);
    // confDv points at the Procs key when Conf ΔV is not on screen (in Node it always finds it).
    const pointed = new Set([...EN, ...ES].flatMap(pressesOf).concat('tab-procs'));
    for (const id of pointed) expect(ids, `press() → ${id}`).toContain(id);
    for (const step of [...EN, ...ES]) if (step.target) expect(tourTargets, step.target).toContain(step.target);
  });

  it('English and Spanish have the same steps, so ?tour=n opens the same one in both', () => {
    expect(ES.length).toBe(EN.length);
    EN.forEach((en, i) => {
      const es = ES[i];
      expect(es.target, `step ${i}`).toBe(en.target);
      expect(!!es.until, `step ${i}`).toBe(!!en.until);
      for (const s of SAMPLES) {
        expect(es.until?.(s), `step ${i}`).toBe(en.until?.(s));
        for (const v of VIEWS) expect(es.press?.(s, v), `step ${i}`).toBe(en.press?.(s, v));
      }
    });
  });

  it('the pad and the count come after the 3D view, then the count is sped up to T‑33 s and the rocket lifts off', () => {
    const index = (id: string): number => EN.findIndex((st) => pressesOf(st).includes(id));
    const view3d = EN.findIndex((st) => st.target === 'view-3d');
    const pad = index('cam-pad');
    const count = index('tab-count');
    expect(pad).toBe(view3d + 1);
    expect(count).toBe(pad + 1);
    // Both are information steps: the hand points without waiting for an action.
    expect(EN[pad].until).toBeUndefined();
    expect(EN[count].until).toBeUndefined();
    // The hand leaves the PAD button once that camera is chosen.
    expect(EN[pad].press!(s0, { camera3d: 'pad' })).toBeNull();
    // Speed up the count: PLAY, then ×10, done when the ALS takes over (T‑33 s).
    const speed = EN[count + 1];
    expect(speed.press!(s0, VIEWS[0])).toBe('play');
    expect(speed.press!(play(s0), VIEWS[0])).toBe('warp-10');
    expect(speed.until!(at(s0, MET_ALS - 1))).toBe(false);
    expect(speed.until!(at(s0, MET_ALS))).toBe(true);
    // Liftoff: done once the rocket has left the pad with the clock running.
    const liftoff = EN[count + 2];
    expect(liftoff.until!(at(play(s0), -1))).toBe(false);
    expect(liftoff.until!(at(play(s0), 0.5))).toBe(true);
    // Boosters: back to AUTO if the view stayed on the PAD camera.
    expect(EN[count + 3].press!(at(play(s0), 5), { camera3d: 'pad' })).toBe('cam-auto');
    // The hand steps of the ICPS separation and the first burn keep their order after them.
    const order = ['pyro-arm', 'icps-lever', 'conf-dv', 'aux-guard', 'aux-lever'].map(index);
    expect(order[0]).toBeGreaterThan(count + 3);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the demonstration mode starts at T‑10 min with the automatic crew and its warp; the tutorial, paused', () => {
    expect(WARP_LEVELS).toContain(DEMO_WARP);
    startMission({ autoCrew: true, tutorial: false });
    let s = simStore.getState();
    expect(s.t).toBe(COUNT_START);
    expect(s.switches.autoCrew).toBe(true);
    expect(s.clock.running).toBe(true);
    expect(s.clock.warp).toBe(DEMO_WARP);
    startMission({ autoCrew: false, tutorial: true });
    s = simStore.getState();
    expect(s.t).toBe(COUNT_START);
    expect(s.switches.autoCrew).toBe(false);
    expect(s.clock.running).toBe(false);
  });
});

describe('guides', () => {
  it('the stages guide lists the main count milestones in order, with their published T‑', () => {
    for (const l of ['en', 'es'] as const) {
      const count = guideContent('stages', l).sections[0];
      const rows = count.table!.rows;
      expect(rows[0][0]).toBe(formatTMinus(COUNT_START, l));
      expect(rows[rows.length - 1][0]).toBe('T‑0');
      const mets = rows.map((r) => COUNTDOWN.find((c) => formatTMinus(c.met, l) === r[0])!.met);
      expect([...mets].sort((a, b) => a - b)).toEqual(mets);
    }
  });

  it('the documentation links are nasa.gov pages over https, the four new ones included', () => {
    for (const l of ['en', 'es'] as const) {
      const links = guideContent('docs', l).sections.flatMap((x) => x.links ?? []);
      for (const k of links) expect(k.url).toMatch(/^https:\/\/www\.nasa\.gov\//);
      expect(links.length).toBe(9);
    }
  });
});

describe('time spans in words', () => {
  it('formats the times the tutorial and the guides use', () => {
    expect(formatTMinus(COUNT_START, 'en')).toBe('T‑10 min');
    expect(formatTMinus(MET_ALS, 'en')).toBe('T‑33 s');
    expect(formatTMinus(-6.36, 'en')).toBe('T‑6.36 s');
    expect(formatTMinus(-6.36, 'es')).toBe('T‑6,36 s');
    expect(formatTMinus(0, 'es')).toBe('T‑0');
    expect(formatSpan(7, 'en')).toBe('7 s');
    expect(formatSpan(128, 'en')).toBe('2 min 8 s');
    expect(formatSpan(498, 'es')).toBe('8 min 18 s');
    expect(formatSpan(12166, 'en')).toBe('3 h 23 min'); // 3 h 22 min 46 s, to the nearest minute
    expect(formatSpan(7200, 'en')).toBe('2 h');
  });
});
