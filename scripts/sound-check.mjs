// Proves the sounds are sane without ears. Builds src/lib/sound.ts for the browser, renders
// every sound through an OfflineAudioContext in Chrome, measures the result and exits 1 if
// anything clips, is too loud, is silent or fails to die away. Then drives the real `sound`
// singleton through its on/off rules in a live page.
// Usage: node scripts/sound-check.mjs
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const SOURCE = fileURLToPath(new URL("../src/lib/sound.ts", import.meta.url));
const ORIGIN = "http://sound-check.test"; // never reached: every request is answered below
const RATE = 48000;
const BLOCK = 128 / RATE; // an offline context can only pause on a block boundary
const START = 192 * BLOCK; // 0.512 s. The limiter fades in when a context is born; wait it out.
const HELD = 1152 * BLOCK; // 3.072 s. How long a continuous sound is held before it is let go.
const WINDOW = 0.005; // seconds; loudness is followed in windows this long
const FLOOR = 10 ** (-60 / 20);
const CEILING_DB = -9;

const db = (x) => 20 * Math.log10(Math.max(x, 1e-10));
const failures = [];
const fail = (name, why) => failures.push(`${name}: ${why}`);

// esbuild when Node can resolve it, otherwise the TypeScript compiler. The fallback only
// strips types, which is all a file with no imports needs.
async function browserBuild() {
  let esbuild = null;
  try {
    esbuild = await import("esbuild");
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }
  if (esbuild) {
    const built = await esbuild.build({ entryPoints: [SOURCE], bundle: true, format: "esm", target: "es2022", write: false, logLevel: "silent" });
    return { code: built.outputFiles[0].text, builder: "esbuild" };
  }
  const { default: ts } = await import("typescript");
  const options = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 };
  return { code: ts.transpileModule(await readFile(SOURCE, "utf8"), { compilerOptions: options }).outputText, builder: "typescript" };
}

const { code, builder } = await browserBuild();
console.log(`src/lib/sound.ts built with ${builder}, rendered offline at ${RATE} Hz in Chrome.\n`);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--mute-audio"] });

// A blank page on an origin of its own, so the module can be imported and localStorage works.
async function blankPage() {
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, (route) =>
    route.request().url().endsWith("/sound.js")
      ? route.fulfill({ contentType: "text/javascript", body: code })
      : route.fulfill({ contentType: "text/html", body: "<!doctype html><title>sound check</title>" }),
  );
  await page.goto(`${ORIGIN}/`);
  return page;
}

const page = await blankPage();

// Renders `seconds` of the engine. `cues` is a list of [time, [[method, ...args], ...]]:
// at each time the render pauses and the calls are made, as the page would make them.
async function render(cues, seconds) {
  const encoded = await page.evaluate(
    async ({ cues, frames, rate }) => {
      const { createEngine } = await import("/sound.js");
      const ctx = new OfflineAudioContext(2, frames, rate);
      const engine = createEngine(ctx);
      // A call that throws must not leave the render paused for ever: keep the error, let
      // the render finish, then report it.
      let thrown = null;
      for (const [at, calls] of cues) {
        const play = () => {
          try {
            calls.forEach(([method, ...args]) => engine[method](...args));
          } catch (error) {
            thrown ??= error;
          }
        };
        if (at === 0) play();
        else void ctx.suspend(at).then(() => (play(), ctx.resume()));
      }
      const buffer = await ctx.startRendering();
      if (thrown) throw thrown;
      return [0, 1].map((channel) => {
        const bytes = new Uint8Array(buffer.getChannelData(channel).buffer);
        let text = "";
        for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(text);
      });
    },
    { cues, frames: Math.round(seconds * RATE), rate: RATE },
  );
  return encoded.map((text) => new Float32Array(new Uint8Array(Buffer.from(text, "base64")).buffer));
}

// In-place radix-2 FFT.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const cos = Math.cos(step * k);
        const sin = Math.sin(step * k);
        const a = start + k;
        const b = a + size / 2;
        const xr = re[b] * cos - im[b] * sin;
        const xi = re[b] * sin + im[b] * cos;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

// Power spectrum of the samples from `from` to `to`. A one-shot is taken whole, in a single
// transform. A steady sound is noise, so it is averaged over overlapping windows and then
// smoothed across neighbouring bins, or the "dominant frequency" would be a roll of the dice.
function spectrum([left, right], from, to, steady) {
  const size = steady ? 16384 : Math.min(65536, 2 ** Math.ceil(Math.log2(Math.max(8192, to - from))));
  const power = new Float64Array(size / 2);
  for (let at = from; at === from || at + size <= to; at += size / 2) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size && at + i < to; i++) {
      const hann = steady ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size) : 1;
      re[i] = ((left[at + i] + right[at + i]) / 2) * hann;
    }
    fft(re, im);
    for (let i = 0; i < size / 2; i++) power[i] += re[i] * re[i] + im[i] * im[i];
  }
  if (steady) {
    const raw = power.slice();
    for (let i = 0; i < raw.length; i++) {
      let sum = 0;
      for (let k = Math.max(0, i - 3); k <= Math.min(raw.length - 1, i + 3); k++) sum += raw[k];
      power[i] = sum / 7;
    }
  }
  return { power, binHz: RATE / size };
}

