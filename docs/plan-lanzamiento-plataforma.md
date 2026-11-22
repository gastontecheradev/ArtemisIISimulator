# Plan: lanzamiento desde la plataforma

**Pedido (Gastón, sesión 40):** planificar el lanzamiento del cohete desde la base, con el modelo 3D de la plataforma, las animaciones de la nave y de la base, el humo, la información y los controles del panel, el tutorial y los demás lugares que toca la funcionalidad. También evaluar cómo mejorar la textura del terreno cercano.
**Fecha:** 2026-11-21. **Estado:** etapa 1 (cuenta final) hecha en la sesión 41; lo que cambió al implementarla está en la decisión 45 de `process.md`. Etapa 0 completa en la sesión 42 (imágenes, elevación, brazos de la torre medidos y posiciones en el suelo de OpenStreetMap, ver §2). Etapa 2 (suelo y cámara PLATAFORMA) hecha en la sesión 43; lo que cambió respecto de §4.2 y §4.6 está en la decisión 47 de `process.md`. Decisiones D1–D9 tomadas: Gastón aceptó todas las recomendaciones (sesión 40).
**Cómo se armó:** se leyó el código (`sim/state.ts`, `sim/advance.ts`, `sim/capcom.ts`, `render/scene.ts`, `render/bodies.ts`, `render/earthDetail.ts`, `render/vehicle.ts`, `render/wake.ts`, `ui/tutorial/steps.tsx`, `ui/panel/pages/index.ts`). Se muestreó la textura `earth-day-pad` en LC‑39B y se leyeron la hoja de datos del Mobile Launcher 1 de NASA y la página de NASA con la cuenta final de Artemis II. No hay capturas, porque esta copia del proyecto no tiene `node_modules` (falta correr `npm install`).

Lo que se lee directo de una fuente va sin marca. Lo que es interpretación va marcado *(interpretación)* y lo que es elección de dibujo, *(elección de dibujo)*.

## 1. De dónde se parte

| Tema | Hoy | Consecuencia |
|---|---|---|
| Cuenta regresiva | Arranca en T‑6 s con los RS‑25 encendidos (`INITIAL_MET`, `RS25_START_BEFORE_LIFTOFF = 6`, que es un supuesto). `holdDown` sujeta la nave a la plataforma hasta T‑0. | Extenderla a T‑10 min sale barato, porque `holdDown` ya sirve para cualquier t < 0. |
| Plataforma | No existe. El cohete se apoya con las toberas sobre la esfera de la Tierra, a radio R_EARTH (`anchorBase` en `scene.ts`). | Hace falta un piso: la cubierta del ML está a 14,33 m del suelo. |
| Forma de la Tierra | `SphereGeometry(1, 192, 96)`, con facetas de 1,875° (~209 km). La plataforma cae en un vértice. | **Desde ese vértice cada faceta baja 0,94°, así que el suelo cae 1,6 m a 100 m y 16 m a 1 km.** La plataforma quedaría en la punta de una pirámide baja: las esquinas de la base del ML quedarían ~0,5 m en el aire y una torre a 200 m, ~3 m. La esfera real baja 0,08 m en 1 km. |
| Precisión | La Tierra es una esfera unitaria escalada a 6,378 unidades. En float32 su superficie se ubica con un error de ~0,5 m cerca de la nave. | El suelo detallado no puede ser la esfera: necesita una malla propia con origen flotante, como la nave. |
| Textura cercana | Global de 4K (~10 km/px) más un parche de 4.080 × 2.040 (1,86 km/px). | El píxel de LC‑39B es `#2c4542`, una mezcla de tierra y mar: en la textura, el cohete está sobre la costa. La zona de 76 × 76 km alrededor es una mancha verde y azul. |
| Cámaras 3D | Todas tienen +z (la normal al plano orbital) hacia arriba. Con NAVE en la plataforma el cohete se ve acostado. En la sesión 31 se probó poner la vertical local arriba y se revirtió. | La vista desde el suelo necesita la vertical local arriba, así que tiene que ser una cámara nueva, sin tocar NAVE. |
| Humo | `render/wake.ts`: una columna desde T‑6 s, a escala real, que gira con el aire. | La columna se queda. Faltan la nube del foso de llamas, el agua y el vapor de antes del despegue. |
| Panel | No hay página de la cuenta. La barra de estado muestra el MET negativo y la cuenta hasta E1. Procs muestra E6 durante el ascenso (problema abierto). | Una página nueva para la cuenta y un procedimiento de lanzamiento, que resuelve el problema abierto. |
| Houston | `engineStart` en `INITIAL_MET` y `liftoff` en T+7 s. | Faltan los mensajes de la cuenta final. |
| Tutorial | El paso "DESPEGUE" pide PLAY y dice que los RS‑25 encienden 6 s antes. | Pasos nuevos para la plataforma y la cuenta. |

## 2. Datos y fuentes

### Conseguidos en esta sesión

**[ML1]** NASA, hoja de datos "Mobile Launcher 1", FS‑2024‑11‑997‑KSC (`nasa.gov/wp-content/uploads/2021/04/final_-_mobile_launcher_1_fact_sheet.pdf`). Es fuente primaria.

| Dato | Valor publicado | SI |
|---|---|---|
| Altura total sobre el suelo | ~400 ft | ~121,9 m |
| Base de dos pisos | 25 ft de alto, 165 ft de largo, 135 ft de ancho | 7,62 × 50,3 × 41,1 m |
| Apoyos | seis montantes de acero de 22 ft | 6,71 m |
| Cubierta (nivel 0) sobre el suelo | 47 ft | 14,33 m |
| Apoyo del cohete | 8 postes (Vehicle Support Posts), cuatro por booster, bajo el faldón trasero | — |
| Torre | 40 ft de lado, ~345 ft de alto | 12,19 m; 105,2 m |
| Pisos de la torre | uno cada 20 ft | 6,10 m |
| Abertura de escape de la cubierta | 34 × 64 ft (se amplió desde 22 × 22 ft) | 10,4 × 19,5 m |
| Peso | ~11,5 millones de lb | ~5.200 t |
| Evacuación | canastas sobre cables, como telesillas, hasta el perímetro de la plataforma | — |

Hay una contradicción: otros textos de NASA hablan de una torre "de 380 ft". Con los datos de la hoja la suma cierra (345 ft de torre + 47 ft de cubierta ≈ 392 ft ≈ "~400 ft sobre el suelo"), así que se usa la hoja.

**[UMB]** NASA, hoja de datos "Mobile Launcher Tower Umbilicals and Accessories", FS‑2021‑08‑727‑KSC (`nasa.gov/sites/default/files/atoms/files/fs-2018-02-250-ksc-ml_umbilical_fact_sheet.pdf`). Es fuente primaria.

