import { useEffect, useRef, useState } from 'react';
import { formatMet } from '../../sim/format';
import { displayPhaseLabel } from '../../sim/mission/phases';
import { SimState } from '../../sim/state';
import { useT } from '../i18n';
import { getPanelUi, setPanelUi, usePanelUi } from '../store';
import { MENUS, PAGES, PageGroup, PageId, SoftAction } from './pages';

/** Keys per edge, as on Orion's displays: 8 above and below the screen, 5 per half on each side. */
const TOP_KEYS = 8;
const SIDE_KEYS = 5;
/** Brightness steps of the Brt/Dim keys. */
const BRIGHTNESS_STEP = 0.15;
const BRIGHTNESS_MIN = 0.4;

/** Bezel key. Without an action it is decorative: not a button and does not react to the mouse. */
function Key({ action, label, press }: { action?: () => void; label?: string; press?: string }): JSX.Element {
  return action ? (
    <button className="softkey" onClick={action} aria-label={label} title={label} data-press={press} />
  ) : (
    <span className="softkey inert" />
  );
}

function SideKeys({ actions, side }: { actions: readonly SoftAction[]; side: 'L' | 'R' }): JSX.Element {
  return (
    <div className="du-keygroup">
      {Array.from({ length: SIDE_KEYS }, (_, i) => {
        const a = actions.find((x) => x.side === side && x.slot === i && !x.disabled);
        return <Key key={i} action={a?.run} label={a?.label.replace('\n', ' ')} press={a?.press} />;
      })}
    </div>
  );
}

/** On-screen labels of the actions, aligned with the side keys. */
function ActionLabels({ actions, side }: { actions: readonly SoftAction[]; side: 'L' | 'R' }): JSX.Element {
  return (
    <div className={`du-actions ${side === 'L' ? 'left' : 'right'}`}>
      {Array.from({ length: SIDE_KEYS }, (_, i) => {
        const a = actions.find((x) => x.side === side && x.slot === i);
        if (!a) return <span key={i} className="du-action empty" />;
        const kind = a.option ? (a.lit ? ' on' : ' off') : a.lit ? ' on lit' : ' on';
        const cls = `du-action${kind}${a.disabled ? ' disabled' : ''}${a.tone === 'command' ? ' command' : ''}`;
        return (
          <span key={i} className={cls}>
            {a.label}
          </span>
        );
      })}
    </div>
  );
}

function Half({ s, page }: { s: SimState; page: PageId }): JSX.Element {
  const def = PAGES[page];
  const actions = def.actions(s);
  const hasLeft = actions.some((a) => a.side === 'L');
  const hasRight = actions.some((a) => a.side === 'R');
  return (
    <div className={`du-half${hasLeft ? ' with-left' : ''}${hasRight ? ' with-right' : ''}`}>
      {hasLeft && <ActionLabels actions={actions} side="L" />}
      <div className="du-body">
        <def.Body s={s} />
      </div>
      {hasRight && <ActionLabels actions={actions} side="R" />}
    </div>
  );
}

/** Tabs of a menu row: ▲ (switches the group) and the pages of the group. */
const menuSlots = (group: PageGroup): (PageId | '▲' | null)[] =>
  Array.from({ length: TOP_KEYS }, (_, i) => (i === 0 ? '▲' : (MENUS[group][i - 1] ?? null)));

function Menu({ group, active, where }: { group: PageGroup; active: PageId; where: 'top' | 'bottom' }): JSX.Element {
  return (
    <div className={`du-menu ${where}`}>
      {menuSlots(group).map((id, i) => (
        <span key={i} className={id === null ? 'du-tab empty' : id === active ? 'du-tab on' : 'du-tab'}>
          {id === null ? '' : id === '▲' ? '▲' : PAGES[id].menu}
        </span>
      ))}
    </div>
  );
}

/**
 * Display Unit: screen with bezel and soft keys (reference: Orion's cockpit displays). The screen is
 * split into an upper and a lower half, each with one page. The top keys choose the upper page,
 * the bottom ones the lower page (the first of each row, ▲, switches between the Flt and Sys page
 * groups), and the side ones run the actions of each page. Brt and Dim set the screen brightness.
 * With `countdown`, the upper half shows Flt.Count while the rocket is on the pad and goes back to
 * its initial page at liftoff (if Flt.Count is still on screen).
 */
