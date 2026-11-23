/**
 * Physical constants and data converted from the reference images and the NASA
 * guides. Simulation units: km, s, km/s.
 *
 * Cited sources:
 * - [SLS] NASA, "Space Launch System Reference Guide for Artemis II", SLS‑5558, oct. 2025.
 * - [A2]  NASA, "Artemis II Reference Guide", 2026.
 * - [TL]  NASA, "Artemis II Overview Timeline", 18/03/2026 (STRIVES 20260002249).
 * - [AV]  NASA, "Artemis II Mission Availability – April 2026" (launch windows).
 * - [ASC] NASA, ascent and Earth-orbit infographic for Artemis II, same as the [SLS] table.
 * - [JPL] NASA/JPL, Horizons ephemeris system (ssd.jpl.nasa.gov/horizons), accessed 2026-11-15.
 * - [ORG] NASA, "Orion Reference Guide", 2022-11-10 (predates Artemis I; Orion data).
 * - [CNT] NASA, "NASA Releases Artemis II Moon Mission Launch Countdown", 2026-03-26
 *   (nasa.gov/general/nasa-releases-artemis-ii-moon-mission-launch-countdown/): terminal count
 *   from T‑10 min; the times are "approximate".
 * - [ML1] NASA, "Mobile Launcher 1" fact sheet, FS‑2024‑11‑997‑KSC.
 * - [UMB] NASA, "Mobile Launcher Tower Umbilicals and Accessories" fact sheet, FS‑2021‑08‑727‑KSC.
 * - [39B] NASA, "Launch Complex 39B" fact sheet, FS‑2021‑08‑726‑KSC.
 * - [LDAY] NASA, "Live Artemis II Launch Day Updates", blog, 2026-04-01.
 * - [LC50] NASA, "NASA Celebrates 50th Anniversary of Launch Complex 39B, Prepares for Next
 *   Mission", 2017-06-14 (nasa.gov/centers-and-facilities/kennedy/): pad elevation.
 * - [OSM] © OpenStreetMap contributors (ODbL), via the Overpass API: only the positions (and the
 *   tank footprints) of elements around LC‑39B, credited in the app's Credits.
 */

// --- Physics ---
export const GM_EARTH = 398600.4418; // km³/s²
export const GM_MOON = 4902.8; // km³/s²
export const R_EARTH = 6378.137; // km
export const R_MOON = 1737.4; // km
/**
 * Mean Earth‑Moon distance. Used by the circular model (CR3BP tests) and the sphere of
 * influence; the mission flies with the elliptical orbit of `MOON_ORBIT`.
 */
export const EARTH_MOON_DISTANCE = 384400; // km
export const MOON_SIDEREAL_PERIOD = 27.321661 * 86400; // s
export const MOON_ANGULAR_RATE = (2 * Math.PI) / MOON_SIDEREAL_PERIOD; // rad/s
export const C_LIGHT = 299792.458; // km/s

/** Earth's rotation rate (rad/s). */
export const EARTH_ROTATION_RATE = 7.2921159e-5;
/** Latitude of pad LC‑39B (degrees). */
export const LAUNCH_LATITUDE_DEG = 28.627;
/**
 * Longitude of pad LC‑39B (degrees, east positive): 80.621° W. Source: Wikipedia
 * ("Launch Complex 39B"), secondary. Only the 3D view uses it, to place the Earth
 * texture under the pad; the physics never does.
 */
export const LAUNCH_LONGITUDE_DEG = -80.621;
/**
 * Azimuth of the model's single plane at the pad (degrees from north). **Unverified
 * assumption:** due east. It only decides how the Earth texture is laid on the planar
 * model (which great circle through the pad the orbital plane is); the physics does not
 * use it. Artemis II's actual launch azimuth is not in the documents used.
 */
export const MODEL_PLANE_AZIMUTH_DEG = 90;
/**
 * Earth's rotation seen in the orbital plane. The model is planar: the ground and the
 * air at the launch site move east at Ω·R·cos(latitude) ≈ 0.408 km/s,
 * and that is the velocity the rocket already has at liftoff.
 */
export const EARTH_ROTATION_IN_PLANE = EARTH_ROTATION_RATE * Math.cos((LAUNCH_LATITUDE_DEG * Math.PI) / 180);

