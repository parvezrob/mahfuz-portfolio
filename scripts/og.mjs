// Makes the link-preview image from the real hero frame, so it always matches the site.
// Run with the dev server up: node scripts/og.mjs
import { chromium } from "playwright-core";
import sharp from "sharp";

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--hide-scrollbars"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await page.goto(process.env.SITE_URL ?? "http://localhost:3210/", { waitUntil: "networkidle" });
await page.waitForTimeout(3200);
// The preview should be the photograph and the name only.
await page.addStyleTag({ content: "header, .hero-role, nextjs-portal { display: none !important } .hero-fade { opacity: 0 !important }" });
const shot = await page.screenshot({ type: "png" });
await browser.close();
await sharp(shot).resize(1200, 630).jpeg({ quality: 86, mozjpeg: true }).toFile("public/og.jpg");
console.log("public/og.jpg written");
