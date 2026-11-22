import { describe, expect, it } from 'vitest';
import { fly, flyFrom, withBurn } from '../scripts/lib/calibration';
import { advance, attitudeAxes, bodyRates, cruiseSense, executeManeuver, lvlhOf, powerInputOf, produce, setManeuver } from '../src/sim/advance';
import { capcomFeed } from '../src/sim/capcom';
import { eulerOf } from '../src/sim/attitude';
import { nextLinkChanges } from '../src/sim/comms';
import { airVelocity } from '../src/sim/atmosphere';
import { dvMagnitude } from '../src/sim/burns';
import * as cmd from '../src/sim/commands';
import {
  ASCENT_TABLE,
  CM_SEP_LEAD_TIME,
  CUBESAT_DEPLOYMENTS,
  E7_BURN_DURATION,
  ENTRY_CORRIDOR,
  FLYBY_ALTITUDE_TARGET,
  HEO_ORBIT,
  INSERTION_ALTITUDE,
  INSERTION_ORBIT,
  INSERTION_SPEED_REL,
  LAUNCH_SITE_HEIGHT,
  MECO_ALTITUDE,
  MET_E4_PERIGEE_RAISE,
  MET_E5_APOGEE_RAISE,
  MET_E7_DEPARTURE,
  MET_ICPS_SPLASHDOWN,
  ORBIT_TABLE,
  POST_ARB_ORBIT,
  POST_PRM_ORBIT,
  PUBLISHED_MET,
  RHC_RATE,
  R_EARTH,
  TLI_HALF_BURN,
} from '../src/sim/constants';
import { solveCorrection } from '../src/sim/guidance';
import { angleBetween, length, normalize, sub } from '../src/sim/math/vec3';
import { ASCENT_SEQUENCE } from '../src/sim/mission/ascent';
import { COUNTDOWN, MET_ALS, countdownStatus } from '../src/sim/mission/countdown';
import { tr } from '../src/sim/i18n';
import { MISSION_PARAMS } from '../src/sim/mission/params';
import { procedureView } from '../src/sim/mission/procedures';
import { nextEvent, timelineStatus } from '../src/sim/mission/timeline';
import { earthElements } from '../src/sim/orbit';
import { forces } from '../src/sim/power';
import { INITIAL_MET, SimState, altitudeOf, createInitialState, ephemerisOf } from '../src/sim/state';
import { ENGINES, FULL_TANKS, G0, MASS, RS25_START_BEFORE_LIFTOFF, SRB_ISP, TANK, burnDuration, totalMass } from '../src/sim/vehicle';

const P = MISSION_PARAMS;
const DAY = 86400;
const S = ASCENT_SEQUENCE;

const launch = (): SimState => createInitialState(P, { headless: true, autoCrew: true });
/** Velocity relative to the rotating Earth (the one in the ascent tables). */
const speedRel = (s: SimState): number => length(sub(s.ship.v, airVelocity(s.ship.r, ephemerisOf(s).earth(s.t))));
/** Inertial velocity relative to Earth (the one in the orbit tables). */
const speedIn = (s: SimState): number => length(sub(s.ship.v, ephemerisOf(s).earth(s.t).v));
const elements = (s: SimState) => earthElements(s.ship, s.t, ephemerisOf(s));

/** Runs the frame loop as the app does. `crew` acts when the sim pauses. */
function runFrames(s0: SimState, crew: (s: SimState) => SimState, until = Infinity, maxFrames = 400000): SimState {
  let s = s0;
  for (let i = 0; i < maxFrames && !s.outcome && s.t < until; i++) {
    if (!s.clock.running) s = cmd.setWarp(cmd.play(crew(s)), 10000);
    // The launch sequencer drops the warp to ×1 at T‑33 s; after liftoff the crew raises it again.
    else if (s.t > 0 && s.clock.warp === 1) s = cmd.setWarp(s, 10000);
    s = cmd.tick(s, 1 / 60);
  }
  return s;
}

/** Crew that follows the procedures with the panel switches. */
function followProcedures(s: SimState): SimState {
  // Like a real crew: it does not act until the first step (the wait) is complete.
  if (!procedureView(s, s.proc.activeId).steps[0].done) return s;
  switch (s.proc.activeId) {
    case 'SEP_ICPS':
      return cmd.fireIcpsSeparation(cmd.setSwitch(s, 'pyroArm', true));
    case 'SEP_CM':
      return cmd.fireCmSeparation(cmd.setSwitch(s, 'pyroArm', true));
    case 'E7':
      return cmd.fireEngine(cmd.confirmDv(cmd.setSwitch(s, 'auxArm', true)), 'AUX');
    case 'E8':
      // E8 is committed with the PFD's Burn ATP key instead of the lever.
      return cmd.burnAtp(cmd.confirmDv(cmd.setSwitch(s, 'mainArm', true)));
    case 'E9':
      return cmd.fireEngine(cmd.confirmDv(cmd.setSwitch(s, 'mainArm', true)), 'MAIN');
    default:
      return s;
  }
}

