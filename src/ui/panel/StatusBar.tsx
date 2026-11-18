import { selectProcedure } from '../../sim/commands';
import { formatDuration, formatMet } from '../../sim/format';
import { phaseLabel } from '../../sim/mission/phases';
import { nextEvent } from '../../sim/mission/timeline';
import { SimState } from '../../sim/state';
import { useT } from '../i18n';
import { act } from '../store';
import { procedureFor } from './faults';

/** Flight day (FD01 on launch day), as in NASA's timeline. */
const flightDay = (t: number): number => Math.max(1, Math.floor(t / 86400) + 1);

/**
 * Status bar (a simulator element, not part of the real cockpit): MET, phase, COMM, simulation
 * speed, next event and the active alarms. The Master Alarm is on the flight control plate,
 * as on Orion's center panel.
 */
export function StatusBar({ s }: { s: SimState }): JSX.Element {
  const t = useT();
  const comm = s.comms.los ? 'LOS' : s.comms.network;
  const run = s.outcome ? t('st.run.end') : s.clock.running ? t('st.run.run') : t('st.run.pause');
  const next = nextEvent(s);
  return (
    <header className="status" data-tour="status">
      <div className="status-row">
        <div className="st-cell">
          <span className="st-label">MET · {t('st.fd')}{String(flightDay(s.t)).padStart(2, '0')}</span>
          <span className="st-value">{formatMet(s.t)}</span>
        </div>
        <div className="st-cell">
          <span className="st-label">{t('st.phase')}</span>
          <span className="st-value">{phaseLabel(s.phase)}</span>
        </div>
        <div className="st-cell">
          <span className="st-label">COMM</span>
          <span className={`st-value comm-${comm.toLowerCase()}`}>{comm}</span>
        </div>
        <div className="st-cell">
          <span className="st-label">SIM</span>
          <span className={s.clock.running ? 'st-value' : 'st-value dim'}>
            ×{s.clock.warp} {run}
          </span>
        </div>
        {next && (
          <div className="st-cell">
            <span className="st-label">
              {t('st.next')} · {next.id} {next.short}
            </span>
            <span className="st-value cmd">T−{formatDuration(next.t - s.t)}</span>
          </div>
        )}
      </div>
      {s.alarms.length > 0 && (
        <div className="annunciator">
          {s.alarms.map((a) => {
            const cls = `ann ${a.level.toLowerCase()}${a.acked ? ' acked' : ''}`;
            const proc = procedureFor(a.id, s);
            // As in the real cockpit, the alarm leads to the procedure that handles it.
            return proc ? (
              <button key={a.id} className={`${cls} link`} title={t('st.openProc')} onClick={() => act((x) => selectProcedure(x, proc))}>
                {a.text} ▸
              </button>
            ) : (
              <span key={a.id} className={cls}>
                {a.text}
              </span>
            );
          })}
        </div>
      )}
    </header>
  );
}
