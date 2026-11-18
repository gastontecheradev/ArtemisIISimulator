# Análisis del panel de la nave contra la cabina real

**Material:** `docs/reference/12.png` (foto de la cabina de Orion: dos Display Units, el panel central y las placas F2, F4 y F5) y `docs/reference/13.png` (detalle de la página Flt.PFD con GNC.Switch debajo). Las dos tienen un logo de NASA en una esquina, que no pasa a la app.
**Comparado con:** captura headless del panel actual en MET 12.500 s, en inglés, a 1700 × 950 (una sola Display Unit a ese ancho).
**Fecha:** 2026-11-17 (sesión 30).

**Estado (misma sesión, a pedido de Gastón):** implementadas la actitud de tres ejes con su PFD y E1–E6, E8 y F1–F8. Cómo quedó cada una:

- **E1:** bisel, teclas, placas y metal muestreados de 13.png. La foto 12.png tiene luz azul y daba azul marino.
- **E2 y E3:** adoptadas. Cambian dos convenciones de `CLAUDE.md`: el verde pasa a marcar solo lo activo, y las pantallas y placas usan mayúsculas y minúsculas.
- **E5:** sin el color de foco. Sin cursor no tendría función y sería decorativo.
- **E8:** `Brt`/`Dim` funcionan. La perilla `Tab` se dibuja sin interacción, y `Fav`, `Fcs`, `Tmr`, `Cnx` y `Pwr` no se dibujan.
- **E7:** no se cambió el umbral de pantallas.
  - A 1.920 px y más ya entran dos o tres pantallas casi verticales (≈ 465 × 560 px).
  - A 1.700 px, dos pantallas de ≈ 415 px dejarían unos 270 px para el texto de Procs y la columna de la PFD sin lugar.
  - La bola de la PFD depende del alto de la media pantalla, no del ancho, así que tampoco la agrandaría.
  - Verificado con capturas a 1.700, 1.920 y 2.560/2.600 px.
- **F3:** `Burn ATP` se suma a la palanca y también necesita la guarda levantada.
- **F6:** sin `Free`, porque con actitud cinemática sería igual a `Intl`.

El detalle de cada cambio está en `process.md` (sesión 30).

Lo que se lee directo de la foto va sin marca. Lo que es interpretación mía va marcado *(interpretación)*: la foto no dice qué significa cada cosa, y no hay un manual público de las pantallas de Orion contra el cual verificarlo.

**12.png muestra solo una parte del panel.** La cabina tiene tres pantallas y siete placas de interruptores ([ORG] pág. 20 y 68), y la foto muestra dos pantallas y unas cuatro placas. Que un control del simulador no aparezca en la foto (interruptores de motor, ICPS SEP, THC, controles de tiempo) **no quiere decir que la cabina no lo tenga**: esas ausencias no se usan como argumento (aclaración de Gastón, sesión 30).

## 1. Qué muestra 12.png

### Display Units (DU)

