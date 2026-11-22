import { attitudeAxes, commandedAxes } from '../../../sim/advance';
import { dvMagnitude } from '../../../sim/burns';
import { burnAtp, confirmDv } from '../../../sim/commands';
import { ATTITUDE_TOLERANCE } from '../../../sim/constants';
import { formatDuration, formatMet, formatNumber } from '../../../sim/format';
import { angleBetween } from '../../../sim/math/vec3';
import { PROCEDURE_ORDER, activeManeuverId, isManeuverId } from '../../../sim/mission/procedures';
import { PropSystem, SYSTEM_ENGINE } from '../../../sim/propulsion';
import { SimState } from '../../../sim/state';
import { ENGINES, G0, burnDuration, totalMass } from '../../../sim/vehicle';
import { UiKey, useT } from '../../i18n';
import { act } from '../../store';
import type { SoftAction } from './index';

export type BurnStatus = 'pend' | 'atped' | 'burn' | 'done' | 'miss' | 'auto';

/** The burn the crew is following: the one in progress, the one loaded in Procs or the next automatic one. */
export interface BurnSummary {
  readonly id: string;
  readonly system: PropSystem;
  readonly status: BurnStatus;
  readonly tig: number | null;
  /** Planned Δv (km/s) and its split in the local frame. */
  readonly dv: { readonly prograde: number; readonly normal: number; readonly radial: number };
  /** Δv delivered so far (km/s), during the burn. */
  readonly delivered: number | null;
  /** Instant of the automatic cutoff, during the burn. */
  readonly tEnd: number | null;
  readonly confirmed: boolean;
}

export function burnSummary(s: SimState): BurnSummary | null {
  const b = s.burn;
  if (b) {
    const isp = ENGINES[SYSTEM_ENGINE[b.system]].ispVac;
    const delivered = ((G0 * isp) / 1000) * Math.log(b.massStart / totalMass(s.vehicle, s.propulsion.prop));
    return { id: b.id, system: b.system, status: 'burn', tig: b.tStart, dv: b.dv, delivered, tEnd: b.tEnd, confirmed: true };
  }
  const id = activeManeuverId(s);
  if (id) {
    const m = s.maneuvers[id];
    const status: BurnStatus =
      m.status === 'committed' ? 'atped' : m.status === 'done' ? 'done' : m.status === 'missed' ? 'miss' : 'pend';
    return { id, system: m.system, status, tig: m.tig, dv: m.dv, delivered: null, tEnd: null, confirmed: m.confirmed };
  }
  if (!s.vehicle.icpsSeparated) {
    for (const k of ['E4', 'E5'] as const) {
      const ab = s.autoBurns[k];
      if (ab.status === 'pending') return { id: k, system: 'ICPS', status: 'auto', tig: ab.met, dv: ab.dv, delivered: null, tEnd: null, confirmed: true };
    }
  }
  // Otherwise, the next scheduled crew burn (the one Procs will load next).
  const next = PROCEDURE_ORDER.map((p) => (isManeuverId(p) ? s.maneuvers[p] : null)).find(
    (m) => m && m.tig !== null && m.status === 'pending',
  );
  if (next) return { id: next.id, system: next.system, status: 'pend', tig: next.tig, dv: next.dv, delivered: null, tEnd: null, confirmed: next.confirmed };
  return null;
}

/** Burn ATP is available: a crew burn loaded, with its Δv confirmed and not yet committed. */
export function atpReady(s: SimState): boolean {
  if (s.outcome) return false;
  const id = activeManeuverId(s);
  const m = id ? s.maneuvers[id] : null;
  return !!m && m.status === 'pending' && m.confirmed && (m.system === 'MAIN' || m.system === 'AUX');
}

const STATUS_KEY: Readonly<Record<BurnStatus, UiKey>> = {
  pend: 'bs.pend',
  atped: 'bs.atped',
  burn: 'bs.burn',
  done: 'bs.done',
  miss: 'bs.miss',
  auto: 'bs.auto',
};