/**
 * Liftoff time and the Sun. [AV]: the 2026-04-01 window opened at 06:24 PM EDT (22:24 UTC),
 * "1.28 Hours Before Sunset" at the pad. [LDAY]: Artemis II lifted off at 06:35 PM EDT
 * (22:35 UTC), 11 minutes later. The model lifts off at the real time (MET 0 = 22:35 UTC) and
 * the Sun direction comes from this figure: sunset happens when Earth's rotation brings the
 * pad's vertical to 90° from the Sun.
 */
export const LIFTOFF_AFTER_WINDOW_OPEN = 11 * 60; // s
export const LAUNCH_BEFORE_SUNSET = 1.28 * 3600 - LIFTOFF_AFTER_WINDOW_OPEN; // s
/** Earth's mean motion around the Sun (sidereal year of 365.256 days): the Sun advances ~0.99°/day. */
export const EARTH_ORBIT_RATE = (2 * Math.PI) / (365.256 * 86400); // rad/s

/**
 * [JPL] Moon's orbit during the mission: Keplerian ellipse (two bodies, GM_EARTH + GM_MOON)
 * least-squares fitted to the geocentric vectors from JPL Horizons (Moon, code
 * 301, center 500@399), hourly from 2026-04-01 12:00 to 2026-04-12 12:00 UTC,
 * projected onto their mean plane. The fit was made with its time origin at the window
 * opening, 2026-04-01 22:24 UTC ([AV]); the model's MET 0 is the actual liftoff, 11 min
 * later ([LDAY]), so the apogee passage is 11 min earlier in MET.
 * Error against Horizons: < 400 km in distance between MET 3 d and 6 d (flyby), 1,860 km
 * at most (at liftoff) and < 811 km along the whole orbit.
 * The Moon passed apogee on 2026-04-07 (404,964 km): during the flyby it was ~5 %
 * farther than the mean distance, and that lengthens both transits. The apogee
 * direction does not come from here: it is set by the free-return lunar phase (`moonAngle0Deg`).
 */
export const MOON_ORBIT = {
  /** Semi-major axis (km). */
  a: 382778.4,
  e: 0.05777,
  /** MET of the apogee passage (s): 5.2027 d after the window opening. */
  apogeeMet: 5.2027 * 86400 - LIFTOFF_AFTER_WINDOW_OPEN,
} as const;

/** Radius of the lunar sphere of influence (Laplace): D·(GM_MOON/GM_EARTH)^(2/5). */
export const MOON_SOI = EARTH_MOON_DISTANCE * Math.pow(GM_MOON / GM_EARTH, 2 / 5);

// --- Imperial unit conversion (exact factors) ---
export const FT_TO_KM = 0.3048 / 1000;
export const MPH_TO_KMS = 0.44704 / 1000;
export const NM_TO_KM = 1.852;
export const MI_TO_KM = 1.609344;

// --- Launch pad ---
/**
 * Height of the rocket's support on the pad above the model's sea-level sphere (km): the
 * boosters' aft skirts rest on the vehicle support posts, on the Mobile Launcher deck. The
 * simulated position on the pad is that point.
 * - [ML1] Deck (level 0) 47 ft above the ground.
 * - [UMB] Vehicle support posts: 5 ft tall, four per booster, under the aft skirts.
 * - [LC50] Pad elevation: "Pad B sits seven feet higher (55 feet) above mean sea level" (the
 *   pad surface the Mobile Launcher stands on). Shuttle-era NASA fact sheets give the same 55 ft
 *   for the Pad B hardstand; no source says whether the rebuild for SLS changed it. A side photo
 *   of the pad (stage 0) shows its surface ~12–16 m above the surrounding ground, consistent.
 */
export const LAUNCH_DECK_HEIGHT = 47 * FT_TO_KM; // 14.33 m
export const SUPPORT_POST_HEIGHT = 5 * FT_TO_KM; // 1.52 m
export const PAD_ELEVATION = 55 * FT_TO_KM; // 16.76 m
export const LAUNCH_SITE_HEIGHT = PAD_ELEVATION + LAUNCH_DECK_HEIGHT + SUPPORT_POST_HEIGHT; // 32.61 m (107 ft)
/**
 * [ML1] Mobile Launcher 1 (km). A two-story base 25 ft tall, 165 ft long and 135 ft wide on six
 * 22 ft steel mounts (22 + 25 = 47 ft, the deck); a tower 40 ft square and ~345 ft tall with a
 * floor every 20 ft, ~400 ft above the ground in all; an exhaust opening of 34 × 64 ft in the deck.
 * On the pad the base's long side runs north-south: its six mounts span 40.3 m east-west and
 * 48.9 m north-south (ML_MOUNTS). The opening's long side goes along the boosters' line, east-west
 * (the photos in `ROCKET_ON_ML`).
 */
