import { useEffect, useRef, useState } from 'react';
import { ackAlarms, setRhc, setThc, setWarp, togglePlay } from '../sim/commands';
import { WARP_LEVELS } from '../sim/constants';
import { Credits } from './Credits';
import { EndScreen } from './EndScreen';
import { LanguageScreen } from './LanguageScreen';
import { StartScreen } from './StartScreen';
import { CAMERA_MODES, TrajectoryView } from './TrajectoryView';
import { GuideViewer, GuidesMenu } from './guides/Guides';
import { Capcom } from './panel/Capcom';
import { DisplayUnit } from './panel/DisplayUnit';
import { EventLog } from './panel/EventLog';
import { StatusBar } from './panel/StatusBar';
import { SwitchPanel } from './panel/SwitchPanel';
import { TimeControls } from './panel/TimeControls';
import { RotAxis } from '../sim/state';
import { useT } from './i18n';
import { act, setCamera, setGuide, setTour, useGuide, useIntro, usePanelUi, useSim, useTour } from './store';
import { Tour } from './tutorial/Tour';

/** Minimum panel width to show a third Display Unit (the real cockpit has three). */
const THREE_DU_MIN_WIDTH = 1280;

/** Keyboard shortcuts. All of them go through the same commands as the panel controls. */
function useKeyboard(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const typing = (e: KeyboardEvent): boolean => {
      const target = e.target as HTMLElement | null;
      return e.ctrlKey || e.metaKey || e.altKey || !!(target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    };
    // Hand controllers, active while the key is held down. ← → pitch (on the map, ← turns the
    // spacecraft counterclockwise, as before the three-axis attitude), Z X yaw, Q E roll; ↑ ↓ THC.
    const RHC_KEYS: Readonly<Record<string, [RotAxis, number]>> = {
      ArrowLeft: ['pitch', -1],
      ArrowRight: ['pitch', 1],
      z: ['yaw', -1],
      x: ['yaw', 1],
      q: ['roll', -1],
      e: ['roll', 1],
    };
    const hold = (e: KeyboardEvent, on: boolean): boolean => {
      const rhc = RHC_KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (rhc) act((s) => setRhc(s, rhc[0], on ? rhc[1] : 0));
      else if (e.key === 'ArrowUp') act((s) => setThc(s, on ? 1 : 0));
      else if (e.key === 'ArrowDown') act((s) => setThc(s, on ? -1 : 0));
      else return false;
      e.preventDefault();
      return true;
    };
    const onDown = (e: KeyboardEvent): void => {
      if (typing(e)) return;
      if (hold(e, true) || e.repeat) return;
      const step = (dir: 1 | -1): void =>
        act((s) => {
          const i = WARP_LEVELS.indexOf(s.clock.warp as (typeof WARP_LEVELS)[number]);
          return setWarp(s, WARP_LEVELS[Math.max(0, Math.min(WARP_LEVELS.length - 1, i + dir))]);
        });
      if (e.code === 'Space') {
        // Prevents the space bar from re-triggering the last focused button.
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        act(togglePlay);
      } else if (e.key === '+' || e.key === '=' || e.key === '.') step(1);
      else if (e.key === '-' || e.key === ',') step(-1);
      else if (e.key === 'a' || e.key === 'A') act(ackAlarms);
      else if (/^[1-5]$/.test(e.key)) setCamera('3d', CAMERA_MODES[Number(e.key) - 1]);
    };
    const onUp = (e: KeyboardEvent): void => {
      if (!typing(e)) hold(e, false);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [enabled]);
}

export function App(): JSX.Element {
  const t = useT();
  const s = useSim();
  const intro = useIntro();
  const tour = useTour();
  const guide = useGuide();
  const lampTest = usePanelUi().lampTest;
  const columnRef = useRef<HTMLElement>(null);
  const [units, setUnits] = useState<2 | 3>(2);
  const [credits, setCredits] = useState(false);
  useKeyboard(intro === null && !credits && !guide);

  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setUnits(el.clientWidth >= THREE_DU_MIN_WIDTH ? 3 : 2));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="app">
      <aside className="panel-col" ref={columnRef}>
        <div className={lampTest ? 'panel lamp-test' : 'panel'}>
          <StatusBar s={s} />
          <div className="du-row">
            {/* Gastón's layout: Traj/TL on the left and PFD/Prop on the right; Sum/Fault on the third. */}
            <DisplayUnit s={s} index={0} initial={['TRAJ', 'TL']} />
            <DisplayUnit s={s} index={1} initial={['PFD', 'PROP']} />
            {units >= 3 && <DisplayUnit s={s} index={2} initial={['SUM', 'FAULT']} />}
          </div>
          <SwitchPanel s={s} />
          <div className="bottom-row">
            <TimeControls s={s} />
            <Capcom s={s} />
            <EventLog s={s} />
          </div>
          <p className="panel-note">{t('panel.conceptual')}</p>
        </div>
      </aside>
      <main className="view">
        <TrajectoryView onCredits={() => setCredits(true)} onTutorial={() => setTour(0)} onGuides={() => setGuide('objective')} />
        {s.outcome && intro === null && <EndScreen s={s} onCredits={() => setCredits(true)} />}
      </main>
      {intro === 'lang' && <LanguageScreen />}
      {intro === 'guides' && <GuidesMenu />}
      {intro === 'start' && <StartScreen onCredits={() => setCredits(true)} />}
      {tour !== null && intro === null && <Tour s={s} index={tour} />}
      <GuideViewer />
      {credits && <Credits onClose={() => setCredits(false)} />}
    </div>
  );
}