function measure(channels, cue, steady) {
  const [left, right] = channels;
  const span = Math.round(WINDOW * RATE);
  const windows = Math.floor(left.length / span);
  const loud = new Float64Array(windows);
  let peak = 0;
  for (let i = 0; i < windows * span; i++) {
    const level = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (level > loud[Math.floor(i / span)]) loud[Math.floor(i / span)] = level;
    if (level > peak) peak = level;
  }
  let last = -1;
  for (let w = 0; w < windows; w++) if (loud[w] >= FLOOR) last = w;
  const end = (last + 1) * WINDOW;

  // A steady sound is measured while held, once it has settled; a one-shot over its own length.
  const from = Math.round((steady ? cue + 0.4 : cue) * RATE);
  const to = Math.max(from + 1, Math.round((steady ? cue + HELD : end) * RATE));
  let squares = 0;
  for (let i = from; i < to; i++) squares += left[i] * left[i] + right[i] * right[i];

  const { power, binHz } = spectrum(channels, from, to, steady);
  let top = 1;
  let weighted = 0;
  let total = 0;
  for (let i = Math.ceil(20 / binHz); i < power.length; i++) {
    if (power[i] > power[top]) top = i;
    weighted += i * binHz * power[i];
    total += power[i];
  }
  return {
    peakDb: db(peak),
    rmsDb: db(Math.sqrt(squares / (2 * (to - from)))),
    // Time to fall under -60 dBFS: from the start of a one-shot, from the release of a steady sound.
    fade: last < 0 ? 0 : end - (steady ? cue + HELD : cue),
    endsQuiet: last < windows - 10,
    dominant: top * binHz,
    centroid: total > 0 ? weighted / total : 0,
  };
}

const shot = (calls) => render([[START, calls]], START + 2.6).then((audio) => measure(audio, START, false));
const held = (method, value) =>
  render(
    [
      [START, [[method, value]]],
      [START + HELD, [[method, 0]]],
    ],
    START + HELD + 2.6,
  ).then((audio) => measure(audio, START, true));

const table = [
  ["roll 0.2", () => held("roll", 0.2), true],
  ["roll 0.6", () => held("roll", 0.6), true],
  ["roll 1.0", () => held("roll", 1), true],
  ["tick 0", () => shot([["tick", 0]]), false],
  ["tick 1", () => shot([["tick", 1]]), false],
  ["tick 2", () => shot([["tick", 2]]), false],
  ["thud 1.0", () => shot([["thud", 1]]), false],
  ["clink 1.0", () => shot([["clink", 1]]), false],
  ["swell 1.0", () => held("swell", 1), true],
  ["drop", () => shot([["drop"]]), false],
];

const cell = (text, width) => String(text).padStart(width);
console.log(`${"sound".padEnd(10)}${cell("to -60 dB", 11)}${cell("peak dBFS", 11)}${cell("RMS dBFS", 10)}${cell("dominant", 10)}${cell("centroid", 10)}`);
const results = {};
for (const [name, run, steady] of table) {
  const m = (results[name] = await run());
  console.log(
    `${name.padEnd(10)}${cell(`${m.fade.toFixed(2)} s`, 11)}${cell(m.peakDb.toFixed(1), 11)}${cell(m.rmsDb.toFixed(1), 10)}${cell(`${m.dominant.toFixed(0)} Hz`, 10)}${cell(`${m.centroid.toFixed(0)} Hz`, 10)}`,
  );
  if (m.peakDb >= -0.01) fail(name, "clips");
  else if (m.peakDb > CEILING_DB) fail(name, `peaks at ${m.peakDb.toFixed(1)} dBFS, above ${CEILING_DB}`);
  if (m.peakDb < -60) fail(name, "is silent");
  if (m.fade > 2 || !m.endsQuiet) fail(name, steady ? "does not fade out within 2 s of being set to 0" : "has not decayed within 2 s");
}
console.log("to -60 dB: for roll and swell, the fade after being set to 0; RMS and spectrum are taken while held.");

// What the brief asks of the sounds relative to one another.
const one = (name) => results[name];
const shots = table.filter(([, , steady]) => !steady).map(([name]) => name);
const loudest = shots.reduce((a, b) => (one(a).peakDb >= one(b).peakDb ? a : b));
if (Math.abs(one(loudest).peakDb + 12) > 1.5) fail(loudest, `is the loudest one-shot and should peak near -12 dBFS, not ${one(loudest).peakDb.toFixed(1)}`);
for (const name of ["roll 1.0", "swell 1.0"]) {
  if (one(name).peakDb > one(loudest).peakDb - 6) fail(name, "a continuous layer should sit well under the one-shots");
}
for (const [slow, fast] of [["roll 0.2", "roll 0.6"], ["roll 0.6", "roll 1.0"]]) {
  if (!(one(fast).centroid > one(slow).centroid && one(fast).dominant > one(slow).dominant)) fail(fast, `should be higher and brighter than ${slow}`);
  if (!(one(fast).rmsDb > one(slow).rmsDb)) fail(fast, `should be louder than ${slow}`);
}
if (!(one("tick 0").dominant < one("tick 1").dominant && one("tick 1").dominant < one("tick 2").dominant)) fail("tick", "the three pitches should climb");