| Pieza | Dónde | Qué hace en el lanzamiento |
|---|---|---|
| Umbilicales eléctricos del faldón trasero (2) | borde exterior inferior de cada booster | quedan conectados hasta el despegue; llevan la señal al sistema que da la orden de liberación |
| Umbilicales de purga del faldón trasero (2) | ídem | quedan conectados hasta el despegue |
| Mástiles de servicio de cola, TSMU (2) | sobre la cubierta, ~33 ft (10,1 m) de alto, a la sección de motores de la etapa central | se inclinan hacia atrás antes del lanzamiento y se retraen al despegar |
| Umbilical del entretanque, CSITU | nivel de 140 ft (42,7 m) | brazo giratorio que ventea el hidrógeno evaporado; se aparta al despegar |
| Umbilical del faldón delantero, CSFSU | nivel de 180 ft (54,9 m), "sobre el tanque de oxígeno" | se aparta al despegar |
| Estabilizador del vehículo | nivel de 200 ft (61,0 m), contra la etapa central | baja y se aparta al despegar |
| Umbilical del ICPS | nivel de ~240 ft (73,2 m) | se aparta al despegar |
| Brazo de acceso, CAA | nivel de 274 ft (83,5 m), en la escotilla del CM | se retrae antes del lanzamiento (T‑8 min según [CNT]) |
| Umbilical del módulo de servicio de Orion, OSMU | nivel de 280 ft (85,3 m) | se inclina hacia atrás al despegar |
| Postes de apoyo (8) | sobre la cubierta, cuatro por booster; acero fundido, 5 ft (1,52 m) de alto, ~10.000 lb cada uno | sostienen el cohete hasta T‑0 |

**Comprobación con el modelo** *(interpretación)*: los niveles se cuentan desde la cubierta. Con el faldón trasero de los boosters (`ST.srbBase` = −80,45 m) sobre los postes de 1,52 m, cada nivel cae en la estación (nivel − 81,97 m) del modelo:

- **Coinciden:**
  - El CAA cae en +1,55 m, sobre el CM (0 a 3,35 m), a la altura de una escotilla lateral.
  - El ICPS cae en −8,8 m, sobre el ICPS (−6,2 a −19,9 m).
  - La punta de los TSMU cae en −71,9 m, donde empieza la sección de motores del modelo (−71,95 m).
  - El estabilizador cae en −21,0 m, arriba de la etapa central.
- **No coinciden:**
  - El OSMU cae en +3,4 m, arriba del CM, cuando el módulo de servicio está entre +0,25 y −4,55 m.
  - El CSFSU cae en −27,1 m, cuando el faldón delantero del modelo está entre −17,65 y −20,15 m.
  - El CSITU cae en −39,3 m, cuando el entretanque del modelo está entre −30,65 y −35,65 m.
  - Las diferencias van de 3 a 9 m. Puede ser el modelo (las estaciones del tanque de oxígeno y del entretanque se midieron en un dibujo) o la forma de los brazos. **Resuelto en la etapa 0** (sesión 42, "Medido en las imágenes de referencia"): en las fotos los brazos tocan las piezas del modelo; lo que no coincide son los niveles publicados del OSMU y del CSITU.
- Si los niveles se contaran desde el suelo, el CAA quedaría 14 m por debajo de la escotilla.

**[CNT]** NASA, "NASA Releases Artemis II Moon Mission Launch Countdown" (26/03/2026, `nasa.gov/general/nasa-releases-artemis-ii-moon-mission-launch-countdown/`). Es fuente primaria; los tiempos que da son "aproximados". La cuenta final:

| T‑ | Hito |
|---|---|
| L‑40 min | espera programada de 30 min |
| L‑17 min | el director de lanzamiento pide el "go" |
| L‑15 min | la tripulación baja los visores |
| T‑10 min | el GLS (Ground Launch Sequencer) inicia la cuenta final |
| T‑8 min | se retrae el brazo de acceso de la tripulación |
| T‑6 min | presurización de los tanques de la etapa central; pirotecnia de ascenso de Orion armada; Orion a energía interna |
| T‑5 min 57 s | termina el rellenado de LH2 de la etapa central |
| T‑5 min 20 s | el sistema de escape (LAS) queda disponible |
| T‑4 min 40 s | purga de alto caudal del LH2 |
| T‑4 min 30 s | sistema de terminación de vuelo armado |
| T‑4 min | arranca la APU de la etapa central; termina el rellenado de LOX de la etapa central |
| T‑3 min 30 s | termina el rellenado de LOX del ICPS |
| T‑3 min 10 s | secuencia de purga 4 |
| T‑2 min 02 s | ICPS a batería interna |
| T‑2 min | boosters a batería interna |
| T‑1 min 30 s | etapa central a energía interna |
| T‑1 min 20 s | ICPS en modo de cuenta final |
| T‑50 s | termina el rellenado de LH2 del ICPS |
| T‑33 s | el GLS da "go" al secuenciador automático (ALS) |
| T‑30 s | la computadora de la etapa central pasa al ALS |
| T‑12 s | se encienden los encendedores de quemado de hidrógeno (ROFI) |
| T‑10 s | orden de arranque de los motores |
| **T‑6,36 s** | **arranque de los RS‑25** (hoy el modelo usa 6 s, que es un supuesto) |
| T‑0 | ignición de los boosters, separación de los umbilicales y despegue |

Reglas de las esperas:

- En T‑6 min se puede esperar lo que dure la ventana menos 6 min.
- Entre T‑6 min y T‑1 min 30 s, hasta 3 min; si es más, la cuenta vuelve a T‑10.
- Después de T‑1 min 30 s y antes del ALS, vuelve a T‑10 si queda ventana.
- Después del ALS, cualquier corte suspende el intento del día.

**[39B]** NASA, hoja de datos "Launch Complex 39B", FS‑2021‑08‑726‑KSC (`nasa.gov/wp-content/uploads/2018/06/launchpad39b_factsheet_013018_508.pdf`), y la página "Launch Complex 39B" (`nasa.gov/reference/launch-complex-39b/`), que repite los mismos datos. Son fuentes primarias.