describe('ascenso simulado (E1–E3)', () => {
  it('el cohete despega con sus motores y masas reales y reproduce los datos publicados', () => {
    let s = flyFrom(launch(), S.pitchStart);
    // Tower cleared: published 468 ft and 70 mph.
    expect(altitudeOf(s)).toBeGreaterThan(0.08);
    expect(altitudeOf(s)).toBeLessThan(0.2);
    // Published 70 mph; the initial acceleration depends on the boosters' thrust ramp (assumed).
    expect(Math.abs(speedRel(s) - 0.031)).toBeLessThan(0.01);
    // Booster separation: published 45.2 km and 1.34 km/s (not tuning targets).
    // The first two minutes come out ~10 % faster than published (known model difference).
    s = flyFrom(s, S.srbSeparation);
    expect(s.vehicle.srbSeparated).toBe(true);
    expect(Math.abs(altitudeOf(s) - 45.23)).toBeLessThan(8);
    expect(Math.abs(speedRel(s) - 1.344)).toBeLessThan(0.1);
    expect(s.propulsion.prop[TANK.SRB]).toBe(0);
    // MECO and core stage separation: the three figures the guidance does tune.
    s = flyFrom(s, S.meco);
    expect(altitudeOf(s)).toBeCloseTo(MECO_ALTITUDE, 3);
    expect(s.propulsion.prop[TANK.CORE]).toBeGreaterThan(0);
    s = flyFrom(s, S.coreSeparation);
    expect(s.phase).toBe('INSERCION');
    expect(s.record.insertion!.altitude).toBeCloseTo(INSERTION_ALTITUDE, 3);
    expect(s.record.insertion!.speedRel).toBeCloseTo(INSERTION_SPEED_REL, 5);
    // The inertial velocity is higher: the published figure is relative to the rotating Earth.
    expect(s.record.insertion!.speed - INSERTION_SPEED_REL).toBeGreaterThan(0.35);
    expect(s.markers.map((m) => m.eventId)).toEqual(['E1', 'E2', 'E3']);
  });

  it('Max Q cae cerca del instante publicado, y la aceleración respeta el límite de los RS‑25', () => {
    let s = flyFrom(launch(), 100);
    const q = s.record.maxQ!;
    // Published: 00:01:11. The booster thrust profile has its minimum there.
    expect(Math.abs(q.t - 71)).toBeLessThan(15);
    expect(q.q).toBeGreaterThan(15000);
    expect(q.q).toBeLessThan(45000);
    expect(s.log.some((l) => l.text.startsWith('Max Q'))).toBe(true);
    // Near the end of the burn the mass is small: without the limit it would exceed 4 g.
    s = flyFrom(s, 470);
    const f = forces(powerInputOf(s)!, s.t, s.ship.r, s.ship.v, s.propulsion.prop);
    expect(f.thrustAccel).toBeCloseTo(P.ascent.gLimit, 3);
    expect(f.thrustAccel / G0).toBeLessThan(4);
    // The last 5 s are at 67 %: the acceleration drops.
    const end = flyFrom(s, 484);
    const fe = forces(powerInputOf(end)!, end.t, end.ship.r, end.ship.v, end.propulsion.prop);
    // (the acceleration limit already had the engines near 70 %, so the drop is small)
    expect(fe.thrustAccel).toBeLessThan(f.thrustAccel);
    expect(fe.thrust / f.thrust).toBeLessThan(0.95);
  });

  it('cuenta regresiva: arranca en T‑10 min sin consumir; los RS‑25 en T‑6,36 s sujetos sobre la cubierta del ML; los boosters en T‑0', () => {
    const pad = launch();
    expect(pad.t).toBe(INITIAL_MET);
    expect(INITIAL_MET).toBe(-600);
    expect(pad.ascentEngines).toEqual([]);
    // Mass on the pad: 2,604 t of loaded SLS + Orion (NASA guides; the model sums its parts).
    expect(totalMass(pad.vehicle, pad.propulsion.prop) / 1e6).toBeCloseTo(2.63, 1);
    // The rocket rests on the support posts of the Mobile Launcher deck, on the pad:
    // 55 ft above sea level + 47 ft deck + 5 ft posts = 107 ft.
    expect(altitudeOf(pad) * 1000).toBeCloseTo(107 * 0.3048, 6);
    // Until the RS‑25 start nothing is consumed and the rocket stays on the pad.
    const before = flyFrom(pad, -RS25_START_BEFORE_LIFTOFF - 0.01);
    expect(before.ascentEngines).toEqual([]);
    expect(before.propulsion.prop).toEqual(pad.propulsion.prop);
    expect(altitudeOf(before)).toBeCloseTo(LAUNCH_SITE_HEIGHT, 9);
    const start = flyFrom(pad, -RS25_START_BEFORE_LIFTOFF);
    expect(RS25_START_BEFORE_LIFTOFF).toBe(6.36);
    expect(start.ascentEngines).toEqual(['RS25']);
    const s = flyFrom(pad, 0);
    expect(s.t).toBe(0);
    expect(altitudeOf(s)).toBeCloseTo(LAUNCH_SITE_HEIGHT, 9);
    expect(s.ascentEngines).toEqual(['SRB', 'RS25']);
    // 6.36 seconds of RS‑25 burn core stage propellant before liftoff.
    expect(MASS.coreProp - s.propulsion.prop[TANK.CORE]).toBeGreaterThan(4000);
    expect(MASS.coreProp - s.propulsion.prop[TANK.CORE]).toBeLessThan(9000);
    // Published liftoff thrust: 36,787 kN.
    const f = forces(powerInputOf(s)!, 0, s.ship.r, s.ship.v, s.propulsion.prop);
    expect(f.thrust / 1e3).toBeCloseTo(36787, -3);
    expect(f.thrustAccel / G0).toBeGreaterThan(1.2);
    expect(f.thrustAccel / G0).toBeLessThan(1.7);
    // The boosters' effective specific impulse comes from the published curve and propellant.
    expect(SRB_ISP).toBeGreaterThan(255);
    expect(SRB_ISP).toBeLessThan(275);
  });

  it('la tabla de eventos publicada del ascenso y la órbita se reproduce sin haberla ajustado', () => {
    let s = launch();
    for (const row of ASCENT_TABLE.slice(1)) {
      s = flyFrom(s, row.met);
      // Altitude within 3 km or 15 %; relative velocity within 0.1 km/s or 7 %.
      // In the first two minutes the model runs ~10 % faster than the table (known model difference).
      expect(Math.abs(altitudeOf(s) - row.altitude)).toBeLessThan(Math.max(3, 0.15 * row.altitude));
      expect(Math.abs(speedRel(s) - row.speed)).toBeLessThan(Math.max(0.1, 0.07 * row.speed));
    }
    for (const row of ORBIT_TABLE) {
      s = flyFrom(s, row.met);
      expect(Math.abs(altitudeOf(s) - row.altitude)).toBeLessThan(Math.max(30, 0.05 * row.altitude));
      expect(Math.abs(speedIn(s) - row.speed)).toBeLessThan(0.05 * row.speed);
    }
  });

  it('con un guiado malo el cohete no llega a la órbita', () => {
    const bad = flyFrom(createInitialState({ ...P, ascent: { ...P.ascent, kickDeg: 25 } }, { headless: true, autoCrew: true }), 3000);
    expect(['crash', 'reentry-early']).toContain(bad.outcome?.kind);
  });
});

