import {
  APOLLO_13_RECORD_DISTANCE,
  CRAWLERWAY,
  CUBESAT_DEPLOYMENTS,
  E7_BURN_DURATION,
  EARTH_MOON_DISTANCE,
  FLAME_TRENCH,
  FLYBY_ALTITUDE_TARGET,
  HEO_ORBIT,
  INSERTION_ORBIT,
  LAUNCH_DECK_HEIGHT,
  LIFTOFF_AFTER_WINDOW_OPEN,
  LIGHTNING_MAST_HEIGHT,
  MET_E4_PERIGEE_RAISE,
  MET_E5_APOGEE_RAISE,
  MET_E6_PROX_OPS_START,
  MET_E7_DEPARTURE,
  MET_ICPS_DISPOSAL,
  MET_ICPS_SPLASHDOWN,
  ML1,
  MOON_ORBIT,
  PAD_ELEVATION,
  POST_ARB_ORBIT,
  POST_PRM_ORBIT,
  PUBLISHED_MET,
  SUPPORT_POST_HEIGHT,
  TSMU_HEIGHT,
} from '../../sim/constants';
import { dvMagnitude } from '../../sim/burns';
import { formatDuration, formatMet, formatNumber, formatSpan, formatTMinus } from '../../sim/format';
import { Locale } from '../../sim/i18n';
import { COUNTDOWN, COUNT_START, CountdownId, MET_ALS } from '../../sim/mission/countdown';
import { MISSION_PARAMS } from '../../sim/mission/params';
import { CONFIG_AT_LIFTOFF, CUBESAT_COUNT, ENGINES, MASS, RS25_START_BEFORE_LIFTOFF, SRB_ISP, SRB_THRUST_PROFILE, dryMass, idealDv } from '../../sim/vehicle';
import { GuideId } from '../store';

/** Text by language. */
const L = (locale: Locale, en: string, es: string): string => (locale === 'es' ? es : en);

export interface GuideSection {
  readonly title: string;
  readonly paragraphs?: readonly string[];
  readonly bullets?: readonly string[];
  readonly table?: { readonly head: readonly string[]; readonly rows: readonly (readonly string[])[] };
  /** External links (open in another tab). */
  readonly links?: readonly GuideLink[];
  /** Footnote: sources or clarifications. */
  readonly note?: string;
}

export interface GuideLink {
  readonly label: string;
  readonly url: string;
  /** What it covers, in one line. */
  readonly desc: string;
}

export interface GuideContent {
  readonly title: string;
  readonly sections: readonly GuideSection[];
}

const t = (kg: number): string => formatNumber(kg / 1000, 1);
const kn = (n: number): string => formatNumber(n / 1000, 0);
const ms = (kms: number): string => formatNumber(kms * 1000, 0);
const P = MISSION_PARAMS;

const SRC_SLS = 'NASA, "Space Launch System Reference Guide for Artemis II" (SLS‑5558, 2025)';
const SRC_A2 = 'NASA, "Artemis II Reference Guide" (2026)';
const SRC_TL = 'NASA, "Artemis II Overview Timeline" (18/03/2026)';
const SRC_OBJ = 'NASA, "Artemis II Priorities and Objectives" (2026)';
const SRC_JPL = 'NASA/JPL, Horizons ephemeris system';
// The launch pad and the terminal count ([CNT], [ML1], [UMB], [39B], [LC50] and [CRW] in constants.ts).
const SRC_CNT = 'NASA, "NASA Releases Artemis II Moon Mission Launch Countdown" (2026‑03‑26)';
const SRC_ML1 = 'NASA, "Mobile Launcher 1" fact sheet (FS‑2024‑11‑997‑KSC)';
const SRC_UMB = 'NASA, "Mobile Launcher Tower Umbilicals and Accessories" fact sheet (FS‑2021‑08‑727‑KSC)';
const SRC_39B = 'NASA, "Launch Complex 39B" fact sheet (FS‑2021‑08‑726‑KSC)';
const SRC_LC50 = 'NASA, "NASA Celebrates 50th Anniversary of Launch Complex 39B" (2017)';
const SRC_CRW = 'NASA, "Countdown! NASA Launch Vehicles and Facilities" (IS‑2003‑09‑006‑KSC)';
const SRC_LDAY = 'NASA, "Live Artemis II Launch Day Updates" (2026‑04‑01)';

/** Meters from km, with `d` decimals. */
const m = (km: number, d = 0): string => formatNumber(km * 1000, d);

// ---------- Objective ----------