- **Foso de llamas:** la llama del despegue se desvía **hacia el lado norte** del foso, por un deflector nuevo (~150 placas de acero de hasta 4.000 lb). El lado sur queda de hormigón. El lado norte mide ~571 ft de largo, 58 ft de ancho y 42 ft de alto (174 × 17,7 × 12,8 m). Contradicción: en los "Fun Facts" de la misma hoja el foso mide 450 ft. Se usan los 571 ft del lado norte, que es el dato detallado.
- **Pararrayos:** tres mástiles de 600 ft (182,9 m) con cables aéreos, alrededor del perímetro de la plataforma. La hoja no da las posiciones.
- **Agua (IOP/SS):** la torre guarda ~400.000 galones (1.514 m³), que caen sobre el ML y dentro del foso en menos de 30 s, con un caudal máximo de 1,1 millones de galones por minuto (69 m³/s).
- **Cuándo empieza el agua:** "unos 20 segundos antes de T‑0". Es una cita del artículo de NASA "Pad 39B Water Flow Test Comes Through Loud and Clear", según el resultado de la búsqueda; la página no se leyó entera.
- **Hidrógeno:** un tanque nuevo de ~1,25 millones de galones utilizables. La hoja no dice de qué lado de la plataforma está, ni da la capacidad ni la ubicación del tanque de oxígeno.

**[LDAY]** NASA, "Live Artemis II Launch Day Updates" (01/04/2026, `nasa.gov/blogs/missions/2026/04/01/live-artemis-ii-launch-day-updates`), con horas del Este de EE. UU.:

- **El despegue fue a las 18:35 EDT (22:35 UTC).** La cuenta entró en T‑10 min a las 18:25, después de extender la espera de T‑10 (anuncio de las 18:19). El poll fue un "go" unánime a las 18:22.
- El modelo usa la apertura de la ventana, a las 22:24 UTC ([AV], `LAUNCH_BEFORE_SUNSET` = 1,28 h). Con la hora real, el despegue queda a 1,28 h − 11 min ≈ 1,10 h de la puesta del Sol. Lo único que cambia es la luz (ver D9).
- Separación de los boosters a las 18:37 y MECO con separación a las 18:43, coherentes con 2:08 y 8:18 después de las 18:35.

### Medido en las imágenes de referencia (etapa 0, sesión 42)

Gastón dejó nueve imágenes en `docs/reference/launch/` (fuera de git, como el resto de `docs/reference/`). Se miraron todas; para medir se usaron solo las fotos de NASA.

| Archivo | Qué es | Origen |
|---|---|---|
| `LC‑39B-cenital-1.jpg`, `-2`, `-3` (ya no están) | Vistas satelitales del Cabo, de la plataforma y del complejo | Capturas de Google Maps ("© 2026 Google"). Gastón las sacó al decidir usar una foto aérea de NASA |
| `39-B.jpg` | Vista de mapa del complejo (544 × 448) | Sin metadatos. No es de Google Maps (lo aclaró Gastón); origen y licencia por confirmar |
| `39B-Draw.jpg` | Ilustración del despegue en LC‑39B (1.010 × 526) | Sin metadatos; autor desconocido |
| `39-B-2.jpg` | Plano tipo "blueprint" de LC‑39B con logo de NASA (1.408 × 768) | Sin metadatos. **No se usa**: contradice a las fuentes primarias y a las fotos (4 pararrayos en vez de 3, 2 torres de agua en vez de 1, foso de 137 m en vez de 174 m, tanque de LH2 de 850.000 galones en vez de ~1,25 millones) y tiene rótulos deformados ("9θm", "(3x 1β3m)") y cotas contradictorias, marcas típicas de una imagen generada por IA |
| `ML-1-image-1.jpg` | El SLS en la plataforma visto desde lo alto de un pararrayos, con el océano al fondo | Sin metadatos; parece de NASA |
| `ML-1-image-2.jpg` | El SLS de Artemis II (logo de la misión en el booster) al amanecer, de costado y con teleobjetivo: casi sin perspectiva | Sin metadatos; parece de NASA |
| `ML1-image-3.jpg` | El SLS en la plataforma desde el pasto, con el talud y una boca del foso | Sin metadatos; parece de NASA |
| `launch-1.jpg` | Despegue de Artemis II, 01/04/2026, 800 mm | NASA/Joel Kowsky (EXIF) |
| `launch-2.jpg` | Artemis II ya sobre las torres, con la nube del suelo | NASA/Keegan Barber (EXIF) |
| `launch-3.jpg` | Exposición larga del ascenso: el trazo se curva y el viento deforma la estela | Sin metadatos |

**Elevación de la plataforma** ([LC50]): *"Pad B sits seven feet higher (55 feet) above mean sea level"* (NASA, 50.º aniversario de LC‑39B, 2017). Las hojas de LC‑39 de la época del transbordador dan los mismos 55 ft para la explanada del Pad B; ninguna fuente dice si la reconstrucción para el SLS la cambió. En `ML1-image-3` la superficie de la plataforma queda ~12–16 m sobre el pasto (la perspectiva no deja afinar más), coherente con 16,76 m sobre el mar. Pasa a `PAD_ELEVATION`: el apoyo del cohete queda a 32,61 m (107 ft) sobre la esfera.

**Escala de `ML-1-image-2`:** 9,88 px/m, sacada de tres estaciones del modelo del cohete (punta del LAS, punta de los boosters y base del faldón trasero: 9,86 y 9,90 px/m entre pares). Controles con datos publicados: la cubierta del ML cae en la estación −82,1 m (−81,97 m por [ML1] y [UMB]), los postes miden 1,6 m (1,52 m) y el mástil de cola (TSMU) 10,0 m sobre la cubierta (~10,1 m). `ML1-image-3`, tomada desde el suelo, tiene un 7 % de diferencia de escala entre arriba y abajo: se usó solo para comparar.

**Dónde tocan el cohete los brazos de la torre** (estaciones del modelo, en metros; ±0,5 m):

| Brazo | En la foto | Nivel de [UMB] contado desde la cubierta | Pieza del modelo |
|---|---|---|---|
| Acceso de la tripulación (CAA) | sala blanca de +1,1 a +4,1 | 274 ft → +1,55 | CM (0 a +3,35): coincide |
| Módulo de servicio de Orion (OSMU) | de +1,1 a −1,3, mangueras en ~0; **debajo** del CAA en las dos fotos | 280 ft → +3,4 (sobre el CAA) | arriba del SM (+0,25 a −4,55): coincide con la pieza, no con el nivel publicado |
| ICPS | estructura de −3,7 a −13,8; mangueras de −6,3 a −12,6 | 240 ft → −8,8 | ICPS: coincide |
| El que llega al faldón delantero | de −17,4 a −20,4; toca en −20,0 (−17,3 a −20,0 en la otra foto) | estabilizador, 200 ft → −21,0 | faldón delantero (−17,65 a −20,15): coincide |
| Brazo corto en −27,3 que **no llega** al cohete en ninguna de las dos fotos | — | CSFSU, 180 ft → −27,1 | — |
| Entretanque (CSITU) | de −34,7 a −37,2; toca en −36,1 (−36,6 en la otra foto) | 140 ft → −39,3 | entretanque (−30,65 a −35,65): toca 0,5 m debajo de su base |