describe('cuenta final', () => {
  it('los hitos están ordenados y en sus T‑ publicados, entre T‑10 min y T‑0', () => {
    for (let i = 1; i < COUNTDOWN.length; i++) expect(COUNTDOWN[i].met).toBeGreaterThanOrEqual(COUNTDOWN[i - 1].met);
    const at = (id: string): number => COUNTDOWN.find((m) => m.id === id)!.met;
    expect(at('GLS')).toBe(INITIAL_MET);
    expect(at('CAA')).toBe(-8 * 60);
    expect(at('PRESS')).toBe(-6 * 60);
    expect(at('FTS')).toBe(-(4 * 60 + 30));
    expect(at('ALS')).toBe(-33);
    expect(at('WATER')).toBe(-20);
    expect(at('ROFI')).toBe(-12);
    expect(at('RS25')).toBe(-6.36);
    expect(at('LIFTOFF')).toBe(0);
    // Each logged milestone appears once, at its exact MET.
    const s = flyFrom(launch(), 1);
    for (const m of COUNTDOWN.filter((c) => c.log)) {
      const lines = s.log.filter((l) => l.text === tr(m.log!));
      expect(lines.map((l) => l.t)).toEqual([m.met]);
    }
  });

  it('el estado de tierra sale del tiempo: brazo, venteos, ROFI, agua, umbilicales', () => {
    expect(countdownStatus(-590)).toMatchObject({ mode: 'gls', accessArm: 'extended', ventsOpen: true, rofi: false, water: 'off', attached: true });
    expect(countdownStatus(-470).accessArm).toBe('retracting');
    expect(countdownStatus(-300)).toMatchObject({ accessArm: 'retracted', ventsOpen: false });
    expect(countdownStatus(-15)).toMatchObject({ mode: 'als', rofi: false, water: 'flowing' });
    expect(countdownStatus(-5)).toMatchObject({ rofi: true, attached: true });
    expect(countdownStatus(1)).toMatchObject({ mode: 'flight', rofi: false, attached: false, next: COUNTDOWN.length });
  });

  it('el despegue es reproducible: el mismo estado en T‑0 avanzando de un tirón o en tramos desparejos', () => {
    const once = flyFrom(launch(), 0);
    let s = cmd.play(launch());
    for (let k = 0; s.t < 0; k++) s = advance(s, Math.min([7.3, 0.9, 41, 2.2][k % 4], -s.t), Infinity);
    expect(s.t).toBe(0);
    for (let i = 0; i < s.propulsion.prop.length; i++) expect(s.propulsion.prop[i]).toBeCloseTo(once.propulsion.prop[i], 6);
    expect(length(sub(s.ship.r, once.ship.r))).toBeLessThan(1e-12);
  });

  it('en T‑33 s el warp baja a ×1 y el frame termina ahí; con la tripulación automática no', () => {
    let s = cmd.setWarp(cmd.play(cmd.reset(P)), 10000);
    // One frame at ×10000 is 167 s: without the cut it would skip the launch.
    while (s.t < MET_ALS) s = cmd.tick(s, 1 / 60);
    expect(s.t).toBe(MET_ALS);
    expect(s.clock.warp).toBe(1);
    expect(s.clock.running).toBe(true);
    let auto = cmd.setWarp(cmd.play(cmd.reset(P, { autoCrew: true })), 1000);
    while (auto.t < 0) auto = cmd.tick(auto, 1 / 60);
    expect(auto.clock.warp).toBe(1000);
  });

  it('habla Kennedy hasta que el cohete despeja la torre y Houston desde ahí', () => {
    const feed = capcomFeed(flyFrom(launch(), -1));
    expect(feed.length).toBeGreaterThanOrEqual(5);
    expect(feed.every((m) => m.from === 'KSC')).toBe(true);
    const after = capcomFeed(flyFrom(launch(), S.pitchStart + 1));
    expect(after.filter((m) => m.from === 'HOUSTON').map((m) => m.t)).toEqual([S.pitchStart]);
  });

  it('Procs muestra la cuenta y el ascenso (LAUNCH) hasta la separación de la etapa central', () => {
    const pad = cmd.reset(P);
    expect(pad.proc.activeId).toBe('LAUNCH');
    const view = procedureView(pad, 'LAUNCH');
    expect(view.steps.every((st) => st.kind === 'AUTO')).toBe(true);
    expect(view.steps[0].done).toBe(true);
    expect(view.steps.slice(1).some((st) => st.done)).toBe(false);
    const meco = flyFrom(cmd.play(cmd.reset(P, { autoCrew: true })), S.meco + 1);
    expect(meco.proc.activeId).toBe('LAUNCH');
    expect(procedureView(meco, 'LAUNCH').steps.filter((st) => !st.done).map((st) => st.key)).toEqual(['core']);
    const orbit = flyFrom(meco, S.coreSeparation + 1);
    expect(orbit.proc.activeId).toBe('SEP_ICPS');
  });
});

