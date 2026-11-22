import { attitudeAxes, commandedAxes } from '../../../sim/advance';
import { nextLinkChanges } from '../../../sim/comms';
import { ATTITUDE_TOLERANCE } from '../../../sim/constants';
import { formatMet, formatNumber } from '../../../sim/format';
import { angleBetween } from '../../../sim/math/vec3';
import { displayPhaseLabel } from '../../../sim/mission/phases';
import { dvAvailable, orionDvRemaining } from '../../../sim/propulsion';
import { SimState, ephemerisOf } from '../../../sim/state';
import { FULL_TANKS, TANK, TankName } from '../../../sim/vehicle';
import { UiKey, useT } from '../../i18n';
import { usePanelUi } from '../../store';

/** Configuration of the stack, as the "Vehicle Segment" field of the real summary. */
function segmentKey(s: SimState): UiKey {
  const v = s.vehicle;
  if (v.cmSeparated) return 'ss.seg.cm';
  if (v.icpsSeparated) return 'ss.seg.orion';
  if (v.coreSeparated) return 'ss.seg.icps';
  return 'ss.seg.sls';
}

function Cell({ label, value, cls = 'val', unit }: { label: string; value: string; cls?: string; unit?: string }): JSX.Element {
  return (
    <div className="ss-cell">
      <span className="lbl">{label}</span>
      <span className={cls}>
        {value}
        {unit && <span className="unit"> {unit}</span>}
      </span>
    </div>
  );
}

/**
 * Sys.Sum: system summary (inspired by the summary page of Orion's cockpit), only with what
 * the simulator models: phase, next loss and acquisition of signal, propellant, Δv,
 * configuration, link, tanks, attitude control and pyros. The real page also shows power,
 * life support and computers, which are not simulated.
 */
export function SysSum({ s }: { s: SimState }): JSX.Element {
  const t = useT();
  const ui = usePanelUi();
  const eph = ephemerisOf(s);
  const p = s.propulsion.prop;
  const link = s.prediction ? nextLinkChanges(s.prediction.points, eph) : { los: null, aos: null };
  const orionProp = s.vehicle.cmSeparated ? p[TANK.CM] : p[TANK.ESM] + p[TANK.CM];
  const dv = s.vehicle.icpsSeparated ? orionDvRemaining(s.propulsion, s.vehicle) : dvAvailable('ICPS', s.propulsion, s.vehicle);
  const err = angleBetween(attitudeAxes(s).x, commandedAxes(s).x);
  const tank = (name: TankName, label: string): JSX.Element | null => {
    const kg = p[TANK[name]];
    if (FULL_TANKS[TANK[name]] === 0) return null;
    const pct = (100 * kg) / FULL_TANKS[TANK[name]];
    return <Cell key={name} label={label} value={`${formatNumber(kg, 0)} kg · ${formatNumber(pct, 0)}%`} cls={pct < 15 ? 'warn' : 'val'} />;
  };
  const sw = s.switches;
  return (
    <div className="page syssum">
      <div className="ss-head">
        <Cell label={t('ss.phase')} value={displayPhaseLabel(s.t, s.phase)} />
        <Cell label="LOS" value={link.los !== null ? formatMet(link.los) : '—'} />
        <Cell label="AOS" value={link.aos !== null ? formatMet(link.aos) : '—'} />
        <Cell label={t('ss.totalProp')} value={formatNumber(orionProp, 0)} unit="kg" />
        <Cell label="Delta V" value={formatNumber(dv * 1000, 0)} unit="m/s" />
        <Cell label={t('ss.segment')} value={t(segmentKey(s))} />
      </div>
      <div className="ss-grid">
        <section>
          <h4>Comm</h4>
          <Cell label={t('ss.net')} value={s.comms.network} />
          <Cell label={t('pg.link')} value={s.comms.los ? 'LOS' : 'AOS'} cls={s.comms.los ? 'warn' : 'on-green'} />
          <Cell label={t('ss.delay')} value={formatNumber(s.comms.delay, 2)} unit="s" />
        </section>
        <section>
          <h4>Prop</h4>
          {!s.vehicle.icpsSeparated && tank('ICPS', 'ICPS')}
          {!s.vehicle.cmSeparated && tank('ESM', 'SM')}
          {tank('CM', 'CM RCS')}
          <Cell label="Main · Aux" value={`${sw.mainArm ? t('ss.armed') : t('ss.safe')} · ${sw.auxArm ? t('ss.armed') : t('ss.safe')}`} cls={sw.mainArm || sw.auxArm ? 'warn' : 'val'} />
        </section>
        <section>
          <h4>GNC</h4>
          <Cell label="DAP" value={s.attitude.mode} cls={s.attitude.mode === 'MAN' ? 'manual' : 'val'} />
          <Cell label="Att Ref" value={ui.attRef === 'LVLH' ? 'LVLH' : 'INRTL'} />
          <Cell label={t('pg.attErr')} value={`${formatNumber((err * 180) / Math.PI, 1)}°`} cls={err < ATTITUDE_TOLERANCE ? 'val' : 'warn'} />
        </section>
        <section>
          <h4>Pyro</h4>
          <Cell label="Pyro Arm" value={sw.pyroArm ? t('ss.armed') : t('ss.safe')} cls={sw.pyroArm ? 'warn' : 'val'} />
          <Cell label="ICPS Sep" value={s.vehicle.icpsSeparated ? t('ss.fired') : '—'} />
          <Cell label="CM/SM Sep" value={s.vehicle.cmSeparated ? t('ss.fired') : '—'} />
        </section>
      </div>
    </div>
  );
}
