import sharp from 'sharp';
// node crop.mjs image out x0 y0 x1 y1 [width]: crop in fractions, with a grid every 0.01 (thin) and 0.05 (thick)
const [f, out, a, b, c, d, wOut] = process.argv.slice(2);
const [x0, y0, x1, y1] = [a, b, c, d].map(Number);
const meta = await sharp(f).metadata();
const W = meta.width, H = meta.height;
const left = Math.round(x0 * W), top = Math.round(y0 * H), width = Math.min(W - left, Math.round((x1 - x0) * W)), height = Math.min(H - top, Math.round((y1 - y0) * H));
const ow = Number(wOut ?? 900), oh = Math.round(ow * height / width);
let svg = `<svg width="${ow}" height="${oh}" xmlns="http://www.w3.org/2000/svg">`;
for (let g = Math.ceil(x0 * 100); g <= Math.floor(x1 * 100); g++) { const x = ((g / 100 - x0) / (x1 - x0)) * ow; const thick = g % 5 === 0; svg += `<line x1="${x}" y1="0" x2="${x}" y2="${oh}" stroke="${thick ? 'red' : 'yellow'}" stroke-opacity="${thick ? 0.8 : 0.35}" stroke-width="1"/>`; if (thick) svg += `<text x="${x + 2}" y="12" fill="red" font-size="12">${(g / 100).toFixed(2)}</text>`; }
for (let g = Math.ceil(y0 * 100); g <= Math.floor(y1 * 100); g++) { const y = ((g / 100 - y0) / (y1 - y0)) * oh; const thick = g % 5 === 0; svg += `<line x1="0" y1="${y}" x2="${ow}" y2="${y}" stroke="${thick ? 'red' : 'yellow'}" stroke-opacity="${thick ? 0.8 : 0.35}" stroke-width="1"/>`; if (thick) svg += `<text x="2" y="${y - 2}" fill="red" font-size="12">${(g / 100).toFixed(2)}</text>`; }
svg += '</svg>';
await sharp(f).extract({ left, top, width, height }).resize(ow, oh).composite([{ input: Buffer.from(svg) }]).toFile(out);