export const ML1 = {
  baseLength: 165 * FT_TO_KM,
  baseWidth: 135 * FT_TO_KM,
  baseHeight: 25 * FT_TO_KM,
  mountHeight: 22 * FT_TO_KM,
  towerSide: 40 * FT_TO_KM,
  towerHeight: 345 * FT_TO_KM,
  floorSpacing: 20 * FT_TO_KM,
  totalHeight: 400 * FT_TO_KM,
  openingLength: 64 * FT_TO_KM,
  openingWidth: 34 * FT_TO_KM,
} as const;
/** [UMB] Tail service mast umbilicals: about 33 ft tall above the deck. */
export const TSMU_HEIGHT = 33 * FT_TO_KM;
/**
 * [39B] North side of the flame trench, where the new deflector sends the whole plume: ~571 ft
 * long, 58 ft wide and 42 ft high. The same fact sheet's "Fun Facts" give a 450 ft trench; the
 * detailed figure is used.
 */
export const FLAME_TRENCH = { length: 571 * FT_TO_KM, width: 58 * FT_TO_KM, depth: 42 * FT_TO_KM } as const;
/** [39B] Three lightning masts of 600 ft. [OSM]: each is a 146.4 m lattice tower with the mast on top. */
export const LIGHTNING_MAST_HEIGHT = 600 * FT_TO_KM;
export const LIGHTNING_TOWER_HEIGHT = 0.1464;

/**
 * [OSM] Positions around LC‑39B from OpenStreetMap (ODbL; Overpass API, data of 2026-11-22; launch
 * plan, §2), in km east and north of the center of the Mobile Launcher's six mounts
 * (`man_made=mast` + `tower:type=portal`, 28.6272154° N, 80.6208577° W), with 110,830 m per degree
 * of latitude and 97,787 m per degree of longitude. Credit in the app's Credits.
 */
const osm = (eastM: number, northM: number): { readonly east: number; readonly north: number } => ({ east: eastM / 1000, north: northM / 1000 });
/** The six mounts the Mobile Launcher stands on: 40.3 m apart east-west, in pairs 26, 4 and 22 m north/south of the center. */
export const ML_MOUNTS = [osm(-20.15, 26), osm(20.15, 26), osm(-20.15, -4), osm(20.15, -4), osm(-20.15, -22), osm(20.15, -22)] as const;
export const LIGHTNING_MASTS = [osm(-102.9, -118.3), osm(125.1, 38.3), osm(-144.0, 66.9)] as const;
/**
 * The water tower: [OSM] 80.5 m tall (`height`) with a 2.4 m column (`diameter`); its description
 * gives an 88 m tower. [39B]: ~400,000 gallons. The tank's shape is measured in `launch-1.jpg`
 * (stage 3; ~12.8 m wide and ~8.8 m tall, scaled with the core stage): about 1,400 m³, consistent.
 */
export const WATER_TOWER = { ...osm(101.7, 114.5), tankTop: 0.0805, top: 0.088, column: 0.0024, tankDiameter: 0.0128, tankHeight: 0.0088 } as const;
/** Spherical tanks: [OSM] positions and footprint diameters (the largest is probably the new LH2 tank of [39B]). */
export const CRYO_TANKS = [
  { ...osm(372.9, 227.7), diameter: 0.0222 }, // LH2 (way 153128950)
  { ...osm(236.7, 319.4), diameter: 0.0247 }, // LH2 (way 901620453)
  { ...osm(-398.5, 244.6), diameter: 0.0222 }, // LOX (way 153128951)
] as const;
/**
 * Where the rocket stands on the Mobile Launcher (km from the mounts' center). Measured in stage 3
 * on NASA photos of the pad (`docs/reference/launch/`): fitting the heading of the launch photo taken
 * from the south-southwest (`launch-1.jpg`: two masts, the water tower and the rocket, 3 px residual)
 * and of the side photo from the west (`ML-1-image-2.jpg`) against the OSM positions puts the core
 * stage's axis 7–8 m south of the center and centered east-west within ~1 m. The side photo agrees:
 * there the base reaches 15.0 m south and 34.8 m north of the axis. The same photos show the tower
 * north of the rocket (the side it is drawn on, `ML_TOWER_FACE`) and the boosters east and west of it.
 * The simulated launch point is this axis; the model's LC‑39B coordinates (Wikipedia) fall 27.6 m
 * from the mounts' center and only place Earth's texture.
 */
