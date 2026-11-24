import sharp from 'sharp';
const f = process.argv[2] ?? 'docs/reference/launch/ML-1-image-1.jpg';
const boxes = { grassFront: [0.2, 0.93, 0.6, 0.99], grassMid: [0.05, 0.86, 0.3, 0.9] };
const meta = await sharp(f).metadata();
for (const [k, b] of Object.entries(boxes)) {
  const left = Math.round(b[0] * meta.width), top = Math.round(b[1] * meta.height), width = Math.round((b[2] - b[0]) * meta.width), height = Math.round((b[3] - b[1]) * meta.height);
  const { data } = await sharp(f).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = [[], [], []];
  for (let i = 0; i + 2 < data.length; i += 3) for (let c = 0; c < 3; c++) ch[c].push(data[i + c]);
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  const q = (a, p) => a.sort((x, y) => x - y)[Math.floor(a.length * p)];
  console.log(k.padEnd(8), '#' + ch.map((a) => med(a).toString(16).padStart(2, '0')).join(''), 'n', ch[0].length, 'p10-p90 R', q(ch[0], 0.1), q(ch[0], 0.9));
}