function objective(l: Locale): GuideContent {
  return {
    title: L(l, 'MISSION OBJECTIVE', 'OBJETIVO DE LA MISIÓN'),
    sections: [
      {
        title: L(l, 'Primary goal', 'Meta principal'),
        paragraphs: [
          L(
            l,
            'Artemis II is a crewed test flight in lunar space: four astronauts fly around the Moon on a free-return trajectory and come back. It is the first crewed flight of the SLS rocket and the Orion spacecraft, and the first human flight beyond low Earth orbit since Apollo 17 in 1972.',
            'Artemis II es un vuelo de prueba tripulado en el espacio lunar: cuatro astronautas rodean la Luna en una trayectoria de retorno libre y vuelven. Es el primer vuelo tripulado del cohete SLS y de la nave Orion, y el primer vuelo humano más allá de la órbita baja desde el Apollo 17, en 1972.',
          ),
          L(
            l,
            'The mission does not land on the Moon. Its job is to prove that the spacecraft keeps a crew alive and in control in deep space, so that the following missions can land.',
            'La misión no aluniza. Su trabajo es demostrar que la nave mantiene a una tripulación viva y con control en el espacio profundo, para que las misiones siguientes puedan aterrizar.',
          ),
        ],
      },
      {
        title: L(l, 'Mission priorities (in order)', 'Prioridades de la misión (en orden)'),
        bullets: [
          L(l, 'Crew: sustain the flight crew in the flight environment and through their return to Earth.', 'Tripulación: sostener a la tripulación en el entorno de vuelo y hasta su regreso a la Tierra.'),
          L(l, 'Systems: demonstrate the systems and operations essential to a crewed lunar campaign.', 'Sistemas: demostrar los sistemas y operaciones esenciales para una campaña lunar tripulada.'),
          L(l, 'Hardware and data: retrieve the flight hardware and the data to assess performance.', 'Hardware y datos: recuperar el hardware de vuelo y los datos para evaluar el desempeño.'),
          L(l, 'Emergency operations: demonstrate the emergency capabilities, such as abort and rescue, as far as practical.', 'Operaciones de emergencia: demostrar las capacidades de emergencia, como abortos y rescate, en lo que sea practicable.'),
          L(l, 'Data and subsystems: complete additional objectives to verify subsystems and validate data.', 'Datos y subsistemas: completar objetivos adicionales para verificar subsistemas y validar datos.'),
        ],
      },
      {
        title: L(l, 'What the crew tests', 'Qué prueba la tripulación'),
        bullets: [
          L(l, 'Manual proximity operations with the spent upper stage (ICPS) as a docking target: handling qualities, thruster plume effects and bearing measurements with the docking camera.', 'Operaciones de proximidad manuales con la etapa superior gastada (ICPS) como blanco de acoplamiento: manejo, efecto de los propulsores y medición de dirección con la cámara de acoplamiento.'),
          L(l, "The service module propulsion upgrades, the life support system (including a metabolic stress test), the suits, the exercise equipment and the radiation shelter.", 'Las mejoras de propulsión del módulo de servicio, el sistema de soporte vital (con una prueba de carga metabólica), los trajes, el equipo de ejercicio y el refugio contra radiación.'),
          L(l, 'Communications and navigation: the Near Space and Deep Space Networks, an optical communications demonstration, GPS, star trackers and optical navigation.', 'Comunicaciones y navegación: las redes Near Space y Deep Space, una demostración de comunicaciones ópticas, GPS, rastreadores de estrellas y navegación óptica.'),
          L(l, 'The heat shield during re-entry from cislunar velocity, the parachutes, the uprighting system and the crew recovery.', 'El escudo térmico en la reentrada a velocidad cislunar, los paracaídas, el sistema de enderezado y la recuperación de la tripulación.'),
          L(l, `Four CubeSats ride in the stage adapter: ${CUBESAT_DEPLOYMENTS.map((c) => c.name).join(', ')}.`, `Cuatro CubeSats viajan en el adaptador de la etapa: ${CUBESAT_DEPLOYMENTS.map((c) => c.name).join(', ')}.`),
        ],
      },
      {
        title: L(l, 'In the simulator', 'En el simulador'),
        paragraphs: [
          L(
            l,
            `Your objective is the same flight: reach the high orbit, fly around the Moon at ${formatNumber(FLYBY_ALTITUDE_TARGET)} km above the far side and come back into the entry corridor. Every burn is yours to confirm, arm and fire; physics decides the rest.`,
            `Tu objetivo es el mismo vuelo: llegar a la órbita alta, rodear la Luna a ${formatNumber(FLYBY_ALTITUDE_TARGET)} km sobre la cara oculta y volver dentro del corredor de entrada. Cada encendido lo confirmás, armás y accionás vos; el resto lo decide la física.`,
          ),
        ],
        note: SRC_OBJ,
      },
    ],
  };
}

// ---------- Stages ----------

/**
 * Main milestones of the terminal count ([CNT]): what NASA's count says and what the simulator does
 * at each one. The rest are on the Flt.Count page.
 */
const COUNT_ROWS: Partial<Record<CountdownId, readonly [en: string, es: string, simEn: string, simEs: string]>> = {
  GLS: [
    'The ground launch sequencer (GLS) starts the terminal count.',
    'El secuenciador de tierra (GLS) inicia la cuenta final.',
    'The mission starts here, with the rocket on the Mobile Launcher’s support posts.',
    'La misión empieza acá, con el cohete sobre los postes del Mobile Launcher.',
  ],
  CAA: ['The crew access arm retracts.', 'Se retrae el brazo de acceso de la tripulación.', 'The arm swings away from the hatch (3D view).', 'El brazo se aparta de la escotilla (vista 3D).'],
  PRESS: [
    'Core stage tanks pressurized; Orion on internal power, ascent pyros armed.',
    'Presurización de los tanques de la etapa central; Orion a energía interna, pirotecnia de ascenso armada.',
    'The boil-off vapor at the umbilicals stops (3D view).',
    'Se corta el vapor de los venteos en los umbilicales (vista 3D).',
  ],
  ALS: [
    'The GLS gives the go to the automated launch sequencer (ALS).',
    'El GLS da el “go” al secuenciador automático (ALS).',
    'The warp drops to ×1 (except with the automatic crew).',
    'El warp baja a ×1 (salvo con la tripulación automática).',
  ],
  ROFI: [
    'The hydrogen burn-off igniters (ROFI) light under the engines.',
    'Se encienden los encendedores de quemado de hidrógeno (ROFI) bajo los motores.',
    'Sparks fall under the engines (3D view).',
    'Caen chispas bajo los motores (vista 3D).',
  ],
  RS25: [
    'The four RS‑25 engines start.',
    'Arrancan los cuatro motores RS‑25.',
    'The engines burn propellant with the rocket held down.',
    'Los motores consumen propelente con el cohete sujeto.',
  ],
  LIFTOFF: [
    'Booster ignition, umbilical release and liftoff.',
    'Ignición de los boosters, separación de los umbilicales y despegue.',
    'The hold-down releases: from here on, the physics flies the rocket.',
    'Se suelta la sujeción: desde acá vuela la física.',
  ],
};

