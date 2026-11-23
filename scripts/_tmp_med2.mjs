import sharp from 'sharp';
const f = 'docs/reference/launch/ML-1-image-1.jpg';
const boxes = { sandA: [0.05, 0.717, 0.1, 0.735], sandB: [0.13, 0.685, 0.2, 0.7], sandC: [0.082, 0.705, 0.1, 0.72] };
const meta = await sharp(f).metadata();
for (const [k, b] of Object.entries(boxes)) {
  const left = Math.round(b[0] * meta.width), top = Math.round(b[1] * meta.height), width = Math.round((b[2] - b[0]) * meta.width), height = Math.round((b[3] - b[1]) * meta.height);
  const { data } = await sharp(f).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let px = [];
  for (let i = 0; i + 2 < data.length; i += 3) px.push([data[i], data[i + 1], data[i + 2]]);
  for (const top of [1, 0.5, 0.3]) {
    const s = [...px].sort((a, b) => b[0] + b[1] + b[2] - a[0] - a[1] - a[2]).slice(0, Math.floor(px.length * top));
    const med = (c) => s.map((p) => p[c]).sort((a, b) => a - b)[s.length >> 1];
    console.log(k, top, '#' + [0, 1, 2].map((c) => med(c).toString(16).padStart(2, '0')).join(''));
  }
}
