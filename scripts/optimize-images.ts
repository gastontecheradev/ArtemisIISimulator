/**
 * Converts the NASA originals in assets-src/ into lightweight versions in
 * public/assets/nasa/. It is idempotent: it can be re-run without duplicating anything.
 *
 * - earth-* and moon-*: equirectangular textures → 2048×1024 (2D) and 4096×2048 (3D),
 *   in WebP with JPG fallback. earth-day also gets the high-resolution patch around
 *   the pad (EARTH_DETAIL, src/render/earthDetail.ts) if the original is larger than 4K.
 * - The rest: photos → 1200 px wide, WebP and JPG.
 *
 * The output base name is the original's, which has to match its row
 * in ASSETS.md.
 *
 * Usage: npm run images
 */
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { EARTH_DETAIL } from '../src/render/earthDetail';

const SRC = fileURLToPath(new URL('../assets-src/', import.meta.url));
const OUT = fileURLToPath(new URL('../public/assets/nasa/', import.meta.url));
const INPUT = new Set(['.tif', '.tiff', '.png', '.jpg', '.jpeg', '.webp']);

if (!existsSync(SRC)) {
  console.log('No existe assets-src/: no hay originales para procesar.');
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });

const isFresh = (out: string, src: string): boolean => existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs;

async function emit(src: string, name: string, width: number, height?: number): Promise<void> {
  for (const format of ['webp', 'jpg'] as const) {
    const out = join(OUT, `${name}.${format}`);
    if (isFresh(out, src)) {
      console.log(`  = ${name}.${format} (al día)`);
      continue;
    }
    const img = sharp(src, { limitInputPixels: false }).resize(width, height, { fit: height ? 'fill' : 'inside', withoutEnlargement: true });
    await (format === 'webp' ? img.webp({ quality: 82 }) : img.jpeg({ quality: 84, mozjpeg: true })).toFile(out);
    console.log(`  + ${name}.${format}`);
  }
}

/**
 * Cuts EARTH_DETAIL out of the day Earth at the original's native resolution. Only if
 * the original has more detail than the 4K texture; otherwise the app does without it.
 */
async function emitEarthDetail(src: string): Promise<void> {
  const { width = 0, height = 0 } = await sharp(src, { limitInputPixels: false }).metadata();
  if (width <= 4096) {
    console.log(`  (sin ${EARTH_DETAIL.name}: el original no supera los 4096 px)`);
    return;
  }
  const pxPerDegX = width / 360;
  const pxPerDegY = height / 180;
  const left = Math.round((EARTH_DETAIL.lonMin + 180) * pxPerDegX);
  const top = Math.round((90 - EARTH_DETAIL.latMax) * pxPerDegY);
  const w = Math.round((EARTH_DETAIL.lonMax - EARTH_DETAIL.lonMin) * pxPerDegX);
  const h = Math.round((EARTH_DETAIL.latMax - EARTH_DETAIL.latMin) * pxPerDegY);
  for (const format of ['webp', 'jpg'] as const) {
    const out = join(OUT, `${EARTH_DETAIL.name}.${format}`);
    if (isFresh(out, src)) {
      console.log(`  = ${EARTH_DETAIL.name}.${format} (al día)`);
      continue;
    }
    const img = sharp(src, { limitInputPixels: false }).extract({ left, top, width: w, height: h });
    await (format === 'webp' ? img.webp({ quality: 82 }) : img.jpeg({ quality: 84, mozjpeg: true })).toFile(out);
    console.log(`  + ${EARTH_DETAIL.name}.${format} (${w}×${h})`);
  }
}

const files = readdirSync(SRC).filter((f) => INPUT.has(extname(f).toLowerCase()));
if (files.length === 0) console.log('assets-src/ está vacío.');
for (const file of files) {
  const src = join(SRC, file);
  const base = basename(file, extname(file));
  console.log(file);
  if (/^(earth|moon)-/.test(base)) {
    await emit(src, `${base}-2k`, 2048, 1024);
    await emit(src, `${base}-4k`, 4096, 2048);
    if (base === 'earth-day') await emitEarthDetail(src);
  } else {
    await emit(src, base, 1200);
  }
}