function stages(l: Locale): GuideContent {
  const n = P.nominal;
  const row = (id: string, what: string, published: string, model: string): string[] => [id, what, published, model];
  const met = (s: number): string => formatMet(s);
  const T = (s: number): string => formatTMinus(s, l);
  return {
    title: L(l, 'MISSION STAGES', 'ETAPAS DE LA MISIÓN'),
    sections: [
      {
        title: L(l, 'Before liftoff: the terminal count', 'Antes del despegue: la cuenta final'),
        paragraphs: [
          L(
            l,
            `The mission starts on the pad at ${T(COUNT_START)}, when the ground launch sequencer (GLS) starts the terminal count NASA published for Artemis II: ${COUNTDOWN.length} milestones, all of them on the panel’s Count page. From ${T(MET_ALS)} the automated launch sequencer (ALS) runs it. The crew has no required action, as in the real count, and the holds are not simulated. Liftoff is at the real launch time, ${formatSpan(LIFTOFF_AFTER_WINDOW_OPEN, l)} after the window opened, which sets where the Sun is.`,
            `La misión empieza en la plataforma en ${T(COUNT_START)}, cuando el secuenciador de tierra (GLS) inicia la cuenta final que publicó NASA para Artemis II: ${COUNTDOWN.length} hitos, todos en la página Count del panel. Desde ${T(MET_ALS)} la corre el secuenciador automático (ALS). La tripulación no tiene acciones obligatorias, como en la cuenta real, y las esperas no se simulan. El despegue es a la hora real del lanzamiento, ${formatSpan(LIFTOFF_AFTER_WINDOW_OPEN, l)} después de abrirse la ventana, que fija dónde está el Sol.`,
          ),
        ],
        table: {
          head: ['T‑', L(l, 'Milestone', 'Hito'), L(l, 'In the simulator', 'En el simulador')],
          rows: COUNTDOWN.flatMap((c) => {
            const r = COUNT_ROWS[c.id];
            return r ? [[T(c.met), L(l, r[0], r[1]), L(l, r[2], r[3])]] : [];
          }),
        },
        note: L(
          l,
          `Only the RS‑25 start and the booster ignition change the physics; the rest is the programmed sequence of the ground systems, shown on the Count page, in the log and in the 3D view. NASA gives the times as approximate. Sources: ${SRC_CNT}; ${SRC_LDAY}.`,
          `Solo el arranque de los RS‑25 y la ignición de los boosters cambian la física; el resto es la secuencia programada de los sistemas de tierra, que se ve en la página Count, en el log y en la vista 3D. NASA da los tiempos como aproximados. Fuentes: ${SRC_CNT}; ${SRC_LDAY}.`,
        ),
      },
      {
        title: L(l, 'Event by event', 'Evento por evento'),
        paragraphs: [
          L(
            l,
            'The 15 numbered events follow NASA’s mission map. "Published" is NASA’s pre-launch estimate; "model" is what this simulator computes with its physics (the ascent and the ICPS burns are automatic, the rest is flown by the crew).',
            'Los 15 eventos numerados siguen el mapa de misión de NASA. "Publicado" es la estimación previa al lanzamiento de NASA; "modelo" es lo que calcula este simulador con su física (el ascenso y los encendidos del ICPS son automáticos, el resto lo vuela la tripulación).',
          ),
        ],
        table: {
          head: ['#', L(l, 'Event', 'Evento'), L(l, 'Published MET', 'MET publicado'), L(l, 'Model MET', 'MET del modelo')],
          rows: [
            row('E1', L(l, `Liftoff from LC‑39B after the terminal count (above): the RS‑25 engines start at ${T(-RS25_START_BEFORE_LIFTOFF)} and the boosters at T‑0.`, `Despegue desde LC‑39B después de la cuenta final (arriba): los RS‑25 arrancan en ${T(-RS25_START_BEFORE_LIFTOFF)} y los boosters en T‑0.`), '000/00:00:00', '000/00:00:00'),
            row('E2', L(l, 'Booster separation at 2:08; launch abort system jettison at 3:28.', 'Separación de boosters a 2:08; eyección de la torre de escape a 3:28.'), '000/00:02:08', '000/00:02:08'),
            row('E3', L(l, `MECO at 8:06 and core stage separation into a ${formatNumber(INSERTION_ORBIT.perigee)} × ${formatNumber(INSERTION_ORBIT.apogee)} km orbit.`, `MECO a 8:06 y separación de la etapa central en una órbita de ${formatNumber(INSERTION_ORBIT.perigee)} × ${formatNumber(INSERTION_ORBIT.apogee)} km.`), '000/00:08:18', '000/00:08:18'),
            row('E4', L(l, `ICPS perigee raise (~30 s) to ${formatNumber(POST_PRM_ORBIT.perigee)} km.`, `Elevación del perigeo con el ICPS (~30 s) a ${formatNumber(POST_PRM_ORBIT.perigee)} km.`), met(MET_E4_PERIGEE_RAISE), met(P.burns.E4.met)),
            row('E5', L(l, `ICPS apogee raise (~20 min), perigee left at zero so the stage re-enters by itself. The SLS guide gives a ${formatNumber(POST_ARB_ORBIT.apogee)} km apogee; the model sizes it so the TLI falls on the timeline’s time (a slightly lower apogee).`, `Elevación del apogeo con el ICPS (~20 min), con el perigeo en cero para que la etapa reentre sola. La guía del SLS da un apogeo de ${formatNumber(POST_ARB_ORBIT.apogee)} km; el modelo lo ajusta para que el TLI caiga en el horario del cronograma (un apogeo algo más bajo).`), met(MET_E5_APOGEE_RAISE), met(P.burns.E5.met)),
            row('E6', L(l, 'Orion/ICPS separation and ~90 min of manual proximity operations.', 'Separación Orion/ICPS y ~90 min de operaciones de proximidad manuales.'), met(MET_E6_PROX_OPS_START), met(MET_E6_PROX_OPS_START)),
            row('E7', L(l, `Orion departure burn: ${E7_BURN_DURATION} s on the auxiliary thrusters. Then the ICPS does its disposal burn (${met(MET_ICPS_DISPOSAL)}), releases the CubeSats and falls into the Pacific at ${met(MET_ICPS_SPLASHDOWN)}.`, `Encendido de salida de Orion: ${E7_BURN_DURATION} s con los auxiliares. Después el ICPS hace su encendido de eliminación (${met(MET_ICPS_DISPOSAL)}), libera los CubeSats y cae al Pacífico a las ${met(MET_ICPS_SPLASHDOWN)}.`), met(MET_E7_DEPARTURE), met(P.burns.E7.met)),
            row('E8', L(l, `Orion perigee raise at apogee, to ${formatNumber(HEO_ORBIT.perigee)} km (${ms(P.burns.E8.dv.prograde)} m/s).`, `Elevación del perigeo de Orion en el apogeo, a ${formatNumber(HEO_ORBIT.perigee)} km (${ms(P.burns.E8.dv.prograde)} m/s).`), `~${met(PUBLISHED_MET.prb)}`, met(P.burns.E8.met)),
            row('E9', L(l, `Translunar injection at perigee: ${ms(P.burns.E9.dv.prograde)} m/s with the main engine.`, `Inyección translunar en el perigeo: ${ms(P.burns.E9.dv.prograde)} m/s con el motor principal.`), met(PUBLISHED_MET.tli), met(P.burns.E9.met)),
            row('E10', L(l, 'Outbound transit with up to three correction burns (OTC‑1, 2 and 3).', 'Tránsito de ida con hasta tres correcciones (OTC‑1, 2 y 3).'), `${met(PUBLISHED_MET.otc1)} …`, '—'),
            row('E11', L(l, `Lunar flyby at ${formatNumber(FLYBY_ALTITUDE_TARGET)} km over the far side, out of contact; farthest humans ever (past Apollo 13’s ${formatNumber(APOLLO_13_RECORD_DISTANCE)} km).`, `Sobrevuelo lunar a ${formatNumber(FLYBY_ALTITUDE_TARGET)} km sobre la cara oculta, sin contacto; el punto más lejano alcanzado por humanos (más allá de los ${formatNumber(APOLLO_13_RECORD_DISTANCE)} km del Apollo 13).`), met(PUBLISHED_MET.flyby), met(n.flybyMet)),
            row('E12', L(l, 'Return transit with up to three corrections (RTC‑1, 2 and 3).', 'Tránsito de regreso con hasta tres correcciones (RTC‑1, 2 y 3).'), `${met(PUBLISHED_MET.rtc1)} …`, '—'),
            row('E13', L(l, 'Crew module / service module separation, 20 min before entry.', 'Separación módulo de tripulación / módulo de servicio, 20 min antes de la entrada.'), met(PUBLISHED_MET.cmSep), met(n.eiMet - 1200)),
            row('E14', L(l, `Entry interface at 121.9 km and ~${formatNumber(n.eiSpeed, 1)} km/s.`, `Interfaz de entrada a 121,9 km y ~${formatNumber(n.eiSpeed, 1)} km/s.`), met(PUBLISHED_MET.ei), met(n.eiMet)),
            row('E15', L(l, 'Parachutes and splashdown in the Pacific off San Diego (not simulated).', 'Paracaídas y amerizaje en el Pacífico frente a San Diego (no se simula).'), met(PUBLISHED_MET.splashdown), '—'),
          ],
        },
        note: L(
          l,
          `Entry interface: ${met(PUBLISHED_MET.ei)} published versus ${met(n.eiMet)} in the model. Splashdown, which is not simulated, comes ${formatDuration(PUBLISHED_MET.splashdown - PUBLISHED_MET.ei)} later: ${formatDuration(PUBLISHED_MET.splashdown)} in total. The Moon moves on its real orbit for April 2026, close to apogee (about ${formatNumber(Math.round(MOON_ORBIT.a * (1 + MOON_ORBIT.e) / 100) * 100)} km from Earth at the flyby, against an average of ${formatNumber(EARTH_MOON_DISTANCE)} km), and the high orbit is sized so the TLI falls on the published time. The remaining difference is within the model’s simplifications: a single orbital plane and a Keplerian Moon. Sources: ${SRC_SLS}; ${SRC_TL}; ${SRC_JPL}.`,
          `Interfaz de entrada: ${met(PUBLISHED_MET.ei)} publicado contra ${met(n.eiMet)} en el modelo. El amerizaje, que no se simula, llega ${formatDuration(PUBLISHED_MET.splashdown - PUBLISHED_MET.ei)} después: ${formatDuration(PUBLISHED_MET.splashdown)} en total. La Luna recorre su órbita real de abril de 2026, cerca del apogeo (a unos ${formatNumber(Math.round(MOON_ORBIT.a * (1 + MOON_ORBIT.e) / 100) * 100)} km de la Tierra en el sobrevuelo, contra ${formatNumber(EARTH_MOON_DISTANCE)} km de promedio), y la órbita alta está ajustada para que el TLI caiga en el horario publicado. La diferencia que queda entra en las simplificaciones del modelo: un único plano orbital y una Luna kepleriana. Fuentes: ${SRC_SLS}; ${SRC_TL}; ${SRC_JPL}.`,
        ),
      },
    ],
  };
}

