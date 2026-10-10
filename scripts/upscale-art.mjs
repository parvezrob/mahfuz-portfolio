// Sharper 2x plates: art/raw/<name>.png -> art/up/<name>.png, exactly twice the size.
//
// Run: node scripts/upscale-art.mjs              every raw plate without an up-to-date result
//      node scripts/upscale-art.mjs build rest   only these
//      node scripts/upscale-art.mjs --force      redo them all
//
// How it works. A super-resolution network (realesrnet-x4plus, run on the GPU by
// realesrgan-ncnn-vulkan) makes a 4x picture, which is reduced to 2x. That picture has crisp
// edges but no grain and slightly drifted tones, so it is not used as it stands. Instead:
//
//     result = network2x + lanczos2x(raw - lanczosHalf(network2x))
//
// Everything the raw plate can represent (framing, tone, grain, every pore) comes from the raw
// plate; the network only contributes the detail finer than a raw pixel. Shrinking the result
// back therefore returns the raw plate, which is checked for every file before it is written:
// a result that is not exactly 2x, drifts from the raw plate or is shifted is refused.
//
// Pixel centres stay aligned, so a point at (x, y) in the raw plate is at (2x, 2y) in the
// result, measured from the image corner. (sharp's own enlarging resize lands half an output
// pixel down and right of that, and is bicubic whatever kernel is asked for.)
//
// The tool is not part of the repo. To install it (github.com only):
//   D=~/.cache/riaz-upscale; mkdir -p $D/dl
//   gh release download v0.2.5.0 -R xinntao/Real-ESRGAN -p realesrgan-ncnn-vulkan-20220424-ubuntu.zip -D $D/dl
//   gh release download v0.2.3.0 -R xinntao/Real-ESRGAN -p realesrgan-ncnn-vulkan-20211212-ubuntu.zip -D $D/dl
//   unzip -q $D/dl/realesrgan-ncnn-vulkan-20220424-ubuntu.zip -d $D/realesrgan-ncnn-vulkan-20220424
//   unzip -q -j $D/dl/realesrgan-ncnn-vulkan-20211212-ubuntu.zip 'models/realesrnet-x4plus.*' -d $D/models-extra
//   chmod +x $D/realesrgan-ncnn-vulkan-20220424/realesrgan-ncnn-vulkan
// It needs a Vulkan driver. The files are checked against the hashes below before they run.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RAW = join(ROOT, "art/raw");
const OUT = join(ROOT, "art/up");
const HOME = process.env.RIAZ_UPSCALE_HOME ?? join(homedir(), ".cache/riaz-upscale");
const TOOL = join(HOME, "realesrgan-ncnn-vulkan-20220424/realesrgan-ncnn-vulkan");
const MODELS = join(HOME, "models-extra");
// realesrnet-x4plus is the network trained without the adversarial loss. Its sibling
// realesrgan-x4plus looks sharper at a glance but paints: waxy skin, pen-line eyelids, peppered
// travertine and scratches on bare plaster. It was tried on every plate and rejected.
const MODEL = "realesrnet-x4plus";
const SHA256 = {
  [TOOL]: "22c2296a39b40cc43ac92615c827ab6d4b60b7142e8cee59f718e3f8e2cdbda9",
  [join(MODELS, `${MODEL}.bin`)]: "26bccfcc82d9e8260c0c6b0dffb34ab297982740882d1f33c6d423f70b562c40",
  [join(MODELS, `${MODEL}.param`)]: "35330ececcea33b6c397a72548e788d5d53becee4734c50b7fada36e89f10a86",
};

// Raw files that are not plates: hero-a1 is a superseded take. Anything else that is a PNG
// is upscaled, so a new plate only has to be dropped into art/raw.
const SKIP = new Set(["hero-a1"]);

// A result is refused when shrinking it back differs from the raw plate by more than this
// (mean absolute difference, 8-bit levels) or sits more than this far from it (raw pixels).
const MAX_DIFF = 1.0;
const MAX_SHIFT = 0.05;