export const ROCKET_ON_ML = osm(0, -7.5);
/**
 * Distance from the rocket's axis to the face of the Mobile Launcher tower that looks at it (km):
 * 14.7 m, measured in the side photo (`ML-1-image-2.jpg`, stage 0, launch plan §2).
 */
export const ML_TOWER_FACE = 0.0147;

/**
 * Shape of the elevated pad as the 3D view draws it (km), around the simulated launch point.
 * **Unverified assumption**: a flat top at PAD_ELEVATION and a smooth slope down to the surrounding
 * ground, which is taken at mean sea level (the model's sphere; the stage-0 photo shows the pad
 * surface ~12–16 m above the grass, consistent). The top is every point within PAD_TOP_RADIUS of a
 * north-south segment through the launch point, from PAD_TOP_SOUTH south of it to PAD_TOP_NORTH north
 * of it (a stadium), and the slope is PAD_SLOPE_RUN long. Until stage 3 it was a circle (the segment
 * was a point): it holds the Mobile Launcher base (its farthest corner is 40 m away), but the flame
 * trench ([39B]: 174 m on the north side, 12.8 m deep) would have opened out of it at 94 m.
 * - PAD_TOP_NORTH is derived: the trench floor meets the slope 174 m north of the rocket.
 * - PAD_TOP_SOUTH: the photo from the east (`ML1-image-3.jpg`) shows the flat top edge across the
 *   whole frame, at least ~100 m south of the rocket (qualitative).
 * - The slope still ends before the lightning masts (≥ 125 m from the segment) and at the foot of
 *   the water tower (OSM; launch plan, §2).
 * No source gives the outline of the hardstand: the crawlerway ramp is not drawn, and the ground
 * layout is generic (D6). The physics does not use these values.
 */
export const PAD_TOP_RADIUS = 0.06; // km
export const PAD_SLOPE_RUN = 0.05; // km
export const PAD_TOP_SOUTH = 0.04; // km
export const PAD_TOP_NORTH =
  FLAME_TRENCH.length -
  PAD_TOP_RADIUS -
  (PAD_SLOPE_RUN * Math.acos((2 * (PAD_ELEVATION - FLAME_TRENCH.depth)) / PAD_ELEVATION - 1)) / Math.PI; // ≈ 0.080 km

/**
 * [CRW] NASA, "Countdown! NASA Launch Vehicles and Facilities", Information Summaries
 * IS‑2003‑09‑006‑KSC (2003), primary: "The Crawlerway is a 130-foot-wide (39.6-meter) roadway ... The
 * Crawlerway consists of two 40-foot- (12-meter-) wide lanes, separated by a 50-foot- (15-meter-) wide
 * median strip"; its top layer is river gravel; "The ramp leading up to the pad surface is inclined at a
 * 5 percent grade". It gives Pad B's 55 ft too, like [LC50]. The SLS uses the same crawlerway. Only the 3D
 * ground draws it (render/padLayout.ts); the ramp is not in the relief.
 */
export const CRAWLERWAY = { lane: 40 * FT_TO_KM, median: 50 * FT_TO_KM, total: 130 * FT_TO_KM, rampGrade: 0.05 } as const;

/**
 * The Atlantic shoreline east of LC‑39B, measured on NASA's Earth texture (`earth-day-pad`, the Blue
 * Marble patch of ASSETS.md: 1.63 km per pixel east-west, 1.85 km north-south): in each row of pixels from
 * 9 km north to 7.6 km south of the pad, where a water index (blue minus red, scaled between the land west
 * of the pad and the open sea) crosses one half; then a least-squares parabola through those ten points
 * (0.17 km rms). East (km) = a + b·north + c·north², north in km from the launch site. The WebP and JPG
 * files differ by up to 1.2 km at the pad's row: good to about ±1 km. It puts the beach ~1.9 km
 * east-northeast of the pad. Only the 3D ground draws it (render/padLayout.ts).
 */