/** Burn identification, time to ignition and Δv: the upper-right block of the PFD. */
export function BurnBlock({ s, burn, compact = false }: { s: SimState; burn: BurnSummary | null; compact?: boolean }): JSX.Element {
  const t = useT();
  if (!burn) {
    return (
      <div className="burn-block">
        <span className="lbl">{t('bb.none')}</span>
      </div>
    );
  }
  const toTig = burn.tig !== null ? burn.tig - s.t : null;
  const plan = dvMagnitude(burn.dv);
  return (
    <div className="burn-block">
      <div className="bb-head">
        <span className="bb-id">{burn.id}</span>
        <span className={`bb-status ${burn.status}`}>{t(STATUS_KEY[burn.status])}</span>
        <span className="bb-sys">{burn.system}</span>
      </div>
      {burn.tig !== null && !compact && (
        <div className="row">
          <span className="lbl">TIG</span>
          <span className="val">{formatMet(burn.tig)}</span>
          <span className="unit" />
        </div>
      )}
      {toTig !== null && burn.status !== 'done' && (
        <div className="row">
          <span className="lbl">{toTig >= 0 ? 'T−' : 'T+'}</span>
          <span className={burn.status === 'miss' ? 'alarm' : 'val'}>{formatDuration(Math.abs(toTig))}</span>
          <span className="unit" />
        </div>
      )}
      <div className="row">
        <span className="lbl">ΔV</span>
        <span className="cmd">{formatNumber(plan * 1000, 1)}</span>
        <span className="unit">m/s</span>
      </div>
      {burn.delivered !== null && (
        <div className="row">
          <span className="lbl">{t('bb.togo')}</span>
          <span className="on-green">{formatNumber(Math.max(0, plan - burn.delivered) * 1000, 1)}</span>
          <span className="unit">m/s</span>
        </div>
      )}
      {burn.tEnd !== null && !compact && (
        <div className="row">
          <span className="lbl">{t('pg.cutoffIn')}</span>
          <span className="on-green">{formatNumber(Math.max(0, burn.tEnd - s.t), 0)}</span>
          <span className="unit">s</span>
        </div>
      )}
    </div>
  );
}

/** Flt.Burn side keys: confirm the Δv and give the authority to proceed (Burn ATP). */
export function burnActions(s: SimState): SoftAction[] {
  const id = activeManeuverId(s);
  const m = id ? s.maneuvers[id] : null;
  if (!m) return [];
  return [
    { side: 'R', slot: 0, label: 'Conf\nΔV', run: () => act(confirmDv), disabled: m.confirmed || m.status === 'done', lit: m.confirmed, tone: 'command' },
    { side: 'R', slot: 2, label: 'Burn\nATP', run: () => act(burnAtp), disabled: !atpReady(s) },
  ];
}

/** Flt.Burn: the next burn in detail (identification, timing, Δv split, attitude and arming). */
export function Burn({ s }: { s: SimState }): JSX.Element {
  const t = useT();
  const burn = burnSummary(s);
  if (!burn) return <div className="page burn"><BurnBlock s={s} burn={null} /></div>;
  const engine = ENGINES[SYSTEM_ENGINE[burn.system]];
  const duration = burnDuration(engine, totalMass(s.vehicle, s.propulsion.prop), dvMagnitude(burn.dv));
  const error = angleBetween(attitudeAxes(s).x, commandedAxes(s).x);
  const armed = burn.system === 'MAIN' ? s.switches.mainArm : burn.system === 'AUX' ? s.switches.auxArm : true;
  const comp = (label: string, v: number): JSX.Element => (
    <div className="row">
      <span className="lbl">{label}</span>
      <span className={v !== 0 ? 'cmd' : 'val dim'}>{formatNumber(v * 1000, 1)}</span>
      <span className="unit">m/s</span>
    </div>
  );
  return (
    <div className="page burn">
      <div className="burn-cols">
        <BurnBlock s={s} burn={burn} />
        <div className="rows">
          {comp(t('bb.prograde'), burn.dv.prograde)}
          {comp(t('bb.radial'), burn.dv.radial)}
          {comp(t('bb.normal'), burn.dv.normal)}
          <div className="row">
            <span className="lbl">{t('bb.duration')}</span>
            <span className="val">{formatNumber(duration, 0)}</span>
            <span className="unit">s</span>
          </div>
          <div className="row">
            <span className="lbl">In Att</span>
            <span className={error < ATTITUDE_TOLERANCE ? 'on-green' : 'warn'}>{formatNumber((error * 180) / Math.PI, 1)}°</span>
            <span className="unit" />
          </div>
          <div className="row">
            <span className="lbl">{t('bb.conf')}</span>
            <span className={burn.confirmed ? 'on-green' : 'val dim'}>{burn.confirmed ? '✓' : '—'}</span>
            <span className="unit" />
          </div>
          <div className="row">
            <span className="lbl">{t('bb.arm')}</span>
            <span className={armed ? 'on-green' : 'val dim'}>{armed ? '✓' : '—'}</span>
            <span className="unit" />
          </div>
        </div>
      </div>
    </div>
  );
}
