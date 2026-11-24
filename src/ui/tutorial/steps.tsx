import type { CameraMode } from '../../render/scene';
import { BURN_LEAD_TIME, E7_BURN_DURATION, FLAME_TRENCH, LIGHTNING_MAST_HEIGHT, MET_E6_PROX_OPS_START, ML1 } from '../../sim/constants';
import { formatSpan, formatTMinus } from '../../sim/format';
import { Locale } from '../../sim/i18n';
import { ASCENT_SEQUENCE } from '../../sim/mission/ascent';
import { COUNTDOWN, COUNT_START, MET_ACCESS_ARM_RETRACT, MET_ALS, MET_ROFI } from '../../sim/mission/countdown';
import { SimState } from '../../sim/state';
import { RS25_START_BEFORE_LIFTOFF } from '../../sim/vehicle';

/** What the tutorial sees of the interface besides the simulation. */
export interface TourView {
  /** 3D camera chosen in the toolbar (AUTO stays AUTO, whichever camera it is showing). */
  readonly camera3d: CameraMode;
}

export interface TourStep {
  /** `data-tour` value of the element to point at. Without it, the callout is centered. */
  readonly target?: string;
  readonly title: string;
  readonly body: JSX.Element;
  /** Action step: completes on its own when the simulation meets this condition. */
  readonly until?: (s: SimState) => boolean;
  /**
   * Button to press now (its `data-press`), or null if none is needed. The tutorial points at it
   * with an animated hand: in an action step while it is not completed, in an information step
   * whenever this returns a button.
   */
  readonly press?: (s: SimState, view: TourView) => string | null;
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
/** Meters, rounded, from a length in km. */
const meters = (km: number): number => Math.round(km * 1000);

/**
 * Guided tour, one list for both languages (so `?tour=n` opens the same step in each). First the
 * spacecraft, the mission and the panel; then the pad and the terminal count, and the first
 * mission steps done by hand. Times and sizes come from the model's constants.
 */
function steps(l: Locale): TourStep[] {
  const es = l === 'es';
  const T = (t: number): string => formatTMinus(t, l);
  const span = (t: number): string => formatSpan(t, l);
  const S = ASCENT_SEQUENCE;
  const parts: Parts = es
    ? [
        { name: 'Torre de escape (LAS).', text: `Arranca la cápsula del cohete si algo falla en el ascenso. Se eyecta a los ${span(S.lasJettison)}.` },
        { name: 'Módulo de tripulación (CM).', text: 'La cápsula donde viajan los cuatro astronautas. Es lo único que vuelve.' },
        { name: 'Módulo de servicio (SM).', text: 'Motor principal, propulsores, tanques y paneles solares de Orion. Se separa antes de la entrada.' },
        { name: 'Etapa superior (ICPS).', text: `Un motor RL10 que sube a Orion a la órbita alta. Se separa a las ${span(MET_E6_PROX_OPS_START)}.` },
        { name: 'Etapa central.', text: `Cuatro motores RS‑25 que queman durante ${span(S.meco)}. Se separa a los ${span(S.coreSeparation)}.` },
        { name: 'Boosters.', text: `Dos cohetes de combustible sólido que dan casi todo el empuje del despegue. Se separan a los ${span(S.srbSeparation)}.` },
      ]
    : [
        { name: 'Launch abort system (LAS).', text: `Pulls the capsule away from the rocket if something fails during ascent. Jettisoned at ${span(S.lasJettison)}.` },
        { name: 'Crew module (CM).', text: 'The capsule where the four astronauts travel. It is the only part that comes back.' },
        { name: 'Service module (SM).', text: "Orion's main engine, thrusters, tanks and solar arrays. Separated before entry." },
        { name: 'Upper stage (ICPS).', text: `One RL10 engine that lifts Orion to the high orbit. Separated at ${span(MET_E6_PROX_OPS_START)}.` },
        { name: 'Core stage.', text: `Four RS‑25 engines burning for ${span(S.meco)}. Separated at ${span(S.coreSeparation)}.` },
        { name: 'Boosters.', text: `Two solid rocket boosters giving most of the liftoff thrust. Separated at ${span(S.srbSeparation)}.` },
      ];
  const mission: Parts = es
    ? [
        { name: 'E1–E3 · Lanzamiento y ascenso.', text: `La cuenta final desde ${T(COUNT_START)} en la plataforma y ${span(S.coreSeparation)} hasta la órbita. Lo vuela el cohete solo.` },
        { name: 'E4–E5 · Órbita alta.', text: 'El ICPS enciende dos veces, también solo, y deja a Orion en una órbita alta y muy elíptica.' },
        { name: 'E6–E8 · Chequeo.', text: 'Orion se separa del ICPS y la tripulación hace sus primeros encendidos.' },
        { name: 'E9 · Inyección translunar.', text: 'El encendido que manda la nave hacia la Luna.' },
        { name: 'E10–E12 · Ida, sobrevuelo y regreso.', text: 'Casi cuatro días de ida, la vuelta por detrás de la Luna sin señal, y casi cuatro de regreso.' },
        { name: 'E13–E15 · Entrada.', text: 'La cápsula se separa del módulo de servicio y entra a la atmósfera.' },
      ]
    : [
        { name: 'E1–E3 · Launch and ascent.', text: `The terminal count from ${T(COUNT_START)} on the pad, and ${span(S.coreSeparation)} to orbit. The rocket flies it by itself.` },
        { name: 'E4–E5 · High orbit.', text: 'The ICPS fires twice, also on its own, and leaves Orion in a high, very elliptical orbit.' },
        { name: 'E6–E8 · Checkout.', text: 'Orion separates from the ICPS and the crew performs its first burns.' },
        { name: 'E9 · Translunar injection.', text: 'The burn that sends the spacecraft to the Moon.' },
        { name: 'E10–E12 · Outbound, flyby and return.', text: 'Almost four days out, the pass behind the Moon without signal, and almost four days back.' },
        { name: 'E13–E15 · Entry.', text: 'The capsule separates from the service module and enters the atmosphere.' },
      ];
  return [
    {
      title: es ? 'TUTORIAL GUIADO' : 'GUIDED TUTORIAL',
      body: es ? (
        <>
          <p>Primero un recorrido por la nave, el panel y la plataforma. Después vas a seguir la cuenta final hasta el despegue, separar la etapa superior y hacer tu primer encendido.</p>
          <p>Los pasos con una acción avanzan solos cuando la hacés. Podés salir cuando quieras.</p>
        </>
      ) : (
        <>
          <p>First a tour of the spacecraft, the panel and the launch pad. Then you will follow the terminal count to liftoff, separate the upper stage and perform your first burn.</p>
          <p>Steps with an action advance by themselves when you do it. You can exit at any time.</p>
        </>
      ),
    },
    { title: es ? 'EL COHETE Y LA NAVE' : 'THE ROCKET AND THE SPACECRAFT', body: <VehicleDiagram parts={parts} /> },
    { title: es ? 'LA MISIÓN' : 'THE MISSION', body: <MissionDiagram items={mission} /> },
    {
      target: 'status',
      title: es ? 'BARRA DE ESTADO' : 'STATUS BAR',
      body: es ? (
        <p>
          El tiempo de misión (MET) y el día de vuelo, la fase, la red de comunicaciones, la velocidad de simulación y la cuenta regresiva al próximo evento (durante la
          cuenta final, al próximo hito). Debajo, las alarmas activas: las que tienen procedimiento lo abren con un clic. Esta barra es del simulador, no de la cabina real.
        </p>
      ) : (
        <p>
          Mission elapsed time (MET) and flight day, the phase, the communications network, the simulation speed and the countdown to the next event (during the
          terminal count, to the next milestone). Below, the active alarms: the ones with a procedure open it with a click. This bar belongs to the simulator, not to the
          real cockpit.
        </p>
      ),
    },
    {
      target: 'du',
      title: es ? 'PANTALLA Y TECLAS' : 'DISPLAY AND KEYS',
      body: es ? (
        <>
          <p>Cada pantalla muestra dos páginas. Las teclas de <b>arriba</b> eligen la página superior y las de <b>abajo</b>, la inferior; la primera, <b>▲</b>, alterna entre las páginas de vuelo (Flt) y las de sistemas (Sys). Las teclas de los <b>costados</b> ejecutan las acciones de la página: las cajas grises son opciones y las verdes, opciones activas o acciones.</p>
          <p><b>PFD</b> actitud en tres ejes · <b>Traj</b> trayectoria · <b>Burn</b> próximo encendido · <b>Procs</b> procedimientos · <b>TL</b> línea de tiempo · <b>Count</b> cuenta final · <b>Sum</b> resumen · <b>Fault</b> alarmas · <b>Prop</b> propulsión · <b>Comm</b> comunicaciones.</p>
        </>
      ) : (
        <>
          <p>Each display shows two pages. The <b>top</b> keys choose the upper page and the <b>bottom</b> keys the lower one; the first key, <b>▲</b>, switches between the flight pages (Flt) and the system pages (Sys). The <b>side</b> keys run the actions of the page: gray boxes are options, green ones are active or actions.</p>
          <p><b>PFD</b> three-axis attitude · <b>Traj</b> trajectory · <b>Burn</b> next burn · <b>Procs</b> procedures · <b>TL</b> timeline · <b>Count</b> terminal count · <b>Sum</b> summary · <b>Fault</b> alarms · <b>Prop</b> propulsion · <b>Comm</b> communications.</p>
        </>
      ),
    },
    {
      target: 'switches',
      title: es ? 'INTERRUPTORES' : 'SWITCHES',
      body: es ? (
        <p>
          Los motores tienen una <b>guarda</b>: se levanta para armar y después se acciona la palanca. Bajar la guarda desarma, y si el motor está encendido lo corta.
          Las separaciones piden antes <b>PYRO ARM</b> arriba, el armado maestro de la pirotecnia.
        </p>
      ) : (
        <p>
          The engines have a <b>guard</b>: lift it to arm and then actuate the lever. Lowering the guard disarms, and if the engine is firing it cuts it off. The separations need <b>PYRO ARM</b> up first, the pyro master arm.
        </p>
      ),
    },
    {
      target: 'flight-controls',
      title: es ? 'CONTROL DE VUELO' : 'FLIGHT CONTROL',
      body: es ? (
        <>
          <p><b>DAP</b> es el piloto automático: en Auto orienta la nave solo, en LVLH mantiene la actitud respecto del horizonte local y en Intl la deja fija en el espacio. El <b>Master Alarm</b> se enciende con cada alarma y se apaga con un clic; <b>Lamp Test</b> enciende todas las luces mientras se mantiene.</p>
          <p>El <b>RHC</b> rota la nave en cabeceo, guiñada y alabeo (al moverlo el DAP pasa a Manual) y el <b>THC</b> la empuja hacia adelante o atrás con los propulsores chicos. Actúan mientras mantenés apretado.</p>
        </>
      ) : (
        <>
          <p><b>DAP</b> is the autopilot: Auto orients the spacecraft by itself, LVLH holds the attitude relative to the local horizon and Intl holds it fixed in space. The <b>Master Alarm</b> lights with every alarm and goes out with a click; <b>Lamp Test</b> lights every lamp while held.</p>
          <p>The <b>RHC</b> rotates the spacecraft in pitch, yaw and roll (moving it takes the DAP to Manual) and the <b>THC</b> pushes it forward or backwards with the small thrusters. They act while you hold them.</p>
        </>
      ),
    },
    {
      target: 'mcc',
      title: es ? 'CONTROL DE MISIÓN' : 'MISSION CONTROL',
      body: es ? (
        <p>Durante la cuenta final te habla por acá el control de lanzamiento de Kennedy, hasta que el cohete despeja la torre; desde ahí, Houston: los "go" de cada maniobra, los horarios de los encendidos y los avisos. Cuando la Luna tapa el enlace, la ventana queda muda hasta recuperar la señal.</p>
      ) : (
        <p>During the terminal count Kennedy's launch control talks to you here, until the rocket clears the tower; from then on, Houston: go/no-go calls, burn times and warnings. When the Moon blocks the link, the window goes quiet until signal is reacquired.</p>
      ),
    },
    {
      target: 'time',
      title: es ? 'TIEMPO' : 'TIME',
      body: es ? (
        <p>Play, pausa y velocidad de simulación. La misión dura más de ocho días: sin el warp no se termina nunca. La simulación se pausa sola antes de cada acción tuya.</p>
      ) : (
        <p>Play, pause and simulation speed. The mission lasts more than eight days: without the warp it never ends. The simulation pauses by itself before each of your actions.</p>
      ),
    },
    {
      target: 'view-2d',
      title: es ? 'MAPA 2D' : '2D MAP',
      body: es ? (
        <p>Un mapa del sistema Tierra‑Luna visto desde arriba (desde el norte), con la Tierra a la derecha y la Luna a la izquierda. En el marco rotante la Tierra y la Luna quedan quietas y la nave avanza sobre el plan nominal, dibujado tenue. Con la rueda se hace zoom, arrastrando se mueve y con doble clic se vuelve a ver toda la misión. Con <b>MARCO · INERCIAL</b> se ve desde un punto fijo del espacio: la Luna recorre su órbita y el contorno punteado marca dónde va a estar cuando llegue la nave.</p>
      ) : (
        <p>A map of the Earth‑Moon system seen from above (from the north), with the Earth on the right and the Moon on the left. In the rotating frame the Earth and the Moon stay still and the spacecraft moves along the faint nominal plan. Use the wheel to zoom, drag to pan and double‑click to see the whole mission again. With <b>FRAME · INERTIAL</b> you see it from a fixed point in space instead: the Moon travels along its orbit, and the dotted outline shows where it will be when the spacecraft arrives.</p>
      ),
    },
    {
      target: 'view-3d',
      title: es ? 'VISTA 3D' : '3D VIEW',
      body: es ? (
        <p>La nave de cerca y a escala real. Acá se ve cómo se desprenden los boosters, la torre de escape y cada etapa. Arrastrá para girar la cámara. La columna de la derecha muestra el entorno terrestre visto desde arriba; cuando la nave se acerca a la Luna pasa al entorno lunar.</p>
      ) : (
        <p>The spacecraft up close and at real scale. Here you can watch the boosters, the launch abort system and each stage come off. Drag to orbit the camera. The column on the right shows the Earth vicinity seen from above; when the spacecraft gets close to the Moon it switches to the lunar vicinity.</p>
      ),
    },
    {
      // The PAD camera ([ML1], [UMB], [39B] in constants.ts). Information step: the hand stays on the
      // PAD button until it is chosen; the BOOSTERS step brings the view back to AUTO.
      target: 'view-3d',
      title: es ? 'LA PLATAFORMA' : 'THE LAUNCH PAD',
      body: es ? (
        <>
          <p>El cohete está sobre el Mobile Launcher 1, en el complejo de lanzamiento 39B, en Florida. Apretá <b>PLATAFORMA</b> (tecla 6) para verlo desde el suelo; la rueda hace zoom, como un telescopio de seguimiento. AUTO usa esta cámara hasta poco después del despegue y después sigue a la nave.</p>
          <p>La <b>torre</b>, de {meters(ML1.towerHeight)} m sobre la cubierta, lleva los brazos que conectan el cohete con tierra hasta el último momento. El <b>brazo de acceso</b> de la tripulación, el puente hasta la escotilla de Orion, se retrae en {T(MET_ACCESS_ARM_RETRACT)}; los <b>umbilicales</b>, que dan propelente, energía y datos, se apartan al despegar. Debajo de la cubierta, el <b>foso de llamas</b>, de {meters(FLAME_TRENCH.length)} m de largo y {meters(FLAME_TRENCH.depth)} m de profundidad, manda el escape hacia el norte. Tres pararrayos de {meters(LIGHTNING_MAST_HEIGHT)} m rodean la plataforma.</p>
        </>
      ) : (
        <>
          <p>The rocket stands on Mobile Launcher 1, at Launch Complex 39B in Florida. Press <b>PAD</b> (key 6) to watch it from the ground; the wheel zooms like a tracking telescope. AUTO uses this camera until shortly after liftoff and then follows the spacecraft.</p>
          <p>The <b>tower</b>, {meters(ML1.towerHeight)} m tall above the deck, carries the arms that connect the rocket to the ground until the last moment. The crew <b>access arm</b>, the bridge to Orion's hatch, retracts at {T(MET_ACCESS_ARM_RETRACT)}; the <b>umbilicals</b>, which feed propellant, power and data, swing away at liftoff. Under the deck, the <b>flame trench</b>, {meters(FLAME_TRENCH.length)} m long and {meters(FLAME_TRENCH.depth)} m deep, sends the exhaust north. Three lightning masts of {meters(LIGHTNING_MAST_HEIGHT)} m surround the pad.</p>
        </>
      ),
      press: (_s, v) => (v.camera3d === 'pad' ? null : 'cam-pad'),
    },
    {
      // [CNT]: the published terminal count, on the Flt.Count page (top of the left display on the pad).
      target: 'du',
      title: es ? 'LA CUENTA FINAL' : 'THE TERMINAL COUNT',
      body: es ? (
        <>
          <p>La página <b>Count</b> sigue la cuenta final que publicó NASA para Artemis II: {COUNTDOWN.length} hitos desde {T(COUNT_START)} hasta el despegue. Arriba, el reloj T‑, quién corre la cuenta (el secuenciador de tierra, GLS, y desde {T(MET_ALS)} el secuenciador automático, ALS) y el tiempo al próximo hito. Debajo, los sistemas de tierra (brazo de acceso, venteos, umbilicales, sujeción, encendedores, agua y motores) y la lista: en verde lo hecho y en magenta lo próximo. La tecla <b>Scroll</b> la recorre.</p>
          <p>Mientras el cohete está en la plataforma, la pantalla izquierda la muestra arriba; en cualquier pantalla la abre la tecla <b>Count</b>. La tripulación no tiene nada que hacer en la cuenta: la corren los secuenciadores.</p>
        </>
      ) : (
        <>
          <p>The <b>Count</b> page follows the terminal count NASA published for Artemis II: {COUNTDOWN.length} milestones from {T(COUNT_START)} to liftoff. On top, the T‑ clock, who runs the count (the ground launch sequencer, GLS, and from {T(MET_ALS)} the automated launch sequencer, ALS) and the time to the next milestone. Below, the ground systems (access arm, vents, umbilicals, hold‑down, igniters, water and engines) and the list: done in green, next in magenta. The <b>Scroll</b> key pages through it.</p>
          <p>While the rocket is on the pad, the left display shows it on top; on any display, the <b>Count</b> key opens it. The crew has nothing to do during the count: the sequencers run it.</p>
        </>
      ),
      press: () => 'tab-count',
    },
    {
      target: 'time',
      title: es ? 'ACELERAR LA CUENTA' : 'SPEED UP THE COUNT',
      body: es ? (
        <p>Apretá <b>PLAY</b> y poné el warp en <b>×10</b>: los {span(-COUNT_START)} de la cuenta pasan en {span(-COUNT_START / 10)}. Mirá cómo se aparta el brazo de acceso en {T(MET_ACCESS_ARM_RETRACT)}. En {T(MET_ALS)} la cuenta pasa al ALS y el warp vuelve solo a ×1, para que no te pierdas el despegue.</p>
      ) : (
        <p>Press <b>PLAY</b> and set the warp to <b>×10</b>: the {span(-COUNT_START)} of the count go by in {span(-COUNT_START / 10)}. Watch the access arm swing away at {T(MET_ACCESS_ARM_RETRACT)}. At {T(MET_ALS)} the ALS takes over the count and the warp drops back to ×1 by itself, so you do not miss the liftoff.</p>
      ),
      until: (s) => s.t >= MET_ALS,
      press: countdownWarp,
    },
    {
      target: 'view-3d',
      title: es ? 'DESPEGUE' : 'LIFTOFF',
      body: es ? (
        <p>Los últimos {span(-MET_ALS)} corren a ×1. Mirá la vista 3D: el agua de supresión de sonido inunda la cubierta y el foso; en {T(MET_ROFI)} los encendedores <b>ROFI</b> tiran chispas bajo los motores para quemar el hidrógeno que se escapa; en {T(-RS25_START_BEFORE_LIFTOFF)} arrancan los cuatro <b>RS‑25</b>, con el cohete todavía sujeto; en <b>T‑0</b> encienden los boosters, se apartan los umbilicales y el cohete sale de la plataforma.</p>
      ) : (
        <p>The last {span(-MET_ALS)} run at ×1. Watch the 3D view: the sound suppression water floods the deck and the trench; at {T(MET_ROFI)} the <b>ROFI</b> igniters throw sparks under the engines to burn off the escaping hydrogen; at {T(-RS25_START_BEFORE_LIFTOFF)} the four <b>RS‑25</b> engines start, with the rocket still held down; at <b>T‑0</b> the boosters ignite, the umbilicals swing away and the rocket leaves the pad.</p>
      ),
      until: (s) => s.clock.running && s.t > 0,
      press: countdownWarp,
    },
    {
      target: 'view-3d',
      title: 'BOOSTERS',
      body: es ? (
        <p>El cohete sube vertical y, al despejar la torre, a los {span(S.pitchStart)} empieza a inclinarse. Si la vista 3D está en la cámara PLATAFORMA, apretá <b>AUTO</b> para seguirlo. Poné el warp en <b>×10</b> y mirá la separación de los boosters a los {span(S.srbSeparation)}.</p>
      ) : (
        <p>The rocket climbs vertically and, once it clears the tower, starts to tilt at {span(S.pitchStart)}. If the 3D view is on the PAD camera, press <b>AUTO</b> to follow it. Set the warp to <b>×10</b> and watch the booster separation at {span(S.srbSeparation)}.</p>
      ),
      until: (s) => s.vehicle.srbSeparated,
      press: (s, v) => (v.camera3d === 'pad' ? 'cam-auto' : s.clock.warp < 10 ? 'warp-10' : playIfPaused(s)),
    },
    {
      target: 'du',
      title: es ? 'HASTA LA ÓRBITA' : 'TO ORBIT',
      body: es ? (
        <p>Queda la etapa central. En la página <b>PFD</b> podés ver la aceleración: los motores bajan el empuje para no pasar el límite de g. A los {span(S.coreSeparation)} se separa y quedás en órbita.</p>
      ) : (
        <p>The core stage remains. On the <b>PFD</b> page you can see the acceleration: the engines throttle down to stay under the g limit. At {span(S.coreSeparation)} it separates and you are in orbit.</p>
      ),
      until: (s) => s.vehicle.coreSeparated,
    },
    {
      target: 'time',
      title: es ? 'ÓRBITA ALTA' : 'HIGH ORBIT',
      body: es ? (
        <p>Ahora el ICPS enciende dos veces por su cuenta. Subí el warp a <b>×100</b> o <b>×1000</b> y dejalo correr.</p>
      ) : (
        <p>Now the ICPS fires twice on its own. Raise the warp to <b>×100</b> or <b>×1000</b> and let it run.</p>
      ),
      until: (s) => s.phase === 'ORBITA_ALTA',
      press: highWarp,
    },
    {
      target: 'time',
      title: es ? 'ESPERAR LA SEPARACIÓN' : 'WAIT FOR THE SEPARATION',
      body: es ? (
        <p>A las {span(MET_E6_PROX_OPS_START)} se abre la ventana para separar Orion del ICPS. Seguí con warp alto: la simulación se pausa sola cuando llega.</p>
      ) : (
        <p>At {span(MET_E6_PROX_OPS_START)} the window opens to separate Orion from the ICPS. Keep a high warp: the simulation pauses by itself when it arrives.</p>
      ),
      until: (s) => s.t >= MET_E6_PROX_OPS_START || s.vehicle.icpsSeparated,
      press: highWarp,
    },
    {
      target: 'switches',
      title: es ? 'ARMAR LA SEPARACIÓN' : 'ARM THE SEPARATION',
      body: es ? <p>Tu primera acción. Subí <b>PYRO ARM</b>, el armado maestro de la pirotecnia.</p> : <p>Your first action. Raise <b>PYRO ARM</b>, the pyro master arm.</p>,
      until: (s) => s.switches.pyroArm || s.vehicle.icpsSeparated,
      press: () => 'pyro-arm',
    },
    {
      target: 'switches',
      title: es ? 'SEPARAR' : 'SEPARATE',
      body: es ? (
        <p>Ahora accioná la <b>palanca</b> de ICPS SEP. En la vista 3D vas a ver a Orion sola, con los paneles solares desplegados.</p>
      ) : (
        <p>Now actuate the ICPS SEP <b>lever</b>. In the 3D view you will see Orion alone, with its solar arrays deployed.</p>
      ),
      until: (s) => s.vehicle.icpsSeparated,
      press: (s) => (s.switches.pyroArm ? 'icps-lever' : 'pyro-arm'),
    },
    {
      target: 'time',
      title: es ? 'ESPERAR EL PRIMER ENCENDIDO' : 'WAIT FOR THE FIRST BURN',
      body: es ? (
        <p>Dale a <b>PLAY</b> con warp alto. {span(BURN_LEAD_TIME)} antes del encendido E7 la simulación se pausa y la nave se orienta sola.</p>
      ) : (
        <p>Press <b>PLAY</b> with a high warp. {span(BURN_LEAD_TIME)} before the E7 burn the simulation pauses and the spacecraft orients itself.</p>
      ),
      until: (s) => s.t >= (e7(s).tig ?? 0) - BURN_LEAD_TIME || fired(s),
      press: highWarp,
    },
    {
      target: 'du',
      title: es ? 'CONFIRMAR EL ΔV' : 'CONFIRM THE ΔV',
      body: es ? (
        <p>En la página <b>Procs</b> está el procedimiento E7 con el paso actual en magenta. Si no está a la vista, abrila con la tecla <b>Procs</b> debajo de una pantalla. Después apretá la tecla <b>Conf ΔV</b>, abajo a la derecha de esa página.</p>
      ) : (
        <p>The <b>Procs</b> page shows procedure E7 with the current step in magenta. If it is not on screen, open it with the <b>Procs</b> key under a display. Then press the <b>Conf ΔV</b> key, at the lower right of that page.</p>
      ),
      until: (s) => e7(s).confirmed || fired(s),
      press: confDv,
    },
    {
      target: 'switches',
      title: es ? 'ARMAR EL MOTOR' : 'ARM THE ENGINE',
      body: es ? <p>Levantá la <b>guarda</b> de <b>AUX THR</b>, los propulsores auxiliares.</p> : <p>Lift the <b>guard</b> of <b>AUX THR</b>, the auxiliary thrusters.</p>,
      until: (s) => s.switches.auxArm || fired(s),
      press: () => 'aux-guard',
    },
    {
      target: 'switches',
      title: es ? 'ENCENDER' : 'FIRE',
      body: es ? (
        <p>Accioná la <b>palanca</b> de AUX THR. El encendido queda comprometido: los propulsores van a encender solos en el instante planeado (TIG).</p>
      ) : (
        <p>Actuate the AUX THR <b>lever</b>. The burn is committed: the engines will fire by themselves at the planned time (TIG).</p>
      ),
      until: fired,
      press: (s) => (s.switches.auxArm ? 'aux-lever' : 'aux-guard'),
    },
    {
      target: 'time',
      title: es ? 'IGNICIÓN' : 'IGNITION',
      body: es ? (
        <p>Apretá <b>PLAY</b>. Cuando llegue el TIG los propulsores encienden durante {span(E7_BURN_DURATION)}, como en el vuelo real, y se apagan solos.</p>
      ) : (
        <p>Press <b>PLAY</b>. At TIG the thrusters fire for {span(E7_BURN_DURATION)}, as in the real flight, and shut down by themselves.</p>
      ),
      until: (s) => e7(s).status === 'done',
      press: playIfPaused,
    },
    {
      title: es ? 'A PARTIR DE ACÁ, SEGUÍS VOS' : 'FROM HERE ON, IT IS YOURS',
      body: es ? (
        <>
          <p>Todos los encendidos son iguales: esperar la ventana, confirmar el Δv, levantar la guarda y accionar la palanca (o apretar <b>Burn ATP</b> en la PFD). Quedan dos: <b>E8</b> y el <b>TLI</b>, que te manda a la Luna.</p>
          <p>En el camino, la tecla <b>Calc</b> de Procs calcula correcciones de trayectoria. Antes de la entrada hay que separar el módulo de servicio con <b>PYRO ARM</b> y <b>CM/SM SEP</b>.</p>
          <p>La página Procs siempre dice qué sigue.</p>
        </>
      ) : (
        <>
          <p>Every burn works the same way: wait for the window, confirm the Δv, lift the guard and actuate the lever (or press <b>Burn ATP</b> on the PFD). Two remain: <b>E8</b> and the <b>TLI</b>, which sends you to the Moon.</p>
          <p>Along the way, the <b>Calc</b> key in Procs computes trajectory corrections. Before entry you have to separate the service module with <b>PYRO ARM</b> and <b>CM/SM SEP</b>.</p>
          <p>The Procs page always tells you what comes next.</p>
        </>
      ),
    },
  ];
}

const cache: Partial<Record<Locale, readonly TourStep[]>> = {};

/** Guided tour in the requested language: first the spacecraft, the panel and the pad, then the first mission steps done by hand. */
export function tourSteps(locale: Locale): readonly TourStep[] {
  return (cache[locale] ??= steps(locale));
}
