/**
 * Extracts the palette from the reference images (without inventing hex values).
 * For each color a region of an image is defined (in fractions of width/height)
 * and a criterion; the median of the pixels that best meet the criterion is taken.
 * The result replaces the marked block in src/ui/theme.css.
 *
 * Usage: npm run palette
 */
import { readFileSync, writeFileSync } from 'node:fs';
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
  // Orion 3D model (Orion illustration)
  { name: 'ship-hull', image: '4.png', box: [0.6, 0.38, 0.65, 0.43], pick: 'bright', top: 0.1, note: 'white hull' },
  { name: 'ship-dark', image: '4.png', box: [0.665, 0.755, 0.69, 0.785], pick: 'dark', top: 0.3, note: 'nozzle and heat shield' },
  { name: 'ship-solar', image: '4.png', box: [0.72, 0.55, 0.82, 0.67], pick: 'blue', top: 0.1, note: 'solar array cells' },
  { name: 'ship-core', image: '3.png', box: [0.3, 0.3, 0.42, 0.45], pick: 'orange', top: 0.05, note: 'rocket core stage' },
  // Trail by network (network map)
  { name: 'net-nsn', image: '2.png', box: [0.123, 0.585, 0.17, 0.655], pick: 'green', note: 'Near Space Network' },
  { name: 'net-dsn', image: '2.png', box: [0.43, 0.585, 0.478, 0.655], pick: 'red', note: 'Deep Space Network' },
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

const lines: string[] = [];
for (const s of SWATCHES) {
  const c = await sample(s);
  lines.push(`  --c-${s.name}: ${hex(c)}; /* ${s.note} */`);
  console.log(`${s.name.padEnd(14)} ${hex(c)}  ${s.image}  ${s.note}`);
}

const themePath = fileURLToPath(new URL('../src/ui/theme.css', import.meta.url));
const START = '/* palette:start (generated by scripts/extract-palette.ts, do not edit by hand) */';
const END = '/* palette:end */';
const css = readFileSync(themePath, 'utf8');
const a = css.indexOf(START);
const b = css.indexOf(END);
if (a < 0 || b < 0) throw new Error('theme.css no tiene los marcadores de paleta');
writeFileSync(themePath, `${css.slice(0, a)}${START}\n:root {\n${lines.join('\n')}\n}\n${css.slice(b)}`);
console.log('\nsrc/ui/theme.css actualizado.');