// ---------- float images: { d: Float32Array, W, H, C }, values 0..255 in sRGB encoding ----------

const lanczos3 = (x) => {
  x = Math.abs(x);
  if (x < 1e-7) return 1;
  if (x >= 3) return 0;
  const p = Math.PI * x;
  return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p);
};

function taps(from, to) {
  const scale = from / to;
  const stretch = Math.max(1, scale); // widen the kernel when shrinking, so nothing aliases
  const reach = 3 * stretch;
  const size = Math.ceil(reach) * 2 + 1;
  const index = new Int32Array(to * size);
  const weight = new Float32Array(to * size);
  for (let o = 0; o < to; o++) {
    const centre = (o + 0.5) * scale - 0.5;
    const first = Math.floor(centre - reach) + 1;
    let sum = 0;
    for (let k = 0; k < size; k++) {
      const w = lanczos3((first + k - centre) / stretch);
      index[o * size + k] = Math.max(0, Math.min(from - 1, first + k));
      weight[o * size + k] = w;
      sum += w;
    }
    for (let k = 0; k < size; k++) weight[o * size + k] /= sum;
  }
  return { index, weight, size };
}

// Separable Lanczos3, pixel centres aligned. Matches ImageMagick's Lanczos resize.
function resize({ d, W, H, C }, W2, H2) {
  let wide = d;
  if (W2 !== W) {
    const { index, weight, size } = taps(W, W2);
    wide = new Float32Array(W2 * H * C);
    for (let y = 0; y < H; y++) {
      const row = y * W * C;
      const out = y * W2 * C;
      for (let x = 0; x < W2; x++) {
        for (let k = 0; k < size; k++) {
          const w = weight[x * size + k];
          const from = row + index[x * size + k] * C;
          for (let c = 0; c < C; c++) wide[out + x * C + c] += w * d[from + c];
        }
      }
    }
  }
  if (H2 === H) return { d: wide, W: W2, H, C };
  const { index, weight, size } = taps(H, H2);
  const tall = new Float32Array(W2 * H2 * C);
  const n = W2 * C;
  for (let y = 0; y < H2; y++) {
    for (let k = 0; k < size; k++) {
      const w = weight[y * size + k];
      if (w === 0) continue;
      const from = index[y * size + k] * n;
      const out = y * n;
      for (let i = 0; i < n; i++) tall[out + i] += w * wide[from + i];
    }
  }
  return { d: tall, W: W2, H: H2, C };
}

// The network's fine detail laid over the raw plate (one step of back-projection).
function detail(raw, net4x) {
  const net = resize(net4x, raw.W * 2, raw.H * 2);
  const miss = resize(net, raw.W, raw.H);
  for (let i = 0; i < miss.d.length; i++) miss.d[i] = raw.d[i] - miss.d[i];
  const lift = resize(miss, net.W, net.H);
  for (let i = 0; i < net.d.length; i++) net.d[i] += lift.d[i];
  return net;
}

const bytes = (img) => {
  const out = Buffer.alloc(img.d.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(img.d[i])));
  return out;
};

async function read(path, channels) {
  let img = sharp(path).removeAlpha();
  if (channels === 1) img = img.extractChannel(0);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { d: Float32Array.from(data), W: info.width, H: info.height, C: info.channels };
}

