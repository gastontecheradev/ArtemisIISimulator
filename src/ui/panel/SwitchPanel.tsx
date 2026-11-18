import { ackAlarms, fireCmSeparation, fireEngine, fireIcpsSeparation, setDapMode, setRhc, setSwitch, setThc } from '../../sim/commands';
import { DapMode, RotAxis, SimState, SwitchName } from '../../sim/state';
import { T, useT } from '../i18n';
import { act, setPanelUi } from '../store';

type Led = 'off' | 'armed' | 'active' | 'done';

/**
 * Toggle switch seen from the front (round base, ring, stem and knob), the style the panel had
 * before session 30, which Gastón preferred to the bat handle.
 */
function Lever({ up }: { up: boolean }): JSX.Element {
  return (
    <svg className="lever" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="17" className="lever-base" />
      <circle cx="20" cy="20" r="11" className="lever-ring" />
      <path d={up ? 'M16 20 L17.5 7 H22.5 L24 20 Z' : 'M16 20 L17.5 33 H22.5 L24 20 Z'} className="lever-stem" />
      <circle cx="20" cy={up ? 8 : 32} r="5.5" className="lever-knob" />
    </svg>
  );
}

/** Switch with its name above, the position labels above and below, and a status LED. */
function Switch({
  name,
  upLabel,
  downLabel,
  up,
  led,
  state,
  hazard = false,
  children,
}: {
  name: string;
  upLabel: string;
  downLabel: string;
  up: boolean;
  led: Led;
  /** Status line under the switch, only where it says more than the position labels. */
  state?: string;
  hazard?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`sw${hazard ? ' hazard' : ''}`}>
      <span className="sw-label">
        {name}
        <i className={`led ${led}`} />
      </span>
      <span className={up ? 'sw-pos on' : 'sw-pos'}>{upLabel}</span>
      <div className="sw-body">{children}</div>
      <span className={up ? 'sw-pos' : 'sw-pos on'}>{downLabel}</span>
      {state && <span className="sw-state">{state}</span>}
    </div>
  );
}

interface EngineProps {
  t: T;
  name: string;
  /** `data-press` prefix of the guard and the lever (the tutorial points at them). */
  press: string;
  armed: boolean;
  led: Led;
  state: string;
  disabled: boolean;
  onArm: (armed: boolean) => void;
  onFire: () => void;
}

/**
 * Engine switch: critical, with the striped frame and a guard over the lever. Two steps:
 * lift the guard (arm) and actuate the lever. Lowering the guard disarms (and cuts a burn).
 */
function EngineSwitch({ t, name, press, armed, led, state, disabled, onArm, onFire }: EngineProps): JSX.Element {
  return (
    <Switch name={name} upLabel="Fire" downLabel="Safe" up={led === 'active'} led={led} state={state}>
      <div className={`guard-frame${armed ? ' armed' : ''}`}>
        <button className={`guard${armed ? ' up' : ''}`} data-press={`${press}-guard`} disabled={disabled} onClick={() => onArm(!armed)} title={armed ? t('sw.lower') : t('sw.lift')}>
          {armed ? t('sw.guardUp') : t('sw.guardDown')}
        </button>
        <button className="lever-btn fire" data-press={`${press}-lever`} disabled={disabled || !armed} onClick={onFire} title={t('sw.actuate')}>
          <Lever up={led === 'active'} />
        </button>
      </div>
    </Switch>
  );
}

function Plate({ id, title, children, wide = false }: { id: string; title: string; children: React.ReactNode; wide?: boolean }): JSX.Element {
  return (
    <div className={wide ? 'plate wide' : 'plate'}>
      <span className="plate-id">{id}</span>
      <span className="plate-title">{title}</span>
      <div className="plate-switches">{children}</div>
      <i className="screw tl" />
      <i className="screw tr" />
      <i className="screw bl" />
      <i className="screw br" />
    </div>
  );
}

/** Button that acts while held down: that is how the hand controllers work. */
function HoldButton({ label, title, disabled, onHold, press }: { label: string; title: string; disabled: boolean; onHold: (on: boolean) => void; press?: string }): JSX.Element {
  return (
    <button
      className="pb hold"
      title={title}
      disabled={disabled}
      data-press={press}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onLostPointerCapture={() => onHold(false)}
    >
      {label}
    </button>
  );
}