describe('H6 · fase en órbita terrestre', () => {
  const s = fly(P, P.burns.E9.met - 1);
  const apsides = s.record.apsides;

  it('sin E4 la nave reentra: el perigeo de inserción queda bajo la interfaz de entrada', () => {
    const noE4 = fly(withBurn(withBurn(P, 'E4', { prograde: 0 }), 'E5', { prograde: 0 }), 4 * 3600);
    expect(noE4.outcome?.kind).toBe('reentry-early');
  });

  it('E4 y E5 encienden solos en los MET publicados y entregan el Δv pedido', () => {
    const e4 = s.log.find((l) => l.eventId === 'E4')!;
    const e5 = s.log.find((l) => l.eventId === 'E5')!;
    expect(e4.t).toBe(MET_E4_PERIGEE_RAISE);
    expect(e5.t).toBe(MET_E5_APOGEE_RAISE);
    expect(s.propulsion.icpsBurns).toBe(2);
    expect(s.propulsion.icpsDvUsed).toBeCloseTo(dvMagnitude(P.burns.E4.dv) + dvMagnitude(P.burns.E5.dv), 6);
    expect(s.autoBurns.E5.status).toBe('done');
  });

  it('las órbitas publicadas: inserción 28 × 2.222, tras E4 185 × 2.222, tras E5 perigeo 0 y tras E8 perigeo 185 km (apogeo de control: 74.080 km)', () => {
    const ins = elements(fly(P, 700));
    expect(Math.abs(ins.rp - R_EARTH - INSERTION_ORBIT.perigee)).toBeLessThan(15);
    expect(Math.abs(ins.ra - R_EARTH - INSERTION_ORBIT.apogee)).toBeLessThan(60);
    const prm = elements(fly(P, MET_E4_PERIGEE_RAISE + 400));
    expect(prm.rp - R_EARTH).toBeCloseTo(POST_PRM_ORBIT.perigee, 1);
    expect(Math.abs(prm.ra - R_EARTH - POST_PRM_ORBIT.apogee)).toBeLessThan(60);
    const arb = fly(P, MET_E5_APOGEE_RAISE + 1900);
    expect(arb.burn).toBeNull();
    expect(Math.abs(elements(arb).rp - R_EARTH - POST_ARB_ORBIT.perigee)).toBeLessThan(1);
    // The ICPS has margin left: the burn did not end by depletion.
    expect(arb.propulsion.prop[TANK.ICPS]).toBeGreaterThan(500);
    // The apogee is set by the timeline's TLI time (~70,100 km); the SLS guide's 40,000 NM are a check value.
    const afterE7 = elements(fly(P, MET_E7_DEPARTURE + E7_BURN_DURATION + 60));
    expect(Math.abs(afterE7.ra - R_EARTH - POST_ARB_ORBIT.apogee) / POST_ARB_ORBIT.apogee).toBeLessThan(0.07);
    const heo = elements(fly(P, P.burns.E8.met + 600));
    expect(heo.rp - R_EARTH).toBeCloseTo(HEO_ORBIT.perigee, 1);
    expect(Math.abs(heo.ra - R_EARTH - HEO_ORBIT.apogee) / HEO_ORBIT.apogee).toBeLessThan(0.07);
  });

  it('las duraciones: E4 ~30 s, E5 ~20 min y E7 2 min, como publica NASA', () => {
    const e4 = fly(P, MET_E4_PERIGEE_RAISE + 1).burn!;
    expect(e4.tEnd - e4.tStart).toBeGreaterThan(20);
    expect(e4.tEnd - e4.tStart).toBeLessThan(40);
    const before = fly(P, MET_E5_APOGEE_RAISE);
    const mass = totalMass(before.vehicle, before.propulsion.prop);
    const duration = burnDuration(ENGINES.RL10, mass, dvMagnitude(P.burns.E5.dv));
    expect(before.burn!.tEnd - before.burn!.tStart).toBeCloseTo(duration, 6);
    expect(duration / 60).toBeGreaterThan(15);
    expect(duration / 60).toBeLessThan(21);
    // E5 holds the inertial attitude from ignition.
    expect(before.burn!.fixedDir).not.toBeNull();
    const e7 = fly(P, MET_E7_DEPARTURE + 1).burn!;
    expect(e7.tEnd - e7.tStart).toBeCloseTo(E7_BURN_DURATION, 3);
  });

  it('la órbita alta es estable durante el chequeo y vuelve al perigeo para el TLI', () => {
    expect(s.outcome).toBeNull();
    expect(s.phase).toBe('ORBITA_ALTA');
    const high = apsides.find((a) => a.type === 'apoapsis' && a.t > MET_E5_APOGEE_RAISE + 3000)!;
    expect(high.radius - R_EARTH).toBeGreaterThan(65000);
    // [TL] timeline: perigee raise at apogee at ~0/13:30 and TLI at 1/01:08:42.
    expect(Math.abs(high.t - PUBLISHED_MET.prb)).toBeLessThan(15 * 60);
    expect(Math.abs(P.burns.E9.met - PUBLISHED_MET.tli)).toBeLessThan(5);
    const next = fly(withBurn(P, 'E9', { prograde: 0 }), P.burns.E9.met + 1200);
    const peri = next.record.apsides.find((a) => a.type === 'periapsis' && a.t > high.t)!;
    expect(Math.abs(peri.t - (P.burns.E9.met + TLI_HALF_BURN))).toBeLessThan(5);
    expect(peri.radius - R_EARTH).toBeGreaterThan(150);
    // Without E8, Orion reenters at perigee: the published orbit after E5 has its perigee at zero altitude.
    const noE8 = fly(withBurn(withBurn(P, 'E8', { prograde: 0 }), 'E9', { prograde: 0 }), P.burns.E9.met + 3600);
    expect(noE8.outcome?.kind).toBe('reentry-early');
  });
});

