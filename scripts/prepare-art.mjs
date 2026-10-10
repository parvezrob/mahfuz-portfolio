// Turns the raw generated plates in art/raw into the web assets in public/art.
// Run: node scripts/prepare-art.mjs
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const RAW = "art/raw";
const OUT = "public/art";
await mkdir(OUT, { recursive: true });

// Plates are generated at about 1.6k wide. The 1x file serves phones. The 2x file comes from
// art/up/<name>.png when a super-resolution pass has produced one (scripts/upscale-art.*),
// and from a Lanczos 2x with light sharpening otherwise.
const { existsSync } = await import("node:fs");
const plates = ["hero-plate", "build", "build-empty", "build-tall", "build-tall-empty", "automate", "rest"].filter((name) => existsSync(`${RAW}/${name}.png`));
async function double(name) {
  const up = `art/up/${name}.png`;
  const { width } = await sharp(`${RAW}/${name}.png`).metadata();
  if (existsSync(up)) return sharp(up).resize({ width: width * 2 }).png().toBuffer();
  return sharp(`${RAW}/${name}.png`)
    .resize({ width: width * 2, kernel: "lanczos3" })
    .sharpen({ sigma: 0.7, m1: 0.6, m2: 1.2 })
    .png()
    .toBuffer();
}
for (const name of plates) {
  await sharp(`${RAW}/${name}.png`).webp({ quality: 84 }).toFile(`${OUT}/${name}-1x.webp`);
  await sharp(await double(name)).webp({ quality: 82 }).toFile(`${OUT}/${name}-2x.webp`);
}

// The ball: trim to its alpha and lay it over its own red so the rim never blends toward
// black. It is cut slightly inside its edge and overfills the frame; the page clips it to a
// circle in CSS, which stays sharp however large the ball is drawn.
const SIZE = 1024;
const ballSource = existsSync("art/up/ball.png") ? "art/up/ball.png" : `${RAW}/ball.png`;
const trimmed = await sharp(ballSource).trim({ threshold: 40 }).toBuffer();
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