export const COASTLINE = { a: 2.1758, b: -0.5713, c: -0.0072 } as const;

const hms = (h: number, m: number, s: number): number => h * 3600 + m * 60 + s;
const dhms = (d: number, h: number, m: number, s: number): number => d * 86400 + hms(h, m, s);

// --- Ascent data from [ASC] and the [SLS] event table (converted once, here) ---
export interface AscentPoint {
  readonly label: string;
  readonly met: number; // s
  /** Velocity relative to the rotating Earth (km/s). */
  readonly speed: number;
  readonly altitude: number; // km
}
export const ASCENT_TABLE: readonly AscentPoint[] = [
  { label: 'Lanzamiento', met: 0, speed: 0, altitude: 0 },
  { label: 'Torre despejada', met: hms(0, 0, 7), speed: 70 * MPH_TO_KMS, altitude: 468 * FT_TO_KM },
  { label: 'Mach 1', met: hms(0, 0, 55), speed: 710 * MPH_TO_KMS, altitude: 25745 * FT_TO_KM },
  { label: 'Max Q', met: hms(0, 1, 11), speed: 1041 * MPH_TO_KMS, altitude: 43795 * FT_TO_KM },
  { label: 'RS‑25 al 85 %', met: hms(0, 2, 4), speed: 2989 * MPH_TO_KMS, altitude: 139757 * FT_TO_KM },
  { label: 'Separación de SRB', met: hms(0, 2, 8), speed: 3006 * MPH_TO_KMS, altitude: 148384 * FT_TO_KM },
  { label: 'Eyección del LAS', met: hms(0, 3, 28), speed: 4487 * MPH_TO_KMS, altitude: 286146 * FT_TO_KM },
  { label: 'Aceleración máxima', met: hms(0, 7, 1), speed: 13207 * MPH_TO_KMS, altitude: 431633 * FT_TO_KM },
  { label: 'RS‑25 al 67 %', met: hms(0, 8, 1), speed: 17261 * MPH_TO_KMS, altitude: 502630 * FT_TO_KM },
  { label: 'MECO', met: hms(0, 8, 6), speed: 17599 * MPH_TO_KMS, altitude: 511884 * FT_TO_KM },
  { label: 'Separación etapa central/ICPS', met: hms(0, 8, 18), speed: 17627 * MPH_TO_KMS, altitude: 534564 * FT_TO_KM },
];

/**
 * Earth-orbit checkpoints from the [SLS] event table. Here the published velocity
 * is inertial (in orbit NASA's tables stop subtracting Earth's rotation).
 */
export const ORBIT_TABLE: readonly AscentPoint[] = [
  { label: 'Elevación del perigeo (ICPS)', met: hms(0, 49, 52), speed: 14145 * MPH_TO_KMS, altitude: 7181309 * FT_TO_KM },
  { label: 'Elevación del apogeo (ICPS)', met: hms(1, 46, 37), speed: 18510 * MPH_TO_KMS, altitude: 701589 * FT_TO_KM },
  { label: 'Separación ICPS/Orion', met: hms(3, 22, 46), speed: 9598 * MPH_TO_KMS, altitude: 72546507 * FT_TO_KM },
  { label: 'Inicio demo de proximidad', met: hms(3, 23, 36), speed: 9552 * MPH_TO_KMS, altitude: 73128169 * FT_TO_KM },
  { label: 'Fin demo de proximidad', met: hms(4, 53, 36), speed: 6460 * MPH_TO_KMS, altitude: 125055993 * FT_TO_KM },
  { label: 'Eliminación del ICPS', met: hms(5, 0, 33), speed: 6305 * MPH_TO_KMS, altitude: 128352996 * FT_TO_KM },
  { label: 'Liberación de CubeSats', met: hms(5, 20, 23), speed: 5896 * MPH_TO_KMS, altitude: 137337463 * FT_TO_KM },
];

