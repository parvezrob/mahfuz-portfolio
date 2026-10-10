// Screenshots the running site at chosen points of the scroll film, as one contact sheet.
// Usage: node scripts/shoot.mjs <out.jpg> <width>x<height> <t1,t2,...|y:px,...> [cols]
import { chromium } from "playwright-core";
import sharp from "sharp";

const [out, size = "1440x810", stops = "0", cols = "3"] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const URL = process.env.SITE_URL ?? "http://localhost:3210/";

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--hide-scrollbars"] });
// REDUCED=1 emulates a visitor who has asked for reduced motion.
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: process.env.REDUCED ? "reduce" : "no-preference" });
const problems = [];
page.on("console", (m) => ["error", "warning"].includes(m.type()) && problems.push(`${m.type()}: ${m.text().slice(0, 200)}`));
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2600);

const frames = [];
// A stop is a film time ("36"), a pixel offset ("y:1200") or an anchor ("#about+200"); "@2500" sets the wait.
for (const raw of stops.split(",")) {
  const [stop, wait] = raw.split("@");
  let y;
  if (stop.startsWith("#")) {
    const [id, offset = "0"] = stop.split("+");
    y = await page.evaluate(([sel, add]) => document.querySelector(sel).getBoundingClientRect().top + scrollY + add, [id, Number(offset)]);
  } else if (stop.startsWith("y:")) {
    y = Number(stop.slice(2));
  } else {
    // The page knows where each film time sits on the scroll.
    y = await page.evaluate((t) => Math.round(window.__filmScroll(t)), Number(stop));
  }
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForTimeout(wait ? Number(wait) : stop === "0" ? 100 : 900);
  frames.push(await page.screenshot({ type: "png" }));
}
await browser.close();

const n = Number(cols);
const cell = Math.round(1560 / n);
const cellH = Math.round((cell * height) / width);
const rows = Math.ceil(frames.length / n);
const tiles = await Promise.all(frames.map((f) => sharp(f).resize(cell - 4, cellH - 4).toBuffer()));
await sharp({ create: { width: cell * n, height: cellH * rows, channels: 3, background: "#222" } })
  .composite(tiles.map((input, i) => ({ input, left: (i % n) * cell + 2, top: Math.floor(i / n) * cellH + 2 })))
  .jpeg({ quality: 78 })
  .toFile(out);
console.log(`${frames.length} frames -> ${out}`);
if (problems.length) console.log([...new Set(problems)].slice(0, 8).join("\n"));
