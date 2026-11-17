/**
 * High-resolution patch of the Earth texture around the pad, for the 3D view during
 * the ascent and the first orbits. It is cut at the original's native resolution by
 * `npm run images` (scripts/optimize-images.ts) and drawn over the global texture by
 * the Earth shader (render/bodies.ts). No three.js here: the script imports it too.
 *
 * The window is a drawing choice: 68° × 34° (degrees, east and north positive), biased
 * east of LC‑39B because the rocket flies east. With the 21,600 px Blue Marble that is
 * 4,080 × 2,040 px (~2 km per pixel), within every GPU's texture limit.
 */
export const EARTH_DETAIL = {
  /** Base name of the generated files (.webp and .jpg) in public/assets/nasa/. */
  name: 'earth-day-pad',
  lonMin: -100,
  lonMax: -32,
  latMin: 11,
  latMax: 45,
  /** Width (degrees) of the band at the edge where the patch fades into the global texture. */
  fade: 2,
} as const;
