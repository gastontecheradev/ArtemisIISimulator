# Registro de imágenes de NASA

Cada archivo de `public/assets/nasa/` tiene que tener una fila en "Imágenes en uso". La sección "Créditos" de la app se genera leyendo esa tabla.

Reglas (ver `CLAUDE.md`): solo imágenes elegidas por Gastón, con crédito "NASA" o "NASA/Nombre". Los originales van a `assets-src/` (fuera del repo) y se optimizan con `npm run images`. Las imágenes de `docs/reference/` no se registran acá porque no se usan en la app.

## Imágenes en uso

| Archivo | URL de origen | ID de NASA | Crédito | Fecha de descarga |
|---|---|---|---|---|
| earth-day | https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry | Blue Marble Next Generation, April 2004 | NASA Earth Observatory/Reto Stöckli | 2026-11-17 |
| moon-color | https://svs.gsfc.nasa.gov/4720 | SVS 4720, CGI Moon Kit | NASA's Scientific Visualization Studio | 2026-11-17 |

Cada fila cubre las cuatro versiones que genera `npm run images` (`-2k`/`-4k`, `.webp`/`.jpg`). Originales: `world.topo.bathy.200404.3x5400x2700.jpg` (5400 × 2700, topografía y batimetría, abril de 2004) y `lroc_color_16bit_srgb_4k.tif` (4096 × 2048, 16 bits, mapa de color LROC del CGI Moon Kit). Las dos son equirectangulares con la longitud 0 en el centro. La app las usa en la vista 3D (4K) y en el recuadro del entorno (2K); el mapa 2D sigue con colores lisos.

## Pendientes

La pantalla final todavía muestra un recuadro vacío.

| Uso | Nombre base esperado | Fuente sugerida | Estado |
|---|---|---|---|
| Foto de amerizaje para la pantalla final (E15) | `splashdown` | images.nasa.gov, "Orion splashdown" | Pendiente. Ojo: `docs/reference/7.png` es de Artemis I y es una captura, no sirve como asset |
| Fotos para el log de eventos y pantalla de inicio | a definir | images.nasa.gov, "Artemis II" | Pendiente (opcional) |

`scripts/optimize-images.ts` reconoce esos nombres base: `earth-*` y `moon-*` se tratan como texturas equirectangulares (2048×1024 y 4096×2048) y el resto como fotos (1200 px de ancho).
