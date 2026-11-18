import { attitudeAxes, bodyRates, commandedAxes, lvlhOf, powerInputOf, runningEngines } from '../../../sim/advance';
import { airVelocity } from '../../../sim/atmosphere';
import { Axes, INERTIAL_REF, eulerOf } from '../../../sim/attitude';
import { referenceBody } from '../../../sim/burns';
import { burnAtp, setDapMode } from '../../../sim/commands';
import { ATTITUDE_TOLERANCE, R_EARTH } from '../../../sim/constants';
import { formatNumber } from '../../../sim/format';
import { Vec3, add, dot, length, normalize, scale, sub } from '../../../sim/math/vec3';
import { forces } from '../../../sim/power';
import { DapMode, SimState, ephemerisOf } from '../../../sim/state';
import { skinTemperature } from '../../../sim/thermal';
import { G0, totalMass } from '../../../sim/vehicle';
import { useT } from '../../i18n';
import { act, getPanelUi, setPanelUi, usePanelUi } from '../../store';
import { BurnBlock, atpReady, burnSummary } from './Burn';
import type { SoftAction } from './index';

const DEG = 180 / Math.PI;
/** Ball radius in drawing units. */
const R = 46;
/** Visible half-span of the yaw and pitch tapes (deg) and of the roll arc (deg). */
const TAPE_SPAN = 25;
const ARC_SPAN = 40;
/** Trend bars: where the attitude will be in this many seconds at the current rate (interpretation). */
const TREND_S = 5;

/** Mode names as Orion's PFD keys show them. */
const MODE_NAME: Readonly<Record<DapMode, string>> = { AUTO: 'Auto', LVLH: 'LVLH', INRTL: 'Intl', MAN: 'Manual' };

/** Signed difference a − b in degrees, wrapped to ±180. */
const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;
const label360 = (deg: number): string => String(Math.round(((deg % 360) + 360) % 360) % 360);

/** Direction on the reference sphere: azimuth α from X towards Y, elevation e towards −Z (up). */
function sphereDir(ref: Axes, azDeg: number, elDeg: number): Vec3 {
  const a = azDeg / DEG;
  const e = elDeg / DEG;
  return add(scale(add(scale(ref.x, Math.cos(a)), scale(ref.y, Math.sin(a))), Math.cos(e)), scale(ref.z, -Math.sin(e)));
}

/**
 * Path through sphere directions, seen from the spacecraft: orthographic projection on the
 * body Y (right) and Z (down) axes. Only the front hemisphere (along +X) is drawn.
 */