// Give fully transparent pixels the colour of the nearest visible ones (pull-push), so the
// network never sees a hard edge between the subject and the black that sits under alpha 0.
function bleed(rgb, known, W, H) {
  const levels = [{ c: rgb, k: known, W, H }];
  while (levels.at(-1).W > 1 || levels.at(-1).H > 1) {
    const p = levels.at(-1);
    const w = Math.ceil(p.W / 2);
    const h = Math.ceil(p.H / 2);
    const c = new Float32Array(w * h * 3);
    const k = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let n = 0, r = 0, g = 0, b = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const j = Math.min(p.H - 1, y * 2 + dy) * p.W + Math.min(p.W - 1, x * 2 + dx);
            if (!p.k[j]) continue;
            n++; r += p.c[j * 3]; g += p.c[j * 3 + 1]; b += p.c[j * 3 + 2];
          }
        }
        if (!n) continue;
        const i = y * w + x;
        c[i * 3] = r / n; c[i * 3 + 1] = g / n; c[i * 3 + 2] = b / n; k[i] = 1;
      }
    }
    levels.push({ c, k, W: w, H: h });
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const p = levels[l];
    const q = levels[l + 1];
    for (let y = 0; y < p.H; y++) {
      for (let x = 0; x < p.W; x++) {
        const i = y * p.W + x;
        if (p.k[i]) continue;
        const j = (y >> 1) * q.W + (x >> 1);
        p.c[i * 3] = q.c[j * 3]; p.c[i * 3 + 1] = q.c[j * 3 + 1]; p.c[i * 3 + 2] = q.c[j * 3 + 2];
      }
    }
  }
  return levels[0].c;
}

// ---------- the geometry check ----------

function luma({ d, W, H, C }) {
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = C === 1 ? d[i] : 0.299 * d[i * C] + 0.587 * d[i * C + 1] + 0.114 * d[i * C + 2];
  // a light blur, so the gradients below are well behaved
  const k = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  const t = new Float32Array(W * H);
  const o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let j = -2; j <= 2; j++) s += k[j + 2] * g[y * W + Math.max(0, Math.min(W - 1, x + j))];
    t[y * W + x] = s;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let j = -2; j <= 2; j++) s += k[j + 2] * t[Math.max(0, Math.min(H - 1, y + j)) * W + x];
    o[y * W + x] = s;
  }
  return o;
}

// How far picture b sits from picture a, in pixels (Lucas-Kanade translation): for the whole
// frame, and the largest value over a 4x4 grid of tiles that have enough texture to tell.
// A plain 2x enlarge misplaced by a quarter of a raw pixel reads as 0.26 to 0.29 here.
function shift(a, b) {
  const p = luma(a);
  const q = luma(b);
  const { W, H } = a;
  const solve = (x0, y0, x1, y1) => {
    let xx = 0, xy = 0, yy = 0, xt = 0, yt = 0;
    for (let y = Math.max(3, y0); y < Math.min(H - 3, y1); y++) {
      for (let x = Math.max(3, x0); x < Math.min(W - 3, x1); x++) {
        const i = y * W + x;
        const gx = (p[i + 1] - p[i - 1] + q[i + 1] - q[i - 1]) / 4;
        const gy = (p[i + W] - p[i - W] + q[i + W] - q[i - W]) / 4;
        const t = q[i] - p[i];
        xx += gx * gx; xy += gx * gy; yy += gy * gy; xt += gx * t; yt += gy * t;
      }
    }
    const det = xx * yy - xy * xy;
    if (det <= 0) return null;
    const trace = xx + yy;
    const weakest = trace / 2 - Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
    return { dx: -(yy * xt - xy * yt) / det, dy: -(xx * yt - xy * xt) / det, textured: weakest / ((x1 - x0) * (y1 - y0)) > 2 };
  };
  const whole = solve(0, 0, W, H) ?? { dx: 0, dy: 0 };
  let worst = 0;
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      const tile = solve((tx * W) >> 2, (ty * H) >> 2, ((tx + 1) * W) >> 2, ((ty + 1) * H) >> 2);
      if (tile?.textured) worst = Math.max(worst, Math.hypot(tile.dx, tile.dy));
    }
  }
  return { dx: whole.dx, dy: whole.dy, worst };
}

