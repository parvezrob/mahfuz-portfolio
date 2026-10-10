// Records a real wheel-scroll through the whole page, to judge motion rather than stills.
// Usage: node scripts/record.mjs <out-dir> [width]x[height] [seconds]
import { chromium } from "playwright-core";

const [dir, size = "1280x720", seconds = "46"] = process.argv.slice(2);
const [width, height] = size.split("x").map(Number);
const URL = process.env.SITE_URL ?? "http://localhost:3210/";

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--hide-scrollbars"] });
const context = await browser.newContext({ viewport: { width, height }, recordVideo: { dir, size: { width, height } } });
const page = await context.newPage();
await page.goto(URL, { waitUntil: "networkidle" });
await page.mouse.move(width / 2, height / 2);
await page.waitForTimeout(3200);

const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
const steps = Number(seconds) * 30;
for (let i = 0; i < steps; i++) {
  await page.mouse.wheel(0, total / steps / 0.9);
  await page.waitForTimeout(33);
}
await page.waitForTimeout(4200);
await context.close();
await browser.close();
console.log("recorded", await page.video().path());