// ---------- Budget ----------

function budget(l: Locale): GuideContent {
  // ICPS capability with the stack left after core stage separation.
  const afterCore = { ...CONFIG_AT_LIFTOFF, srbSeparated: true, lasJettisoned: true, coreSeparated: true };
  const stackAtE4 = dryMass(afterCore) + MASS.icpsProp + MASS.esmProp + MASS.cmProp;
  const icpsCapability = idealDv(ENGINES.RL10, stackAtE4, MASS.icpsProp);
  const icpsPlanned = dvMagnitude(P.burns.E4.dv) + dvMagnitude(P.burns.E5.dv);
  // Orion alone, with a full service module.
  const orionFull = dryMass({ ...afterCore, icpsSeparated: true }) + MASS.esmProp + MASS.cmProp;
  const orionCapability = idealDv(ENGINES.MAIN, orionFull, MASS.esmProp);
  const orionPlanned = P.burns.E7.dv.prograde + P.burns.E8.dv.prograde + P.burns.E9.dv.prograde;
  return {
    title: L(l, 'BUDGET', 'PRESUPUESTO'),
    sections: [
      {
        title: L(l, 'Δv budget: what each stage can give and what the plan spends', 'Presupuesto de Δv: lo que puede dar cada etapa y lo que gasta el plan'),
        paragraphs: [
          L(
            l,
            'In spaceflight the budget that matters is velocity change (Δv). Each stage can deliver a fixed amount, set by the rocket equation from its propellant, its mass and the exhaust speed of its engine. What is not spent on the plan is the margin for corrections and contingencies.',
            'En vuelo espacial el presupuesto que importa es el cambio de velocidad (Δv). Cada etapa puede entregar una cantidad fija, que sale de la ecuación del cohete con su propelente, su masa y la velocidad de escape de su motor. Lo que no gasta el plan es el margen para correcciones y contingencias.',
          ),
        ],
        table: {
          head: [L(l, 'Stage', 'Etapa'), L(l, 'Propellant', 'Propelente'), L(l, 'Capability', 'Capacidad'), L(l, 'Planned', 'Planeado'), L(l, 'Margin', 'Margen')],
          rows: [
            [L(l, 'Boosters (×2)', 'Boosters (×2)'), `${t(MASS.srbProp)} t`, L(l, '126 s of burn', '126 s de quemado'), L(l, 'all of it, during ascent', 'todo, en el ascenso'), '—'],
            [L(l, 'Core stage', 'Etapa central'), `${t(MASS.coreProp)} t`, L(l, '486 s of burn', '486 s de quemado'), L(l, 'to orbit (a few % remain at MECO)', 'hasta la órbita (queda un pequeño % en MECO)'), '—'],
            ['ICPS', `${t(MASS.icpsProp)} t`, `${ms(icpsCapability)} m/s`, `${ms(icpsPlanned)} m/s (E4 + E5)`, `${ms(icpsCapability - icpsPlanned)} m/s`],
            [L(l, 'Orion service module', 'Módulo de servicio de Orion'), `${t(MASS.esmProp)} t`, `${ms(orionCapability)} m/s`, `${ms(orionPlanned)} m/s (E7 + E8 + E9)`, `${ms(orionCapability - orionPlanned)} m/s`],
          ],
        },
        note: L(
          l,
          'Capabilities are ideal Δv (rocket equation, no gravity losses). Orion’s margin pays for the trajectory corrections (OTC/RTC), attitude control and any off-nominal recovery: that is what you spend when you fire the auxiliaries or the RCS by hand.',
          'Las capacidades son Δv ideal (ecuación del cohete, sin pérdidas por gravedad). El margen de Orion paga las correcciones de trayectoria (OTC/RTC), el control de actitud y cualquier recuperación fuera de lo nominal: eso es lo que gastás cuando encendés los auxiliares o el RCS a mano.',
        ),
      },
      {
        title: L(l, 'Mass budget at liftoff', 'Presupuesto de masa al despegue'),
        table: {
          head: [L(l, 'Element', 'Elemento'), L(l, 'Mass', 'Masa')],
          rows: [
            [L(l, 'Two boosters, loaded', 'Dos boosters cargados'), `${t(MASS.srbDry + MASS.srbProp)} t`],
            [L(l, 'Core stage with engines and propellant', 'Etapa central con motores y propelente'), `${t(MASS.coreDry + MASS.coreProp)} t`],
            [L(l, 'Stage adapter (LVSA)', 'Adaptador de etapas (LVSA)'), `${t(MASS.lvsa)} t`],
            [L(l, 'ICPS, loaded', 'ICPS cargado'), `${t(MASS.icpsDry + MASS.icpsProp)} t`],
            [L(l, `Orion stage adapter and ${CUBESAT_COUNT} CubeSats`, `Adaptador de Orion y ${CUBESAT_COUNT} CubeSats`), `${t(MASS.osa + CUBESAT_COUNT * MASS.cubesat)} t`],
            [L(l, 'Orion: crew module, service module, adapter, panels and abort system', 'Orion: módulo de tripulación, módulo de servicio, adaptador, paneles y torre de escape'), `${t(MASS.cm + MASS.cmProp + MASS.smDry + MASS.esmProp + MASS.spacecraftAdapter + MASS.fairing + MASS.las)} t`],
          ],
        },
        note: L(l, `Published: SLS 2,604 t fueled plus Orion. Sources: ${SRC_SLS}; ${SRC_A2}.`, `Publicado: SLS 2.604 t cargado más Orion. Fuentes: ${SRC_SLS}; ${SRC_A2}.`),
      },
      {
        title: L(l, 'Money', 'Dinero'),
        paragraphs: [
          L(
            l,
            'NASA’s Office of Inspector General estimated the production and operations cost of each of the first four Artemis launches (SLS, Orion and ground systems) at about 4.1 billion dollars, and the whole Artemis program at about 93 billion dollars from fiscal year 2012 through 2025.',
            'La Oficina del Inspector General de NASA estimó el costo de producción y operación de cada uno de los cuatro primeros lanzamientos Artemis (SLS, Orion y sistemas de tierra) en unos 4.100 millones de dólares, y el programa Artemis completo en unos 93.000 millones de dólares entre los años fiscales 2012 y 2025.',
          ),
        ],
        note: L(l, 'Source: NASA OIG, "NASA’s Management of the Artemis Missions", IG‑22‑003, November 2021. These figures are not part of the simulation.', 'Fuente: NASA OIG, "NASA’s Management of the Artemis Missions", IG‑22‑003, noviembre de 2021. Estas cifras no forman parte de la simulación.'),
      },
    ],
  };
}