// Shrink the finished PNG back with sharp (an independent resampler) and compare it with the
// raw plate. A picture with alpha is compared as it looks over mid grey, and its alpha
// channel is compared on its own as well; the larger of the two differences is reported.
async function verify(png, rawPath, W, H) {
  const meta = await sharp(png).metadata();
  if (meta.width !== W * 2 || meta.height !== H * 2) throw new Error(`is ${meta.width}x${meta.height}, not ${W * 2}x${H * 2}`);
  const grey = { background: "#808080" };
  const back = { kernel: "lanczos3", fit: "fill" };
  const mean = (a, b) => {
    if (a.length !== b.length) throw new Error("the check compared pictures of different shapes");
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  };
  // Flattened first and shrunk as plain RGB, so no premultiplied rounding gets into the number.
  const a = await sharp(rawPath).flatten(grey).raw().toBuffer();
  const flat = await sharp(png).flatten(grey).raw().toBuffer();
  const b = await sharp(flat, { raw: { width: W * 2, height: H * 2, channels: 3 } }).resize(W, H, back).raw().toBuffer();
  let diff = mean(a, b);
  if (meta.hasAlpha) {
    const rawAlpha = await sharp(rawPath).extractChannel("alpha").raw().toBuffer();
    const upAlpha = await sharp(png).resize(W, H, back).extractChannel("alpha").raw().toBuffer();
    diff = Math.max(diff, mean(rawAlpha, upAlpha));
  }
  const s = shift({ d: a, W, H, C: 3 }, { d: b, W, H, C: 3 });
  const off = Math.max(Math.hypot(s.dx, s.dy), s.worst);
  if (diff > MAX_DIFF) throw new Error(`differs from the raw plate by ${diff.toFixed(2)} levels when shrunk back`);
  if (off > MAX_SHIFT) throw new Error(`sits ${off.toFixed(3)} px away from the raw plate`);
  return { diff, dx: s.dx, dy: s.dy, worst: s.worst };
}

// ---------- the run ----------

const sha256 = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let tail = "";
    child.stderr.on("data", (chunk) => { tail = (tail + chunk).slice(-4000); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(tail) : reject(new Error(`${command} exited with ${code}\n${tail}`))));
  });
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const asked = args.filter((a) => !a.startsWith("--"));
const present = (await readdir(RAW)).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).filter((n) => !SKIP.has(n)).sort();
for (const name of asked) if (!present.includes(name)) throw new Error(`no plate called ${name} in art/raw (or it is on the skip list)`);

const todo = [];
for (const name of asked.length ? asked : present) {
  const up = join(OUT, `${name}.png`);
  if (!force && existsSync(up)) {
    const [raw, done] = [await sharp(join(RAW, `${name}.png`)).metadata(), await sharp(up).metadata()];
    const fresh = (await stat(up)).mtimeMs >= (await stat(join(RAW, `${name}.png`))).mtimeMs;
    if (fresh && done.width === raw.width * 2 && done.height === raw.height * 2) {
      console.log(`${name}: up to date`);
      continue;
    }
  }
  todo.push(name);
}
if (!todo.length) process.exit(0);

for (const [path, want] of Object.entries(SHA256)) {
  if (!existsSync(path)) throw new Error(`${path} is missing; see the install notes at the top of this script`);
  if ((await sha256(path)) !== want) throw new Error(`${path} is not the file this script was written for`);
}

