// Turns the raw generated plates in art/raw into the web assets in public/art.
// Run: node scripts/prepare-art.mjs
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const RAW = "art/raw";
const OUT = "public/art";
await mkdir(OUT, { recursive: true });

// Plates are generated at about 1.6k wide; a Lanczos 2x with light sharpening holds up
// on high-density desktop screens, and the 1x file serves phones.
const plates = ["hero-plate", "build", "automate", "rest"];
for (const name of plates) {
  const src = sharp(`${RAW}/${name}.png`);
  const { width } = await src.metadata();
  await src.clone().webp({ quality: 84 }).toFile(`${OUT}/${name}-1x.webp`);
  await src
    .clone()
    .resize({ width: width * 2, kernel: "lanczos3" })
    .sharpen({ sigma: 0.7, m1: 0.6, m2: 1.2 })
    .webp({ quality: 80 })
    .toFile(`${OUT}/${name}-2x.webp`);
}

// The ball: trim to its alpha and lay it over its own red so the rim never blends toward
// black. It is cut slightly inside its edge and overfills the frame; the page clips it to a
// circle in CSS, which stays sharp however large the ball is drawn.
const SIZE = 1024;
const trimmed = await sharp(`${RAW}/ball.png`).trim({ threshold: 40 }).toBuffer();
const over = Math.round(SIZE * 1.045);
const inset = Math.round((over - SIZE) / 2);
await sharp(trimmed)
  .resize(over, over, { fit: "fill", kernel: "lanczos3" })
  .flatten({ background: "#a8231a" })
  .extract({ left: inset, top: inset, width: SIZE, height: SIZE })
  .webp({ quality: 93 })
  .toFile(`${OUT}/ball.webp`);

const stats = await sharp(trimmed).resize(64, 64).removeAlpha().stats();
console.log("ball mean rgb", stats.channels.map((c) => Math.round(c.mean)).join(","));
for (const name of plates) {
  const { width, height } = await sharp(`${OUT}/${name}-2x.webp`).metadata();
  console.log(name, `${width}x${height}`);
}

// Automate: the near (left) arc of each steel hoop has to pass in front of the ball.
// Cut those arcs out of the plate into their own layer, registered pixel for pixel.
{
  const src = sharp(`${RAW}/automate.png`);
  const { data, info } = await src.clone().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const dark = (x, y) => Math.max(data[(y * W + x) * C], data[(y * W + x) * C + 1], data[(y * W + x) * C + 2]);

  const columns = [];
  for (let x = 0; x < W; x++) {
    let n = 0;
    for (let y = 0; y < H; y++) if (dark(x, y) < 62) n++;
    columns.push(n);
  }
  const hoops = [];
  let start = -1;
  let gap = 0;
  for (let x = 0; x <= W; x++) {
    const on = x < W && columns[x] >= 3;
    if (on) {
      if (start < 0) start = x;
      gap = 0;
    } else if (start >= 0 && (++gap > 30 || x === W)) {
      const end = x - gap;
      if (end - start > 60) hoops.push({ left: start, right: end, centre: Math.round((start + end) / 2) });
      start = -1;
      gap = 0;
    }
  }
  for (const hoop of hoops) {
    let top = H;
    for (let y = 0; y < H && top === H; y++) if (dark(hoop.centre, y) < 62) top = y;
    hoop.top = top;
  }
  console.log("hoops", JSON.stringify(hoops));

  const alpha = Buffer.alloc(W * H);
  for (const { left, centre } of hoops) {
    for (let x = Math.max(0, left - 3); x <= centre; x++) {
      for (let y = 0; y < H; y++) {
        const a = (104 - dark(x, y)) / 36;
        alpha[y * W + x] = Math.round(255 * Math.min(1, Math.max(0, a)));
      }
    }
  }
  const rgb = await src.clone().removeAlpha().raw().toBuffer();
  const rgba = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();
  await sharp(rgba).webp({ quality: 88, alphaQuality: 100 }).toFile(`${OUT}/automate-fg-1x.webp`);
  await sharp(rgba)
    .resize({ width: W * 2, kernel: "lanczos3" })
    .webp({ quality: 84, alphaQuality: 100 })
    .toFile(`${OUT}/automate-fg-2x.webp`);
}

// Portraits and product shots. The original portrait keeps its crop (generator watermark, bottom right).
await sharp(`${RAW}/portrait-source.jpg`)
  .extract({ left: 0, top: 0, width: 796, height: 940 })
  .webp({ quality: 86 })
  .toFile(`${OUT}/portrait-original.webp`);

const { existsSync } = await import("node:fs");
for (const name of ["portrait-a", "portrait-b", "sample-site", "sample-crm", "sample-followup", "sample-ads"]) {
  if (!existsSync(`${RAW}/${name}.png`)) continue;
  const img = sharp(`${RAW}/${name}.png`);
  const { width, height } = await img.metadata();
  await img.webp({ quality: 86 }).toFile(`${OUT}/${name}.webp`);
  console.log(name, `${width}x${height}`);
}