// --- Event METs ([SLS] event table; E4 and E6 match [ASC]) ---
export const MET_MECO = hms(0, 8, 6);
export const MET_CORE_SEPARATION = hms(0, 8, 18); // E3
export const MET_E4_PERIGEE_RAISE = hms(0, 49, 52);
/** [SLS] table: 01:46:37 ([ASC] gives 01:48:48 and the [TL] timeline 0/01:47; the table, the most detailed, is used). */
export const MET_E5_APOGEE_RAISE = hms(1, 46, 37);
/** [SLS] Orion/ICPS separation 03:22:46 and proximity demo until Orion's departure burn at 04:53:15. */
export const MET_E6_PROX_OPS_START = hms(3, 22, 46);
export const MET_E6_PROX_OPS_END = hms(4, 53, 15);
/** [SLS] Orion departure burn (E7): two minutes. The text says "the service module engine"; the demo diagram labels it "AUX DEPARTURE". The auxiliaries are used. */
export const MET_E7_DEPARTURE = hms(4, 53, 15);
export const E7_BURN_DURATION = 120; // s
/** [SLS] ICPS disposal burn and CubeSat release (payload table, in deployment order). */
export const MET_ICPS_DISPOSAL = hms(5, 0, 33);
export const CUBESAT_DEPLOYMENTS: readonly { readonly name: string; readonly met: number }[] = [
  { name: 'ATENEA (CONAE)', met: hms(5, 29, 10) },
  { name: 'Space Weather CubeSat‑1 (SSA)', met: hms(5, 31, 10) },
  { name: 'TACHELES (DLR)', met: hms(5, 32, 10) },
  { name: 'K‑Rad Cube (KASA)', met: hms(5, 33, 10) },
];
/** [SLS] ICPS splashdown in the Pacific: 25:23:01 (check value). */
export const MET_ICPS_SPLASHDOWN = hms(25, 23, 1);

/**
 * ASSUMPTION: Δv of the ICPS disposal burn (retrograde, m/s). The guide does not give
 * the value; the perigee is already at zero altitude after E5, so it only adjusts the
 * reentry point.
 */
export const ICPS_DISPOSAL_DV = 5; // m/s
/** ASSUMPTION: deployment speed of each CubeSat from the dispenser (m/s). */
export const CUBESAT_DEPLOY_SPEED = 1.5;

// --- Published orbits ([SLS] "Artemis II by the Numbers", in nautical miles) ---
export interface PublishedOrbit {
  readonly perigee: number; // km of altitude
  readonly apogee: number;
}
/** Insertion orbit: 15 × 1,200 NM. Check value (it comes out of the ascent), not a target. */
export const INSERTION_ORBIT: PublishedOrbit = { perigee: 15 * NM_TO_KM, apogee: 1200 * NM_TO_KM };
/** After the ICPS perigee raise (E4): 100 × 1,200 NM. Target of E4: the perigee. */
export const POST_PRM_ORBIT: PublishedOrbit = { perigee: 100 * NM_TO_KM, apogee: 1200 * NM_TO_KM };
/**
 * After the apogee raise (E5): 0 × 40,000 NM. Target of E5: the perigee (at zero it
 * leaves the ICPS reentering on its own). The apogee is a check value, not a target: with 40,000 NM the
 * period is ~25.1 h and the TLI would fall 1 h 45 min after the [TL] timeline. E5 is
 * tuned so that the TLI ignites at the published MET (see `PUBLISHED_MET.tli`).
 */
export const POST_ARB_ORBIT: PublishedOrbit = { perigee: 0, apogee: 40000 * NM_TO_KM };
/** High orbit after Orion's perigee raise (E8): 100 × 40,000 NM. Target of E8: the perigee (the apogee is a check value). */
export const HEO_ORBIT: PublishedOrbit = { perigee: 100 * NM_TO_KM, apogee: 40000 * NM_TO_KM };

/** Published altitudes at MECO and at core stage separation: targets of the ascent guidance. */
export const MECO_ALTITUDE = 511884 * FT_TO_KM; // 156.02 km
export const INSERTION_ALTITUDE = 534564 * FT_TO_KM; // 162.94 km
/**
 * Published velocity at core stage separation: 17,627 mph. It is relative to the
 * rotating Earth, not inertial: the ascent simulated with the real rocket data reproduces
 * it that way, and as an inertial velocity it would be incompatible with the published times.
 */
export const INSERTION_SPEED_REL = 17627 * MPH_TO_KMS; // 7.880 km/s
/** The TLI is centered on perigee: ignition is this long before it (≈ half the burn duration). */
export const TLI_HALF_BURN = 185; // s