/** DAP pushbuttons, with the names of Orion's attitude modes. */
const DAP_BUTTONS: readonly { mode: DapMode; label: string }[] = [
  { mode: 'AUTO', label: 'Auto' },
  { mode: 'LVLH', label: 'LVLH' },
  { mode: 'INRTL', label: 'Intl' },
];

/** RHC rows: axis, labels of the negative and positive deflection. */
const RHC_AXES: readonly { axis: RotAxis; neg: string; pos: string }[] = [
  { axis: 'pitch', neg: '▼', pos: '▲' },
  { axis: 'yaw', neg: '◄', pos: '►' },
  { axis: 'roll', neg: '↺', pos: '↻' },
];

/** Switch and controller panel. All of them trigger real simulation commands. */
export function SwitchPanel({ s }: { s: SimState }): JSX.Element {
  const t = useT();
  const sw = s.switches;
  const set = (name: SwitchName) => (value: boolean) => act((x) => setSwitch(x, name, value));
  const over = !!s.outcome;
  const engine = (system: 'MAIN' | 'AUX'): { led: Led; state: string } => {
    const armed = system === 'MAIN' ? sw.mainArm : sw.auxArm;
    const committed = Object.values(s.maneuvers).some((m) => m.system === system && m.status === 'committed');
    if (s.vehicle.cmSeparated) return { led: 'off', state: t('sw.separated') };
    if (s.burn?.system === system) return { led: 'active', state: t('sw.firing') };
    if (committed) return { led: 'armed', state: t('sw.atTig') };
    return armed ? { led: 'armed', state: t('sw.armed') } : { led: 'off', state: t('sw.safe') };
  };
  const main = engine('MAIN');
  const aux = engine('AUX');
  const pending = s.alarms.filter((a) => !a.acked);
  const level = pending.some((a) => a.level === 'WARNING') ? 'warning' : pending.length > 0 ? 'caution' : 'off';
  const rhcLocked = over || s.phase === 'ASCENSO';
  const rhc = s.attitude.rhc;
  const sep = (done: boolean): { led: Led; state: string } =>
    done ? { led: 'done', state: t('sw.separated') } : { led: sw.pyroArm ? 'armed' : 'off', state: t('sw.attached') };
  const icps = sep(s.vehicle.icpsSeparated);
  const cm = sep(s.vehicle.cmSeparated);
  return (
    <section className="switch-panel" data-tour="switches">
      <Plate id="F1" title={t('sw.F1')}>
        <EngineSwitch t={t} name="Main Eng" press="main" armed={sw.mainArm} led={main.led} state={main.state} disabled={over || s.vehicle.cmSeparated} onArm={set('mainArm')} onFire={() => act((x) => fireEngine(x, 'MAIN'))} />
        <EngineSwitch t={t} name="Aux Thr" press="aux" armed={sw.auxArm} led={aux.led} state={aux.state} disabled={over || s.vehicle.cmSeparated} onArm={set('auxArm')} onFire={() => act((x) => fireEngine(x, 'AUX'))} />
      </Plate>
      <Plate id="F2" title={t('sw.F2')}>
        <Switch name="Pyro Arm" upLabel="Arm" downLabel="Safe" up={sw.pyroArm} led={sw.pyroArm ? 'armed' : 'off'}>
          <div className={`guard-frame${sw.pyroArm ? ' armed' : ''}`}>
            <button className="lever-btn fire" data-press="pyro-arm" disabled={over} onClick={() => set('pyroArm')(!sw.pyroArm)} title={t('sw.pyroArm')}>
              <Lever up={sw.pyroArm} />
            </button>
          </div>
        </Switch>
        <Switch name="ICPS Sep" upLabel="Sep" downLabel="—" up={s.vehicle.icpsSeparated} led={icps.led} state={icps.state}>
          <button className="lever-btn" data-press="icps-lever" disabled={over || s.vehicle.icpsSeparated} onClick={() => act(fireIcpsSeparation)} title={t('sw.actuate')}>
            <Lever up={s.vehicle.icpsSeparated} />
          </button>
        </Switch>
        <Switch name="CM/SM Sep" upLabel="Sep" downLabel="—" up={s.vehicle.cmSeparated} led={cm.led} state={cm.state}>
          <button className="lever-btn" data-press="cm-lever" disabled={over || s.vehicle.cmSeparated} onClick={() => act(fireCmSeparation)} title={t('sw.actuate')}>
            <Lever up={s.vehicle.cmSeparated} />
          </button>
        </Switch>
      </Plate>
      <Plate id="F3" title={t('sw.F3')}>
        <Switch name="Crew Auto" upLabel="Auto" downLabel="Man" up={sw.autoCrew} led={sw.autoCrew ? 'active' : 'off'}>
          <button className="lever-btn" onClick={() => set('autoCrew')(!sw.autoCrew)} title={t('sw.crewAutoTitle')}>
            <Lever up={sw.autoCrew} />
          </button>
        </Switch>
        <Switch name="Auto Pause" upLabel="On" downLabel="Off" up={sw.autoPause} led={sw.autoPause ? 'active' : 'off'}>
          <button className="lever-btn" onClick={() => set('autoPause')(!sw.autoPause)} title={t('sw.autoPauseTitle')}>
            <Lever up={sw.autoPause} />
          </button>
        </Switch>
      </Plate>
      {/* Flight control, as Orion's center panel: DAP and THC, RHC, Master Alarm and the lamp test. */}
      <Plate id="F4" title={t('sw.F4')} wide>
        <div className="fc" data-tour="flight-controls">
          <div className="fc-block">
            <span className="sw-label">DAP</span>
            <div className="fc-row">
              {DAP_BUTTONS.map(({ mode, label }) => (
                <button key={mode} className={s.attitude.mode === mode ? 'pb on' : 'pb'} disabled={over} onClick={() => act((x) => setDapMode(x, mode))} title={t(`sw.dap.${mode}`)}>
                  {label}
                </button>
              ))}
            </div>
            <span className={s.attitude.mode === 'MAN' ? 'fc-manual on' : 'fc-manual'}>Manual</span>
            <span className="sw-label">
              THC X
              <i className={`led ${s.thc !== 0 ? 'active' : 'off'}`} />
            </span>
            <div className="fc-row">
              <HoldButton label="−X" title={t('sw.thcBack')} disabled={over || !s.vehicle.icpsSeparated} onHold={(on) => act((x) => setThc(x, on ? -1 : 0))} />
              <HoldButton label="+X" title={t('sw.thcFwd')} disabled={over || !s.vehicle.icpsSeparated} onHold={(on) => act((x) => setThc(x, on ? 1 : 0))} />
            </div>
          </div>
          <div className="fc-block">
            <span className="sw-label">
              RHC
              <i className={`led ${rhc.pitch !== 0 || rhc.yaw !== 0 || rhc.roll !== 0 ? 'active' : 'off'}`} />
            </span>
            <div className="fc-rhc">
              {RHC_AXES.map(({ axis, neg, pos }) => (
                <div key={axis} className="fc-axis">
                  <span className="fc-axis-name">{t(`sw.axis.${axis}`)}</span>
                  <HoldButton label={neg} title={t(`sw.rhc.${axis}.neg`)} disabled={rhcLocked} onHold={(on) => act((x) => setRhc(x, axis, on ? -1 : 0))} />
                  <HoldButton label={pos} title={t(`sw.rhc.${axis}.pos`)} disabled={rhcLocked} onHold={(on) => act((x) => setRhc(x, axis, on ? 1 : 0))} />
                </div>
              ))}
            </div>
          </div>
          <div className="fc-block">
            <span className="sw-label">Master Alarm</span>
            <button className={`master-alarm ${level}`} onClick={() => act(ackAlarms)} title={t('st.masterAlarm')} aria-label="Master Alarm">
              <span className="ma-warning">WARNING</span>
              <span className="ma-caution">CAUTION</span>
            </button>
            <button
              className="pb lamp"
              title={t('sw.lampTest')}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setPanelUi({ lampTest: true });
              }}
              onPointerUp={() => setPanelUi({ lampTest: false })}
              onPointerCancel={() => setPanelUi({ lampTest: false })}
              onLostPointerCapture={() => setPanelUi({ lampTest: false })}
            >
              Lamp Test
            </button>
          </div>
        </div>
      </Plate>
    </section>
  );
}
