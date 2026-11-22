import type { SimKey } from '../i18n';
import { RS25_START_BEFORE_LIFTOFF } from '../vehicle';

/**
 * Terminal count of Artemis II, from T‑10 min to T‑0, as NASA published it ([CNT] in
 * constants.ts; the times are "approximate"). It is the programmed sequence of the ground
 * launch sequencer (GLS) and then of the automated launch sequencer (ALS): in the real
 * vehicle it is also programmed (architecture rule 4). The crew has no required action.
 *
 * The simulation only needs a few of these milestones (the RS‑25 start, booster ignition);
 * the rest are shown on the Flt.Count page, in the log and in the LAUNCH procedure, and
 * set the state of the ground systems (`countdownStatus`) for the views.
 */

export type CountdownId =
  | 'GLS'
  | 'CAA'
  | 'PRESS'
  | 'ORION'
  | 'LH2_CORE'
  | 'LAS'
  | 'LH2_BLEED'
  | 'FTS'
  | 'APU'
  | 'LOX_ICPS'
  | 'PURGE4'
  | 'ICPS_BATT'
  | 'SRB_BATT'
  | 'CORE_INT'
  | 'ICPS_TERM'
  | 'LH2_ICPS'
  | 'ALS'
  | 'CORE_ALS'
  | 'WATER'
  | 'ROFI'
  | 'START_CMD'
  | 'RS25'
  | 'LIFTOFF';

export interface CountdownMilestone {
  readonly id: CountdownId;
  /** MET (s): negative before liftoff. */
  readonly met: number;
  /** Text written to the event log, or null (only the main milestones: the Flt.Count page lists them all). */
  readonly log: SimKey | null;
  /** Step of the LAUNCH procedure in Procs. */
  readonly proc: boolean;
}

/** Start of the terminal count: the mission starts here (T‑10 min). [CNT] */
export const COUNT_START = -600;
/** [CNT] T‑8 min: the crew access arm retracts. */
export const MET_ACCESS_ARM_RETRACT = -480;
/**
 * ASSUMPTION: how long the crew access arm takes to swing away (s). [CNT] only gives when
 * it starts; the value is only used to draw it.
 */
export const ACCESS_ARM_RETRACT_DURATION = 60;
/** [CNT] T‑6 min: core stage tank pressurization (the boil-off vents close). */
export const MET_TANK_PRESS = -360;
/** [CNT] T‑33 s: the GLS hands the count over to the automated launch sequencer (ALS). */
export const MET_ALS = -33;
/**
 * [39B] Sound suppression water: it starts "about 20 seconds before T‑0" (quoted from NASA's
 * "Pad 39B Water Flow Test Comes Through Loud and Clear", through a search result: the page was
 * not read in full) and the ~400,000 gallons are released "in less than 30 seconds" (the upper
 * bound is used as the duration).
 */
export const MET_WATER = -20;
export const WATER_DURATION = 30;
/** [CNT] T‑12 s: the hydrogen burn-off igniters (ROFI) light under the RS‑25s. ASSUMPTION: they stay lit until T‑0. */
export const MET_ROFI = -12;

export const COUNTDOWN: readonly CountdownMilestone[] = [
  { id: 'GLS', met: COUNT_START, log: null, proc: true },
  { id: 'CAA', met: MET_ACCESS_ARM_RETRACT, log: 'log.cd.CAA', proc: true },
  { id: 'PRESS', met: MET_TANK_PRESS, log: 'log.cd.PRESS', proc: true },
  { id: 'ORION', met: MET_TANK_PRESS, log: null, proc: false },
  { id: 'LH2_CORE', met: -357, log: null, proc: false },
  { id: 'LAS', met: -320, log: null, proc: false },
  { id: 'LH2_BLEED', met: -280, log: null, proc: false },
  { id: 'FTS', met: -270, log: null, proc: false },
  { id: 'APU', met: -240, log: null, proc: false },
  { id: 'LOX_ICPS', met: -210, log: null, proc: false },
  { id: 'PURGE4', met: -190, log: null, proc: false },
  { id: 'ICPS_BATT', met: -122, log: null, proc: false },
  { id: 'SRB_BATT', met: -120, log: null, proc: false },
  { id: 'CORE_INT', met: -90, log: null, proc: false },
  { id: 'ICPS_TERM', met: -80, log: null, proc: false },
  { id: 'LH2_ICPS', met: -50, log: null, proc: false },
  { id: 'ALS', met: MET_ALS, log: 'log.cd.ALS', proc: true },
  { id: 'CORE_ALS', met: -30, log: null, proc: false },
  { id: 'WATER', met: MET_WATER, log: null, proc: false },
  { id: 'ROFI', met: MET_ROFI, log: 'log.cd.ROFI', proc: false },
  { id: 'START_CMD', met: -10, log: null, proc: false },
  { id: 'RS25', met: -RS25_START_BEFORE_LIFTOFF, log: 'log.cd.RS25', proc: true },
  { id: 'LIFTOFF', met: 0, log: null, proc: true },
];

export type AccessArmState = 'extended' | 'retracting' | 'retracted';

/** State of the count and of the ground systems at an instant (a function of time only). */
export interface CountdownStatus {
  /** Index in COUNTDOWN of the next milestone (COUNTDOWN.length once all have happened). */
  readonly next: number;
  /** Who runs the count: the GLS, the ALS (from T‑33 s) or nobody (after liftoff). */
  readonly mode: 'gls' | 'als' | 'flight';
  readonly accessArm: AccessArmState;
  /** How far the crew access arm has gone (0 extended, 1 retracted), linear in time; the drawing eases it. */
  readonly accessArmTravel: number;
  /** Boil-off vents of the core stage: open until the tanks are pressurized. */
  readonly ventsOpen: boolean;
  readonly rofi: boolean;
  readonly water: 'off' | 'flowing' | 'done';
  /** Umbilicals and hold-down posts: they release at T‑0. */
  readonly attached: boolean;
}

export function countdownStatus(t: number): CountdownStatus {
  const i = COUNTDOWN.findIndex((m) => m.met > t);
  const armT = t - MET_ACCESS_ARM_RETRACT;
  const waterT = t - MET_WATER;
  return {
    next: i < 0 ? COUNTDOWN.length : i,
    mode: t >= 0 ? 'flight' : t >= MET_ALS ? 'als' : 'gls',
    accessArm: armT < 0 ? 'extended' : armT < ACCESS_ARM_RETRACT_DURATION ? 'retracting' : 'retracted',
    accessArmTravel: Math.min(1, Math.max(0, armT / ACCESS_ARM_RETRACT_DURATION)),
    ventsOpen: t < MET_TANK_PRESS,
    rofi: t >= MET_ROFI && t < 0,
    water: waterT < 0 ? 'off' : waterT < WATER_DURATION ? 'flowing' : 'done',
    attached: t < 0,
  };
}