Conclusión: **no hay que mover las estaciones del cohete.** Las diferencias de 3–9 m del §2 venían de los niveles de [UMB]: el del OSMU y el del CSITU no coinciden con las fotos y se sigue la foto. Que el brazo del faldón delantero sea el estabilizador y que el brazo corto de 180 ft sea el CSFSU (quizás guardado) es una identificación sin confirmar. Otras diferencias chicas del modelo: el naranja del LVSA empieza en −9,6 (modelo −10,5) y el cono termina en −17,1 (modelo −17,65); no se tocan.

**Torre del ML:** el techo de la sala de máquinas queda 108 m sobre la cubierta y el marco principal 99 m ([ML1]: 345 ft = 105,2 m; 3 % de diferencia, que puede ser la profundidad). La cara de la torre que mira al cohete está a ~14,7 m del eje del cohete (medido en proyección; la torre se ve casi de frente: 14,0 m de ancho aparente contra 12,19 m).

**Nube y estela** (para la etapa 5): en el despegue la nube sale a ras del suelo hacia los dos lados, más hacia uno (`launch-1`), y es blanca (vapor del agua) con zonas tostadas; la columna del ascenso se ve beige con el Sol bajo (`launch-2`). En `launch-3` el viento dobla la estela (el modelo no tiene viento: fuera de alcance). En `launch-1` se ve la torre de agua junto al cohete, más atrás.

**Hora del despegue:** el EXIF de `launch-2` dice 18:35:34,97 EDT con el cohete ya bien arriba de las torres. No se sabe si el reloj de la cámara estaba sincronizado, así que no fija el segundo del despegue; el modelo sigue en 22:35:00 UTC.

**Disposición, de las imágenes sin escala** (cualitativo): tres pararrayos alrededor de la plataforma; la torre de agua al costado del ML, del lado opuesto al de la nube; una esfera blanca (tanque) más lejos; la nube del despegue sale hacia el lado del foso (norte, [39B]) y el crawlerway llega desde el sur (`39B-Draw.jpg`, `39-B.jpg`, `launch-1.jpg`).

**Posiciones en el suelo: OpenStreetMap** ([OSM]; consulta a la API Overpass, datos del 22/11/2026 01:40 UTC, licencia ODbL). Gastón no encontró una foto cenital de NASA y eligió usar OpenStreetMap **solo para las posiciones**, con el crédito *"Datos de posición © colaboradores de OpenStreetMap (ODbL)"* en los Créditos cuando entren a la app (etapa 3). El trazado del suelo (D6) no se calca: queda genérico. Lo mapeado en OpenStreetMap está calcado, en buena parte, de ortofotos de USGS (NAIP) y de Bing.

Origen local: el centro de los seis apoyos del ML (`man_made=mast`, `tower:type=portal`: 28,6272154° N, 80,6208577° O). Los apoyos ocupan 40,3 m de este a oeste y 48,9 m de norte a sur ([ML1]: base de 41,1 × 50,3 m; coincide). No son simétricos: hay dos a +26 m, dos a −4 m y dos a −22 m al norte del centro; dónde queda el cohete sobre la base se resuelve en la etapa 3. Metros por grado: 110.830 de latitud y 97.787 de longitud.

| Elemento (id en OpenStreetMap) | Este | Norte | Distancia | Rumbo | Otros datos de OpenStreetMap |
|---|---|---|---|---|---|
| Pararrayos 1 (node 3281217398) | −102,9 m | −118,3 m | 156,8 m | 221° | 183 m (torre de 146,4 m + mástil); [39B]: 600 ft = 182,9 m |
| Pararrayos 2 (node 3281217399) | +125,1 m | +38,3 m | 130,8 m | 73° | ídem |
| Pararrayos 3 (node 3281217400) | −144,0 m | +66,9 m | 158,8 m | 295° | ídem |
| Torre de agua (node 8651215902) | +101,7 m | +114,5 m | 153,1 m | 42° | 80,5 m hasta el tanque y 88 m con el domo (sin fuente primaria) |
| Tanque de LH2 (way 153128950) | +372,9 m | +227,7 m | 436,9 m | 59° | "Liquid Hydrogen tank" |
| Tanque de LH2 (way 901620453) | +236,7 m | +319,4 m | 397,5 m | 37° | probablemente el nuevo de ~1,25 millones de galones ([39B]); sin confirmar |
| Tanque de LOX (way 153128951) | −398,5 m | +244,6 m | 467,5 m | 302° | "Liquid Oxygen tank" |

Controles: los tres pararrayos y la torre de agua coinciden con las fotos (en `launch-1`, tomada desde el sur‑sudoeste, la torre de agua queda a la derecha del cohete y más atrás). Las coordenadas de LC‑39B del modelo (`LAUNCH_LATITUDE_DEG`, `LAUNCH_LONGITUDE_DEG`, de Wikipedia) caen a 27,6 m del centro de los apoyos: no se cambian, porque solo apoyan la textura de la Tierra.

**Historia de la vista cenital:** Las posiciones de los pararrayos, la torre de agua y los tanques, la rampa, el cerco y el trazado del suelo (D6) necesitan una vista cenital con escala. Las tres primeras eran capturas satelitales de Google Maps; hasta donde sé, los términos de Google no permiten crear contenido a partir de sus imágenes (calcar caminos o edificios), y el trazado iría dentro de la app. **Gastón eligió una foto aérea de NASA** (sesión 42). Las dos imágenes que agregó después no son fotos: `39-B.jpg` es una vista de mapa (no de Google Maps; origen y licencia por confirmar) y `39B-Draw.jpg` es una ilustración sin escala. No se midió nada en ellas. Si la licencia del mapa lo permite, sirve para el trazado del suelo (caminos, perímetro, agua), con la escala sacada de medidas publicadas; las posiciones de los pararrayos, la torre de agua y los tanques no aparecen en el mapa. Gastón no encontró una foto cenital de NASA, y las posiciones salieron de OpenStreetMap (arriba).

### Falta conseguir (etapa 0)

- ~~Elevación de LC‑39B~~: conseguida ([LC50], arriba).
- ~~Imágenes de referencia~~: elegidas por Gastón (`docs/reference/launch/`, arriba).
- ~~Posiciones de los pararrayos, la torre de agua y los tanques~~: de OpenStreetMap (arriba), con crédito.
- **La rampa del crawlerway, el cerco y el trazado del suelo:** no se calcan (decisión de Gastón, sesión 42). El suelo de la etapa 6 es genérico; la orientación sí se conoce (foso al norte [39B], crawlerway desde el sur).