describe('H7 · retorno libre', () => {
  const s = fly(P);

  it('la misión completa corre sola desde la plataforma hasta la interfaz de entrada', () => {
    expect(s.outcome?.kind).toBe('success');
    expect(s.record.perilune!.altitude).toBeCloseTo(FLYBY_ALTITUDE_TARGET, 0);
    expect(s.record.ei!.fpaDeg).toBeGreaterThan(ENTRY_CORRIDOR.min);
    expect(s.record.ei!.fpaDeg).toBeLessThan(ENTRY_CORRIDOR.max);
    expect(s.record.ei!.fpaDeg).toBeCloseTo(ENTRY_CORRIDOR.target, 2);
    expect(s.t / DAY).toBeGreaterThan(8);
    expect(s.t / DAY).toBeLessThan(11);
    for (const id of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12', 'E13', 'E14']) {
      expect(s.markers.some((m) => m.eventId === id)).toBe(true);
    }
  });

  it('sigue el cronograma publicado: sobrevuelo y entrada a menos de 1 h (Luna a la distancia real de abril de 2026)', () => {
    expect(Math.abs(s.record.perilune!.t - PUBLISHED_MET.flyby)).toBeLessThan(3600);
    expect(Math.abs(s.record.ei!.t - PUBLISHED_MET.ei)).toBeLessThan(3600);
  });

  it('coincide con los valores nominales guardados en params.json', () => {
    expect(s.record.perilune!.t).toBeCloseTo(P.nominal.flybyMet, 0);
    expect(s.record.ei!.t).toBeCloseTo(P.nominal.eiMet, 0);
    expect(s.record.insertion!.speed).toBeCloseTo(P.nominal.insertionSpeed, 6);
  });

  it('H9 · LOS durante el sobrevuelo y AOS al salir', () => {
    const los = s.log.find((l) => l.text.startsWith('LOS'))!;
    const aos = s.log.find((l) => l.text.startsWith('AOS'))!;
    const flyby = s.record.perilune!.t;
    expect(los.t).toBeLessThan(flyby);
    expect(aos.t).toBeGreaterThan(flyby);
    expect(aos.t - los.t).toBeLessThan(2 * 3600);
    expect(s.trail.some((p) => p.net === 'LOS')).toBe(true);
  });

  it('H9 · el Δv entregado y el propelente gastado son coherentes con los encendidos', () => {
    const b = P.burns;
    const orion = b.E7.dv.prograde + b.E8.dv.prograde + b.E9.dv.prograde;
    expect(s.propulsion.orionDvUsed).toBeCloseTo(orion, 6);
    expect(s.propulsion.mainBurns).toBe(2);
    expect(s.propulsion.auxBurns).toBe(1);
    // Before separating the service module, the propellant spent is the one from the rocket equation.
    const pre = fly(P, P.nominal.eiMet - 2 * 3600);
    const used = FULL_TANKS[TANK.ESM] - pre.propulsion.prop[TANK.ESM];
    const m0 = MASS.cm + MASS.cmProp + MASS.smDry + MASS.esmProp;
    const ideal = m0 * (1 - Math.exp((-orion * 1000) / (G0 * ENGINES.MAIN.ispVac)));
    expect(used / ideal).toBeGreaterThan(0.98);
    expect(used / ideal).toBeLessThan(1.02);
  });

  it('la separación CM/SM ocurre 20 min antes de la interfaz de entrada, como en el cronograma de NASA', () => {
    expect(s.record.cmSepAt).not.toBeNull();
    expect(Math.abs(s.record.ei!.t - s.record.cmSepAt! - CM_SEP_LEAD_TIME)).toBeLessThan(25);
  });

  it('después de la separación CM/SM la cápsula va con el escudo térmico por delante', () => {
    const cm = fly(P, P.nominal.eiMet - 600);
    expect(cm.vehicle.cmSeparated).toBe(true);
    const retro = normalize(sub(ephemerisOf(cm).earth(cm.t).v, cm.ship.v));
    expect(angleBetween(cm.attitude.dir, retro)).toBeLessThan(0.01);
  });

  it('crucero: prograde en el tránsito, retrógrado con la cápsula sola y nada durante un encendido o su orientación previa', () => {
    expect(cruiseSense(fly(P, 3 * 86400))).toBe(1);
    expect(cruiseSense(fly(P, P.nominal.eiMet - 600))).toBe(-1);
    // The TLI ignites 185 s before perigee; 60 s before its TIG the spacecraft is already orienting.
    const tig = P.burns.E9.met;
    expect(cruiseSense(fly(P, tig - 60))).toBe(0);
    expect(cruiseSense(fly(P, tig + 60))).toBe(0);
    expect(cruiseSense(fly(P, 300))).toBe(0);
  });

  it('da el mismo resultado avanzando frame a frame con warp ×10000', () => {
    let f = cmd.setWarp(cmd.play(launch()), 10000);
    for (let i = 0; i < 400000 && !f.outcome; i++) f = cmd.tick(f, 1 / 60);
    expect(f.outcome?.kind).toBe('success');
    expect(f.record.perilune!.altitude).toBeCloseTo(s.record.perilune!.altitude, 0);
    expect(f.record.ei!.fpaDeg).toBeCloseTo(s.record.ei!.fpaDeg, 1);
  });
});