function spherePath(dirs: readonly Vec3[], body: Axes): string {
  let d = '';
  let pen = false;
  for (const v of dirs) {
    if (dot(v, body.x) <= 0) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${(R * dot(v, body.y)).toFixed(2)} ${(R * dot(v, body.z)).toFixed(2)}`;
    pen = true;
  }
  return d;
}

/**
 * Sky region of the ball: what lies above the reference horizon. The horizon (a great circle)
 * projects as an ellipse with semi-axes R and R·|n·X|, where n is the zenith (−Z of the reference).
 */
function skyPath(body: Axes, ref: Axes): string {
  const n = scale(ref.z, -1);
  const nx = dot(n, body.x);
  const w = { x: dot(n, body.y), y: dot(n, body.z) };
  const wl = Math.hypot(w.x, w.y);
  const circle = `M${R} 0A${R} ${R} 0 1 1 ${-R} 0A${R} ${R} 0 1 1 ${R} 0Z`;
  if (wl < 1e-6) return nx > 0 ? circle : '';
  const u = { x: w.x / wl, y: w.y / wl };
  const m = { x: -u.y, y: u.x };
  const pts: string[] = [];
  // Limb from +m through the zenith side to −m.
  for (let i = 0; i <= 36; i++) {
    const f = (Math.PI * i) / 36;
    pts.push(`${(R * (Math.cos(f) * m.x + Math.sin(f) * u.x)).toFixed(2)} ${(R * (Math.cos(f) * m.y + Math.sin(f) * u.y)).toFixed(2)}`);
  }
  // Visible half of the horizon, back from −m to +m: beyond the center if the zenith is in front.
  const side = nx > 0 ? -1 : 1;
  const k = R * Math.abs(nx) * side;
  for (let i = 36; i >= 0; i--) {
    const f = (Math.PI * i) / 36;
    pts.push(`${(R * Math.cos(f) * m.x + k * Math.sin(f) * u.x).toFixed(2)} ${(R * Math.cos(f) * m.y + k * Math.sin(f) * u.y).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** Ball grid: parallels every 30° of elevation and meridians every 30° of azimuth. */
function gridPaths(body: Axes, ref: Axes): { horizon: string; lines: string } {
  let lines = '';
  for (const el of [-60, -30, 30, 60]) {
    const dirs: Vec3[] = [];
    for (let a = 0; a <= 360; a += 4) dirs.push(sphereDir(ref, a, el));
    lines += spherePath(dirs, body);
  }
  for (let a = 0; a < 360; a += 30) {
    const dirs: Vec3[] = [];
    for (let el = -88; el <= 88; el += 4) dirs.push(sphereDir(ref, a, el));
    lines += spherePath(dirs, body);
  }
  const horizon: Vec3[] = [];
  for (let a = 0; a <= 360; a += 3) horizon.push(sphereDir(ref, a, 0));
  return { horizon: spherePath(horizon, body), lines };
}

/** Marker of a direction on the ball, if it is in the front hemisphere. */
function onBall(v: Vec3, body: Axes): { x: number; y: number } | null {
  return dot(v, body.x) > 0 ? { x: R * dot(v, body.y), y: R * dot(v, body.z) } : null;
}

interface AxisData {
  /** Current value (deg). */
  readonly now: number;
  /** Commanded value (deg). */
  readonly cmd: number;
  /** Rate (deg/s). */
  readonly rate: number;
}

/** Drawing degrees of the roll arc per degree of roll: spreads the labels so they do not overlap. */
const ARC_K = 1.5;

/** Roll arc above the ball: the scale turns, the box at the top shows the current value. */
function RollArc({ a }: { a: AxisData }): JSX.Element {
  const r = R + 8;
  const at = (deg: number, rr: number): string => {
    const q = deg / DEG;
    return `${(rr * Math.sin(q)).toFixed(2)} ${(-rr * Math.cos(q)).toFixed(2)}`;
  };
  const band = `M${at(-ARC_SPAN - 2, r - 1)}A${r - 1} ${r - 1} 0 0 1 ${at(ARC_SPAN + 2, r - 1)}L${at(ARC_SPAN + 2, r + 8)}A${r + 8} ${r + 8} 0 0 0 ${at(-ARC_SPAN - 2, r + 8)}Z`;
  const ticks: JSX.Element[] = [];
  const span = ARC_SPAN / ARC_K;
  const first = Math.ceil((a.now - span) / 5) * 5;
  for (let v = first; v <= a.now + span; v += 5) {
    const off = (v - a.now) * ARC_K;
    const major = v % 10 === 0;
    ticks.push(<path key={`t${v}`} d={`M${at(off, r - 1)}L${at(off, r + (major ? 3 : 1.8))}`} className="adi-tick" />);
    if (major && Math.abs(off) > 11) {
      const [x, y] = at(off, r + 6).split(' ').map(Number);
      ticks.push(
        <text key={`l${v}`} x={x} y={y + 2} className="adi-scale-num">
          {label360(v)}
        </text>,
      );
    }
  }
  const trend = Math.max(-ARC_SPAN, Math.min(ARC_SPAN, a.rate * TREND_S * ARC_K));
  const cmdOff = wrap180(a.cmd - a.now) * ARC_K;
  return (
    <g>
      <path d={band} className="adi-scale" />
      {ticks}
      {Math.abs(trend) > 0.2 && (
        <path d={`M${at(0, r + 4)}A${r + 4} ${r + 4} 0 0 ${trend > 0 ? 1 : 0} ${at(trend, r + 4)}`} className="adi-trend" />
      )}
      <rect x={-10} y={-r - 12} width={20} height={10} className="adi-box" />
      <text x={0} y={-r - 4.3} className="adi-box-num">
        {label360(a.now)}
      </text>
      {Math.abs(cmdOff) <= ARC_SPAN && <path d={`M${at(cmdOff, r + 12)}l-2.5 -3.5h5z`} className="adi-cmd" />}
    </g>
  );
}

/** Straight moving tape: yaw (horizontal, below) or pitch (vertical, right). */
function Tape({ a, vertical }: { a: AxisData; vertical: boolean }): JSX.Element {
  const k = R / TAPE_SPAN;
  // Tape body: along the axis from −R to R; across it from c0 to c0 + 11.
  const c0 = R + 6;
  const w = 11;
  const pos = (along: number, across: number): [number, number] => (vertical ? [c0 + across, -along] : [along, c0 + across]);
  const rect = (a0: number, a1: number, c1: number, c2: number): JSX.Element => {
    const [x0, y0] = pos(a0, c1);
    const [x1, y1] = pos(a1, c2);
    return <rect x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} className="adi-scale" />;
  };
  const items: JSX.Element[] = [rect(-R, R, 0, w)];
  const first = Math.ceil((a.now - TAPE_SPAN) / 5) * 5;
  for (let v = first; v <= a.now + TAPE_SPAN; v += 5) {
    const off = (v - a.now) * k;
    const major = v % 10 === 0;
    const [x0, y0] = pos(off, 0);
    const [x1, y1] = pos(off, major ? 2.4 : 1.4);
    items.push(<path key={`t${v}`} d={`M${x0} ${y0}L${x1} ${y1}`} className="adi-tick" />);
    if (major && Math.abs(off) > 10) {
      const [x, y] = pos(off, w / 2 + 1.5);
      items.push(
        <text key={`l${v}`} x={x} y={y + 2} className="adi-scale-num">
          {label360(v)}
        </text>,
      );
    }
  }
  const trend = Math.max(-R, Math.min(R, a.rate * TREND_S * k));
  if (Math.abs(trend) > 0.3) {
    const [x0, y0] = pos(0, -1.5);
    const [x1, y1] = pos(trend, -1.5);
    items.push(<path key="trend" d={`M${x0} ${y0}L${x1} ${y1}`} className="adi-trend" />);
  }
  const cmdOff = wrap180(a.cmd - a.now) * k;
  if (Math.abs(cmdOff) <= R) {
    const [x, y] = pos(cmdOff, -3);
    // Apex towards the tape.
    items.push(<path key="cmd" d={vertical ? `M${x} ${y}l-3 -2v4z` : `M${x} ${y}l-2 -3h4z`} className="adi-cmd" />);
  }
  const [bx, by] = pos(0, w / 2);
  items.push(<rect key="box" x={bx - 10} y={by - 5} width={20} height={10} className="adi-box" />);
  items.push(
    <text key="num" x={bx} y={by + 2.5} className="adi-box-num">
      {label360(a.now)}
    </text>,
  );
  return <g>{items}</g>;
}

/**
 * Attitude ball with the three axes (reference: the PFD of Orion's cockpit). The ball is the
 * reference sphere seen from the spacecraft: the center is where the nose points, up is the
 * spacecraft's top (−Z). Brown below the horizon, light blue above, with meridians and
 * parallels every 30°. Around it, moving tapes for roll (arc above), yaw (below) and pitch
 * (right), each with the commanded value (magenta) and a trend bar (green).
 */
function AttitudeBall({ body, frame: ref, cmd, prograde, roll, pitch, yaw }: {
  body: Axes;
  /** Reference frame of the ball (not `ref`: React reserves that prop name). */
  frame: Axes;
  cmd: Vec3;
  prograde: Vec3;
  roll: AxisData;
  pitch: AxisData;
  yaw: AxisData;
}): JSX.Element {
  const grid = gridPaths(body, ref);
  const c = onBall(cmd, body);
  const p = onBall(prograde, body);
  return (
    <svg className="adi" viewBox="-56 -80 132 150">
      <clipPath id="adi-clip">
        <circle r={R} />
      </clipPath>
      <g clipPath="url(#adi-clip)">
        <circle r={R} className="adi-ground" />
        <path d={skyPath(body, ref)} className="adi-sky" />
        <path d={grid.lines} className="adi-line" />
        <path d={grid.horizon} className="adi-horizon" />
        {p && <circle cx={p.x} cy={p.y} r={2.6} className="adi-prograde" />}
        {c && <path d={`M${c.x - 3.5} ${c.y}h7M${c.x} ${c.y - 3.5}v7`} className="adi-command" />}
      </g>
      <circle r={R} className="adi-rim" />
      {/* Fixed spacecraft symbol. */}
      <path d="M-15 0H-4L0 -4L4 0H15M0 -4V0" className="adi-ship" />
      <RollArc a={roll} />
      <Tape a={yaw} vertical={false} />
      <Tape a={pitch} vertical={true} />
    </svg>
  );
}

function Readout({ label, value, unit, cls = 'val' }: { label: string; value: string; unit?: string; cls?: string }): JSX.Element {
  return (
    <div className="row">
      <span className="lbl">{label}</span>
      <span className={cls}>{value}</span>
      <span className="unit">{unit ?? ''}</span>
    </div>
  );
}

/** Flt.PFD side keys: attitude modes on the left (as Orion's PFD: LVLH, Intl, Auto), Burn ATP and Att Ref on the right. */
export function pfdActions(s: SimState): SoftAction[] {
  const locked = s.phase === 'ASCENSO' || !!s.outcome;
  const ref = getPanelUi().attRef;
  const dap = (slot: number, mode: DapMode): SoftAction => ({
    side: 'L',
    slot,
    label: MODE_NAME[mode],
    option: true,
    lit: s.attitude.mode === mode,
    disabled: locked,
    run: () => act((x) => setDapMode(x, mode)),
  });
  return [
    dap(1, 'LVLH'),
    dap(2, 'INRTL'),
    dap(3, 'AUTO'),
    { side: 'R', slot: 2, label: 'Burn\nATP', press: 'burn-atp', disabled: !atpReady(s), run: () => act(burnAtp) },
    { side: 'R', slot: 3, label: `Att Ref\n${ref === 'LVLH' ? 'LVLH' : 'Intl'}`, run: () => setPanelUi({ attRef: ref === 'LVLH' ? 'INRTL' : 'LVLH' }) },
  ];
}

/**
 * Flt.PFD: three-axis attitude, autopilot mode, the next burn and the forces on the
 * spacecraft (inspired by the primary flight display of Orion's cockpit). Everything comes
 * from the simulated state.
 */
export function Pfd({ s }: { s: SimState }): JSX.Element {
  const t = useT();
  const ui = usePanelUi();
  const eph = ephemerisOf(s);
  const earth = eph.earth(s.t);
  const body = attitudeAxes(s);
  const ref = ui.attRef === 'LVLH' ? lvlhOf(s) : INERTIAL_REF;
  const cmdAxes = commandedAxes(s);
  const e = eulerOf(body, ref);
  const c = eulerOf(cmdAxes, ref);
  const rates = bodyRates(s);
  const vRel = sub(s.ship.v, referenceBody(s.ship, s.t, eph).v);
  const error = Math.acos(Math.max(-1, Math.min(1, dot(body.x, cmdAxes.x))));
  const input = powerInputOf(s);
  const f = input ? forces(input, s.t, s.ship.r, s.ship.v, s.propulsion.prop) : null;
  const engines = runningEngines(s);
  const vAir = length(sub(s.ship.v, airVelocity(s.ship.r, earth)));
  const altitude = length(sub(s.ship.r, earth.r)) - R_EARTH;
  const temp = skinTemperature(s);
  const burn = burnSummary(s);
  const rhc = s.attitude.rhc;
  const rhcOn = rhc.pitch !== 0 || rhc.yaw !== 0 || rhc.roll !== 0;
  const mode = s.attitude.mode;
  return (
    <div className="page pfd">
      <div className="pfd-adi">
        <div className="adi-head">
          <span className="hc">
            THC <i className={s.thc !== 0 ? 'hc-dot on' : 'hc-dot'} />
          </span>
          <span className="hc">
            RHC <i className={rhcOn ? 'hc-dot on' : 'hc-dot'} />
          </span>
          <span className={mode === 'MAN' ? 'adi-mode manual' : 'adi-mode'}>{MODE_NAME[mode]}</span>
          <span className="adi-ref">{ui.attRef === 'LVLH' ? 'LVLH' : 'INRTL'}</span>
        </div>
        <AttitudeBall
          body={body}
          frame={ref}
          cmd={cmdAxes.x}
          prograde={normalize(vRel)}
          roll={{ now: e.roll * DEG, cmd: c.roll * DEG, rate: rates.roll * DEG }}
          pitch={{ now: e.pitch * DEG, cmd: c.pitch * DEG, rate: rates.pitch * DEG }}
          yaw={{ now: e.yaw * DEG, cmd: c.yaw * DEG, rate: rates.yaw * DEG }}
        />
      </div>
      <div className="pfd-side">
        <BurnBlock s={s} burn={burn} compact />
        <div className="rows">
          <Readout label="In Att" value={error < ATTITUDE_TOLERANCE ? '✓' : '—'} cls={error < ATTITUDE_TOLERANCE ? 'on-green' : 'val dim'} />
          <Readout label={t('pg.attErr')} value={formatNumber(error * DEG, 1)} unit="°" cls={error < ATTITUDE_TOLERANCE ? 'val' : 'warn'} />
          <Readout label={t('pg.accel')} value={formatNumber(f ? f.thrustAccel / G0 : 0, 2)} unit="g" />
          <Readout label={t('pg.thrust')} value={formatNumber(f ? f.thrust / 1000 : 0, 0)} unit="kN" />
          <Readout label={t('pg.mass')} value={formatNumber(totalMass(s.vehicle, s.propulsion.prop) / 1000, 1)} unit="t" />
          {altitude < 200 && <Readout label={t('pg.dynQ')} value={formatNumber(f ? f.q / 1000 : 0, 1)} unit="kPa" />}
          {altitude < 200 && <Readout label={t('pg.vRel')} value={formatNumber(vAir, 3)} unit="km/s" />}
          <Readout label={t('pg.temp')} value={formatNumber(temp.kelvin - 273.15, 0)} unit="°C" cls={temp.aerodynamic ? 'warn' : 'val'} />
          <Readout label={t('pg.engines')} value={engines.length > 0 ? engines.join(' ') : t('pg.enginesOff')} cls={engines.length > 0 ? 'on-green' : 'val dim'} />
        </div>
      </div>
    </div>
  );
}