// Automate: the near (left) arc of each steel hoop and the near rail pass in front of the
// ball. Lift them out of the plate into their own layer, registered pixel for pixel. The
// matte is built separately at 1x and 2x from the very plate each will sit on.
{
  // The near rail's centre line in 1x plate pixels (the same points the page places the ball with).
  const RAIL = [[-100, 264], [20, 300.5], [100, 324.5], [330, 394], [420, 422.5], [560, 467], [860, 565.5], [1000, 611], [1150, 660], [1420, 748.5], [1500, 775], [1650, 824]];
  const railY = (x) => {
    for (let i = 1; i < RAIL.length; i++) {
      if (x <= RAIL[i][0]) {
        const [x0, y0] = RAIL[i - 1];
        const [x1, y1] = RAIL[i];
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return RAIL[RAIL.length - 1][1];
  };

  async function foreground(png, k, report) {
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: W, height: H } = info;
    const at = (x, y) => (y * W + x) * 3;
    const peak = (i) => Math.max(data[i], data[i + 1], data[i + 2]);
    // Painted steel is neutral and clearly darker than the wall; the wall is bright and barely warm.
    const steel = (i) => data[i] - data[i + 2] < 34 && peak(i) < 196;
    const wall = (i) => peak(i) >= 188 && data[i] - data[i + 2] < 42;

    // Find the three hoops from their darkest rims.
    const columns = new Uint32Array(W);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (peak(at(x, y)) < 62) columns[x]++;
    const hoops = [];
    let start = -1;
    let gap = 0;
    for (let x = 0; x <= W; x++) {
      const on = x < W && columns[x] >= 3 * k;
      if (on) {
        if (start < 0) start = x;
        gap = 0;
      } else if (start >= 0 && (++gap > 30 * k || x === W)) {
        const end = x - gap;
        if (end - start > 60 * k) hoops.push({ left: start, right: end, centre: Math.round((start + end) / 2) });
        start = -1;
        gap = 0;
      }
    }
    for (const hoop of hoops) {
      const rows = [];
      for (let y = 0; y < H; y++) if (peak(at(hoop.centre, y)) < 62) rows.push(y);
      hoop.top = rows[0];
      hoop.bottom = rows.filter((y) => y < rows[0] + 330 * k).pop();
    }
    if (report) console.log("hoops", JSON.stringify(hoops.map((h) => ({ x: Math.round(h.centre / k), top: Math.round(h.top / k) }))));

    const alpha = new Uint8Array(W * H);
    const rgb = Buffer.from(data);
    const solid = new Uint8Array(W * H); // 1 = steel, 2 = brass
    for (const { left, centre, top, bottom } of hoops) {
      for (let y = Math.max(0, top - 4 * k); y <= Math.min(H - 1, bottom + 4 * k); y++) {
        for (let x = Math.max(0, left - 4 * k); x <= centre; x++) {
          const i = at(x, y);
          if (!steel(i)) continue;
          // Fully solid up to a mid grey, feathering out through the anti-aliased rim.
          const a = Math.min(1, (196 - peak(i)) / 44);
          alpha[y * W + x] = Math.round(255 * a);
          if (a >= 1) solid[y * W + x] = 1;
        }
      }
    }
    // The near rail. Its exact top and bottom edges are read from the plate in every column,
    // median-smoothed along the rail so hoop crossings and specks cannot bend them, and the
    // matte is a clean band between those edges with a one-pixel feather. The plate's own
    // pixels are used unchanged, so the rail keeps its real highlight and anti-aliasing.
    const tops = new Float32Array(W);
    const bottoms = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const mid = railY(x / k) * k;
      let best = null;
      let run = null;
      for (let y = Math.max(0, Math.floor(mid - 9 * k)); y <= Math.min(H - 1, Math.ceil(mid + 9 * k)) + 1; y++) {
        const on = y < H && y <= mid + 9 * k && !wall(at(x, y));
        if (on) run = run ? [run[0], y] : [y, y];
        if (!on && run) {
          if (!best || Math.abs((run[0] + run[1]) / 2 - mid) < Math.abs((best[0] + best[1]) / 2 - mid)) best = run;
          run = null;
        }
      }
      tops[x] = best ? best[0] - mid : NaN;
      bottoms[x] = best ? best[1] - mid : NaN;
    }
    const median = (values, x, half) => {
      const window = [];
      for (let i = Math.max(0, x - half); i <= Math.min(W - 1, x + half); i++) if (!Number.isNaN(values[i])) window.push(values[i]);
      window.sort((p, q) => p - q);
      return window.length ? window[window.length >> 1] : 0;
    };
    for (let x = 0; x < W; x++) {
      const mid = railY(x / k) * k;
      const top = mid + median(tops, x, 44 * k) - 0.6;
      const bottom = mid + median(bottoms, x, 44 * k) + 0.6;
      for (let y = Math.max(0, Math.floor(top - 2)); y <= Math.min(H - 1, Math.ceil(bottom + 2)); y++) {
        const inside = Math.min(y - top, bottom - y) + 1;
        const a = Math.round(255 * Math.min(1, Math.max(0, inside)));
        if (a > alpha[y * W + x]) alpha[y * W + x] = a;
        if (a === 255) solid[y * W + x] = 2;
      }
    }

    // Give every soft-edged steel pixel the colour of the nearest solid steel one, so no wall
    // colour is carried onto the ball as a pale fringe.
    const soft = alpha;
    const reach = 2 * k + 1;
    for (let y = reach; y < H - reach; y++) {
      for (let x = reach; x < W - reach; x++) {
        const j = y * W + x;
        if (!soft[j] || soft[j] === 255 || solid[j]) continue;
        if (!steel(at(x, y))) continue;
        let best = -1;
        let bestD = Infinity;
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dx = -reach; dx <= reach; dx++) {
            const n = j + dy * W + dx;
            const d = dx * dx + dy * dy;
            if (solid[n] === 1 && d < bestD) {
              bestD = d;
              best = n;
            }
          }
        }
        // A soft pixel with no solid neighbour is a stray highlight or speck, not an edge: drop it.
        if (best < 0) {
          soft[j] = 0;
          continue;
        }
        rgb[j * 3] = rgb[best * 3];
        rgb[j * 3 + 1] = rgb[best * 3 + 1];
        rgb[j * 3 + 2] = rgb[best * 3 + 2];
      }
    }
    return sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
      .joinChannel(Buffer.from(soft), { raw: { width: W, height: H, channels: 1 } })
      .webp({ quality: 90, alphaQuality: 100 });
  }

  await (await foreground(await sharp(`${RAW}/automate.png`).png().toBuffer(), 1, true)).toFile(`${OUT}/automate-fg-1x.webp`);
  await (await foreground(await double("automate"), 2, false)).toFile(`${OUT}/automate-fg-2x.webp`);
}