// ---------- Power ----------

function power(l: Locale): GuideContent {
  return {
    title: L(l, 'POWER MANAGEMENT', 'MANEJO DE ENERGÍA'),
    sections: [
      {
        title: L(l, 'Where the power comes from', 'De dónde sale la energía'),
        bullets: [
          L(l, 'The European service module carries four solar array wings that generate about 11 kW. They deploy right after the core stage separates and are angled for the ICPS burns.', 'El módulo de servicio europeo lleva cuatro alas de paneles solares que generan unos 11 kW. Se despliegan apenas se separa la etapa central y se orientan para los encendidos del ICPS.'),
          L(l, 'Orion runs on a 120 V bus with batteries in the crew module. The batteries cover launch (before the arrays deploy), eclipses and the final descent after the service module is gone.', 'Orion funciona con un bus de 120 V y baterías en el módulo de tripulación. Las baterías cubren el lanzamiento (antes de desplegar los paneles), los eclipses y el descenso final, cuando el módulo de servicio ya no está.'),
          L(l, 'On the pad the vehicle switches from ground power to internal power during the terminal count (T‑10 min).', 'En la plataforma el vehículo pasa de la energía de tierra a la interna durante la cuenta terminal (T‑10 min).'),
        ],
      },
      {
        title: L(l, 'How the crew manages it', 'Cómo lo maneja la tripulación'),
        bullets: [
          L(l, 'Attitude is the main tool. During most of the cruise Orion holds a "tail to Sun" attitude (called Bias −XSI in the flight plan) so the arrays see the Sun and the thermal loads stay balanced.', 'La actitud es la herramienta principal. En casi todo el crucero Orion mantiene una actitud "cola al Sol" (llamada Bias −XSI en el plan de vuelo) para que los paneles vean el Sol y las cargas térmicas queden equilibradas.'),
          L(l, 'Burns interrupt it: the spacecraft turns to the burn attitude a few minutes before ignition and goes back afterwards.', 'Los encendidos la interrumpen: la nave gira a la actitud del encendido unos minutos antes de la ignición y vuelve después.'),
          L(l, 'The flight plan includes a test with the arrays in full shadow during the first day, to characterize the batteries, and the lunar flyby itself happens partly in the Moon’s shadow.', 'El plan de vuelo incluye una prueba con los paneles en sombra total durante el primer día, para caracterizar las baterías, y el propio sobrevuelo lunar ocurre en parte en la sombra de la Luna.'),
        ],
      },
      {
        title: L(l, 'In the simulator', 'En el simulador'),
        paragraphs: [
          L(
            l,
            'The simulator does not model the electrical system: no battery charge, no eclipse accounting and no power page. The numbers above are NASA’s published figures, shown here for context only. The one energy-related readout on the panel is the skin temperature, a simplified radiative estimate.',
            'El simulador no modela el sistema eléctrico: no hay carga de baterías, ni contabilidad de eclipses, ni página de energía. Los números de arriba son los publicados por NASA y están solo como contexto. El único dato relacionado con energía en el panel es la temperatura de superficie, una estimación radiativa simplificada.',
          ),
        ],
        note: L(l, `Sources: ${SRC_A2}; ${SRC_TL}.`, `Fuentes: ${SRC_A2}; ${SRC_TL}.`),
      },
    ],
  };
}

