// Native-resolution close-ups of the places where the animated ball meets a photograph.
// Usage: node scripts/closeup.mjs <out.jpg> <width>x<height> "<stop>|<css selector>|<crop px>" ...
// A stop is a film time ("83.4") or an anchor ("#contact+0@3600"), as in shoot.mjs.
import { chromium } from "playwright-core";
import sharp from "sharp";

const [out, size, ...specs] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const DPR = 2;
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--hide-scrollbars"] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: DPR });
await page.goto(process.env.SITE_URL ?? "http://localhost:3210/", { waitUntil: "networkidle" });
await page.waitForTimeout(2800);

const tiles = [];
for (const spec of specs) {
  const [rawStop, selector, crop = "360"] = spec.split("|");
  const [stop, wait] = rawStop.split("@");
  let y;
  if (stop.startsWith("#")) {
    const [id, offset = "0"] = stop.split("+");
    y = await page.evaluate(([sel, add]) => document.querySelector(sel).getBoundingClientRect().top + scrollY + add, [id, Number(offset)]);
  } else {
    y = await page.evaluate((t) => Math.round(window.__filmScroll(t)), Number(stop));
  }
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForTimeout(wait ? Number(wait) : 900);
  // Centre the crop on the first visible element matching the selector.
  const box = await page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(e).visibility !== "hidden";
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, selector);
  const shot = await page.screenshot({ type: "png" });
  const side = Number(crop) * DPR;
  const cx = (box ? box[0] : width / 2) * DPR;
  const cy = (box ? box[1] : height / 2) * DPR;
  const left = Math.round(Math.min(Math.max(0, cx - side / 2), width * DPR - side));
  const top = Math.round(Math.min(Math.max(0, cy - side / 2), height * DPR - side));
  tiles.push(await sharp(shot).extract({ left, top, width: side, height: side }).resize(520, 520).toBuffer());
  if (!box) console.log("not found:", spec);
}
await browser.close();
await sharp({ create: { width: 524 * tiles.length, height: 524, channels: 3, background: "#222" } })
  .composite(tiles.map((input, i) => ({ input, left: i * 524 + 2, top: 2 })))
  .jpeg({ quality: 90 })
  .toFile(out);
console.log(`${tiles.length} close-ups -> ${out}`);