// Portraits and product shots. The original portrait keeps its crop (generator watermark, bottom right).
await sharp(`${RAW}/portrait-source.jpg`)
  .extract({ left: 0, top: 0, width: 796, height: 940 })
  .webp({ quality: 86 })
  .toFile(`${OUT}/portrait-original.webp`);

for (const name of ["portrait-a", "portrait-b", "portrait-c", "sample-site", "sample-crm", "sample-followup", "sample-ads"]) {
  if (!existsSync(`${RAW}/${name}.png`)) continue;
  await sharp(`${RAW}/${name}.png`).webp({ quality: 86 }).toFile(`${OUT}/${name}.webp`);
  if (existsSync(`art/up/${name}.png`)) await sharp(`art/up/${name}.png`).webp({ quality: 82 }).toFile(`${OUT}/${name}-2x.webp`);
}

// The empty studio wall, cropped above the floor line: the backdrop for the flat sections,
// so the whole page sits in the same photographed room.
if (existsSync(`${RAW}/room.png`)) {
  const wide = existsSync("art/up/room.png") ? { file: "art/up/room.png", k: 2 } : { file: `${RAW}/room.png`, k: 1 };
  await sharp(wide.file)
    .extract({ left: 0, top: 0, width: 1536 * wide.k, height: 744 * wide.k })
    .resize({ width: 2560, kernel: "lanczos3" })
    .webp({ quality: 80 })
    .toFile(`${OUT}/wall.webp`);
  const tall = existsSync("art/up/room-tall.png") ? { file: "art/up/room-tall.png", k: 2 } : { file: `${RAW}/room-tall.png`, k: 1 };
  await sharp(tall.file)
    .extract({ left: 0, top: 0, width: 1024 * tall.k, height: 1190 * tall.k })
    .resize({ width: 1280, kernel: "lanczos3" })
    .webp({ quality: 80 })
    .toFile(`${OUT}/wall-tall.webp`);
}

// The browser-tab icon is the ball itself.
{
  const size = 192;
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 4}" fill="#fff"/></svg>`);
  const rgb = await sharp(`${OUT}/ball.webp`).resize(size, size).removeAlpha().raw().toBuffer();
  await sharp(rgb, { raw: { width: size, height: size, channels: 3 } })
    .joinChannel(await sharp(mask).extractChannel(0).raw().toBuffer(), { raw: { width: size, height: size, channels: 1 } })
    .png()
    .toFile("src/app/icon.png");
}

// Build: every part of the flat-lay must be able to appear on its own. Bake one sprite image
// per composition: the photograph, opaque inside each part's box, fading to nothing over the
// box's last few pixels, transparent everywhere else. (CSS masks did this before and cost
// phones dearly.)
{
  const { readFileSync } = await import("node:fs");
  const boxes = JSON.parse(readFileSync("src/content/build-parts.json", "utf8"));
  const FEATHER = 9;
  for (const [name, list] of [["build", boxes.wide], ["build-tall", boxes.tall]]) {
    if (!existsSync(`${RAW}/${name}.png`)) continue;
    for (const k of [1, 2]) {
      const png = k === 1 ? await sharp(`${RAW}/${name}.png`).png().toBuffer() : await double(name);
      const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const { width: W, height: H } = info;
      const alpha = Buffer.alloc(W * H);
      for (const [bx, by, bw, bh] of list) {
        for (let y = by * k; y < (by + bh) * k; y++) {
          for (let x = bx * k; x < (bx + bw) * k; x++) {
            const edge = Math.min(x - bx * k, (bx + bw) * k - 1 - x, y - by * k, (by + bh) * k - 1 - y);
            const a = Math.round(255 * Math.min(1, edge / (FEATHER * k)));
            if (a > alpha[y * W + x]) alpha[y * W + x] = a;
          }
        }
      }
      await sharp(data, { raw: { width: W, height: H, channels: 3 } })
        .joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } })
        .webp({ quality: 84, alphaQuality: 90 })
        .toFile(`${OUT}/${name}-parts-${k}x.webp`);
    }
  }
}
