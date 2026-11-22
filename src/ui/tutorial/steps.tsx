import { BURN_LEAD_TIME, MET_E6_PROX_OPS_START } from '../../sim/constants';
import { Locale } from '../../sim/i18n';
import { MET_ALS } from '../../sim/mission/countdown';
import { SimState } from '../../sim/state';

export interface TourStep {
  /** `data-tour` value of the element to point at. Without it, the callout is centered. */
  readonly target?: string;
  readonly title: string;
  readonly body: JSX.Element;
  /** Action step: completes on its own when the simulation meets this condition. */
  readonly until?: (s: SimState) => boolean;
  /**
   * Button to press now (its `data-press`), or null if none is needed.
   * The tutorial points at it with an animated hand while the step is not completed.
   */
  readonly press?: (s: SimState) => string | null;
}

type Parts = readonly { readonly name: string; readonly text: string }[];

/** Vehicle diagram with its numbered parts. */
function VehicleDiagram({ parts }: { parts: Parts }): JSX.Element {
  return (
    <div className="tour-diagram">
      <svg viewBox="0 0 120 190" className="tour-rocket">
        <path d="M 60 4 L 63 26 L 57 26 Z M 57 26 H 63 L 68 46 H 52 Z" className="part on" />
        <path d="M 52 46 H 68 L 70 58 H 50 Z" className="part on" />
        <rect x="50" y="58" width="20" height="14" className="part on" />
        <rect x="49" y="72" width="22" height="26" className="part on" />
        <path d="M 49 98 H 71 L 76 108 V 178 H 44 V 108 Z" className="part core" />
        <rect x="32" y="112" width="9" height="70" rx="3" className="part on" />
        <rect x="79" y="112" width="9" height="70" rx="3" className="part on" />
        {[
          [1, 68, 18],
          [2, 74, 52],
          [3, 76, 65],
          [4, 77, 85],
          [5, 82, 140],
          [6, 22, 146],
        ].map(([n, x, y]) => (
          <g key={n} transform={`translate(${x} ${y})`}>
            <circle r="6" className="tour-pin" />
            <text y="2.6" className="tour-pin-n">{n}</text>
          </g>
        ))}
      </svg>
      <ol className="tour-parts">
        {parts.map((p) => (
          <li key={p.name}>
            <b>{p.name}</b> {p.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

function MissionDiagram({ items }: { items: Parts }): JSX.Element {
  return (
    <ol className="tour-mission">
      {items.map((p) => (
        <li key={p.name}>
          <b>{p.name}</b> {p.text}
        </li>
      ))}
    </ol>
  );
}

const e7 = (s: SimState): SimState['maneuvers']['E7'] => s.maneuvers.E7;
const fired = (s: SimState): boolean => ['committed', 'burning', 'done'].includes(e7(s).status);
/** PLAY, if the simulation is paused. */
const playIfPaused = (s: SimState): string | null => (s.clock.running ? null : 'play');
/** During the terminal count: PLAY, then ×10 until the automated sequencer lowers it to ×1 at T‑33 s. */
const countdownWarp = (s: SimState): string | null => playIfPaused(s) ?? (s.t < MET_ALS && s.clock.warp < 10 ? 'warp-10' : null);
/** High warp: ×1000 if it is still low (unless the simulation lowered it on its own for a burn); then, PLAY. */
const highWarp = (s: SimState): string | null => (s.clock.warp < 100 && s.warpRestore === null ? 'warp-1000' : playIfPaused(s));
/** The Conf ΔV key if Procs is on screen; if not, the Procs key under a display to open it. */
const confDv = (): string =>
  typeof document !== 'undefined' && !document.querySelector('[data-press="conf-dv"]') ? 'tab-procs' : 'conf-dv';

const PARTS: Readonly<Record<Locale, Parts>> = {
  en: [
    { name: 'Launch abort system (LAS).', text: 'Pulls the capsule away from the rocket if something fails during ascent. Jettisoned at 3 min 28 s.' },
    { name: 'Crew module (CM).', text: 'The capsule where the four astronauts travel. It is the only part that comes back.' },
    { name: 'Service module (SM).', text: "Orion's main engine, thrusters, tanks and solar arrays. Separated before entry." },
    { name: 'Upper stage (ICPS).', text: 'One RL10 engine that lifts Orion to the high orbit. Separated at 3 h 23 min.' },
    { name: 'Core stage.', text: 'Four RS‑25 engines burning for eight minutes. Separated at 8 min 18 s.' },
    { name: 'Boosters.', text: 'Two solid rocket boosters giving most of the liftoff thrust. Separated at 2 min 8 s.' },
  ],
  es: [
    { name: 'Torre de escape (LAS).', text: 'Arranca la cápsula del cohete si algo falla en el ascenso. Se eyecta a los 3 min 28 s.' },
    { name: 'Módulo de tripulación (CM).', text: 'La cápsula donde viajan los cuatro astronautas. Es lo único que vuelve.' },
    { name: 'Módulo de servicio (SM).', text: 'Motor principal, propulsores, tanques y paneles solares de Orion. Se separa antes de la entrada.' },
    { name: 'Etapa superior (ICPS).', text: 'Un motor RL10 que sube a Orion a la órbita alta. Se separa a las 3 h 23 min.' },
    { name: 'Etapa central.', text: 'Cuatro motores RS‑25 que queman durante ocho minutos. Se separa a los 8 min 18 s.' },
    { name: 'Boosters.', text: 'Dos cohetes de combustible sólido que dan casi todo el empuje del despegue. Se separan a los 2 min 8 s.' },
  ],
};

const MISSION: Readonly<Record<Locale, Parts>> = {
  en: [
    { name: 'E1–E3 · Ascent.', text: 'Eight minutes to orbit, flown by the rocket itself.' },
    { name: 'E4–E5 · High orbit.', text: 'The ICPS fires twice, also on its own, and leaves Orion in a 25-hour orbit.' },
    { name: 'E6–E8 · Checkout.', text: 'Orion separates from the ICPS and the crew performs its first burns.' },
    { name: 'E9 · Translunar injection.', text: 'The burn that sends the spacecraft to the Moon.' },
    { name: 'E10–E12 · Outbound, flyby and return.', text: 'Almost four days out, the pass behind the Moon without signal, and almost four days back.' },
    { name: 'E13–E15 · Entry.', text: 'The capsule separates from the service module and enters the atmosphere.' },
  ],
  es: [
    { name: 'E1–E3 · Ascenso.', text: 'Ocho minutos hasta la órbita. Lo vuela el cohete solo.' },
    { name: 'E4–E5 · Órbita alta.', text: 'El ICPS enciende dos veces, también solo, y deja a Orion en una órbita de 25 horas.' },
    { name: 'E6–E8 · Chequeo.', text: 'Orion se separa del ICPS y la tripulación hace sus primeros encendidos.' },
    { name: 'E9 · Inyección translunar.', text: 'El encendido que manda la nave hacia la Luna.' },
    { name: 'E10–E12 · Ida, sobrevuelo y regreso.', text: 'Casi cuatro días de ida, la vuelta por detrás de la Luna sin señal, y casi cuatro de regreso.' },
    { name: 'E13–E15 · Entrada.', text: 'La cápsula se separa del módulo de servicio y entra a la atmósfera.' },
  ],
};

const STEPS_EN = (): TourStep[] => [
  {
    title: 'GUIDED TUTORIAL',
    body: (
      <>
        <p>First a tour of the spacecraft and the panel. Then you will lift off, separate the upper stage and perform your first burn.</p>
        <p>Steps with an action advance by themselves when you do it. You can exit at any time.</p>
      </>
    ),
  },
  { title: 'THE ROCKET AND THE SPACECRAFT', body: <VehicleDiagram parts={PARTS.en} /> },
  { title: 'THE MISSION', body: <MissionDiagram items={MISSION.en} /> },
  {
    target: 'status',
    title: 'STATUS BAR',
    body: (
      <p>
        Mission elapsed time (MET) and flight day, the phase, the communications network, the simulation speed and the countdown to the next event. Below, the active
        alarms: the ones with a procedure open it with a click. This bar belongs to the simulator, not to the real cockpit.
      </p>
    ),
  },
  {
    target: 'du',
    title: 'DISPLAY AND KEYS',
    body: (
      <>
        <p>Each display shows two pages. The <b>top</b> keys choose the upper page and the <b>bottom</b> keys the lower one; the first key, <b>▲</b>, switches between the flight pages (Flt) and the system pages (Sys). The <b>side</b> keys run the actions of the page: gray boxes are options, green ones are active or actions.</p>
        <p><b>PFD</b> three-axis attitude · <b>Traj</b> trajectory · <b>Burn</b> next burn · <b>Procs</b> procedures · <b>TL</b> timeline · <b>Sum</b> summary · <b>Fault</b> alarms · <b>Prop</b> propulsion · <b>Comm</b> communications.</p>
      </>
    ),
  },
  {
    target: 'switches',
    title: 'SWITCHES',
    body: (
      <p>
        The engines have a <b>guard</b>: lift it to arm and then actuate the lever. Lowering the guard disarms, and if the engine is firing it cuts it off. The separations need <b>PYRO ARM</b> up first, the pyro master arm.
      </p>
    ),
  },
  {
    target: 'flight-controls',
    title: 'FLIGHT CONTROL',
    body: (
      <>
        <p><b>DAP</b> is the autopilot: Auto orients the spacecraft by itself, LVLH holds the attitude relative to the local horizon and Intl holds it fixed in space. The <b>Master Alarm</b> lights with every alarm and goes out with a click; <b>Lamp Test</b> lights every lamp while held.</p>
        <p>The <b>RHC</b> rotates the spacecraft in pitch, yaw and roll (moving it takes the DAP to Manual) and the <b>THC</b> pushes it forward or backwards with the small thrusters. They act while you hold them.</p>
      </>
    ),
  },
  {
    target: 'mcc',
    title: 'MISSION CONTROL',
    body: <p>Houston talks to you here: go/no-go calls, burn times and warnings. When the Moon blocks the link, the window goes quiet until signal is reacquired.</p>,
  },
  {
    target: 'time',
    title: 'TIME',
    body: <p>Play, pause and simulation speed. The mission lasts more than eight days: without the warp it never ends. The simulation pauses by itself before each of your actions.</p>,
  },
  {
    target: 'view-2d',
    title: '2D MAP',
    body: <p>A map of the Earth‑Moon system seen from above (from the north), with the Earth on the right and the Moon on the left. In the rotating frame the Earth and the Moon stay still and the spacecraft moves along the faint nominal plan. Use the wheel to zoom, drag to pan and double‑click to see the whole mission again. With <b>FRAME · INERTIAL</b> you see it from a fixed point in space instead: the Moon travels along its orbit, and the dotted outline shows where it will be when the spacecraft arrives.</p>,
  },
  {
    target: 'view-3d',
    title: '3D VIEW',
    body: <p>The spacecraft up close and at real scale. Here you can watch the boosters, the launch abort system and each stage come off. Drag to orbit the camera. The column on the right shows the Earth vicinity seen from above; when the spacecraft gets close to the Moon it switches to the lunar vicinity.</p>,
  },
  {
    target: 'time',
    title: 'LIFTOFF',
    body: <p>Press <b>PLAY</b> and set the warp to <b>×10</b>: the terminal count starts at T‑10 min and runs by itself. At T‑33 s the warp drops back to ×1; the RS‑25 engines start at T‑6.36 s, and at T‑0 the boosters ignite and the rocket leaves the pad.</p>,
    until: (s) => s.clock.running && s.t > 0,
    press: countdownWarp,
  },
  {
    target: 'view-3d',
    title: 'BOOSTERS',
    body: <p>The rocket climbs vertically and starts to tilt at 7 seconds. Set the warp to <b>×10</b> and watch the booster separation at 2 min 8 s.</p>,
    until: (s) => s.vehicle.srbSeparated,
    press: (s) => (s.clock.warp < 10 ? 'warp-10' : playIfPaused(s)),
  },
  {
    target: 'du',
    title: 'TO ORBIT',
    body: <p>The core stage remains. On the <b>PFD</b> page you can see the acceleration: the engines throttle down to stay under the g limit. At 8 min 18 s it separates and you are in orbit.</p>,
    until: (s) => s.vehicle.coreSeparated,
  },
  {
    target: 'time',
    title: 'HIGH ORBIT',
    body: <p>Now the ICPS fires twice on its own. Raise the warp to <b>×100</b> or <b>×1000</b> and let it run.</p>,
    until: (s) => s.phase === 'ORBITA_ALTA',
    press: highWarp,
  },
  {
    target: 'time',
    title: 'WAIT FOR THE SEPARATION',
    body: <p>At 3 h 23 min the window opens to separate Orion from the ICPS. Keep a high warp: the simulation pauses by itself when it arrives.</p>,
    until: (s) => s.t >= MET_E6_PROX_OPS_START || s.vehicle.icpsSeparated,
    press: highWarp,
  },
  {
    target: 'switches',
    title: 'ARM THE SEPARATION',
    body: <p>Your first action. Raise <b>PYRO ARM</b>, the pyro master arm.</p>,
    until: (s) => s.switches.pyroArm || s.vehicle.icpsSeparated,
    press: () => 'pyro-arm',
  },
  {
    target: 'switches',
    title: 'SEPARATE',
    body: <p>Now actuate the ICPS SEP <b>lever</b>. In the 3D view you will see Orion alone, with its solar arrays deployed.</p>,
    until: (s) => s.vehicle.icpsSeparated,
    press: (s) => (s.switches.pyroArm ? 'icps-lever' : 'pyro-arm'),
  },
  {
    target: 'time',
    title: 'WAIT FOR THE FIRST BURN',
    body: <p>Press <b>PLAY</b> with a high warp. Two minutes before the E7 burn the simulation pauses and the spacecraft orients itself.</p>,
    until: (s) => s.t >= (e7(s).tig ?? 0) - BURN_LEAD_TIME || fired(s),
    press: highWarp,
  },
  {
    target: 'du',
    title: 'CONFIRM THE ΔV',
    body: <p>The <b>Procs</b> page shows procedure E7 with the current step in magenta. If it is not on screen, open it with the <b>Procs</b> key under a display. Then press the <b>Conf ΔV</b> key, at the lower right of that page.</p>,
    until: (s) => e7(s).confirmed || fired(s),
    press: confDv,
  },
  {
    target: 'switches',
    title: 'ARM THE ENGINE',
    body: <p>Lift the <b>guard</b> of <b>AUX THR</b>, the auxiliary thrusters.</p>,
    until: (s) => s.switches.auxArm || fired(s),
    press: () => 'aux-guard',
  },
  {
    target: 'switches',
    title: 'FIRE',
    body: <p>Actuate the AUX THR <b>lever</b>. The burn is committed: the engines will fire by themselves at the planned time (TIG).</p>,
    until: fired,
    press: (s) => (s.switches.auxArm ? 'aux-lever' : 'aux-guard'),
  },
  {
    target: 'time',
    title: 'IGNITION',
    body: <p>Press <b>PLAY</b>. At TIG the thrusters fire for two minutes, as in the real flight, and shut down by themselves.</p>,
    until: (s) => e7(s).status === 'done',
    press: playIfPaused,
  },
  {
    title: 'FROM HERE ON, IT IS YOURS',
    body: (
      <>
        <p>Every burn works the same way: wait for the window, confirm the Δv, lift the guard and actuate the lever (or press <b>Burn ATP</b> on the PFD). Two remain: <b>E8</b> and the <b>TLI</b>, which sends you to the Moon.</p>
        <p>Along the way, the <b>Calc</b> key in Procs computes trajectory corrections. Before entry you have to separate the service module with <b>PYRO ARM</b> and <b>CM/SM SEP</b>.</p>
        <p>The Procs page always tells you what comes next.</p>
      </>
    ),
  },
];

const STEPS_ES = (): TourStep[] => [
  {
    title: 'TUTORIAL GUIADO',
    body: (
      <>
        <p>Primero un recorrido por la nave y el panel. Después vas a despegar, separar la etapa superior y hacer tu primer encendido.</p>
        <p>Los pasos con una acción avanzan solos cuando la hacés. Podés salir cuando quieras.</p>
      </>
    ),
  },
  { title: 'EL COHETE Y LA NAVE', body: <VehicleDiagram parts={PARTS.es} /> },
  { title: 'LA MISIÓN', body: <MissionDiagram items={MISSION.es} /> },
  {
    target: 'status',
    title: 'BARRA DE ESTADO',
    body: (
      <p>
        El tiempo de misión (MET) y el día de vuelo, la fase, la red de comunicaciones, la velocidad de simulación y la cuenta regresiva al próximo evento. Debajo, las
        alarmas activas: las que tienen procedimiento lo abren con un clic. Esta barra es del simulador, no de la cabina real.
      </p>
    ),
  },
  {
    target: 'du',
    title: 'PANTALLA Y TECLAS',
    body: (
      <>
        <p>Cada pantalla muestra dos páginas. Las teclas de <b>arriba</b> eligen la página superior y las de <b>abajo</b>, la inferior; la primera, <b>▲</b>, alterna entre las páginas de vuelo (Flt) y las de sistemas (Sys). Las teclas de los <b>costados</b> ejecutan las acciones de la página: las cajas grises son opciones y las verdes, opciones activas o acciones.</p>
        <p><b>PFD</b> actitud en tres ejes · <b>Traj</b> trayectoria · <b>Burn</b> próximo encendido · <b>Procs</b> procedimientos · <b>TL</b> línea de tiempo · <b>Sum</b> resumen · <b>Fault</b> alarmas · <b>Prop</b> propulsión · <b>Comm</b> comunicaciones.</p>
      </>
    ),
  },
  {
    target: 'switches',
    title: 'INTERRUPTORES',
    body: (
      <p>
        Los motores tienen una <b>guarda</b>: se levanta para armar y después se acciona la palanca. Bajar la guarda desarma, y si el motor está encendido lo corta.
        Las separaciones piden antes <b>PYRO ARM</b> arriba, el armado maestro de la pirotecnia.
      </p>
    ),
  },
  {
    target: 'flight-controls',
    title: 'CONTROL DE VUELO',
    body: (
      <>
        <p><b>DAP</b> es el piloto automático: en Auto orienta la nave solo, en LVLH mantiene la actitud respecto del horizonte local y en Intl la deja fija en el espacio. El <b>Master Alarm</b> se enciende con cada alarma y se apaga con un clic; <b>Lamp Test</b> enciende todas las luces mientras se mantiene.</p>
        <p>El <b>RHC</b> rota la nave en cabeceo, guiñada y alabeo (al moverlo el DAP pasa a Manual) y el <b>THC</b> la empuja hacia adelante o atrás con los propulsores chicos. Actúan mientras mantenés apretado.</p>
      </>
    ),
  },
  {
    target: 'mcc',
    title: 'CONTROL DE MISIÓN',
    body: <p>Houston te habla por acá: los "go" de cada maniobra, los horarios de los encendidos y los avisos. Cuando la Luna tapa el enlace, la ventana queda muda hasta recuperar la señal.</p>,
  },
  {
    target: 'time',
    title: 'TIEMPO',
    body: <p>Play, pausa y velocidad de simulación. La misión dura más de ocho días: sin el warp no se termina nunca. La simulación se pausa sola antes de cada acción tuya.</p>,
  },
  {
    target: 'view-2d',
    title: 'MAPA 2D',
    body: <p>Un mapa del sistema Tierra‑Luna visto desde arriba (desde el norte), con la Tierra a la derecha y la Luna a la izquierda. En el marco rotante la Tierra y la Luna quedan quietas y la nave avanza sobre el plan nominal, dibujado tenue. Con la rueda se hace zoom, arrastrando se mueve y con doble clic se vuelve a ver toda la misión. Con <b>MARCO · INERCIAL</b> se ve desde un punto fijo del espacio: la Luna recorre su órbita y el contorno punteado marca dónde va a estar cuando llegue la nave.</p>,
  },
  {
    target: 'view-3d',
    title: 'VISTA 3D',
    body: <p>La nave de cerca y a escala real. Acá se ve cómo se desprenden los boosters, la torre de escape y cada etapa. Arrastrá para girar la cámara. La columna de la derecha muestra el entorno terrestre visto desde arriba; cuando la nave se acerca a la Luna pasa al entorno lunar.</p>,
  },
  {
    target: 'time',
    title: 'DESPEGUE',
    body: <p>Apretá <b>PLAY</b> y poné el warp en <b>×10</b>: la cuenta final empieza en T‑10 min y corre sola. En T‑33 s el warp vuelve a ×1; los RS‑25 arrancan en T‑6,36 s, y en T‑0 encienden los boosters y el cohete sale de la plataforma.</p>,
    until: (s) => s.clock.running && s.t > 0,
    press: countdownWarp,
  },
  {
    target: 'view-3d',
    title: 'BOOSTERS',
    body: <p>El cohete sube vertical y a los 7 segundos empieza a inclinarse. Poné el warp en <b>×10</b> y mirá la separación de los boosters a los 2 min 8 s.</p>,
    until: (s) => s.vehicle.srbSeparated,
    press: (s) => (s.clock.warp < 10 ? 'warp-10' : playIfPaused(s)),
  },
  {
    target: 'du',
    title: 'HASTA LA ÓRBITA',
    body: <p>Queda la etapa central. En la página <b>PFD</b> podés ver la aceleración: los motores bajan el empuje para no pasar el límite de g. A los 8 min 18 s se separa y quedás en órbita.</p>,
    until: (s) => s.vehicle.coreSeparated,
  },
  {
    target: 'time',
    title: 'ÓRBITA ALTA',
    body: <p>Ahora el ICPS enciende dos veces por su cuenta. Subí el warp a <b>×100</b> o <b>×1000</b> y dejalo correr.</p>,
    until: (s) => s.phase === 'ORBITA_ALTA',
    press: highWarp,
  },
  {
    target: 'time',
    title: 'ESPERAR LA SEPARACIÓN',
    body: <p>A las 3 h 23 min se abre la ventana para separar Orion del ICPS. Seguí con warp alto: la simulación se pausa sola cuando llega.</p>,
    until: (s) => s.t >= MET_E6_PROX_OPS_START || s.vehicle.icpsSeparated,
    press: highWarp,
  },
  {
    target: 'switches',
    title: 'ARMAR LA SEPARACIÓN',
    body: <p>Tu primera acción. Subí <b>PYRO ARM</b>, el armado maestro de la pirotecnia.</p>,
    until: (s) => s.switches.pyroArm || s.vehicle.icpsSeparated,
    press: () => 'pyro-arm',
  },
  {
    target: 'switches',
    title: 'SEPARAR',
    body: <p>Ahora accioná la <b>palanca</b> de ICPS SEP. En la vista 3D vas a ver a Orion sola, con los paneles solares desplegados.</p>,
    until: (s) => s.vehicle.icpsSeparated,
    press: (s) => (s.switches.pyroArm ? 'icps-lever' : 'pyro-arm'),
  },
  {
    target: 'time',
    title: 'ESPERAR EL PRIMER ENCENDIDO',
    body: <p>Dale a <b>PLAY</b> con warp alto. Dos minutos antes del encendido E7 la simulación se pausa y la nave se orienta sola.</p>,
    until: (s) => s.t >= (e7(s).tig ?? 0) - BURN_LEAD_TIME || fired(s),
    press: highWarp,
  },
  {
    target: 'du',
    title: 'CONFIRMAR EL ΔV',
    body: <p>En la página <b>Procs</b> está el procedimiento E7 con el paso actual en magenta. Si no está a la vista, abrila con la tecla <b>Procs</b> debajo de una pantalla. Después apretá la tecla <b>Conf ΔV</b>, abajo a la derecha de esa página.</p>,
    until: (s) => e7(s).confirmed || fired(s),
    press: confDv,
  },
  {
    target: 'switches',
    title: 'ARMAR EL MOTOR',
    body: <p>Levantá la <b>guarda</b> de <b>AUX THR</b>, los propulsores auxiliares.</p>,
    until: (s) => s.switches.auxArm || fired(s),
    press: () => 'aux-guard',
  },
  {
    target: 'switches',
    title: 'ENCENDER',
    body: <p>Accioná la <b>palanca</b> de AUX THR. El encendido queda comprometido: los propulsores van a encender solos en el instante planeado (TIG).</p>,
    until: fired,
    press: (s) => (s.switches.auxArm ? 'aux-lever' : 'aux-guard'),
  },
  {
    target: 'time',
    title: 'IGNICIÓN',
    body: <p>Apretá <b>PLAY</b>. Cuando llegue el TIG los propulsores encienden durante dos minutos, como en el vuelo real, y se apagan solos.</p>,
    until: (s) => e7(s).status === 'done',
    press: playIfPaused,
  },
  {
    title: 'A PARTIR DE ACÁ, SEGUÍS VOS',
    body: (
      <>
        <p>Todos los encendidos son iguales: esperar la ventana, confirmar el Δv, levantar la guarda y accionar la palanca (o apretar <b>Burn ATP</b> en la PFD). Quedan dos: <b>E8</b> y el <b>TLI</b>, que te manda a la Luna.</p>
        <p>En el camino, la tecla <b>Calc</b> de Procs calcula correcciones de trayectoria. Antes de la entrada hay que separar el módulo de servicio con <b>PYRO ARM</b> y <b>CM/SM SEP</b>.</p>
        <p>La página Procs siempre dice qué sigue.</p>
      </>
    ),
  },
];

const cache: Partial<Record<Locale, readonly TourStep[]>> = {};

/** Guided tour in the requested language: first the spacecraft and the panel, then the first mission steps done by hand. */
export function tourSteps(locale: Locale): readonly TourStep[] {
  return (cache[locale] ??= locale === 'es' ? STEPS_ES() : STEPS_EN());
}
