/**
 * Extracts the palette from the reference images (without inventing hex values).
 * For each color a region of an image is defined (in fractions of width/height)
 * and a criterion; the median of the pixels that best meet the criterion is taken.
 * The result replaces the marked block in src/ui/theme.css.
 *
 * Usage: npm run palette
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

type Rgb = [number, number, number];
type Criterion = 'median' | 'bright' | 'dark' | 'green' | 'red' | 'blue' | 'yellow' | 'magenta' | 'orange';

interface Swatch {
  name: string;
  image: string;
  /** x0, y0, x1, y1 in fractions of the image. */
  box: [number, number, number, number];
  pick: Criterion;
  /** Fraction of pixels that best meet the criterion (default 0.1). Thin text needs less. */
  top?: number;
  note: string;
}

const SWATCHES: Swatch[] = [
  // Physical panel (close-up of the three-axis PFD, session 30). The wide photo of the cockpit is
  // lit with strong blue light and gives navy blue for the black bezel: this one is more neutral.
  // The surfaces are nearly black; the lit quarter of the pixels gives the tone the eye reads.
  // Panel metal: back to the gray of the first cockpit photo (Gastón, session 30: the near-black
  // metal of the close-up looked too dark on screen).
  { name: 'panel', image: '9.png', box: [0.005, 0.2, 0.03, 0.27], pick: 'median', note: 'panel metal' },
  { name: 'bezel', image: '13.png', box: [0.2866, 0.1557, 0.3179, 0.202], pick: 'bright', top: 0.25, note: 'display bezel' },
  { name: 'key', image: '13.png', box: [0.3257, 0.16, 0.3413, 0.202], pick: 'bright', top: 0.25, note: 'bezel key' },
  { name: 'key-label', image: '13.png', box: [0.74, 0.13, 0.763, 0.158], pick: 'median', note: 'labeled bezel key (Fav)' },
  { name: 'switch-plate', image: '13.png', box: [0.094, 0.5375, 0.115, 0.593], pick: 'dark', top: 0.5, note: 'switch plate' },
  // Close-up of the first photo of the cockpit (green title bar, guard stripes)
  { name: 'title-bar', image: '9.png', box: [0.4, 0.434, 0.49, 0.448], pick: 'green', note: 'page title bar' },
  { name: 'hazard', image: '9.png', box: [0.595, 0.705, 0.642, 0.735], pick: 'yellow', note: 'guard stripes' },
  // Display conventions of the photo and of the three-axis PFD close-up (session 30)
  { name: 'text', image: '13.png', box: [0.299, 0.815, 0.366, 0.838], pick: 'bright', top: 0.03, note: 'default text (white)' },
  { name: 'softkey-off', image: '13.png', box: [0.218, 0.374, 0.246, 0.407], pick: 'median', note: 'side key label, available' },
  { name: 'softkey-on', image: '13.png', box: [0.228, 0.671, 0.257, 0.713], pick: 'median', note: 'side key label, active' },
  { name: 'status', image: '13.png', box: [0.511, 0.32, 0.542, 0.338], pick: 'bright', top: 0.05, note: 'status text (ATPed)' },
  { name: 'manual', image: '13.png', box: [0.322, 0.337, 0.366, 0.354], pick: 'yellow', top: 0.05, note: 'manual mode' },
  { name: 'page-band', image: '12.png', box: [0.0537, 0.4614, 0.0998, 0.4683], pick: 'blue', top: 0.3, note: 'lower page band in the title bar' },
  { name: 'adi-ground', image: '13.png', box: [0.304, 0.532, 0.322, 0.569], pick: 'median', note: 'attitude ball, below the horizon' },
  // The close-up overexposes the sky band to near white; the wide photo shows it cyan.
  { name: 'adi-sky', image: '12.png', box: [0.1025, 0.2434, 0.1074, 0.248], pick: 'bright', top: 0.3, note: 'attitude ball, above the horizon' },
  { name: 'adi-scale', image: '13.png', box: [0.3095, 0.4041, 0.3241, 0.4096], pick: 'median', note: 'attitude scale background' },
  { name: 'adi-ship', image: '13.png', box: [0.343, 0.521, 0.359, 0.534], pick: 'green', top: 0.05, note: 'spacecraft symbol' },
  { name: 'rate-bar', image: '13.png', box: [0.418, 0.421, 0.425, 0.513], pick: 'green', top: 0.3, note: 'bars on the attitude scales' },
  // Screen (ascent display)
  { name: 'screen', image: '10.png', box: [0.55, 0.3, 0.8, 0.5], pick: 'median', note: 'screen background' },
  { name: 'value', image: '10.png', box: [0.5, 0.115, 0.6, 0.165], pick: 'green', top: 0.02, note: 'current values' },
  { name: 'label', image: '10.png', box: [0.43, 0.24, 0.475, 0.5], pick: 'bright', top: 0.02, note: 'labels and scales (speed tape)' },
  { name: 'caution', image: '10.png', box: [0.41, 0.27, 0.428, 0.55], pick: 'yellow', note: 'caution' },
  { name: 'warning', image: '10.png', box: [0.078, 0.56, 0.094, 0.77], pick: 'red', note: 'limits and alarms' },
  { name: 'command', image: '10.png', box: [0.29, 0.755, 0.33, 0.8], pick: 'magenta', top: 0.02, note: 'targets and commanded values' },
  // Trail by phase (mission map)
  { name: 'trail-out', image: '1.png', box: [0.08, 0.48, 0.3, 0.56], pick: 'green', note: 'orbit and outbound' },
  { name: 'trail-return', image: '1.png', box: [0.548, 0.6, 0.572, 0.64], pick: 'blue', top: 0.3, note: 'return (marker 12)' },
  { name: 'trail-prox', image: '1.png', box: [0.13, 0.4, 0.16, 0.45], pick: 'orange', note: 'proximity operations' },
  // Untextured bodies (mission map), until NASA textures are chosen
  { name: 'body-earth', image: '1.png', box: [0.12, 0.25, 0.2, 0.4], pick: 'blue', top: 0.3, note: "Earth's ocean" },
  { name: 'body-moon', image: '1.png', box: [0.705, 0.56, 0.74, 0.61], pick: 'median', note: "Moon's surface" },
  // Orion 3D model (Orion illustration). The solar cells, the adapter metal and the docking
  // system gold come from the exploded view of Orion and SLS (the cells of the Orion
  // illustration are seen at a grazing angle and gave a grayish blue).
  { name: 'ship-hull', image: '4.png', box: [0.6, 0.38, 0.65, 0.43], pick: 'bright', top: 0.1, note: 'white hull' },
  { name: 'ship-dark', image: '4.png', box: [0.665, 0.755, 0.69, 0.785], pick: 'dark', top: 0.3, note: 'nozzle and heat shield' },
  { name: 'ship-solar', image: '14.png', box: [0.398, 0.3, 0.425, 0.355], pick: 'median', note: 'solar array cells' },
  { name: 'ship-metal', image: '14.png', box: [0.54, 0.455, 0.585, 0.5], pick: 'median', note: 'spacecraft adapter metal' },
  { name: 'ship-gold', image: '14.png', box: [0.575, 0.035, 0.615, 0.06], pick: 'yellow', top: 0.1, note: 'docking system gold' },
  { name: 'ship-core', image: '3.png', box: [0.3, 0.3, 0.42, 0.45], pick: 'orange', top: 0.05, note: 'rocket core stage' },
  // Trail by network (network map)
  { name: 'net-nsn', image: '2.png', box: [0.123, 0.585, 0.17, 0.655], pick: 'green', note: 'Near Space Network' },
  { name: 'net-dsn', image: '2.png', box: [0.43, 0.585, 0.478, 0.655], pick: 'red', note: 'Deep Space Network' },
  // Launch pad (stage 3 of the launch plan): the photo of the rocket on the pad taken from the top
  // of a lightning mast, in full sun (the scene lights the pad with the Sun). The tower's lattice
  // has the sea and the grass behind it: its lit quarter is the steel.
  { name: 'pad-steel', image: 'launch/ML-1-image-1.jpg', box: [0.505, 0.33, 0.53, 0.5], pick: 'bright', top: 0.3, note: 'Mobile Launcher steel' },
  { name: 'pad-base', image: 'launch/ML-1-image-1.jpg', box: [0.53, 0.84, 0.6, 0.88], pick: 'median', note: 'Mobile Launcher base' },
  { name: 'pad-concrete', image: 'launch/ML-1-image-1.jpg', box: [0.36, 0.83, 0.42, 0.9], pick: 'median', note: 'pad concrete' },
  { name: 'pad-tank', image: 'launch/ML-1-image-1.jpg', box: [0.623, 0.425, 0.638, 0.455], pick: 'median', note: 'white tanks' },
  { name: 'pad-hood', image: 'launch/ML-1-image-1.jpg', box: [0.553, 0.775, 0.572, 0.81], pick: 'median', note: 'tail service mast hood' },
  // Launch cloud (stage 5): the steam of the ground cloud east of the rocket in the liftoff photo
  // (mostly in shade there: its sunlit tenth is the white), and the boosters' smoke, the tan column
  // of the photo taken a few seconds later, in the low Sun of the launch hour.
  { name: 'smoke-steam', image: 'launch/launch-1.jpg', box: [0.71, 0.85, 0.82, 0.94], pick: 'bright', top: 0.1, note: 'launch cloud steam, in the sun' },
  { name: 'smoke-tan', image: 'launch/launch-2.jpg', box: [0.44, 0.73, 0.5, 0.82], pick: 'median', note: 'booster smoke, in the sun' },
  // Ground around the pad (stage 6): the same photo from the top of a lightning mast, in full sun. The
  // grass is the green lawn east of the rocket (the photo from the grass, `ML1-image-3.jpg`, shows it
  // dormant, olive brown); the scrub, the dense band beyond the mowed grounds; the sand, the bare patch
  // by the round structure at the left edge (the beach is a few pixels wide there); the water, the open
  // sea near the shore; the road, the paved apron of a service road.
  { name: 'ground-grass', image: 'launch/ML-1-image-1.jpg', box: [0.86, 0.56, 0.9, 0.59], pick: 'median', note: 'mowed grass' },
  { name: 'ground-scrub', image: 'launch/ML-1-image-1.jpg', box: [0.31, 0.429, 0.36, 0.438], pick: 'median', note: 'scrub beyond the mowed grounds' },
  { name: 'ground-sand', image: 'launch/ML-1-image-1.jpg', box: [0.082, 0.705, 0.1, 0.72], pick: 'median', note: 'bare sand' },
  { name: 'ground-water', image: 'launch/ML-1-image-1.jpg', box: [0.75, 0.31, 0.9, 0.36], pick: 'median', note: 'sea near the shore' },
  { name: 'ground-road', image: 'launch/ML-1-image-1.jpg', box: [0.915, 0.598, 0.945, 0.612], pick: 'median', note: 'paved service road' },
];