## 3. Decisiones

**Tomadas en la sesión 40:** Gastón aceptó todas las recomendaciones ("todo con lo que vos recomiendes"). Las alternativas quedan como registro de lo descartado.

| # | Decisión | Elegida | Descartadas |
|---|---|---|---|
| D1 | Desde cuándo arranca la misión | **T‑10 min**, cuando el GLS inicia la cuenta final, con el warp libre hasta T‑33 s | T‑6,36 s como hoy; elegirlo en la pantalla de inicio (T‑10 min o T‑33 s) |
| D2 | Qué hace la tripulación durante la cuenta | **Nada obligatorio, como en la realidad** (la cuenta la corre el GLS): mirar, cambiar de cámara y de warp y leer la página de la cuenta | Esperas (`Hold`) con las reglas de NASA y suspensión después del ALS (ver 4.1, "Fuera de la primera versión") |
| D3 | Altura del cohete | **Sobre la cubierta del ML** (14,33 m más la elevación de la plataforma), cambiando `padState` y recalibrando | Solo en el dibujo, con lo que el ML quedaría enterrado o el cohete flotando |
| D4 | Arranque de los RS‑25 | **T‑6,36 s, el valor publicado**, recalibrando | Dejar los 6 s supuestos |
| D5 | Cámara de la plataforma | **Un modo nuevo, `PLATAFORMA`, con la vertical local arriba.** AUTO lo usa hasta ~T+30 s y después pasa a NAVE | Sin cámara nueva; con NAVE el cohete se ve acostado |
| D6 | Textura del suelo cercano | **Un trazado propio** (polígonos de hormigón, caminos, pasto, arena y agua) dibujado a partir de una foto de referencia, con ruido de detalle. **Cambiada en la sesión 42:** no hay foto cenital usable y Gastón no quiere calcar el mapa, así que el trazado es genérico (hormigón de la plataforma, pasto y agua, con la orientación conocida) | Sumar un parche regional de Landsat de 15–30 m/px; el crédito es "NASA/USGS" y hay que decidir si entra en el criterio de `ASSETS.md` |
| D7 | Página de la cuenta en pantalla | **La página nueva arriba en la pantalla izquierda mientras t < 0.** Al despegar vuelve `Flt.Traj` | Dejar las páginas iniciales de ahora y que el tutorial señale la pestaña |
| D8 | Quién habla durante la cuenta | **El control de lanzamiento (Kennedy) hasta que el cohete despeja la torre, y Houston desde ahí**, como en la realidad | Todo como Houston |
| D9 | Hora del despegue (agregada después con los datos de [LDAY]; Gastón la confirmó en la misma sesión) | **La real, 22:35 UTC**: `LAUNCH_BEFORE_SUNSET` = 1,28 h − 11 min, citando [AV] y [LDAY]. Se hace en la etapa 1 | Dejar la apertura de la ventana (22:24 UTC) |

## 4. Diseño

### 4.1 Simulación (`sim/`)

- **`sim/mission/countdown.ts`** (nuevo, puro): la tabla [CNT] como datos (`COUNTDOWN`, con MET, clave de texto y efecto) y `countdownStatus(s)`. Esa función devuelve el hito actual, el próximo y el estado de los sistemas de tierra según el tiempo: brazo de acceso (`extended`, `retracting` o `retracted`), venteos (abiertos hasta la presurización de T‑6 min), ROFI, umbilicales (conectados hasta T‑0), postes de sujeción y agua. Es la secuencia programada del GLS, que en el vehículo real también está programada (regla 4).
- **`state.ts`:** `INITIAL_MET` = −600 s. `ascentEngines` arranca vacío y un breakpoint nuevo en −6,36 s (`asc:rs25`) agrega los RS‑25; hoy están en la lista desde el principio. `padState` suma la altura de la cubierta (`LAUNCH_DECK_HEIGHT` en `constants.ts`, con [ML1]) y la elevación de la plataforma (dato de la etapa 0).
- **`vehicle.ts`:** `RS25_START_BEFORE_LIFTOFF` = 6,36, citando [CNT]. La forma de la rampa de arranque (supuesto) no cambia.
- **`advance.ts`:** breakpoints para los hitos que dejan algo en el log (T‑10 min, T‑8 min, T‑6 min, T‑33 s, T‑12 s y T‑6,36 s). En T‑33 s el warp baja a ×1 (salvo con la tripulación automática o en modo headless), igual que antes de E4 y E5. `holdDown` ya cubre el tramo; sin motores no consume nada, y conviene saltear la integración de Simpson cuando no hay caudal.
- **`capcom.ts`:** mensajes de la cuenta (T‑10 min, brazo retraído, presurización, "go" para el ALS, T‑10 s, arranque y despegue) y un campo `from` en `CapcomMessage` (D8). El mensaje `engineStart` deja de depender de `INITIAL_MET`.
- **`timeline.ts`:** E1 sigue en T‑0. La cuenta va en su propia tabla, fuera de E1–E15.
- **`procedures.ts`:** un procedimiento `LAUNCH` de solo lectura, cuyos pasos son los hitos, todos automáticos y con el estado calculado por tiempo. Procs lo muestra hasta MECO, y eso resuelve el problema abierto de que Procs muestre E6 durante el ascenso.
- **Recalibración:** `npm run tune` y `npm test`, porque cambian la altura inicial y los 0,36 s con los RS‑25 encendidos y el cohete sujeto. Los scripts siguen usando `createInitialState`, así que arrancan en T‑10 min; el tramo sujeto no les agrega costo.
- **Fuera de la primera versión (D2): las esperas y el reciclado a T‑10.** En el modelo el despegue es MET 0 por definición y la fase lunar se calibra para esa hora. Una espera real corre la hora del despegue y obliga a replanificar la ventana, y el modelo no hace eso. Si se quieren esperas, la única versión honesta es que detengan la cuenta y el reloj juntos, como una pausa, y que lo digan.

### 4.2 Terreno cercano: evaluación y propuesta

Hay tres problemas, ordenados de más grave a menos.

**1. Forma.** Con facetas de 209 km y la plataforma en un vértice, el suelo baja 16 m por km alrededor del cohete (§1). Opciones:

- (a) Más segmentos en la esfera. Con 1.024 × 512 (0,35°) el suelo sigue bajando 3 m por km, y la malla pasa a 525.000 vértices. No alcanza.
- (b) **Recomendada: una malla polar centrada en la plataforma.** La plataforma está fija en el marco de la malla (la Tierra ya gira con ella), así que la malla puede ser fina ahí y gruesa lejos. Se arma con anillos alrededor de la plataforma: el primero a 10 m, cada uno un 8 % más separado que el anterior hasta llegar a 0,5° o 1°, y uniformes de ahí en adelante, con 256 sectores. Son ~75.000 a 120.000 vértices (hoy son 18.400). El error de la cuerda queda en ~1 cm a 10 km de la plataforma, y en el resto de la esfera por debajo del actual, que llega a ~1,7 km en el centro de una faceta. El sombreado por latitud y longitud (`sampleGeographic`) no usa los UV, así que la textura no cambia. Se usa solo en la 3D: el mapa y el recuadro siguen con la esfera actual, y la Luna también.
- (c) Una Tierra analítica: el shader interseca cada línea de vista con la esfera exacta y escribe la profundidad, como ya hace la atmósfera. Es exacta en todas partes, pero toca la Tierra entera y obliga a restar en doble precisión en la CPU para no perder la altura de la cámara. Queda como alternativa si (b) no alcanza.

**2. Precisión.** La esfera ubica su superficie con un error de ~0,5 m, así que el suelo de la plataforma parpadearía contra ella. La propuesta es una malla de suelo propia (`render/padGround.ts`):

- En metros, en el marco local este‑norte‑arriba de la plataforma, con origen flotante como la nave.
- Radio de ~5 km (desde 2 m de altura el horizonte está a 5 km), con la curvatura real y un faldón en el borde.
- Se dibuja en la pasada de la nave, cuyo plano lejano cercano da ~3 mm de resolución. El shader de la Tierra descarta sus fragmentos dentro de ese radio, en color y en la pasada de solo profundidad.
- Lleva el relieve: la plataforma elevada, la rampa del crawlerway y el foso de llamas.

**Cómo quedó (etapa 2, sesión 43; decisión 47):** malla polar con espaciado hasta 0,5° (118.477 vértices; error de cuerda 1,2 cm a 10 km y 541 m como máximo). El suelo es como se propuso, salvo dónde se dibuja: el color va en la pasada principal, justo después de la atmósfera y con su misma bruma (la atmósfera corta en la esfera del nivel del mar y pintaba cielo sobre la plataforma elevada; en la pasada de la nave el suelo habría tapado la estela y recibido la luz de relleno), y la profundidad se escribe otra vez en la pasada de la nave, con la precisión de milímetros. Pasa 10 m más allá del círculo que descarta la Tierra, para que el error de float32 de la Tierra no abra grietas. El relieve es solo la plataforma elevada con forma supuesta (sin rampa ni foso: no hay trazado publicado). Lleva la textura de la Tierra hasta la etapa 6.

**3. Textura.** Una cascada de niveles por distancia, cada uno fundido en el borde del siguiente:

| Nivel | Resolución | Origen | Estado |
|---|---|---|---|
| Global | ~10 km/px | Blue Marble de 4K | existe |
| Parche de la plataforma | 1,86 km/px | Blue Marble de 21.600 px | existe |
| Regional (opcional, D6) | 15–30 m/px en ~40 × 40 km | Landsat (crédito NASA/USGS) | lo decide Gastón |
| Suelo de la plataforma | 0,25–0,5 m/px en ~2 × 2 km; 2–4 m/px hasta 5 km | trazado propio dibujado en un canvas, como las texturas de la nave (`createTextures`) | nuevo |
| Detalle | ruido que se repite, en 2 o 3 escalas | procedural | nuevo |

- El **trazado propio** es una lista de polígonos en metros: hormigón de la plataforma, asfalto, piedra del crawlerway, pasto, arena de la playa y agua del Atlántico y de las lagunas. Se mide sobre la foto aérea de referencia, igual que el modelo de la nave se midió sobre 6.png y 15.png. Los colores salen de la paleta extraída de esa foto (`npm run palette`, para no inventar hex). El agua lleva un brillo especular propio.
- El **ruido de detalle** modula el color del nivel de abajo según la distancia a la cámara, para que de cerca no se vea una mancha lisa *(elección de dibujo)*.
- Lejos de la plataforma, el suelo propio se funde con el color del parche: su shader muestrea la misma textura de la Tierra, así que no se ve el borde.
- **No se usan** ortofotos de alta resolución de otros titulares (USDA/NAIP o el estado de Florida), por el criterio de `ASSETS.md`.

### 4.3 Modelo 3D de la plataforma (`render/pad.ts`, nuevo)

Se arma con el mismo método que `render/vehicle.ts`: piezas en metros, geometría procedural juntada por material (`mergeGeometries`) y texturas en canvas, sin logos ni letras. Va con origen flotante y orientado en el marco este‑norte‑arriba que da `earthGeoMatrix`, girando con la Tierra. En la plataforma, el este es la dirección de vuelo del plano y el norte es la normal del plano orbital. Se dibuja solo en la vista 3D y solo con la cámara a menos de ~50 km, que es el alcance de la pasada de la nave.

- **ML‑1** ([ML1]):
  - Base de 50,3 × 41,1 × 7,62 m sobre seis montantes de 6,71 m, con la cubierta a 14,33 m, la abertura de 10,4 × 19,5 m y los 8 postes bajo los faldones de los boosters.
  - Torre de 12,19 m de lado y 105,2 m de alto, con un piso cada 6,10 m. La estructura reticulada (columnas y diagonales) va en la geometría, no en una textura.
  - Brazo de acceso en el nivel de 274 ft, con su sala blanca; umbilicales en sus niveles (datos de la etapa 0); mástiles de servicio de cola; cables de evacuación con sus canastas.
- **LC‑39B** ([39B]):
  - Plataforma elevada con su rampa.
  - Foso de llamas de 174 × 17,7 × 12,8 m hacia el norte, con el deflector.
  - Tres pararrayos de 182,9 m con cables aéreos.
  - La torre de agua, los tanques de LH2 y LOX, los caminos y el cerco.
  - Las posiciones y la elevación se miden en la foto aérea.
- **Apoyo del cohete:** hoy el modelo se apoya en las toberas. Pasa a apoyarse con el faldón trasero de los boosters sobre los postes, con las toberas metidas en la abertura, como el real. La cubierta y el suelo tapan la llama.
- **Comprobaciones cruzadas**, como tests sobre funciones puras:
  - El brazo de acceso queda a la altura de la escotilla del CM.
  - El umbilical del ICPS cae sobre el ICPS.
  - La torre no toca el cohete.
  - En MET 7 s (torre despejada, 468 ft publicados) la base del cohete está por encima de la punta de la torre (~120 m).

### 4.4 Animaciones

Todas salen del tiempo de la cuenta (`countdownStatus`) o del estado de la simulación. Las duraciones de los movimientos son elecciones de dibujo y se marcan como tales. No se anima nada que la secuencia real no haga.