// ---------- Spacecraft ----------

function ship(l: Locale): GuideContent {
  const srbMax = Math.max(...SRB_THRUST_PROFILE.map(([, f]) => f));
  return {
    title: L(l, 'ABOUT THE SPACECRAFT', 'ACERCA DE LA NAVE'),
    sections: [
      {
        title: L(l, 'The stack, bottom to top', 'El apilado, de abajo hacia arriba'),
        table: {
          head: [L(l, 'Part', 'Parte'), L(l, 'Mass', 'Masa'), L(l, 'Propulsion', 'Propulsión'), L(l, 'Role', 'Función')],
          rows: [
            [L(l, 'Solid rocket boosters (×2)', 'Boosters de combustible sólido (×2)'), `${t((MASS.srbDry + MASS.srbProp) / 2)} t ${L(l, 'each', 'cada uno')}`, `${kn(srbMax * 1000)} kN ${L(l, 'max each', 'máx. cada uno')}, Isp ${formatNumber(SRB_ISP, 0)} s`, L(l, 'About 75 % of the liftoff thrust for two minutes.', 'Cerca del 75 % del empuje del despegue durante dos minutos.')],
            [L(l, 'Core stage', 'Etapa central'), `${t(MASS.coreDry)} t + ${t(MASS.coreProp)} t`, `4 RS‑25, ${kn(ENGINES.RS25.thrustVac / 4)} kN ${L(l, 'each in vacuum at 109 %', 'cada uno en vacío al 109 %')}`, L(l, 'Burns for eight minutes, from the pad to orbit.', 'Quema ocho minutos, de la plataforma a la órbita.')],
            [L(l, 'Stage adapter (LVSA)', 'Adaptador de etapas (LVSA)'), `${t(MASS.lvsa)} t`, '—', L(l, 'Cone between the core stage and the ICPS; falls with the core.', 'Cono entre la etapa central y el ICPS; cae con la etapa.')],
            ['ICPS', `${t(MASS.icpsDry)} t + ${t(MASS.icpsProp)} t`, `RL10C‑2, ${kn(ENGINES.RL10.thrustVac)} kN, Isp ${formatNumber(ENGINES.RL10.ispVac, 1)} s`, L(l, 'Two burns to the high orbit; then disposal.', 'Dos encendidos hasta la órbita alta; después, eliminación.')],
            [L(l, 'Orion stage adapter', 'Adaptador de Orion'), `${t(MASS.osa)} t`, '—', L(l, `Holds the ${CUBESAT_COUNT} CubeSats.`, `Aloja los ${CUBESAT_COUNT} CubeSats.`)],
            [L(l, 'Service module (ESA)', 'Módulo de servicio (ESA)'), `${t(MASS.smDry)} t + ${t(MASS.esmProp)} t`, `${L(l, 'Main', 'Principal')} ${kn(ENGINES.MAIN.thrustVac)} kN · 8 aux ${ENGINES.AUX.thrustVac / 8} N · 24 RCS 222 N`, L(l, 'Propulsion, power, water and air for the crew. Separated before entry.', 'Propulsión, energía, agua y aire para la tripulación. Se separa antes de la entrada.')],
            [L(l, 'Crew module', 'Módulo de tripulación'), `${t(MASS.cm)} t`, `12 RCS ${ENGINES.CMRCS.thrustVac / 2} N`, L(l, 'The capsule: four seats, heat shield and parachutes. The only part that comes back.', 'La cápsula: cuatro asientos, escudo térmico y paracaídas. Lo único que vuelve.')],
            [L(l, 'Launch abort system', 'Torre de escape'), `${t(MASS.las)} t`, L(l, 'Abort motor 1,779 kN', 'Motor de aborto 1.779 kN'), L(l, 'Pulls the capsule away in an ascent emergency; jettisoned at 3:28.', 'Arranca la cápsula en una emergencia del ascenso; se eyecta a 3:28.')],
          ],
        },
        note: L(
          l,
          `Height 98 m, 2,604 t at liftoff (SLS) and 36,787 kN of launch thrust. Sources: ${SRC_SLS}; ${SRC_A2}. Values marked as assumptions in the code (Isp of the small thrusters, drag coefficient, capsule RCS propellant) are not NASA data.`,
          `Altura 98 m, 2.604 t al despegue (SLS) y 36.787 kN de empuje al despegue. Fuentes: ${SRC_SLS}; ${SRC_A2}. Los valores marcados como supuestos en el código (Isp de los propulsores chicos, coeficiente de arrastre, propelente del RCS de la cápsula) no son datos de NASA.`,
        ),
      },
      {
        title: L(l, 'What changes along the flight', 'Qué cambia a lo largo del vuelo'),
        bullets: [
          L(l, 'Liftoff: full stack, 98 m tall, held down on the Mobile Launcher until T‑0. Boosters off at 2:08, abort tower and panels at 3:28, core stage at 8:18.', 'Despegue: apilado completo, 98 m de alto, sujeto al Mobile Launcher hasta T‑0. Boosters fuera a 2:08, torre y paneles a 3:28, etapa central a 8:18.'),
          L(l, 'Orbit: Orion plus ICPS, solar arrays deployed. The ICPS leaves at 3 h 23 min with the adapter and the CubeSats.', 'Órbita: Orion más ICPS, paneles desplegados. El ICPS se va a las 3 h 23 min con el adaptador y los CubeSats.'),
          L(l, 'Cruise: Orion alone, about 26 t. The main engine, the auxiliaries and the RCS share the service module tanks.', 'Crucero: Orion sola, unas 26 t. El motor principal, los auxiliares y el RCS comparten los tanques del módulo de servicio.'),
          L(l, 'Entry: the capsule alone, about 10 t, steering with its own RCS.', 'Entrada: la cápsula sola, unas 10 t, orientándose con su propio RCS.'),
        ],
      },
      {
        title: L(l, 'On the pad: Mobile Launcher 1 and Launch Complex 39B', 'En la plataforma: el Mobile Launcher 1 y el complejo 39B'),
        paragraphs: [
          L(
            l,
            'Until liftoff the rocket stands on Mobile Launcher 1 (ML‑1), the steel base and tower that carried it from the assembly building, at Launch Complex 39B of the Kennedy Space Center.',
            'Hasta el despegue el cohete está sobre el Mobile Launcher 1 (ML‑1), la base y la torre de acero que lo llevaron desde el edificio de ensamblaje, en el complejo de lanzamiento 39B del Centro Espacial Kennedy.',
          ),
        ],
        table: {
          head: [L(l, 'Element', 'Elemento'), L(l, 'Size', 'Medida'), L(l, 'What it does', 'Qué hace')],
          rows: [
            [
              L(l, 'ML‑1 base', 'Base del ML‑1'),
              `${m(ML1.baseLength, 1)} × ${m(ML1.baseWidth, 1)} × ${m(ML1.baseHeight, 1)} m`,
              L(
                l,
                `Two stories on six mounts of ${m(ML1.mountHeight, 1)} m. The deck is ${m(LAUNCH_DECK_HEIGHT, 1)} m above the pad, with a ${m(ML1.openingLength, 1)} × ${m(ML1.openingWidth, 1)} m opening for the exhaust.`,
                `Dos pisos sobre seis montantes de ${m(ML1.mountHeight, 1)} m. La cubierta está a ${m(LAUNCH_DECK_HEIGHT, 1)} m sobre la plataforma, con una abertura de ${m(ML1.openingLength, 1)} × ${m(ML1.openingWidth, 1)} m para el escape.`,
              ),
            ],
            [
              L(l, 'Support posts (8)', 'Postes de apoyo (8)'),
              `${m(SUPPORT_POST_HEIGHT, 1)} m`,
              L(l, 'Four under the aft skirt of each booster; they hold the rocket until T‑0.', 'Cuatro bajo el faldón trasero de cada booster; sostienen el cohete hasta T‑0.'),
            ],
            [
              L(l, 'Tower', 'Torre'),
              `${m(ML1.towerSide, 1)} m ${L(l, 'square', 'de lado')}, ${m(ML1.towerHeight)} m`,
              L(
                l,
                `A floor every ${m(ML1.floorSpacing, 1)} m; its top is about ${m(ML1.totalHeight)} m above the ground. It carries the crew access arm and the umbilicals that feed propellant, power and data until liftoff.`,
                `Un piso cada ${m(ML1.floorSpacing, 1)} m; su tope está a unos ${m(ML1.totalHeight)} m del suelo. Lleva el brazo de acceso de la tripulación y los umbilicales que dan propelente, energía y datos hasta el despegue.`,
              ),
            ],
            [
              L(l, 'Tail service masts (2)', 'Mástiles de servicio de cola (2)'),
              `${m(TSMU_HEIGHT, 1)} m`,
              L(l, 'On the deck, connected to the engine section of the core stage; they retract at liftoff.', 'Sobre la cubierta, conectados a la sección de motores de la etapa central; se retraen al despegar.'),
            ],
            [
              L(l, 'Pad surface', 'Superficie de la plataforma'),
              `${m(PAD_ELEVATION, 1)} m`,
              L(l, 'Height above mean sea level of the hardstand the Mobile Launcher stands on.', 'Altura sobre el nivel medio del mar de la explanada donde apoya el Mobile Launcher.'),
            ],
            [
              L(l, 'Flame trench', 'Foso de llamas'),
              `${m(FLAME_TRENCH.length)} × ${m(FLAME_TRENCH.width, 1)} × ${m(FLAME_TRENCH.depth, 1)} m`,
              L(l, 'Long, wide and deep. A deflector under the opening sends the whole plume to its north side.', 'De largo, ancho y profundidad. Un deflector bajo la abertura manda todo el escape a su lado norte.'),
            ],
            [
              L(l, 'Lightning masts (3)', 'Pararrayos (3)'),
              `${m(LIGHTNING_MAST_HEIGHT)} m`,
              L(l, 'Around the pad, with cables between their tops.', 'Alrededor de la plataforma, con cables entre sus topes.'),
            ],
            [
              'Crawlerway',
              `${m(CRAWLERWAY.total, 1)} m`,
              L(
                l,
                `The road the crawler-transporter uses to bring the Mobile Launcher: two lanes of ${m(CRAWLERWAY.lane, 1)} m and a ${m(CRAWLERWAY.median, 1)} m median. The ramp up to the pad has a ${formatNumber(CRAWLERWAY.rampGrade * 100)} % grade.`,
                `El camino por el que la oruga transportadora trae el Mobile Launcher: dos carriles de ${m(CRAWLERWAY.lane, 1)} m y una franja central de ${m(CRAWLERWAY.median, 1)} m. La rampa a la plataforma tiene una pendiente del ${formatNumber(CRAWLERWAY.rampGrade * 100)} %.`,
              ),
            ],
          ],
        },
        note: L(
          l,
          `In the 3D view the pad is a model built from these figures and from NASA photos. The positions of the lightning masts, the water tower and the tanks come from OpenStreetMap; the ground layout is generic, and the angles and timing of the moving arms are approximate drawing choices, because NASA does not publish them. Sources: ${SRC_ML1}; ${SRC_UMB}; ${SRC_39B}; ${SRC_LC50}; ${SRC_CRW}.`,
          `En la vista 3D la plataforma es un modelo hecho con estos números y con fotos de NASA. Las posiciones de los pararrayos, la torre de agua y los tanques salen de OpenStreetMap; el trazado del suelo es genérico, y los ángulos y tiempos de los brazos que se mueven son elecciones de dibujo aproximadas, porque NASA no los publica. Fuentes: ${SRC_ML1}; ${SRC_UMB}; ${SRC_39B}; ${SRC_LC50}; ${SRC_CRW}.`,
        ),
      },
    ],
  };
}