- **Formato vertical**, más alto que ancho (~3:4). El bisel es **casi negro** y se confunde con el panel; el nuestro es gris metálico medio (tomado de 9.png).
- **Teclas:** 8 arriba y 8 abajo, angostas, verticales y oscuras; unas 10 por lado, horizontales. En las esquinas hay teclas con rótulo propio: Fav y Fcs arriba a la derecha; Tmr, Dim, Brt y Cnx en los costados. Abajo a la derecha de cada DU hay una perilla **Tab**, y arriba a la izquierda un interruptor **Pwr** Off/On.
- **Pestañas:** arriba del todo las de la mitad superior y abajo del todo las de la inferior, como ya hace el simulador. La primera es **"▲"** *(interpretación: subir un nivel en el árbol de páginas)*. Nombres cortos en mayúsculas y minúsculas: `PFD · Att · Burn · DO-Plan · Landing` y `Sum · EPS · Prop · GNC · Images`. Cada pestaña es un corchete abierto (líneas a los costados y una base, sin techo); la activa tiene el texto verde.
- **Barra de título:** a la izquierda, una solapa con el borde derecho inclinado donde se apilan las dos páginas: la de arriba (`Flt.PFD`) en blanco y la de abajo (`Sys.Sum`) sobre una franja de color. Después vienen `M 2:03`, un campo ancho con `1.10 Pre-Launch` y, a la derecha, un `0` en su casilla.
- **Color de foco:** la franja de la página inferior y un marco alrededor de esa mitad comparten color: celeste en la DU izquierda, verde en la derecha (página `Fault`) y beige en 13.png (`GNC.Switch`). *(Interpretación: marca la mitad que tiene el foco del dispositivo de cursor. El `0` sería un contador de mensajes de falla y `1.10 Pre-Launch`, la fase o el modo mayor del software.)*
- **Colores del texto:**
  - **Blanco** es el color por defecto, tanto de rótulos como de valores.
  - **Verde:** lo seleccionado o activo (pestaña activa, botón `Auto` encendido, franja `Fault`, barras de las escalas).
  - **Celeste:** estados (`ATPed`).
  - **Amarillo:** modo manual (`Manual`) y un valor a vigilar (`0.2`).
  - **Magenta:** lo comandado (triángulos de las escalas, el `1`).
- **Texto en mayúsculas y minúsculas** (`Rot Rate`, `Total Prop`, `Vehicle Segment`), no todo en mayúsculas.
- **Rótulos de las teclas laterales:** cajas **rellenas** con esquinas redondeadas. Gris = opción disponible (`Free`, `LVLH`, `Intl`); verde = opción activa (`Auto`) o acción (`Rot Rate`, `Mnvr Now`, `Burn ATP`, `Att Reff`, `TVC Sel`, `Ack`, `Open eProc`).
- **Tablas:** una grilla de líneas blancas finas separa secciones con el título centrado.

### Páginas visibles

- **Flt.PFD:** ver la sección 3.
- **Sys.Sum** (resumen del sistema):
  - Encabezado: fase (`4.0 Orbit`), AOS y LOS con hora, `Total Prop`, `Delta V`, `Vehicle Segment` (`Docking`).
  - Secciones: Comm (S‑Band 1 y 2, Tx/Rx/Hb, señal en %), Prop (oxidante y combustible de los principales; RCS 1 y 2 por banco A/B), EPS (Sunset, Sunrise, carga total, vida de batería, baterías A1–B3), GNC (Nav Select `Aided`, IMU 1–3, GPS), ECLS (modo, dP/dT, presión, CO₂, ventiladores) y CDH (cuatro computadoras `FLT-Sync'd`).
  - *(Interpretación: son datos de entrenamiento; la barra dice `Pre-Launch` y el resumen `4.0 Orbit`.)*
- **Fault:** lista de fallas (vacía). A la izquierda, `Ack All`, `Scroll Mode`, `Clear All` y `Sort Class`; a la derecha, `Open eProc` y `Ack`. Es la página de alarmas enlazada con los procedimientos electrónicos.

### Placas de interruptores

- **Interruptores de palanca** metálicos con collar de traba, vistos de frente. El rótulo de arriba lleva el nombre y la posición superior (`On`, `Auto`); el de abajo, la inferior (`Off`, `Trip`). **No hay botones redondos.**
- **Las franjas amarillas y negras son un marco pintado** alrededor del interruptor crítico, no una tapa sobre cada uno. En F4 solo lo lleva `Pyro Master Arm`; los demás son palancas comunes.
- **F2** (abajo a la izquierda): `FCM 1–4` y `VPU 1 BFS`, alimentación de las computadoras de vuelo.
- **Panel central:**
  - `Panel Backlight and Converter [F7]`; perillas `Cockpit Lights` y `Status Lights` (Off–Brt, con posición `Test`).
  - Bloque **DAP** con pulsadores: `Inertial`, `Free` y uno sin rótulo legible.
  - **Master Alarm:** un pulsador cuadrado iluminado, con `WARNING` arriba (rojo) y `CAUTION` abajo (ámbar).
  - **Survival RCS:** `Yaw Left/Right`, `Translate −X`, `Pitch Up/Down`, `Roll Left/Right`, y `RCS Cntl Enable` y `Master Cntl On/Trip` con marco de franjas.