| Qué | Cuándo | Fuente |
|---|---|---|
| El brazo de acceso gira hasta quedar retraído | T‑8 min | [CNT]; duración supuesta |
| Vapor de los venteos (oxígeno e hidrógeno de la etapa central y del ICPS) | hasta T‑6 min (presurización) | [CNT]; salidas ubicadas según la foto de referencia |
| Chispas de los ROFI bajo los RS‑25 | desde T‑12 s | [CNT] |
| Agua de supresión de sonido sobre la cubierta y en el foso | desde ~T‑20 s, durante menos de 30 s | [39B] |
| Los mástiles de cola (TSMU) se inclinan hacia atrás | "antes del lanzamiento"; momento exacto sin dato | [UMB]; momento supuesto |
| Arranque de los RS‑25 (las llamas ya existen) | T‑6,36 s | [CNT] |
| Los umbilicales se sueltan: el CSITU, el CSFSU y el del ICPS giran hacia la torre, el OSMU se inclina hacia atrás, el estabilizador baja y se aparta, y los TSMU se retraen | T‑0 | [CNT], [UMB]; duraciones supuestas |
| Despegue | T‑0 | física (ya existe) |
| Escarcha de la espuma de la etapa central que se desprende al subir | opcional | elección de dibujo |

### 4.5 Humo, vapor y agua (`render/padCloud.ts`, nuevo)

- **Partículas deterministas:** cada partícula es una función pura del tiempo desde que se emitió (con semilla fija), en el marco de la Tierra, así que se mueve con el aire como `wake.ts`. El dibujo no depende de cómo los frames cortan el tiempo y se puede testear igual que `wakeSamples`.
- **Nube del foso:** sale con el caudal de los boosters (`srbThrustEach`) mientras la llama llega al deflector, es decir, con la base del cohete por debajo de ~100 m (supuesto). Sale por la boca norte del foso (el deflector manda la llama al norte, [39B]) y sube abriéndose. Con los RS‑25 solos es vapor tenue, con el mismo criterio que `WAKE_VAPOR`.
- **Vapor del agua:** se suma a la nube mientras corre el agua.
- **Unión con la columna:** `wake.ts` sigue siendo la columna de la trayectoria, y la nube del suelo empieza donde nace la columna.
- **Rendimiento:** un número máximo de partículas (instancias), medido en las capturas con SwiftShader. Sin viento (supuesto: el aire está quieto respecto del suelo).

### 4.6 Cámara

- **Modo nuevo `pad` (PLATAFORMA):** una cámara fija en el suelo, en el perímetro de la plataforma, a ~400 m y 2 m de altura *(elección de dibujo)*, con la vertical local arriba. Apunta al cohete y lo sigue mientras sube, y la rueda cambia el campo visual (zoom de telescopio, como las cámaras de seguimiento). Tecla `6` y `?cam3d=pad`. No toca la cámara NAVE (sesión 31).
- **AUTO (D5):** usa PLATAFORMA mientras t < ~30 s o la nave está a menos de ~5 km, y NAVE después, con una transición suavizada.
- **`camera.ts`:** un rig de perspectiva que acepte un ojo fijo y su propio vector hacia arriba, sin `OrbitControls`. La cámara nunca entra en el suelo: `keepOutside` se aplica contra la malla de suelo, no contra la esfera.
- **Cómo quedó (etapa 2, sesión 43; decisión 47):** la cámara está a 400 m al sur‑sudoeste (200°): al sudoeste el pararrayos de 221° y 157 m (OpenStreetMap) quedaba delante del cohete. Mira un poco debajo del centro del vehículo para que se vea el suelo. AUTO pasa a NAVE solo por tiempo (T+30 s), en 2,5 s. El rig de `camera.ts` separa la cámara que se dibuja de la que mueven los `OrbitControls` y las mezcla durante el paso; la cámara NAVE se mantiene sobre el relieve del suelo además de fuera de la esfera.
- **Sombras (opcional):** el Sol está a ~1 h de la puesta y daría sombras largas del cohete y de la torre. Serían un mapa de sombras acotado a la plataforma (~600 m) en la pasada de la nave. Se evalúa al final, según el rendimiento.

### 4.7 Panel y textos

- **Página nueva `Flt.Count`** (grupo Flt, que tiene lugar para una pestaña más):
  - Reloj T‑ grande, estado (cuenta final, ALS o despegue) y próximo hito.
  - Lista de hitos con su T‑ y su estado, con los colores de Mission.Tl: blanco pendiente, magenta el próximo y verde hecho.
  - Estado de tierra: brazo de acceso, venteos, umbilicales, postes de sujeción, ROFI, agua, RS‑25 y boosters.
  - **Sin valores inventados:** ni presiones de tanques ni tensiones de baterías, que no se simulan. "Orion a energía interna" aparece como un hito de la secuencia publicada, no como un valor.
  - Tecla lateral `Scroll` para la lista.
- **Barra de estado:** durante la cuenta muestra la cuenta regresiva al próximo hito (no solo a E1) y el rótulo de fase "Cuenta final", derivado de t < 0. No se agrega una fase en `phases.ts`, porque cambiaría los colores del trazo y los tests.
- **Log:** solo los seis o siete hitos principales; la lista completa queda en la página.
- **Procs:** el procedimiento `LAUNCH` (4.1).
- **Sys.Sum y PFD:** en la plataforma, "Hold-down" (postes sujetos o sueltos) en la sección GNC o Prop.
- **HUD del mapa y Mission.Tl:** ya muestran T‑ con el MET negativo.
- **Recuadro del entorno terrestre:** el problema abierto de la escala de ±9.000 km en el ascenso se nota más con la cuenta larga. Propuesta: un tercer nivel de ±300 km desde la cuenta hasta MECO.
- **Textos:** todos en `sim/i18n.ts` y `ui/i18n.ts`, en inglés y en español. Los tests comparan en español.

### 4.8 Tutorial, guías, inicio y documentación

- **Tutorial** (`ui/tutorial/steps.tsx`), después de "LA NAVE" y "LA MISIÓN":
  - "LA PLATAFORMA": la torre, el brazo de acceso, los umbilicales y el foso, con la cámara PLATAFORMA.
  - "LA CUENTA FINAL": señala la pestaña `Count` (`data-press="tab-count"`).
  - "ACELERAR LA CUENTA": warp ×10 (la mano en `warp-10`) hasta T‑33 s, donde el warp baja solo.
  - "DESPEGUE", reescrito: chispas en T‑12 s, motores en T‑6,36 s y boosters en T‑0.
  - Los botones de cámara llevan `data-press` (`cam-pad`).