describe('H8 · la misión se vuela desde el panel', () => {
  it('siguiendo los procedimientos se llega al amerizaje sin WARNING', () => {
    const s = runFrames(cmd.reset(P), followProcedures);
    expect(s.outcome?.kind).toBe('success');
    expect(s.record.perilune!.altitude).toBeCloseTo(FLYBY_ALTITUDE_TARGET, -1);
    expect(s.log.filter((l) => l.level === 'WARNING')).toEqual([]);
    expect(s.maneuvers.E9.status).toBe('done');
    expect(s.record.cmSepAt).not.toBeNull();
  });

  it('la predicción tras el TLI anticipa el sobrevuelo y la entrada', () => {
    let s = cmd.play(createInitialState(P, { autoCrew: true }));
    while (s.record.tliAt === null) s = advance(s, 600, Infinity);
    const p = s.prediction!;
    expect(p.end).toBe('ei');
    expect(p.perilune!.altitude).toBeCloseTo(FLYBY_ALTITUDE_TARGET, -1);
    expect(p.ei!.fpaDeg).toBeCloseTo(ENTRY_CORRIDOR.target, 1);
    expect(s.alarms).toEqual([]);
    // The predicted loss of signal brackets the flyby (Sys.Sum shows these times).
    const link = nextLinkChanges(p.points, ephemerisOf(s));
    expect(link.los).not.toBeNull();
    expect(link.los!).toBeLessThan(p.perilune!.t);
    expect(link.aos!).toBeGreaterThan(p.perilune!.t);
    expect(link.aos! - link.los!).toBeLessThan(2 * 3600);
  });

  it('sin acción de la tripulación en el TLI: ventana perdida y la nave queda en órbita', () => {
    const idle = (s: SimState): SimState => (s.proc.activeId === 'E9' ? s : followProcedures(s));
    const s = runFrames(cmd.reset(P), idle, 2.5 * DAY);
    expect(s.outcome).toBeNull();
    expect(s.phase).toBe('ORBITA_ALTA');
    expect(s.maneuvers.E9.status).toBe('missed');
    expect(s.alarms.some((a) => a.id === 'missed:E9' && a.level === 'WARNING')).toBe(true);
  });

  it('los motores de Orion no encienden mientras siga acoplado al ICPS', () => {
    let s = cmd.reset(P);
    s = cmd.selectProcedure(s, 'MAN');
    s = cmd.adjustDv(cmd.toggleAdvanced(s), 0.01);
    s = cmd.fireEngine(cmd.confirmDv(cmd.setSwitch(s, 'mainArm', true)), 'MAIN');
    expect(s.burn).toBeNull();
    expect(s.log[s.log.length - 1].level).toBe('WARNING');
  });

  it('bajar la guarda con el motor encendido corta el encendido', () => {
    let s = flyFrom(createInitialState(P, { headless: true, autoCrew: true }), P.burns.E9.met + 100);
    expect(s.burn?.id).toBe('E9');
    expect(s.maneuvers.E9.status).toBe('burning');
    // The automatic crew does not arm the switch: it is armed and lowered to cut off.
    s = cmd.setSwitch(cmd.setSwitch(s, 'mainArm', true), 'mainArm', false);
    expect(s.burn).toBeNull();
    expect(s.maneuvers.E9.status).toBe('done');
    const delivered = s.propulsion.mainDvUsed - P.burns.E8.dv.prograde;
    expect(delivered).toBeGreaterThan(0.05);
    expect(delivered).toBeLessThan(P.burns.E9.dv.prograde * 0.5);
  });
});

describe('partes que se desprenden', () => {
  it('boosters, torre de escape y etapa central siguen su propia trayectoria y caen', () => {
    let s = cmd.play(createInitialState(P, { autoCrew: true }));
    s = flyFrom(s, S.srbSeparation + 1);
    const boosters = s.debris.filter((d) => d.kind === 'SRB');
    expect(boosters.length).toBe(2);
    // They move apart, one to each side.
    expect(length(sub(boosters[0].ship.r, boosters[1].ship.r))).toBeGreaterThan(0.012);
    s = flyFrom(s, S.lasJettison + 1);
    expect(s.debris.some((d) => d.kind === 'LAS')).toBe(true);
    s = flyFrom(s, S.coreSeparation + 60);
    const core = s.debris.find((d) => d.kind === 'CORE')!;
    expect(length(sub(core.ship.r, s.ship.r))).toBeGreaterThan(0.05);
    // The boosters fall within minutes; the core stage reenters on the first orbit.
    s = flyFrom(s, 3 * 3600);
    expect(s.debris.some((d) => d.kind === 'SRB')).toBe(false);
    expect(s.debris.some((d) => d.kind === 'CORE')).toBe(false);
    expect(s.log.some((l) => l.text.startsWith('Los boosters caen'))).toBe(true);
    expect(s.log.some((l) => l.text.includes('etapa central') && l.text.includes('reingresa'))).toBe(true);
  });

  it('el ICPS libera los CubeSats y reentra en su primer perigeo, unas 25 h después del lanzamiento', () => {
    let s = cmd.play(createInitialState(P, { autoCrew: true }));
    s = flyFrom(s, 6 * 3600);
    const icps = s.debris.find((d) => d.kind === 'ICPS')!;
    expect(icps).toBeDefined();
    expect(length(sub(icps.ship.r, ephemerisOf(s).earth(icps.t).r)) - R_EARTH).toBeGreaterThan(10000);
    expect(s.debris.filter((d) => d.kind === 'CUBESAT').length).toBe(CUBESAT_DEPLOYMENTS.length);
    expect(s.log.some((l) => l.text.includes('eliminación'))).toBe(true);
    s = flyFrom(s, 27 * 3600);
    expect(s.debris.some((d) => d.kind === 'ICPS')).toBe(false);
    const fall = s.log.find((l) => l.text.includes('(ICPS) reingresa'))!;
    expect(Math.abs(fall.t - MET_ICPS_SPLASHDOWN)).toBeLessThan(3 * 3600);
  });
});