- **F4 "Survival Pyros":** `Pyro Master Arm` (con el marco de franjas), `CM Prop Act`, **`CM/SM Sep`**, `Drogue Deploy`, `Main Deploy` (rótulo resaltado en blanco) y `Riser Cut / Upright Deploy`.
- **F5** (derecha): `PDU Pwr Supply`, `SM Pwr Supply` (PCDU 1a–2b), `Battery to Aux` (On/Trip), voltímetro de bus y selector rotativo de fuente.

## 2. Diferencias con el panel actual

| Aspecto | Cabina real (12.png) | Simulador hoy |
|---|---|---|
| Formato de la DU | vertical, ~3:4 | apaisada, una sola a 1700 px |
| Bisel y teclas | casi negros; teclas oscuras | gris medio; teclas gris claro |
| Teclas | 8 arriba y abajo, ~10 por lado, más Dim/Brt/Fav/Tmr/Cnx/Fcs y perilla Tab | 6 arriba y abajo, 10 por lado |
| Pestañas | corchetes; nombres cortos; primera `▲` | cajas; `TRAJ`, `PFD`, `PROCS`… |
| Barra de título | dos páginas apiladas en una solapa, `M` + MET, fase, contador | página de arriba a la izquierda, MET al centro, página de abajo a la derecha en franja verde |
| Foco | marco y franja de color en la mitad activa | sin foco |
| Color del texto | blanco por defecto; verde solo para lo activo | verde para todos los valores |
| Mayúsculas | mayúsculas y minúsculas | todo en mayúsculas |
| Rótulos laterales | cajas rellenas: gris disponible, verde activo | cajas con borde verde |
| Nombres de página | `Flt.PFD`, `Sys.Sum`, `GNC.Switch` | `Flight.Traj`, `Flight.PFD`, `Procs` |
| Alarmas | página `Fault` en una DU + Master Alarm en el panel central | lista bajo la barra de estado + Master Alarm en la barra |
| Encendidos | `Burn ATP` en la PFD (tecla de pantalla) | solo interruptores con guarda MAIN ENG y AUX THR |
| Separación CM/SM | palanca en `Survival Pyros`, con `Pyro Master Arm` aparte | interruptor propio con tapa |
| Interruptores | palancas con collar; marco de franjas solo en el crítico | botones redondos con tapa de franjas en cada uno |
| DAP | pulsadores físicos (`Inertial`, `Free`) y teclas `Free / LVLH / Intl / Auto` en la PFD | `AUTO / INRTL / MAN` en F4 |

La barra de estado superior, los controles de tiempo, Houston y el log no son de la cabina: son del simulador y se quedan.

## 3. Flt.PFD (13.png), base para la próxima sesión

- **Bola de actitud:** esfera marrón con un casquete celeste arriba (el cielo) y una grilla blanca de meridianos y paralelos en perspectiva. El símbolo de la nave, fijo, va en amarillo verdoso al centro.
- **Tres escalas alrededor de la bola:**
  - Un **arco arriba** (`350 · 0 · 10`, valor `0` en una casilla).
  - Una **escala horizontal abajo** (`350 · 0 · 10`, valor `0`).
  - Una **cinta vertical a la derecha** (`310 · 300 · 290`, valor `300`).
  - Cada una lleva un **triángulo magenta** (el valor comandado) y una **barra verde** *(interpretación: error o velocidad angular)*.
  - *(Interpretación: arco = alabeo, escala inferior = guiñada, cinta = cabeceo. En 0–360°, 300 sería −60°.)*