// The rules inside clink(), and the limiter under the worst pile-up the page could cause.
const faint = await shot([["clink", 0.04]]);
if (faint.peakDb > -100) fail("clink 0.04", "should be ignored");
const flurry = await shot(Array.from({ length: 40 }, () => ["clink", 1]));
if (Math.abs(flurry.peakDb - one("clink 1.0").peakDb) > 0.1) fail("clink x40", "calls in the same instant should play as one");
const pile = measure(
  await render(
    [
      [START, [["roll", 1], ["swell", 1]]],
      [START + 96 * BLOCK, [["thud", 1], ["clink", 1], ["tick", 2], ["drop"]]],
    ],
    START + 2,
  ),
  START,
  false,
);
if (pile.peakDb > CEILING_DB) fail("everything at once", `peaks at ${pile.peakDb.toFixed(1)} dBFS: the limiter is not holding`);
console.log(`clink 0.04 ignored, 40 clinks in one instant play as one, everything at once peaks at ${pile.peakDb.toFixed(1)} dBFS.`);

// The singleton, in a page with a real AudioContext and a stand-in for the toggle button.
// What reaches the speakers is tapped by listening in on the connection to the destination.
const live = await blankPage();
await live.addInitScript(() => {
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    if (target instanceof AudioDestinationNode && this.context instanceof AudioContext) {
      window.ctx = this.context;
      window.tap = this.context.createAnalyser();
      window.tap.fftSize = 32768;
      connect.call(this, window.tap);
    }
    return connect.call(this, target, ...rest);
  };
});
const load = async (reducedMotion) => {
  await live.emulateMedia({ reducedMotion });
  await live.reload();
  await live.evaluate(async () => {
    const { sound } = await import("/sound.js");
    window.sound = sound;
    window.heard = [];
    sound.subscribe((on) => window.heard.push(on));
    const toggle = document.body.appendChild(document.createElement("button"));
    toggle.dataset.soundToggle = "";
    toggle.textContent = "toggle";
    toggle.onclick = () => sound.setEnabled(!sound.enabled);
  });
};
const state = () => live.evaluate(() => `${window.sound.enabled ? "on" : "off"}/${window.ctx?.state ?? "none"}/${localStorage.getItem("sound")}`);
const expect = async (step, wanted) => {
  await live.waitForTimeout(600);
  const got = await state();
  if (got !== wanted) fail("live", `${step}: expected ${wanted}, got ${got}`);
};
const setHidden = (hidden) =>
  live.evaluate((value) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

await load("no-preference");
await live.evaluate(() => {
  const { sound } = window;
  for (const call of [() => sound.roll(0.5), () => sound.tick(1), () => sound.thud(1), () => sound.clink(1), () => sound.swell(0.5), () => sound.drop()]) call();
});
await expect("calls before any gesture do nothing", "off/none/null");
await live.click("button");
await expect("the toggle turns sound on", "on/running/on");
const heard = await live.evaluate(async () => {
  window.sound.tick(2);
  await new Promise((done) => setTimeout(done, 300));
  const samples = new Float32Array(window.tap.fftSize);
  window.tap.getFloatTimeDomainData(samples);
  return samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
});
if (heard < FLOOR) fail("live", "a tick with sound on did not reach the output");
await setHidden(true);
await expect("a hidden page suspends the context", "on/suspended/on");
await setHidden(false);
await expect("a visible page resumes it", "on/running/on");
await live.click("button");
await expect("the toggle turns sound off", "off/suspended/off");
if ((await live.evaluate(() => window.heard.join())) !== "true,false") fail("live", "subscribers should hear each change once");
await live.click("button");
await expect("and on again", "on/running/on");

await load("no-preference");
await expect("a remembered choice waits for a gesture", "off/none/on");
await live.mouse.click(300, 300);
await expect("and returns on the first click", "on/running/on");
await load("no-preference");
await live.click("button");
await expect("a first click on the toggle counts once", "on/running/on");
await load("reduce");
await live.mouse.click(300, 300);
await expect("reduced motion: nothing turns itself on", "off/none/on");
await live.click("button");
await expect("reduced motion: the toggle still works", "on/running/on");
console.log(`live: a tick reaches the output at ${db(heard).toFixed(1)} dBFS; toggle, tab visibility, remembered choice and reduced motion behave.`);

await browser.close();
if (failures.length) {
  console.error(`\nFAIL\n${failures.map((line) => `  ${line}`).join("\n")}`);
  process.exit(1);
}
console.log("\nPASS");