describe('actitud y controladores manuales', () => {
  // Orion already separated from the ICPS, in cruise.
  const base = fly(P, 4 * 3600);

  it('durante el ascenso el piloto automático no se puede sacar de AUTO', () => {
    const s = cmd.setDapMode(flyFrom(launch(), 60), 'MAN');
    expect(s.attitude.mode).toBe('AUTO');
  });

  it('en AUTO la nave apunta al prograde; con el RHC en MAN rota al ritmo comandado', () => {
    const eph = ephemerisOf(base);
    const prograde = normalize(sub(base.ship.v, eph.earth(base.t).v));
    expect(angleBetween(base.attitude.dir, prograde)).toBeLessThan(0.02);
    let s = cmd.setRhc(cmd.setDapMode(base, 'MAN'), 'pitch', 1);
    s = flyFrom(s, base.t + 30);
    // 3°/s for 30 s = 90°.
    expect(angleBetween(s.attitude.dir, base.attitude.dir)).toBeCloseTo(Math.PI / 2, 2);
    s = flyFrom(cmd.setRhc(s, 'pitch', 0), s.t + 30);
    expect(angleBetween(s.attitude.dir, base.attitude.dir)).toBeCloseTo(Math.PI / 2, 2);
  });

  it('en crucero nominal la actitud no tiene alabeo ni guiñada respecto de LVLH', () => {
    const e = eulerOf(attitudeAxes(base), lvlhOf(base));
    expect(Math.abs(e.yaw)).toBeLessThan(1e-6);
    expect(Math.abs(e.roll)).toBeLessThan(1e-6);
    // Prograde: the pitch is the flight-path angle.
    expect(Math.abs(e.pitch * (180 / Math.PI) - elements(base).fpaDeg)).toBeLessThan(1);
  });

  it('mover el RHC con el DAP en AUTO lo pasa a MAN', () => {
    const s = cmd.setRhc(base, 'roll', 1);
    expect(s.attitude.mode).toBe('MAN');
    expect(s.log[s.log.length - 1].text).toContain('RHC');
    // The PFD shows the commanded body rate on that axis only.
    const w = bodyRates(s);
    expect(w.roll).toBeCloseTo(RHC_RATE, 12);
    expect(Math.abs(w.pitch) + Math.abs(w.yaw)).toBeLessThan(1e-12);
    // During the ascent the rocket guidance keeps control.
    expect(cmd.setRhc(flyFrom(launch(), 60), 'pitch', 1).attitude.mode).toBe('AUTO');
  });

  it('el alabeo gira la nave sobre su eje sin cambiar hacia dónde empuja', () => {
    const s = flyFrom(cmd.setRhc(base, 'roll', 1), base.t + 30);
    // 90° of roll: the thrust axis stays, the pitch axis turns 90°.
    expect(angleBetween(s.attitude.dir, base.attitude.dir)).toBeLessThan(1e-6);
    expect(angleBetween(s.attitude.pitchAxis, base.attitude.pitchAxis)).toBeCloseTo(Math.PI / 2, 3);
    expect(eulerOf(attitudeAxes(s), lvlhOf(s)).roll).toBeCloseTo(Math.PI / 2, 2);
  });

  it('con guiñada el empuje sale del plano de la órbita lunar', () => {
    // 30° of yaw (10 s at 3°/s), then the THC pushes along the spacecraft axis.
    let s = flyFrom(cmd.setRhc(base, 'yaw', 1), base.t + 10);
    s = cmd.setRhc(s, 'yaw', 0);
    expect(Math.abs(s.attitude.dir.z)).toBeCloseTo(Math.sin(Math.PI / 6), 2);
    const coast = flyFrom(s, s.t + 100);
    const pushed = flyFrom(cmd.setThc(s, 1), s.t + 100);
    const dv = sub(pushed.ship.v, coast.ship.v);
    expect(Math.abs(dv.z) / length(dv)).toBeCloseTo(Math.sin(Math.PI / 6), 2);
    expect(Math.abs(pushed.ship.r.z)).toBeGreaterThan(Math.abs(coast.ship.r.z));
  });

  it('LVLH mantiene el ángulo respecto del horizonte local; INRTL, la actitud inercial', () => {
    const tilted = cmd.setRhc(flyFrom(cmd.setRhc(base, 'pitch', 1), base.t + 10), 'pitch', 0);
    const pitch0 = eulerOf(attitudeAxes(tilted), lvlhOf(tilted)).pitch;
    // 30 min, well before the E7 window.
    const lv = flyFrom(cmd.setDapMode(tilted, 'LVLH'), tilted.t + 1800);
    const inr = flyFrom(cmd.setDapMode(tilted, 'INRTL'), tilted.t + 1800);
    expect(eulerOf(attitudeAxes(lv), lvlhOf(lv)).pitch).toBeCloseTo(pitch0, 3);
    expect(angleBetween(inr.attitude.dir, tilted.attitude.dir)).toBeLessThan(1e-9);
    // In half an hour the local horizon turns: holding it is not the same as holding inertially.
    expect(angleBetween(lv.attitude.dir, inr.attitude.dir)).toBeGreaterThan(0.05);
  });

  it('las separaciones solo actúan con PYRO ARM arriba', () => {
    const early = createInitialState(P, { headless: true });
    expect(cmd.fireIcpsSeparation(early).vehicle.icpsSeparated).toBe(false);
    expect(cmd.fireIcpsSeparation(cmd.setSwitch(early, 'pyroArm', true)).vehicle.icpsSeparated).toBe(true);
  });

  it('el THC empuja con el RCS sobre el eje de la nave y gasta propelente', () => {
    const coast = flyFrom(base, base.t + 100);
    const pushed = flyFrom(cmd.setThc(cmd.setDapMode(base, 'INRTL'), 1), base.t + 100);
    const dv = sub(pushed.ship.v, coast.ship.v);
    // 880 N on ~26.5 t for 100 s ≈ 3.3 m/s.
    expect(length(dv) * 1000).toBeGreaterThan(3);
    expect(length(dv) * 1000).toBeLessThan(3.7);
    expect(angleBetween(normalize(dv), base.attitude.dir)).toBeLessThan(0.02);
    expect(pushed.propulsion.prop[TANK.ESM]).toBeLessThan(coast.propulsion.prop[TANK.ESM]);
    expect(pushed.propulsion.rcsDvUsed).toBeGreaterThan(0.003);
  });

  it('un encendido con la nave mal orientada empuja para donde apunta la nave', () => {
    // Spacecraft turned 180° with a fixed attitude: the "prograde" E7 burn slows down instead of speeding up.
    let s = flyFrom(cmd.setRhc(cmd.setDapMode(base, 'MAN'), 'pitch', 1), base.t + 60);
    s = cmd.setDapMode(cmd.setRhc(s, 'pitch', 0), 'INRTL');
    const good = fly(P, P.burns.E7.met + E7_BURN_DURATION + 10);
    const wrong = flyFrom(s, P.burns.E7.met + E7_BURN_DURATION + 10);
    expect(wrong.maneuvers.E7.status).toBe('done');
    const eph = ephemerisOf(good);
    const vGood = length(sub(good.ship.v, eph.earth(good.t).v));
    const vWrong = length(sub(wrong.ship.v, eph.earth(wrong.t).v));
    expect((vGood - vWrong) * 1000).toBeGreaterThan(1.5);
  });
});

