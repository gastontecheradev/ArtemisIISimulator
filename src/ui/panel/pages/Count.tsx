import { useEffect, useRef } from 'react';
import { runningEngines } from '../../../sim/advance';
import { formatCountdown, formatDuration } from '../../../sim/format';
import { tr } from '../../../sim/i18n';
import { ASCENT_SEQUENCE } from '../../../sim/mission/ascent';
import { COUNTDOWN, countdownStatus } from '../../../sim/mission/countdown';
import { SimState } from '../../../sim/state';
import { rs25PowerLevel } from '../../../sim/vehicle';
import { UiKey, useT } from '../../i18n';
import { getPanelUi, setPanelUi, usePanelUi } from '../../store';
import type { SoftAction } from './index';

/** Rows the Scroll key moves the list. */
const SCROLL_STEP = 5;

/** Row the list keeps in view: the one chosen with Scroll or, by default, the next milestone. */
function focusRow(s: SimState, chosen: number | null): number {
  return chosen ?? Math.min(countdownStatus(s.t).next, COUNTDOWN.length - 1);
}

/** Flt.Count side keys: Scroll pages through the milestones; past the end it follows the count again. */
export function countActions(s: SimState): SoftAction[] {
  const chosen = getPanelUi().countFocus;
  const focus = focusRow(s, chosen);
  return [
    {
      side: 'L',
      slot: 0,
      label: 'Scroll',
      lit: chosen !== null,
      run: () => {
        const next = focus + SCROLL_STEP;
        setPanelUi({ countFocus: next >= COUNTDOWN.length ? null : next });
      },
    },
  ];
}

type Tone = 'val' | 'on-green' | 'cnt-state';

/** State of the pad systems and the engines: what the count has done, as text and color. */
function groundRows(s: SimState): [UiKey, UiKey, Tone][] {
  const st = countdownStatus(s.t);
  const engines = runningEngines(s);
  const rs25: [UiKey, Tone] = engines.includes('RS25')
    ? s.t < 0 && rs25PowerLevel(s.t) < 1
      ? ['cnt.v.start', 'cnt-state']
      : ['cnt.v.run', 'on-green']
    : s.t >= ASCENT_SEQUENCE.meco
      ? ['cnt.v.cutoff', 'val']
      : ['cnt.v.off', 'val'];
  const srb: [UiKey, Tone] = engines.includes('SRB')
    ? ['cnt.v.run', 'on-green']
    : s.vehicle.srbSeparated
      ? ['cnt.v.sep', 'val']
      : s.t > 0
        ? ['cnt.v.burnout', 'val']
        : ['cnt.v.off', 'val'];
  return [
    ['cnt.arm', st.accessArm === 'extended' ? 'cnt.v.ext' : st.accessArm === 'retracting' ? 'cnt.v.retracting' : 'cnt.v.retracted', st.accessArm === 'retracting' ? 'cnt-state' : 'val'],
    ['cnt.vents', st.ventsOpen ? 'cnt.v.open' : 'cnt.v.closed', 'val'],
    ['cnt.umb', st.attached ? 'cnt.v.conn' : 'cnt.v.rel', 'val'],
    ['cnt.hold', st.attached ? 'cnt.v.held' : 'cnt.v.free', 'val'],
    ['cnt.rofi', st.rofi ? 'cnt.v.on' : 'cnt.v.off', st.rofi ? 'on-green' : 'val'],
    ['cnt.water', st.water === 'flowing' ? 'cnt.v.flow' : st.water === 'done' ? 'cnt.v.done' : 'cnt.v.standby', st.water === 'flowing' ? 'on-green' : 'val'],
    ['cnt.rs25', rs25[0], rs25[1]],
    ['cnt.srb', srb[0], srb[1]],
  ];
}

/**
 * Flt.Count: the terminal count as NASA published it. Countdown clock, who runs the count
 * (GLS, then ALS) and the time to the next milestone; the state of the pad systems and the
 * engines (pad on the left column, ignition on the right); and the list of milestones with
 * their T‑ time (done in green, next in magenta, as in Mission.Tl).
 * No tank pressures or battery voltages: they are not simulated.
 */
export function Count({ s }: { s: SimState }): JSX.Element {
  const t = useT();
  const ui = usePanelUi();
  const st = countdownStatus(s.t);
  const focus = focusRow(s, ui.countFocus);
  const listRef = useRef<HTMLOListElement>(null);
  const next = st.next < COUNTDOWN.length ? COUNTDOWN[st.next] : null;

  // Keeps the focus row in view by scrolling the list only (never the panel around it).
  useEffect(() => {
    const list = listRef.current;
    const row = list?.children[focus] as HTMLElement | undefined;
    if (!list || !row) return;
    const top = row.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight;
  }, [focus]);

  return (
    <div className="page count">
      <div className="cnt-head">
        <span className="cnt-clock">{formatCountdown(s.t, false, true)}</span>
        <span className="cnt-mode on-green">{t(`cnt.mode.${st.mode}`)}</span>
        {next && (
          <span className="cnt-next">
            <span className="lbl">{t('cnt.next')} </span>
            <span className="val">{formatDuration(Math.ceil(next.met - s.t))} </span>
            <span className="cmd">{tr(`cd.${next.id}`)}</span>
          </span>
        )}
      </div>
      <div className="cnt-ground" title={t('cnt.ground')}>
        {groundRows(s).map(([label, value, tone]) => (
          <div key={label} className="cnt-g-row">
            <span className="lbl">{t(label)}</span>
            <span className={tone}>{t(value)}</span>
          </div>
        ))}
      </div>
      <ol className="cnt-list" ref={listRef}>
        {COUNTDOWN.map((m, i) => {
          const done = s.t >= m.met;
          return (
            <li key={m.id} className={`cnt-row${done ? ' done' : ''}${i === st.next ? ' next' : ''}`}>
              <span className="tick">{done ? '✓' : ''}</span>
              <span className="cnt-t">{formatCountdown(m.met, true)}</span>
              <span className="cnt-name">{tr(`cd.${m.id}`)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