const score: Record<Exclude<Criterion, 'median'>, (p: Rgb) => number> = {
  bright: ([r, g, b]) => r + g + b,
  dark: ([r, g, b]) => -(r + g + b),
  green: ([r, g, b]) => g - Math.max(r, b),
  red: ([r, g, b]) => r - Math.max(g, b),
  blue: ([r, g, b]) => b - Math.max(r, g),
  yellow: ([r, g, b]) => Math.min(r, g) - b,
  magenta: ([r, g, b]) => Math.min(r, b) - g,
  orange: ([r, g, b]) => r - b - Math.abs(g - (r + b) / 2),
};

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function sample(s: Swatch): Promise<Rgb> {
  const file = fileURLToPath(new URL(`../docs/reference/${s.image}`, import.meta.url));
  const img = sharp(file).removeAlpha();
  const meta = await img.metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const left = Math.round(s.box[0] * W);
  const top = Math.round(s.box[1] * H);
  const width = Math.max(1, Math.round((s.box[2] - s.box[0]) * W));
  const height = Math.max(1, Math.round((s.box[3] - s.box[1]) * H));
  const { data } = await img.extract({ left, top, width, height }).raw().toBuffer({ resolveWithObject: true });
  let pixels: Rgb[] = [];
  for (let i = 0; i + 2 < data.length; i += 3) pixels.push([data[i], data[i + 1], data[i + 2]]);
  if (s.pick !== 'median') {
    const f = score[s.pick];
    pixels.sort((a, b) => f(b) - f(a));
    pixels = pixels.slice(0, Math.max(1, Math.floor(pixels.length * (s.top ?? 0.1))));
  }
  return [median(pixels.map((p) => p[0])), median(pixels.map((p) => p[1])), median(pixels.map((p) => p[2]))];
}