await mkdir(OUT, { recursive: true });
await mkdir(join(HOME, "work"), { recursive: true });
const work = await mkdtemp(join(HOME, "work/run-"));
const started = Date.now();
let failed = 0;
try {
  // 1. What the network is shown: the RGB of every plate, and any alpha channel as its own grey picture.
  await mkdir(join(work, "in"));
  await mkdir(join(work, "x4"));
  const plates = [];
  for (const name of todo) {
    const path = join(RAW, `${name}.png`);
    const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: W, height: H } = info;
    const hasAlpha = (await sharp(path).metadata()).hasAlpha;
    const rgb = new Float32Array(W * H * 3);
    const alpha = new Float32Array(W * H);
    const known = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      rgb[i * 3] = data[i * 4]; rgb[i * 3 + 1] = data[i * 4 + 1]; rgb[i * 3 + 2] = data[i * 4 + 2];
      alpha[i] = data[i * 4 + 3];
      known[i] = alpha[i] >= 128 ? 1 : 0;
    }
    if (hasAlpha) {
      // Pixels that are all but invisible take the colour bled out from the subject.
      const filled = bleed(Float32Array.from(rgb), known, W, H);
      for (let i = 0; i < W * H; i++) if (alpha[i] < 16) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = Math.round(filled[i * 3 + c]);
      await sharp(bytes({ d: alpha }), { raw: { width: W, height: H, channels: 1 } }).toColourspace("srgb").png().toFile(join(work, "in", `${name}.alpha.png`));
    }
    await sharp(bytes({ d: rgb }), { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 3 }).toFile(join(work, "in", `${name}.png`));
    plates.push({ name, path, W, H, rgb: { d: rgb, W, H, C: 3 }, alpha: hasAlpha ? { d: alpha, W, H, C: 1 } : null });
  }

  // 2. The network, 4x, on the GPU. Paths go in as arguments; nothing runs from the tool's folder.
  const gpu = process.env.RIAZ_UPSCALE_GPU ? ["-g", process.env.RIAZ_UPSCALE_GPU] : [];
  console.log(`${MODEL} 4x on ${todo.length} plate${todo.length > 1 ? "s" : ""} ...`);
  await run(TOOL, ["-i", join(work, "in"), "-o", join(work, "x4"), "-n", MODEL, "-s", "4", "-m", MODELS, "-f", "png", ...gpu], work);

  // 3. Lay its detail over each raw plate, check the geometry, and only then keep the file.
  for (const plate of plates) {
    const { name, W, H } = plate;
    const t0 = Date.now();
    try {
      const net = await read(join(work, "x4", `${name}.png`), 3);
      if (net.W !== W * 4 || net.H !== H * 4) throw new Error(`the network returned ${net.W}x${net.H}`);
      const rgb8 = bytes(detail(plate.rgb, net));
      let image = sharp(rgb8, { raw: { width: W * 2, height: H * 2, channels: 3 } });
      if (plate.alpha) {
        const a8 = bytes(detail(plate.alpha, await read(join(work, "x4", `${name}.alpha.png`), 1)));
        for (let y = 0; y < H * 2; y++) {
          for (let x = 0; x < W * 2; x++) {
            // Alpha never leaves the range of the raw alpha around it: no ringing, and what was
            // fully transparent or fully opaque stays so.
            let lo = 255, hi = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const v = plate.alpha.d[Math.max(0, Math.min(H - 1, (y >> 1) + dy)) * W + Math.max(0, Math.min(W - 1, (x >> 1) + dx))];
                if (v < lo) lo = v;
                if (v > hi) hi = v;
              }
            }
            const i = y * W * 2 + x;
            a8[i] = Math.max(lo, Math.min(hi, a8[i]));
            if (a8[i] === 0) rgb8[i * 3] = rgb8[i * 3 + 1] = rgb8[i * 3 + 2] = 0;
          }
        }
        image = sharp(rgb8, { raw: { width: W * 2, height: H * 2, channels: 3 } }).joinChannel(a8, { raw: { width: W * 2, height: H * 2, channels: 1 } });
      }
      const png = await image.png({ compressionLevel: 9 }).toBuffer();
      const v = await verify(png, plate.path, W, H);
      const part = join(OUT, `.${name}.png.part`);
      await writeFile(part, png);
      await rename(part, join(OUT, `${name}.png`));
      console.log(`${name}: ${W}x${H} -> ${W * 2}x${H * 2}  back-to-raw diff ${v.diff.toFixed(2)}  shift ${v.dx.toFixed(3)},${v.dy.toFixed(3)} (worst tile ${v.worst.toFixed(3)})  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (error) {
      failed++;
      console.error(`${name}: NOT written - ${error.message}`);
    }
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)}s`);
if (failed) process.exit(1);