export function DisplayUnit({ s, initial, index, countdown = false }: { s: SimState; initial: [PageId, PageId]; index: number; countdown?: boolean }): JSX.Element {
  const t = useT();
  const ui = usePanelUi();
  const onPad = countdown && s.t < 0 && !s.outcome;
  const firstUpper: PageId = onPad ? 'COUNT' : initial[0];
  const [upper, setUpper] = useState<PageId>(firstUpper);
  const [lower, setLower] = useState<PageId>(initial[1]);
  const [upperGroup, setUpperGroup] = useState<PageGroup>(PAGES[firstUpper].group);
  const wasOnPad = useRef(onPad);
  useEffect(() => {
    if (wasOnPad.current === onPad) return;
    wasOnPad.current = onPad;
    if (onPad) {
      setUpper('COUNT');
      setUpperGroup(PAGES.COUNT.group);
    } else if (upper === 'COUNT') {
      setUpper(initial[0]);
      setUpperGroup(PAGES[initial[0]].group);
    }
  }, [onPad, upper, initial]);
  const [lowerGroup, setLowerGroup] = useState<PageGroup>(PAGES[initial[1]].group);
  const upperActions = PAGES[upper].actions(s);
  const lowerActions = PAGES[lower].actions(s);
  const brightness = ui.brightness[index] ?? 1;
  const unacked = s.alarms.filter((a) => !a.acked).length;

  // Keys the tutorial points at (`data-press`): the bottom Procs key, when Procs is not on screen,
  // and the top Count key, the half where Flt.Count goes during the terminal count.
  const tabPress = (id: PageId, bottom: boolean): string | undefined =>
    bottom && id === 'PROCS' ? 'tab-procs' : !bottom && id === 'COUNT' ? 'tab-count' : undefined;
  const pageKeys = (group: PageGroup, setGroup: (g: PageGroup) => void, setPage: (p: PageId) => void, bottom = false): JSX.Element[] =>
    menuSlots(group).map((id, i) => {
      if (id === null) return <Key key={i} />;
      if (id === '▲') return <Key key={i} action={() => setGroup(group === 'Flt' ? 'Sys' : 'Flt')} label={t('du.up')} />;
      return <Key key={i} action={() => setPage(id)} label={PAGES[id].title} press={tabPress(id, bottom)} />;
    });

  const setBrightness = (delta: number): void => {
    const all = [...getPanelUi().brightness];
    all[index] = Math.max(BRIGHTNESS_MIN, Math.min(1, (all[index] ?? 1) + delta));
    setPanelUi({ brightness: all });
  };

  return (
    <section className="du" data-tour="du">
      <button className="du-corner brt" onClick={() => setBrightness(BRIGHTNESS_STEP)} title={t('du.brt')}>
        Brt
      </button>
      <div className="du-keys top">{pageKeys(upperGroup, setUpperGroup, setUpper)}</div>
      <div className="du-keys left">
        <SideKeys actions={upperActions} side="L" />
        <SideKeys actions={lowerActions} side="L" />
      </div>
      <div className="du-screen" style={brightness < 1 ? { filter: `brightness(${brightness})` } : undefined}>
        <Menu group={upperGroup} active={upper} where="top" />
        <Half s={s} page={upper} />
        <div className="du-titlebar">
          <span className="t-pages">
            <span className="t-upper">{PAGES[upper].title}</span>
            <span className="t-lower">{PAGES[lower].title}</span>
          </span>
          <span className="t-clock">
            <i>M</i>
            {formatMet(s.t)}
          </span>
          <span className="t-phase">{displayPhaseLabel(s.t, s.phase)}</span>
          <span className={unacked > 0 ? 't-count on' : 't-count'} title={t('du.faults')}>
            {unacked}
          </span>
        </div>
        <Half s={s} page={lower} />
        <Menu group={lowerGroup} active={lower} where="bottom" />
      </div>
      <div className="du-keys right">
        <SideKeys actions={upperActions} side="R" />
        <SideKeys actions={lowerActions} side="R" />
      </div>
      <button className="du-corner dim" onClick={() => setBrightness(-BRIGHTNESS_STEP)} title={t('du.dim')}>
        Dim
      </button>
      <div className="du-keys bottom">{pageKeys(lowerGroup, setLowerGroup, setLower, true)}</div>
      {/* Tab knob: decorative (it moves the cursor on the real displays; there is no cursor here). */}
      <span className="du-knob" aria-hidden="true" />
    </section>
  );
}