describe('guiado de correcciones', () => {
  it('una OTC recupera la altitud de sobrevuelo con el TLI desviado', () => {
    const off = withBurn(P, 'E9', { prograde: P.burns.E9.dv.prograde + 0.0003 });
    expect(Math.abs(fly(off, P.nominal.flybyMet + DAY).record.perilune!.altitude - FLYBY_ALTITUDE_TARGET)).toBeGreaterThan(50);
    let s = fly(off, P.burns.E9.met + DAY);
    expect(s.phase).toBe('TRANSITO_IDA');
    const res = solveCorrection(s, 'flyby', 'radial');
    expect(res.ok).toBe(true);
    expect(Math.abs(res.dv)).toBeLessThan(0.05);
    s = produce(s, (d) => {
      setManeuver(d, 'E10', { dv: { prograde: 0, normal: 0, radial: res.dv } });
      executeManeuver(d, 'E10');
    });
    while (!s.record.perilune && !s.outcome) s = advance(s, DAY, Infinity);
    // Guidance assumes an instantaneous impulse and the real burn takes time: a small error remains.
    expect(Math.abs(s.record.perilune!.altitude - FLYBY_ALTITUDE_TARGET)).toBeLessThan(25);
    expect(s.propulsion.auxBurns).toBe(2);
  });

  it('una RTC devuelve al corredor una trayectoria con el TLI desviado', () => {
    const off = withBurn(P, 'E9', { prograde: P.burns.E9.dv.prograde + 0.0002 });
    // Without a correction the entry falls outside the corridor.
    const bad = fly(off, P.nominal.eiMet + DAY);
    expect(bad.outcome?.kind).not.toBe('success');
    // With a correction a day and a half after the flyby, it enters again.
    let s = fly(off, P.nominal.flybyMet + 1.5 * DAY);
    expect(s.phase).toBe('REGRESO');
    const res = solveCorrection(s, 'entry', 'radial');
    expect(res.ok).toBe(true);
    expect(Math.abs(res.dv)).toBeLessThan(0.05);
    s = produce(s, (d) => {
      setManeuver(d, 'E12', { dv: { prograde: 0, normal: 0, radial: res.dv } });
      executeManeuver(d, 'E12');
    });
    while (!s.outcome) s = advance(s, DAY, Infinity);
    expect(s.outcome.kind).toBe('success');
    expect(Math.abs(s.record.ei!.fpaDeg - ENTRY_CORRIDOR.target)).toBeLessThan(0.5);
  });
});

describe('línea de tiempo y warp', () => {
  it('el próximo evento sale del plan y, tras el TLI, de la predicción', () => {
    const start = cmd.reset(P);
    expect(nextEvent(start)).toMatchObject({ id: 'E1', t: 0 });
    expect(nextEvent(flyFrom(start, 1))).toMatchObject({ id: 'E2', t: 128 });
    let s = cmd.play(createInitialState(P, { autoCrew: true }));
    while (s.record.tliAt === null) s = advance(s, 600, Infinity);
    const next = nextEvent(s)!;
    expect(next.id).toBe('E11');
    expect(next.t).toBeCloseTo(P.nominal.flybyMet, -2);
  });

  it('al terminar la misión todos los eventos figuran como hechos', () => {
    const rows = timelineStatus(fly(P));
    expect(rows.length).toBe(15);
    expect(rows.every((r) => r.done)).toBe(true);
  });

  it('el warp baja a ×10 antes de E4 y vuelve solo al valor anterior', () => {
    let s = cmd.setWarp(cmd.play(flyFrom(cmd.reset(P), 1)), 1000);
    let min = Infinity;
    for (let i = 0; i < 100000 && s.t < MET_E4_PERIGEE_RAISE + 60; i++) {
      s = cmd.tick(s, 1 / 60);
      min = Math.min(min, s.clock.warp);
    }
    expect(min).toBe(10);
    expect(s.clock.warp).toBe(1000);
    expect(s.warpRestore).toBeNull();
  });
});