- **Junto a la bola:** `LVLH` en un recuadro verde (el marco de referencia de la bola), un `1` magenta y un `0.2` amarillo.
- **Arriba de la bola:** `THC ●` `RHC ●` (indicadores de los controladores) y `Manual` en amarillo.
- **Encendido:** `B-01 ATPed`, `TIG 0:01`, `T-1 0:01` y una escala vertical `200 / 150` con un triángulo *(interpretación: Δv o tiempo restante)*.
- **Abajo:** `In Att 0:01` (tiempo en actitud), `Rot P/P/P` (modo de rotación en cada eje) y `Trans P`.
- **Teclas izquierdas:** `Free`, `LVLH`, `Intl`, `Auto` y `Burn Seg ATP`. **Derechas:** `Rot Rate`, `Mnvr Now`, `Burn ATP`, `Att Reff` y `TVC Sel`.
- **Pestañas:** `▲ · PFD · Att · Burn · · DO-Plan · Landing`. **Página de abajo**, `GNC.Switch`: modo de los controladores izquierdos y derechos y de los pulsadores del autopiloto (`Norm`), `RHC Pwr On` 1 2 3.

### Decisión: actitud de tres ejes de verdad (Gastón, sesión 30)

`CLAUDE.md` decía: *"El indicador de actitud solo cabecea, porque es lo único que la simulación modela. Nada de alabeo ni guiñada decorativos."* En `sim/state.ts`, `Attitude` es un solo vector (`dir`) más un `rhc` escalar que gira alrededor de z. Había dos caminos y **Gastón eligió el (a)**:

- **(a) Actitud de tres ejes de verdad (elegido).**
  - `Attitude` pasa a ser un marco completo: el eje de empuje y un eje "arriba", o un cuaternión.
  - El RHC actúa en cabeceo, alabeo y guiñada (teclado: ← → como hoy; agregar teclas para los otros dos ejes).
  - AUTO e INRTL mantienen alabeo y guiñada; LVLH e Intl eligen la referencia de la bola (la tecla `Att Reff`).
  - La guiñada saca el empuje del plano. La integración ya es 3D (regla 2 de arquitectura), así que la trayectoria sale del plano de verdad y el mapa 2D la proyecta.
  - **La misión nominal no cambia**: AUTO lleva alabeo y guiñada en cero.
  - El modelo 3D de `render/vehicle.ts` tiene que girar con el alabeo (los paneles solares lo muestran).
  - Es el pendiente "Tres dimensiones de verdad" de `CLAUDE.md`, recortado a la actitud.
  - Tests: el nominal da lo mismo; el alabeo no cambia la dirección de empuje; la guiñada durante un encendido produce velocidad fuera del plano.
  - Tamaño: grande (sim, comandos, PFD, teclado, 3D y tests).
- **(b) Bola de tres ejes con alabeo y guiñada fijos en cero.** Descartado: dos escalas que nunca se mueven son decorativas.

## 4. Propuestas

Cada una dice qué cambia, por qué, dónde y su tamaño. Las de estética no tocan la física.

### Estética de las pantallas

- **E1. Bisel y teclas oscuros.**
  - Qué: nuevos swatches en `scripts/extract-palette.ts` muestreados de 12.png (bisel, tecla y marco del panel), y `npm run palette`.
  - Por qué: cumple la regla de la paleta (sale de una imagen de referencia) y se acerca a la cabina real.
  - Tamaño: chico.
  - Alternativa: dejar el gris de 9.png. Las dos fotos son de la cabina de Orion; 12.png es más reciente *(interpretación)* y tiene mejor luz.
- **E2. Texto blanco por defecto y verde solo para lo activo.**
  - Qué: reescribir los colores de las páginas en `ui/styles.css`.
  - Por qué: es la convención de 12.png y 13.png. Con todo en verde, lo activo no se distingue.
  - Tamaño: mediano.
  - **Cambia una regla de `CLAUDE.md`** ("verde = valores actuales", tomada de 9.png y 10.png). Decide Gastón.