// --- Published timeline [TL] (check values: the model computes its own from physics) ---
export const PUBLISHED_MET = {
  /** Orion perigee raise (E8), "~0/13:30". */
  prb: dhms(0, 13, 30, 0),
  /**
   * TLI ignition. It is a calibration target: the apogee of the high orbit (E5) is
   * tuned so that the next perigee falls TLI_HALF_BURN later. The timeline
   * implies half an orbit of ~11 h 41 min between the perigee raise and the TLI, i.e. a
   * period of ~23.4 h and an apogee of ~70,100 km (37,850 NM), not the 40,000 NM of [SLS]
   * (25.1 h). The timeline is followed because it is the most recent document and the one that sets
   * the times; the [SLS] 40,000 NM remain as a check value.
   */
  tli: dhms(1, 1, 8, 42),
  otc1: dhms(2, 1, 8, 42),
  otc2: dhms(3, 1, 8, 42),
  otc3: dhms(4, 4, 29, 52),
  soiEntry: dhms(4, 6, 38, 0),
  flyby: dhms(5, 0, 29, 59),
  maxEarthDistance: dhms(5, 0, 35, 0),
  soiExit: dhms(5, 18, 53, 0),
  rtc1: dhms(6, 1, 29, 52),
  rtc2: dhms(8, 4, 29, 10),
  rtc3: dhms(8, 20, 29, 10),
  cmSep: dhms(9, 1, 9, 0),
  ei: dhms(9, 1, 29, 0),
  splashdown: dhms(9, 1, 42, 48),
} as const;
/** Apollo 13's distance-from-Earth record (km), which [TL] marks as surpassed before the flyby. NASA figure. */
export const APOLLO_13_RECORD_DISTANCE = 400171;

// --- Mission ---
/** Entry interface: 400,000 ft. */
export const EI_ALTITUDE = 400000 * FT_TO_KM; // 121.92 km
/** Mean lunar flyby altitude (NASA's Artemis II mission map). [A2] says "~4,700 miles"; the map value is kept. */
export const FLYBY_ALTITUDE_TARGET = 6513; // km

/**
 * Entry corridor: inertial flight-path angle at EI (degrees, negative = descending).
 * Target: −5.66°, the value flown by Artemis I at 400,000 ft (NASA, AAS 24‑174,
 * "Orion Artemis I Entry Performance"). There is no equivalent public figure for Artemis II.
 * The ±1° width is an assumption: UNVERIFIED.
 */
export const ENTRY_CORRIDOR = { min: -6.66, target: -5.66, max: -4.66 } as const;

/**
 * NSN/DSN boundary by altitude. NASA's Artemis II network map is schematic and does not give the value, but it shows NSN
 * at the TLI (near perigee) and DSN in the high orbit: the boundary lies within that
 * orbit. Geostationary altitude is used, where the Near Space Network relay satellites
 * orbit; above it, Deep Space Network takes over.
 */
export const NSN_MAX_ALTITUDE = 35786; // km

/** CAUTION threshold for low propellant in the service module (remaining fraction). */
export const DV_LOW_FRACTION = 0.1;

/** Beyond this distance from Earth the spacecraft is considered lost. */
export const LOST_DISTANCE = 1.5e6; // km

// --- Operation ---
/** Lead time of the auto-pause before a crew burn. */
export const BURN_LEAD_TIME = 120; // s
/** Tolerance after TIG before declaring the window missed. */
export const BURN_WINDOW_TOLERANCE = 300; // s
/** [TL] CM/SM separation happens 20 min before entry interface (9/01:09 → 9/01:29). */
export const CM_SEP_LEAD_TIME = PUBLISHED_MET.ei - PUBLISHED_MET.cmSep; // 1,200 s
/** Lead time with which the separation is requested from the crew (and the procedure opens). */
export const CM_SEP_PROMPT_LEAD_TIME = 2 * CM_SEP_LEAD_TIME;
export const WARP_LEVELS = [1, 10, 100, 1000, 10000] as const;

// --- Attitude (ASSUMPTIONS: I could not find Orion's real maneuver rates) ---
/** Rate at which the autopilot reorients the spacecraft (rad/s). */
export const ATTITUDE_SLEW_RATE = (3 * Math.PI) / 180;
/** Rotation rate commanded by the hand controller at full deflection (rad/s). */
export const RHC_RATE = (3 * Math.PI) / 180;
/** Acceptable attitude error to consider the spacecraft aligned (rad). */
export const ATTITUDE_TOLERANCE = (2 * Math.PI) / 180;