- **Guías:** "Etapas" con la cuenta final; "Acerca de la nave" con un apartado sobre el ML‑1 y la plataforma (números desde `constants.ts`); "Documentación de NASA" con los enlaces de [ML1] y [CNT], si Gastón los aprueba.
- **Pantalla de inicio:** el texto dice desde cuándo arranca la misión (D1). El modo demostración arranca en T‑10 min con la tripulación automática y el warp elegido.
- **Parámetros de URL:** `?met=-30`, que funciona sin cambios porque ya acepta un MET posterior al inicial, y `?cam3d=pad`.
- **`ASSETS.md` y Créditos:** solo si entra una imagen nueva (D6).
- **`CLAUDE.md`:** "Modelo físico" (cuenta desde T‑10 min, cohete sobre la cubierta), "La nave" (apoyo en los postes), "Vista de trayectoria" (cámara PLATAFORMA, suelo propio, malla polar), estructura, "Dónde tocar" (plataforma, cuenta y suelo), las fuentes nuevas ([ML1], [CNT]) y las imágenes de referencia nuevas.

## 5. Etapas (un chat por etapa)

Cada etapa termina con tests y build en verde, capturas headless (receta de `CLAUDE.md`), `process.md` al día y commit cuando Gastón lo pida. **Antes de la primera hay que correr `npm install`**, porque esta copia no tiene `node_modules`.

| Etapa | Qué | Archivos | Verificación | Tamaño |
|---|---|---|---|---|
| 0 | Datos e imágenes. Las hojas de datos ya están leídas ([ML1], [UMB], [39B], [CNT], [LDAY]); falta que Gastón elija las imágenes y medir en ellas lo que no está publicado | `docs/reference/16.png` y siguientes | — | chico |
| 1 | Cuenta final en la simulación: T‑10 min, hitos (con el agua en T‑20 s), RS‑25 en T‑6,36 s, cohete sobre la cubierta y los postes, hora real del despegue (D9), Houston, log, Procs `LAUNCH`, página `Flt.Count` y barra de estado. Las constantes nuevas van en `constants.ts` con su cita, y las fuentes en `CLAUDE.md` | `sim/mission/countdown.ts`, `state.ts`, `vehicle.ts`, `advance.ts`, `capcom.ts`, `procedures.ts`, `sim/i18n.ts`, `ui/panel/pages/Count.tsx`, `pages/index.ts`, `StatusBar.tsx`, `ui/i18n.ts` | `npm run tune`. Tests: arranque en −600 s sin consumo, RS‑25 en −6,36 s, despegue reproducible, hitos ordenados y en sus T‑ publicados, warp ×1 en T‑33 s. Captura de la página | mediano |
| 2 (**hecha**, sesión 43) | Suelo: malla polar de la Tierra, suelo propio con descarte, marco local y cámara PLATAFORMA | `render/bodies.ts`, `render/atmosphere.ts`, `render/padGround.ts`, `render/scene.ts`, `render/camera.ts`, `TrajectoryView.tsx`, `store.ts` | Tests: error de cuerda < 2 cm a 10 km de la plataforma y nunca mayor que el de la esfera actual; marco local coherente con `earthGeoMatrix`. Capturas con `?cam3d=pad` en T‑60 s y T+10 s | mediano |
| 3 | Modelo del ML‑1 y de LC‑39B, y apoyo del cohete en los postes | `render/pad.ts`, `render/vehicle.ts` (anclaje), `scene.ts` | Tests de las comprobaciones cruzadas (4.3). Capturas con PLATAFORMA, NAVE y TIERRA | grande |
| 4 | Animaciones de la cuenta y del despegue | `render/pad.ts`, `countdown.ts` | Capturas en T‑9 min, T‑7 min, T‑11 s, T‑1 s y T+3 s | mediano |
| 5 | Vapor, agua y nube del foso | `render/padCloud.ts`, `scene.ts` | Tests de la función pura: nada antes de su hito, determinista, sin partículas después de su vida. Capturas en T‑5 min, T‑3 s, T+5 s y T+20 s | mediano |
| 6 | Textura del suelo: trazado, paleta, ruido y agua; parche regional si se elige en D6 | `render/padGround.ts`, `scripts/extract-palette.ts`, `theme.css` (y `optimize-images.ts`, `ASSETS.md`) | Capturas comparadas con las de la etapa 2 | mediano |
| 7 | Tutorial, guías, inicio y documentación; sombras si el rendimiento alcanza | `steps.tsx`, `guides/content.tsx`, `StartScreen.tsx`, `CLAUDE.md` | Capturas con `?tour=n`; recorrido a mano por Gastón | chico |

Las etapas 1 y 2 son independientes entre sí. La 3 necesita la 2 (el piso) y la 0 (las medidas), y la 4 y la 5 necesitan la 3.

## 6. Riesgos

- **Rendimiento:** la atmósfera ya hace 32 pasos por píxel, y se suman la torre reticulada, el suelo, las partículas y quizás las sombras. Las capturas no usan una GPU real (SwiftShader). Se mitiga con un tope de partículas y dibujando la plataforma solo cerca de la cámara, y hay que medirlo en el navegador de Gastón.
- **Recalibración:** D3 y D4 mueven la calibración. El ajuste tarda ~10 min y los tests del ascenso tienen tolerancias anchas, pero hay que revisar los números de `process.md`.
- **Posiciones y trazado:** dónde están los pararrayos, la torre de agua y los tanques, y el trazado del suelo, dependen de la foto de referencia. Sin ella serían inventados. La orientación del foso (al norte) y las medidas del ML‑1 sí están publicadas.
- **Estaciones del modelo del cohete:** tres umbilicales (OSMU, CSFSU y CSITU) caen 3–9 m fuera de la pieza que deberían tocar (§2, [UMB]). Si el error es del modelo, corregir las estaciones cambia el ícono 2D y el encuadre de la cámara NAVE, pero no la física.
- **Profundidad:** la torre de 122 m, la nube y el suelo de 5 km de radio entran en los 50 km de la pasada de la nave. Hay que cuidar el orden de dibujo de lo transparente (nube, atmósfera y estela).
- **Cámara con la vertical local:** Gastón revirtió algo parecido en NAVE (sesión 31). Si PLATAFORMA no convence, se revisa D5.

## 7. Fuera de alcance

- Aborto en la plataforma o en el ascenso con el LAS: necesita el descenso con paracaídas, que no se simula.
- Esperas con replanificación de la ventana (4.1).
- Sonido.
- Viento, nubes y lluvia.
- El resto del complejo de Kennedy (VAB, sitio de prensa) fuera del suelo de 5 km.