- **E3. Rótulos laterales como cajas rellenas** (gris = disponible, verde = activo o acción) y en mayúsculas y minúsculas (`Proc ▲`, `Conf ΔV`, `Skip`).
  - Dónde: `ui/styles.css` (`.du-action`) y las etiquetas en `ui/i18n.ts`.
  - Tamaño: chico.
  - Cambia la convención "etiquetas en mayúsculas abreviadas" solo dentro de las DU.
- **E4. Pestañas en forma de corchete y nombres cortos** (`Traj`, `PFD`, `Procs`, `Prop`, `Comm`, `TL`).
  - Dónde: `DisplayUnit.tsx` y los `menu` de `pages/index.ts`.
  - Tamaño: chico.
  - La `▲` solo si hace algo (por ejemplo, volver a la página por defecto de esa mitad); si no, no va.
- **E5. Barra de título como la real:** solapa inclinada con las dos páginas apiladas, `M` + MET, campo con la fase y casilla con la cantidad de alarmas activas.
  - Dónde: `DisplayUnit.tsx` y `ui/styles.css`.
  - Tamaño: chico a mediano.
  - El foco de color (marco en la mitad activa) va solo si alguna acción depende del foco (ver E8). Si no, sería decorativo.
- **E6. Nombres de página con el esquema real:** `Flt.Traj`, `Flt.PFD`, `Sys.Procs`, `Prop.Sys`, `Comm.Sum`, `Mission.Tl`.
  - Dónde: `ui/i18n.ts`.
  - Tamaño: chico.
- **E7. DU vertical (~3:4).**
  - Qué: a 1700 px entrarían dos DU verticales de ~400 px en lugar de una apaisada de ~830 px.
  - Tamaño: grande. Toca el layout y todas las páginas, que hoy aprovechan el ancho.
  - Riesgo: legibilidad. Probarlo primero con capturas a 1366, 1700 y 1920 px antes de decidir.
- **E8. Teclas de bisel:** 8 arriba y abajo; `Dim`/`Brt` funcionales (brillo de esa DU); perilla `Tab` funcional (pasa el foco entre las dos mitades, y ese foco decide a qué mitad van ▲ y la casilla de alarmas).
  - Dónde: `DisplayUnit.tsx`.
  - Tamaño: chico a mediano.
  - `Fav`, `Fcs`, `Tmr`, `Cnx` y `Pwr` no tienen función en el simulador: van inertes (sin hover) o no se dibujan.

### Funcionamiento

- **F1. Página `Fault`.**
  - Qué: lista de alarmas activas con clase (W o C), MET y texto. Teclas `Ack`, `Ack All`, `Sort Class` y `Open eProc` (abre el procedimiento en Procs, lo que hoy hace el clic en la alarma).
  - Por qué: es como la cabina real enlaza alarmas y procedimientos ([ORG] pág. 20 y 68: "procedimientos electrónicos enlazados con el sistema de alarmas").
  - Dónde: `ui/panel/pages/Fault.tsx`, nueva, con datos de `sim/alarms.ts`; los comandos de reconocer ya existen.
  - Tamaño: mediano.
  - La lista bajo la barra de estado puede quedar como resumen.
- **F2. Master Alarm como pulsador cuadrado** en una placa central (`WARNING` arriba, `CAUTION` abajo), igual que el de 12.png.
  - Dónde: `SwitchPanel.tsx`, sacándolo de `StatusBar.tsx` o duplicándolo.
  - Tamaño: chico.
- **F3. Encendidos por pantalla (`Burn ATP`).**
  - Qué: una página `Flt.Burn` (pestaña `Burn` de la PFD) con identificador del encendido (`B-01`…), TIG, cuenta `T-`, Δv, sistema y estado (`Pend`, `ATPed`, `Burning`, `Done`). Teclas `Mnvr Now` (orientar ya) y `Burn ATP` (comprometer el encendido, lo que hoy hace el interruptor con guarda).
  - Se **suma** a los interruptores MAIN ENG y AUX THR, que se quedan: cualquiera de los dos caminos compromete el encendido y bajar la guarda lo sigue cortando.
  - Por qué: 13.png muestra que el encendido se autoriza también desde la PFD (estado `ATPed`).
  - Tamaño: mediano. Toca los procedimientos (`procedures.ts`); el tutorial puede seguir usando las guardas.