const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const themePath = fileURLToPath(new URL('../src/ui/theme.css', import.meta.url));
const START = '/* palette:start (generated by scripts/extract-palette.ts, do not edit by hand) */';
const END = '/* palette:end */';
const css = readFileSync(themePath, 'utf8');
const a = css.indexOf(START);
const b = css.indexOf(END);
if (a < 0 || b < 0) throw new Error('theme.css no tiene los marcadores de paleta');

/**
 * The reference images live only on Gastón's disk (outside git), and a copy of the project may lack
 * some of them. A swatch whose image is missing keeps the value already in theme.css, which was
 * sampled from that image when it was there; a new swatch without its image is an error.
 */
const previous = new Map<string, string>();
for (const m of css.slice(a, b).matchAll(/--c-([\w-]+):\s*(#[0-9a-f]{6});/gi)) previous.set(m[1], m[2]);
const imageExists = (s: Swatch): boolean => existsSync(fileURLToPath(new URL(`../docs/reference/${s.image}`, import.meta.url)));

const lines: string[] = [];
for (const s of SWATCHES) {
  let value: string;
  if (imageExists(s)) {
    value = hex(await sample(s));
    console.log(`${s.name.padEnd(14)} ${value}  ${s.image}  ${s.note}`);
  } else {
    const kept = previous.get(s.name);
    if (!kept) throw new Error(`Falta docs/reference/${s.image} y theme.css no tiene --c-${s.name}`);
    value = kept;
    console.log(`${s.name.padEnd(14)} ${value}  (se mantiene: falta ${s.image})`);
  }
  lines.push(`  --c-${s.name}: ${value}; /* ${s.note} */`);
}
writeFileSync(themePath, `${css.slice(0, a)}${START}\n:root {\n${lines.join('\n')}\n}\n${css.slice(b)}`);
console.log('\nsrc/ui/theme.css actualizado.');
