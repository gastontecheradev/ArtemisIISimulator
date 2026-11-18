import { ackAlarm, ackAlarms, selectProcedure } from '../../../sim/commands';
import { formatMet } from '../../../sim/format';
import { SimState } from '../../../sim/state';
import { useT } from '../../i18n';
import { act, getPanelUi, setPanelUi, usePanelUi } from '../../store';
import { procedureFor, sortedAlarms } from '../faults';
import type { SoftAction } from './index';

/** Row under the cursor, kept inside the list. */
const cursorIn = (n: number, cursor: number): number => (n === 0 ? 0 : Math.min(Math.max(0, cursor), n - 1));

/**
 * Fault side keys, as on the Fault page of Orion's cockpit: Ack All, Scroll and Sort on the left;
 * Open eProc (opens the procedure of the selected alarm in Procs) and Ack on the right.
 */
export function faultActions(s: SimState): SoftAction[] {
  const ui = getPanelUi();
  const list = sortedAlarms(s, ui.faultSort);
  const i = cursorIn(list.length, ui.faultCursor);
  const sel = list[i];
  const proc = sel ? procedureFor(sel.id, s) : null;
  return [
    { side: 'L', slot: 0, label: 'Ack\nAll', run: () => act(ackAlarms), disabled: !s.alarms.some((a) => !a.acked) },
    { side: 'L', slot: 1, label: 'Scroll', run: () => setPanelUi({ faultCursor: (i + 1) % Math.max(1, list.length) }), disabled: list.length < 2 },
    {
      side: 'L',
      slot: 3,
      label: `Sort\n${ui.faultSort === 'time' ? 'Time' : 'Class'}`,
      run: () => setPanelUi({ faultSort: ui.faultSort === 'time' ? 'class' : 'time', faultCursor: 0 }),
    },
    { side: 'R', slot: 0, label: 'Open\neProc', run: () => proc && act((x) => selectProcedure(x, proc)), disabled: !proc },
    { side: 'R', slot: 1, label: 'Ack', run: () => sel && act((x) => ackAlarm(x, sel.id)), disabled: !sel || sel.acked },
  ];
}

/** Fault: the active alarms with their class, time and status; the cursor marks the selected one. */
export function Fault({ s }: { s: SimState }): JSX.Element {
  const t = useT();
  const ui = usePanelUi();
  const list = sortedAlarms(s, ui.faultSort);
  const cursor = cursorIn(list.length, ui.faultCursor);
  if (list.length === 0) {
    return (
      <div className="page fault">
        <span className="lbl">{t('ft.none')}</span>
      </div>
    );
  }
  return (
    <div className="page fault">
      <ol className="fault-list">
        {list.map((a, i) => (
          <li key={a.id} className={`fault-row ${a.level.toLowerCase()}${a.acked ? ' acked' : ''}${i === cursor ? ' cursor' : ''}`}>
            <span className="f-class">{a.level === 'WARNING' ? 'W' : 'C'}</span>
            <span className="f-t">{formatMet(a.since)}</span>
            <span className="f-text">{a.text}</span>
            <span className="f-proc">{procedureFor(a.id, s) ? 'eProc' : ''}</span>
            <span className="f-ack">{a.acked ? 'Ack' : ''}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