- **F4. Pirotecnia como la real.**
  - Qué: una placa al estilo `Survival Pyros` con `PYRO ARM` (único con marco de franjas), `ICPS SEP` y `CM/SM SEP` como palancas comunes que solo actúan con `PYRO ARM` arriba. Reemplaza las tapas individuales y conserva el flujo de dos pasos.
  - `ICPS SEP` no aparece en la foto, pero puede estar en otra parte del panel: se mantiene.
  - `Drogue`, `Main`, `Riser Cut` y `CM Prop Act` no van, porque el descenso no se simula.
  - Dónde: `SwitchPanel.tsx`; en `sim/commands.ts`, el estado del armado.
  - Tamaño: mediano.
- **F5. Interruptores de palanca** dibujados de frente con collar y rótulos de posición arriba y abajo (`ON`/`OFF`, `ARM`/`SAFE`), en lugar de botones redondos.
  - Dónde: SVG en `SwitchPanel.tsx`.
  - Tamaño: mediano. Va junto con F4.
- **F6. Modos del DAP con los nombres y referencias reales.**
  - `LVLH` (nuevo): mantiene el ángulo respecto del horizonte local, así que la actitud gira con la órbita. Es física nueva y barata en el modelo cinemático.
  - `INRTL` pasa a `Intl` y `AUTO` a `Auto`.
  - `MAN` pasa a ser un indicador `Manual` cuando se usa el RHC, como en 13.png.
  - `Free` (deriva libre) es igual a `Intl` en un modelo sin velocidad angular. Tiene sentido recién con la actitud dinámica (pendiente de `CLAUDE.md`); hasta entonces no va.
  - Dónde: `sim/state.ts`, `advance.ts`, `commands.ts`, la PFD y F4.
  - Tamaño: mediano, con tests.
  - Conviene hacerla junto con el indicador de tres ejes.
- **F7. Página `Sys.Sum`** con solo lo que el simulador modela:
  - Fase, próximos LOS y AOS (predichos sobre la trayectoria), propelente total, Δv disponible y configuración (`Vehicle Segment`).
  - Comm: red, enlace y retardo. Prop: cada tanque. GNC: modo del DAP y referencia.
  - Sin EPS, ECLS, CDH, IMU ni GPS: no se simulan.
  - Oxidante y combustible por separado necesitarían la relación de mezcla de cada motor, con fuente.
  - Tamaño: mediano.
- **F8. Prueba de lámparas:** la posición `Test` de `Status Lights` enciende todos los LEDs y anunciadores mientras se mantiene.
  - Por qué: es una función real del panel y no inventa ningún sistema.
  - Tamaño: chico. Opcional.

### Descartado (no se modela)

- FCM, VPU, PDU, PCDU, baterías, voltímetro y selector de fuente (F2 y F5).
- ECLS, CDH, IMU, GPS y la señal de S‑Band en %.
- `Drogue Deploy`, `Main Deploy`, `Riser Cut` y `CM Prop Act`.
- `Survival RCS` (repetiría el RHC y el THC).
- Las páginas `Images`, `DO-Plan` y `Landing`.
- Las perillas de luces de cabina.

Si se modelan más adelante (por ejemplo, EPS con eclipses), sus controles se suman.

## 5. Orden sugerido

1. **E3, E4, E6** (chicos, solo pantalla) y **E1** (paleta).
2. **E2**, si Gastón acepta cambiar la regla del verde.
3. **F1 + F2** (alarmas como en la cabina).
4. **Actitud de tres ejes + indicador + F6** (próxima sesión, decidido por Gastón; ver sección 3).
5. **F4 + F5** (pirotecnia y palancas).
6. **F3** (encendidos por pantalla; toca el tutorial).
7. **F7, E5, E8, F8.**
8. **E7**, con capturas antes de decidir.