// ---------- NASA documentation ----------

function docs(l: Locale): GuideContent {
  return {
    title: L(l, 'NASA DOCUMENTATION', 'DOCUMENTACIÓN DE NASA'),
    sections: [
      {
        title: L(l, 'Mission pages', 'Páginas de la misión'),
        links: [
          {
            label: 'Artemis II Press Kit',
            url: 'https://www.nasa.gov/artemis-ii-press-kit/',
            desc: L(l, 'Mission overview, crew, timeline and media resources.', 'Resumen de la misión, tripulación, cronograma y recursos para prensa.'),
          },
          {
            label: 'Space Launch System Gallery',
            url: 'https://www.nasa.gov/gallery/space-launch-system-gallery/',
            desc: L(l, 'Photos of the SLS rocket.', 'Fotos del cohete SLS.'),
          },
          {
            label: 'How to Fly NASA’s Orion Spacecraft',
            url: 'https://www.nasa.gov/missions/artemis/orion/how-to-fly-nasas-orion-spacecraft/',
            desc: L(l, 'The cockpit, its displays and its controls, explained by NASA.', 'La cabina, sus pantallas y sus controles, explicados por NASA.'),
          },
        ],
      },
      {
        title: L(l, 'Reference guides (PDF)', 'Guías de referencia (PDF)'),
        links: [
          {
            label: 'Artemis II Reference Guide',
            url: 'https://www.nasa.gov/wp-content/uploads/2026/01/a2-reference-guide-012825.pdf',
            desc: L(l, 'Orion, the crew and the mission objectives.', 'Orion, la tripulación y los objetivos de la misión.'),
          },
          {
            label: 'Space Launch System Reference Guide for Artemis II',
            url: 'https://www.nasa.gov/wp-content/uploads/2026/01/sls-5558-artemis-ii-sls-reference-guide-final-review-508-012026.pdf',
            desc: L(l, 'Masses, engines, booster thrust curve and the ascent event table.', 'Masas, motores, curva de empuje de los boosters y tabla de eventos del ascenso.'),
          },
        ],
      },
      {
        title: L(l, 'Launch pad and terminal count', 'Plataforma y cuenta final'),
        links: [
          {
            label: 'NASA Releases Artemis II Moon Mission Launch Countdown',
            url: 'https://www.nasa.gov/general/nasa-releases-artemis-ii-moon-mission-launch-countdown/',
            desc: L(l, `The terminal count from ${formatTMinus(COUNT_START, l)} to liftoff, milestone by milestone.`, `La cuenta final de ${formatTMinus(COUNT_START, l)} al despegue, hito por hito.`),
          },
          {
            label: 'Mobile Launcher 1 (PDF)',
            url: 'https://www.nasa.gov/wp-content/uploads/2021/04/final_-_mobile_launcher_1_fact_sheet.pdf',
            desc: L(l, 'Fact sheet: base, deck, tower and support posts.', 'Hoja de datos: base, cubierta, torre y postes de apoyo.'),
          },
          {
            label: 'Mobile Launcher Tower Umbilicals and Accessories (PDF)',
            url: 'https://www.nasa.gov/wp-content/uploads/2018/06/fs-2018-02-250-ksc-ml_umbilical_fact_sheet.pdf',
            desc: L(l, 'Fact sheet: the crew access arm, the umbilicals and what each one does at launch.', 'Hoja de datos: el brazo de acceso, los umbilicales y qué hace cada uno en el lanzamiento.'),
          },
          {
            label: 'Launch Complex 39B (PDF)',
            url: 'https://www.nasa.gov/wp-content/uploads/2018/06/launchpad39b_factsheet_013018_508.pdf',
            desc: L(l, 'Fact sheet: flame trench, lightning masts and sound suppression water.', 'Hoja de datos: foso de llamas, pararrayos y agua de supresión de sonido.'),
          },
        ],
        note: L(
          l,
          'External links to nasa.gov; they open in a new tab. The simulator’s vehicle and mission data come mostly from the reference guides, and those of the pad and the count from these fact sheets and NASA’s countdown release, cited in each number. This project is not affiliated with or endorsed by NASA.',
          'Enlaces externos a nasa.gov; se abren en otra pestaña. Los datos del vehículo y de la misión del simulador salen sobre todo de las guías de referencia, y los de la plataforma y la cuenta, de estas hojas de datos y del anuncio de la cuenta de NASA, citados en cada número. Este proyecto no está afiliado ni avalado por NASA.',
        ),
      },
    ],
  };
}

const BUILDERS: Readonly<Record<GuideId, (l: Locale) => GuideContent>> = { objective, stages, budget, power, ship, docs };

export const guideContent = (id: GuideId, locale: Locale): GuideContent => BUILDERS[id](locale);
