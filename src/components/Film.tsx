"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import parts from "@/content/build-parts.json";
import { site } from "@/content/site";
import { sound } from "@/lib/sound";

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Plate geometry, in the pixel space of each raw photograph (see scripts/measure-rail.mjs).
const HERO = { w: 1672, h: 941, ball: 78, from: 172, to: 1530 };
const heroRail = (cx: number) => 479 + 0.15 * (cx - 140);
const HERO_CLIP = "polygon(0 0, 100% 0, 100% 96.6%, 0 81.6%)";
const HERO_FLOOR = 848; // where the blocks meet the floor
const SUN = 0.42; // how far a shadow slides right for every pixel of height, read off the block shadows

const BUILD = { w: 1536, h: 1024, ball: 76, land: [1325, 205] as const, exit: 1640 };
// Every object in each flat-lay as [x, y, width, height], shadow included, in the order it is
// set down (blocks, rails, posts, hoops). The same file tells the asset script what to cut out.
type Box = readonly [number, number, number, number];
const PARTS = parts.wide as unknown as readonly Box[];

const AUTO = { w: 1536, h: 1024, from: -90, to: 1640 };
const AUTO_RAIL: readonly (readonly [number, number])[] = [
  [-100, 264], [20, 300.5], [100, 324.5], [330, 394], [420, 422.5], [560, 467],
  [860, 565.5], [1000, 611], [1150, 660], [1420, 748.5], [1500, 775], [1650, 824],
];
const AUTO_HOOPS = [
  { x: 210, top: 196 },
  { x: 744, top: 349 },
  { x: 1337, top: 529 },
] as const;
const autoFloor = (cx: number) => 736 + 0.1615 * (cx - 210);

// Scroll does not map to film time evenly: each beat gets the scroll length it earns, and
// empty beats (the red before the words, the red after them) get almost none.
// [screens scrolled, film time]
const CUT: readonly (readonly [number, number])[] = [
  [0, 0], [1.45, 24], [2.2, 30.6], [2.26, 31.4], [3.95, 49.2], [4.0, 50],
  [6.1, 71.2], [6.5, 75.7], [9.0, 102], [9.6, 102.5],
];
const SCREENS = CUT[CUT.length - 1][0];
function along(value: number, from: 0 | 1) {
  const to = from === 0 ? 1 : 0;
  for (let i = 1; i < CUT.length; i++) {
    if (value <= CUT[i][from]) {
      const a = CUT[i - 1];
      const b = CUT[i];
      return lerp(a[to], b[to], (value - a[from]) / (b[from] - a[from]));
    }
  }
  return CUT[CUT.length - 1][to];
}

// The same scene composed for a tall screen: its own photograph, part boxes and landing spot.
const BUILD_TALL = {
  w: 1024,
  h: 1536,
  ball: 68,
  land: [826, 505] as const,
  exit: 1130,
  parts: parts.tall as unknown as readonly Box[],
};

// How large the ball has to grow to flood the whole window with red from anywhere on screen.
const FLOOD = 72;

const INK = "#1b1815";
const CREAM = "#f4ecdf";
const RED = "#c8301e";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function autoRail(cx: number) {
  for (let i = 1; i < AUTO_RAIL.length; i++) {
    const [x1, y1] = AUTO_RAIL[i];
    if (cx <= x1) {
      const [x0, y0] = AUTO_RAIL[i - 1];
      return lerp(y0, y1, (cx - x0) / (x1 - x0));
    }
  }
  return AUTO_RAIL[AUTO_RAIL.length - 1][1];
}

// On a screen narrower than the plate, pan so the ball stays between a quarter and three
// quarters of the way across, leaning toward where it is headed. Returns --cam for the stage.
function camFor(stage: HTMLElement | null, at: number) {
  if (!stage) return 0.5;
  const shown = window.innerWidth / stage.offsetWidth;
  if (shown >= 0.999) return 0.5;
  const onScreen = 0.5 + (at - 0.5) * 0.5;
  return clamp01((at - shown * onScreen) / (1 - shown));
}

function setVars(el: HTMLElement | null, vars: Record<string, string | number>) {
  if (!el) return;
  for (const key in vars) el.style.setProperty(key, String(vars[key]));
}

function Words({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {text.split(" ").map((word, i) => (
        <span key={i} className="inline-block overflow-clip pb-[0.14em] align-top">
          <span className={`word ${className ?? ""}`} data-w={word.toLowerCase().replace(/[^a-z]/g, "")}>
            {word}&nbsp;
          </span>
        </span>
      ))}
    </>
  );
}

function Plate({ name, w, eager, className = "plate" }: { name: string; w: number; eager?: boolean; className?: string }) {
  return (
    // Phones get the 1x file: the 2x plates are over 3,000 pixels wide and only cost them memory.
    <picture>
      <source media="(max-width: 899px)" srcSet={`/art/${name}-1x.webp`} />
      <img
        className={className}
        src={`/art/${name}-1x.webp`}
        srcSet={`/art/${name}-1x.webp ${w}w, /art/${name}-2x.webp ${w * 2}w`}
        sizes="max(100vw, 178lvh)"
        alt=""
        decoding="async"
        fetchPriority={eager ? "high" : "auto"}
      />
    </picture>
  );
}

function Ball({ ref, clip }: { ref: React.Ref<HTMLDivElement>; clip?: string }) {
  return (
    <div className="ball" ref={ref} style={{ clipPath: clip }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/art/ball.webp" alt="" />
      <i />
    </div>
  );
}

export function Film() {
  const root = useRef<HTMLElement>(null);
  const heroLayer = useRef<HTMLDivElement>(null);
  const heroStage = useRef<HTMLDivElement>(null);
  const heroBall = useRef<HTMLDivElement>(null);
  const heroShadow = useRef<HTMLDivElement>(null);
  const autoShadow = useRef<HTMLDivElement>(null);
  const heroCopy = useRef<HTMLDivElement>(null);
  const cue = useRef<HTMLDivElement>(null);
  const redLayer = useRef<HTMLDivElement>(null);
  const buildLayer = useRef<HTMLDivElement>(null);
  const buildStage = useRef<HTMLDivElement>(null);
  const buildBall = useRef<HTMLDivElement>(null);
  const buildShadow = useRef<HTMLDivElement>(null);
  const autoLayer = useRef<HTMLDivElement>(null);
  const autoStage = useRef<HTMLDivElement>(null);
  const autoBall = useRef<HTMLDivElement>(null);
  const gate = useRef<HTMLDivElement>(null);
  const tallStage = useRef<HTMLDivElement>(null);
  const tallBall = useRef<HTMLDivElement>(null);
  const tallShadow = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const tallScreen = window.innerWidth < 900;

      // --- Per-scene renderers: one number in, the whole physical state out. ---

      const letters = q<HTMLElement>(".hero-name .ch");
      let centres: number[] | null = null;
      ScrollTrigger.addEventListener("refreshInit", () => (centres = null));

      const ripple = window.matchMedia("(pointer: fine)").matches;
      const nameLeft = () => q<HTMLElement>(".hero-name")[0]?.getBoundingClientRect().left ?? 0;
      let lastHeroX = HERO.from;
      let lastAutoX = AUTO.from;
      let hoopsPassed = 0;

      const renderHero = (roll: number, leap: number) => {
        const k = 0.28 * roll + 0.72 * roll * roll;
        const railX = lerp(HERO.from, HERO.to, k);
        const toLens = leap ** 1.6;
        const cx = lerp(railX, HERO.w * 0.5, toLens);
        const cy = lerp(heroRail(railX), HERO.h * 0.5, toLens) - Math.sin(leap * Math.PI) * 46;
        const s = 1 + (FLOOD - 1) * leap ** 3.2;
        setVars(heroBall.current, {
          "--x": cx / HERO.w,
          "--y": cy / HERO.h,
          "--s": s,
          "--flat": clamp01((s - 8) / 10),
          "--clip": leap > 0 ? "none" : HERO_CLIP,
        });
        const cam = camFor(heroStage.current, cx / HERO.w);
        setVars(heroStage.current, { "--cam": cam, "--zoom": 1 + 0.05 * roll });

        // A real cast shadow: it tightens, darkens and closes in as the ball loses height.
        const height = HERO_FLOOR - (cy + HERO.ball / 2);
        setVars(heroShadow.current, {
          "--x": (cx + SUN * height) / HERO.w,
          "--y": (HERO_FLOOR + 6) / HERO.h,
          "--sc": 1 + height / 240,
          "--o": Math.max(0, 0.4 - height / 950) * (1 - clamp01(leap * 3)),
        });

        sound.roll(leap > 0 ? 0 : clamp01(Math.abs(cx - lastHeroX) / 14));
        sound.swell(leap);
        lastHeroX = cx;

        // The name feels the ball go by: the letters above it ride up over it like a bump, then
        // settle. Re-shaping fifteen glyphs a frame is too much for a phone, so touch screens skip
        // it; and the ball's screen position is worked out from numbers, never read from layout.
        if (!ripple || !letters.length) return;
        const stageWidth = heroStage.current?.offsetWidth ?? window.innerWidth;
        const ballX = (cx / HERO.w) * stageWidth - (stageWidth - window.innerWidth) * cam;
        if (!centres) centres = letters.map((el) => el.offsetLeft + el.offsetWidth / 2 + nameLeft());
        const reach = window.innerWidth * 0.12;
        const strength = clamp01(roll * 14) * (1 - clamp01(leap * 4));
        letters.forEach((el, i) => {
          const wave = strength * Math.exp(-(((centres![i] - ballX) / reach) ** 2));
          el.style.fontVariationSettings = `"wdth" ${(125 - 16 * wave).toFixed(1)}`;
          el.style.transform = `translateY(${(-0.17 * wave).toFixed(3)}em)`;
        });
      };

      let landed = false;
      const renderBuild = (fall: number, hop: number, out: number) => {
        const s = FLOOD ** (1 - fall);
        const lift = clamp01((s - 1) / 5) + Math.sin(hop * Math.PI) * 0.16;
        // Two compositions share one performance: the wide flat-lay and the tall-screen one.
        for (const [G, stage, ball, shadow] of [
          [BUILD, buildStage.current, buildBall.current, buildShadow.current],
          [BUILD_TALL, tallStage.current, tallBall.current, tallShadow.current],
        ] as const) {
          const cx = lerp(G.land[0], G.exit, out * out);
          const pos = { "--x": cx / G.w, "--y": G.land[1] / G.h };
          setVars(ball, { ...pos, "--s": s * (1 + Math.sin(hop * Math.PI) * 0.07), "--flat": clamp01((s - 8) / 10) });
          setVars(shadow, { ...pos, "--lift": lift });
          setVars(stage, { "--zoom": 1.06 - 0.06 * fall });
        }
        if (fall >= 1 && !landed) sound.thud(0.7);
        landed = fall >= 1;
      };

      const verbs = q<HTMLElement>(".auto-copy .verb");
      const renderAuto = (run: number) => {
        const k = 0.35 * run + 0.65 * run * run;
        const cx = lerp(AUTO.from, AUTO.to, k);
        const d = lerp(126, 138, clamp01(cx / AUTO.w));
        const cy = autoRail(cx) - d / 2 + 10;
        setVars(autoBall.current, { "--x": cx / AUTO.w, "--y": cy / AUTO.h, "--d": d / AUTO.w });
        setVars(autoStage.current, { "--cam": camFor(autoStage.current, clamp01(cx / AUTO.w)), "--zoom": 1.04 - 0.04 * run });
        const height = autoFloor(cx) - (cy + d / 2);
        setVars(autoShadow.current, {
          "--x": (cx + SUN * height) / AUTO.w,
          "--y": (autoFloor(cx + SUN * height) + 10) / AUTO.h,
          "--sc": 1 + height / 300,
          "--o": Math.max(0, 0.42 - height / 1000),
        });
        sound.roll(clamp01(Math.abs(cx - lastAutoX) / 16));
        lastAutoX = cx;
        // Each hoop the ball threads lights its verb in the sentence: answers, reminds, books.
        let passed = 0;
        verbs.forEach((verb, i) => {
          const on = clamp01((cx - (AUTO_HOOPS[i].x - 30)) / 70);
          verb.style.setProperty("--on", on.toFixed(3));
          if (on >= 1) passed = i + 1;
        });
        if (passed > hoopsPassed) sound.tick((passed - 1) as 0 | 1 | 2);
        hoopsPassed = passed;
      };

      // The name must clear the ball at any window shape. On a wide, short window the plate is
      // cropped from the top and the ball rides higher, so the name is capped by the space above it.
      const fitName = () => {
        const name = q<HTMLElement>(".hero-name")[0];
        const stage = heroStage.current?.getBoundingClientRect();
        const copy = heroCopy.current;
        if (!name || !stage || !copy) return;
        const ballTop = stage.top + ((heroRail(HERO.from) - HERO.ball / 2) / HERO.h) * stage.height;
        const room = ballTop - copy.getBoundingClientRect().top - parseFloat(getComputedStyle(copy).paddingTop) - 16;
        name.style.setProperty("--fit", `${Math.max(34, room / (2 * 0.88))}px`);
      };
      fitName();
      ScrollTrigger.addEventListener("refresh", fitName);
      window.addEventListener("resize", fitName);

      renderHero(0, 0);
      renderBuild(0, 0, 0);
      renderAuto(0);
      if (!reduced) gsap.set([redLayer.current, buildLayer.current, autoLayer.current], { autoAlpha: 0 });

      // --- Arrival: the name sets itself, then the ball drops onto the rail. ---

      const heroWords = q(".hero-name .word");
      const impact = `${((HERO.from / HERO.w) * 100).toFixed(2)}% ${((heroRail(HERO.from) / HERO.h) * 100).toFixed(2)}%`;
      const DROP = { at: 0.3, lasts: 1.3 };
      const hit = DROP.at + DROP.lasts * 0.364; // first contact of a bounce.out
      const intro = gsap.timeline({ paused: true, defaults: { ease: "expo.out" } });
      intro
        .fromTo(heroBall.current, { "--up": 11 }, { "--up": 0, duration: DROP.lasts, ease: "bounce.out" }, DROP.at)
        .fromTo(
          q(".hero-reveal"),
          { clipPath: `circle(0% at ${impact})` },
          { clipPath: `circle(160% at ${impact})`, duration: 2.4, ease: "expo.out", clearProps: "clipPath" },
          hit,
        )
        .from(heroWords, { yPercent: 130, duration: 1.3, stagger: 0.09 }, hit + 0.12)
        .fromTo(".hero-name", { "--wdth": 78 }, { "--wdth": 125, duration: 1.7 }, hit + 0.12)
        .from(q(".hero-fade"), { opacity: 0, y: 14, duration: 1, stagger: 0.08, ease: "power3.out" }, hit + 0.7);
      setVars(heroBall.current, { "--clip": "none" });
      intro.add(() => setVars(heroBall.current, { "--clip": HERO_CLIP }), DROP.at + DROP.lasts);

      // Nothing plays over a half-loaded frame: wait for the plate, the ball and the font,
      // but never keep a visitor on a slow line staring at blank paper for long.
      const needed = q<HTMLImageElement>(".hero-reveal img.plate, .ball img").slice(0, 2);
      const loaded = Promise.all([document.fonts.ready, ...needed.map((img) => img.decode().catch(() => undefined))]);
      const patience = new Promise((resolve) => setTimeout(resolve, 3500));
      Promise.race([loaded, patience]).then(() => (reduced ? intro.progress(1) : intro.play()));

      // The later scenes' photographs are decoded now, while the hero plays, so that no cut
      // has to wait on an image decode (that wait is a dropped frame or three on a phone).
      const warm = () => {
        q<HTMLImageElement>("img.plate").forEach((img) => img.decode?.().catch(() => undefined));
        const sprite = getComputedStyle(q(tallScreen ? ".build-part-tall" : ".build-part")[0] ?? document.body).backgroundImage.match(/url\("?([^")]+)/)?.[1];
        if (sprite) {
          const img = new Image();
          img.src = sprite;
          img.decode().catch(() => undefined);
        }
      };
      Promise.race([loaded, patience]).then(() => setTimeout(warm, 1200));

      // Every start state is now set, so the stage can show itself (it is hidden in CSS until here).
      gate.current?.style.setProperty("opacity", "1");

      if (reduced) {
        // No film: each scene stands as a finished still, stacked down the page (see globals.css).
        renderBuild(1, 0, 0);
        renderAuto(0.52);
        verbs.forEach((verb) => verb.style.setProperty("--on", "1"));
        return;
      }

      // --- The film: one scrubbed timeline, pinned for its whole length. ---

      const hero = { roll: 0, leap: 0 };
      const build = { fall: 0, hop: 0, out: 0 };
      const auto = { run: 0 };
      const drawHero = () => renderHero(hero.roll, hero.leap);
      const drawBuild = () => renderBuild(build.fall, build.hop, build.out);

      const autoCopyAt = tallScreen ? 88.5 : 77;

      const tl = gsap.timeline({ paused: true, defaults: { ease: "none" } });
      // The section is tall and its stage is position: sticky, so the browser holds the frame
      // still natively; the scroll position is only read, then mapped to a time on the film.
      const scrub = ScrollTrigger.create({
        trigger: root.current,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => tl.time(along(self.progress * SCREENS, 0)),
        onRefresh: (self) => tl.time(along(self.progress * SCREENS, 0)),
      });
      let keep: number | null = null;
      let lastWidth = window.innerWidth;
      const rememberPlace = () => {
        if (window.innerWidth === lastWidth) return;
        lastWidth = window.innerWidth;
        if (keep === null && scrub.isActive) keep = scrub.progress;
      };
      const restorePlace = () => {
        if (keep === null) return;
        window.scrollTo(0, scrub.start + keep * (scrub.end - scrub.start));
        keep = null;
      };
      window.addEventListener("resize", rememberPlace);
      ScrollTrigger.addEventListener("refresh", restorePlace);

      // For the screenshot scripts: where to scroll to see a given film time.
      const debug = window as unknown as { __filmScroll?: (t: number) => number; __filmNow?: () => number };
      debug.__filmScroll = (t) => scrub.start + (along(t, 1) / SCREENS) * (scrub.end - scrub.start);
      debug.__filmNow = () => tl.time();

      // Hero: roll the length of the rail, then leap at the lens until the frame is red.
      tl.to(hero, { roll: 1, duration: 24, onUpdate: drawHero }, 0)
        .to(cue.current, { autoAlpha: 0, duration: 2 }, 0.5)
        .to([heroCopy.current, q(".hero-role")], { yPercent: -16, autoAlpha: 0, duration: 4.5, ease: "power1.in" }, 20)
        .to(hero, { leap: 1, duration: 7, onUpdate: drawHero }, 24)
        .set(document.documentElement, { "--nav-l": CREAM, "--nav-r": CREAM, "--nav-dot": CREAM }, 29.9)
        .set(redLayer.current, { autoAlpha: 1 }, 31)
        .set(heroLayer.current, { autoAlpha: 0 }, 31);

      // Red: two sentences that do what they say. "lost" drops out of the first;
      // in the second, a lead falls from above and lands in the cup of the "u" in "build".
      const [first, second] = [q(".say-1 .word"), q(".say-2 .word")];
      const lost = q('.say-1 .word[data-w="lost"]')[0] as HTMLElement | undefined;
      const cup = q('.say-2 .word[data-w="build"]')[0] as HTMLElement | undefined;
      const caught = q<HTMLElement>(".caught")[0];
      const placeCaught = () => {
        const text = cup?.firstChild;
        const frame = caught?.offsetParent?.getBoundingClientRect();
        if (!cup || !text || !frame || !caught) return;
        const glyph = document.createRange();
        glyph.setStart(text, 1);
        glyph.setEnd(text, 2);
        const u = glyph.getBoundingClientRect();
        const line = cup.parentElement!.getBoundingClientRect();
        const em = parseFloat(getComputedStyle(cup).fontSize);
        const size = em * 0.25;
        // Baseline sits 0.764em under the top of the line box; the bowl of the u is one stem above it.
        Object.assign(caught.style, {
          width: `${size}px`,
          height: `${size}px`,
          left: `${u.left - frame.left + u.width / 2 - size / 2}px`,
          top: `${line.top - frame.top + em * (0.764 - 0.165) - size}px`,
        });
      };
      placeCaught();
      ScrollTrigger.addEventListener("refresh", placeCaught);

      tl.from(first, { yPercent: 130, duration: 2.2, stagger: 0.16, ease: "power3.out" }, 31.4);
      if (lost) {
        tl.call(() => sound.drop(), undefined, 35.5).set(lost.parentElement, { overflow: "visible" }, 35.4).to(
          lost,
          { y: () => window.innerHeight * 1.1, x: () => window.innerWidth * 0.04, rotation: 16, duration: 3.4, ease: "power2.in" },
          35.4,
        );
      }
      tl.to(first, { yPercent: -130, duration: 1.6, stagger: 0.08, ease: "power3.in" }, 39)
        .from(second, { yPercent: 130, duration: 2.2, stagger: 0.22, ease: "power3.out" }, 41.2)
        .fromTo(caught, { y: () => -window.innerHeight }, { y: 0, duration: 2.8, ease: "bounce.out", immediateRender: true }, 43.6);
      if (cup) tl.to(cup, { yPercent: 6, duration: 0.3, ease: "power2.out", yoyo: true, repeat: 1 }, 43.6 + 2.8 * 0.364);
      tl.to(second, { yPercent: -130, duration: 1.4, stagger: 0.08, ease: "power3.in" }, 47.6).to(
        caught,
        { y: () => -window.innerHeight * 0.7, duration: 1.5, ease: "power3.in" },
        47.7,
      );

      // Build: the red falls away from the lens and lands as the ball among the parts.
      tl.set(buildLayer.current, { autoAlpha: 1 }, 50)
        .set(redLayer.current, { autoAlpha: 0 }, 50)
        .to(build, { fall: 1, duration: 8, ease: "power1.out", onUpdate: drawBuild }, 50)
        .set(document.documentElement, { "--nav-l": INK, "--nav-dot": RED }, 51.1)
        .set(document.documentElement, { "--nav-r": INK }, 53.4)
        .to(build, { hop: 1, duration: 2.2, onUpdate: drawBuild }, 58)
        .from(q(".build-copy .word"), { yPercent: 130, duration: 2.4, stagger: 0.2, ease: "power3.out" }, 57)
        .fromTo(q(".build-copy h2"), { "--wdth": tallScreen ? 125 : 80 }, { "--wdth": 125, duration: 3.4, ease: "power3.out" }, 57)
        .from(q(".build-copy .fade"), { autoAlpha: 0, y: 16, duration: 2, stagger: 0.3, ease: "power2.out" }, 59)
        // Build builds: the thirteen parts are set down one after another around the ball. Both
        // compositions run the same sequence; only the one on screen makes the sound.
        .from(
          q(".build-part:not(.build-part-tall)"),
          { autoAlpha: 0, scale: 1.08, y: -12, duration: 1.2, ease: "power3.out", stagger: { each: 0.52, onStart: () => !tallScreen && sound.thud(0.22) } },
          58.6,
        )
        .from(
          q(".build-part-tall"),
          { autoAlpha: 0, scale: 1.08, y: -12, duration: 1.2, ease: "power3.out", stagger: { each: 0.52, onStart: () => tallScreen && sound.thud(0.22) } },
          58.6,
        )
        .to(build, { out: 1, duration: 5, onUpdate: drawBuild }, 66.4)
        .to(q(".build-copy"), { autoAlpha: 0, yPercent: -6, duration: 3, ease: "power1.in" }, 68.6);

      // Automate: the camera whips right after the ball, and it rolls back into frame on the assembled run.
      tl.set(autoLayer.current, { autoAlpha: 1 }, 71.2)
        .fromTo(buildLayer.current, { xPercent: 0 }, { xPercent: -100, duration: 4.4, ease: "power2.inOut" }, 71.2)
        .fromTo(autoLayer.current, { xPercent: 100 }, { xPercent: 0, duration: 4.4, ease: "power2.inOut" }, 71.2)
        .set(buildLayer.current, { autoAlpha: 0 }, 75.7)
        .to(auto, { run: 1, duration: 27.6, onUpdate: () => renderAuto(auto.run) }, 75.2)
        .from(q(".auto-copy .word"), { yPercent: 130, duration: 2.4, stagger: 0.2, ease: "power3.out" }, autoCopyAt)
        .fromTo(q(".auto-copy h2"), { "--wdth": tallScreen ? 125 : 80 }, { "--wdth": 125, duration: 3.4, ease: "power3.out" }, autoCopyAt)
        .from(q(".auto-copy .fade"), { autoAlpha: 0, y: 16, duration: 2, stagger: 0.3, ease: "power2.out" }, autoCopyAt + 2)
        // Hold the last frame: the Grow scene dissolves in over it (see Grow.tsx), so there is no blank beat.
        .to({}, { duration: 0.5 }, 102);

      return () => {
        for (const name of ["--nav-l", "--nav-r", "--nav-dot"]) document.documentElement.style.removeProperty(name);
        window.removeEventListener("resize", fitName);
        window.removeEventListener("resize", rememberPlace);
        ScrollTrigger.removeEventListener("refresh", restorePlace);
        scrub.kill();
      };
    },
    { scope: root },
  );

  const [build, automate] = site.acts;

  return (
    <section ref={root} id="top" className="relative bg-paper" style={{ height: `${(SCREENS + 1) * 100}lvh` }} aria-label="Introduction">
      <div ref={gate} className="film-gate sticky top-0 h-lvh w-full overflow-hidden bg-paper">
      {/* Hero */}
      <div ref={heroLayer} className="layer">
        <div ref={heroStage} className="stage" style={{ "--ar": HERO.w / HERO.h, "--ay": 0.72 } as React.CSSProperties}>
          <div className="hero-reveal absolute inset-0">
            <Plate name="hero-plate" w={HERO.w} eager />
            <div ref={heroShadow} className="floor-shadow" style={{ "--d": (HERO.ball * 1.5) / HERO.w } as React.CSSProperties} />
          </div>
          <div
            ref={heroBall}
            className="ball"
            style={{ "--d": HERO.ball / HERO.w, clipPath: "var(--clip)" } as React.CSSProperties}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="hero-ball-drop" src="/art/ball.webp" alt="" />
            <i />
          </div>
        </div>

        <div ref={heroCopy} className="absolute inset-x-0 top-0 px-[5vw] pt-[max(13lvh,5.75rem)]">
          <h1 className="hero-name display text-[min(clamp(3.1rem,10.3vw,13.5rem),var(--fit,100rem))] text-ink max-md:text-[min(13.8vw,var(--fit,100rem))]">
            {[site.name.first, site.name.last].map((line) => (
              <span key={line} className="line-mask whitespace-nowrap" aria-label={line}>
                <span className="word" aria-hidden>
                  {[...line].map((ch, i) => (
                    <span key={i} className="ch inline-block">
                      {ch}
                    </span>
                  ))}
                </span>
              </span>
            ))}
          </h1>
        </div>
        <div className="hero-role absolute right-[5vw] top-[calc(max(13lvh,5.75rem)+0.5rem)] max-md:left-[5vw] max-md:right-auto max-md:top-[calc(max(13lvh,5.75rem)+26vw)]">
          <p className="hero-fade reading read-size max-w-[24ch] text-ink/85 md:text-right">{site.role}</p>
        </div>

        <div ref={cue} className="absolute bottom-[4svh] left-[5vw]">
          <p className="hero-fade small flex items-center gap-3 text-ink/70">
            <span className="block h-px w-10 bg-ink/50" />
            Scroll, or
            <button
              type="button"
              className="pointer-events-auto border-b border-ink/50 pb-px text-ink transition-colors duration-300 hover:border-red hover:text-red"
              onClick={() => document.dispatchEvent(new CustomEvent("film:play"))}
            >
              play the film
            </button>
          </p>
        </div>
      </div>

      {/* Red */}
      <div ref={redLayer} className="layer red-grain flex items-center bg-red px-[5vw] text-cream">
        <div className="relative w-full">
          <p className="say-1 display max-w-[15ch] text-[clamp(2.5rem,7.4vw,9rem)]" style={{ "--wdth": 114 } as React.CSSProperties}>
            <Words text={site.statement[0]} />
          </p>
          <div className="caught absolute overflow-hidden rounded-full shadow-[0.05em_0.08em_0.2em_rgba(70,8,2,0.6)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/art/ball.webp" alt="" className="size-full" />
          </div>
          <p
            className="say-2 display absolute inset-x-0 top-1/2 max-w-[12ch] -translate-y-1/2 text-[clamp(3rem,10vw,12.5rem)]"
            style={{ "--wdth": 125 } as React.CSSProperties}
          >
            <Words text={site.statement[1]} />
          </p>
        </div>
      </div>

      {/* Build */}
      <div ref={buildLayer} className="layer">
        <div ref={buildStage} className="stage max-md:hidden" style={{ "--ar": BUILD.w / BUILD.h } as React.CSSProperties}>
          <BuildSet plate="build" G={{ ...BUILD, parts: PARTS }} ball={buildBall} shadow={buildShadow} />
        </div>
        {/* Tall screens: the plate spans the width and stands at the top; its lower edge feathers into the page. */}
        <div
          ref={tallStage}
          className="tall-stage absolute top-[5lvh] md:hidden"
          style={{ aspectRatio: `${BUILD_TALL.w} / ${BUILD_TALL.h}` }}
        >
          <BuildSet plate="build-tall" G={BUILD_TALL} ball={tallBall} shadow={tallShadow} tall />
        </div>
        <ActCopy act={build} className="build-copy left-[5vw] top-1/2 w-[min(31vw,30rem)] -translate-y-1/2 max-md:bottom-[7lvh] max-md:top-auto max-md:w-[84vw] max-md:translate-y-0" />
      </div>

      {/* Automate */}
      <div ref={autoLayer} className="layer">
        <div ref={autoStage} className="stage" style={{ "--ar": AUTO.w / AUTO.h, "--ay": 0.42 } as React.CSSProperties}>
          <Plate name="automate" w={AUTO.w} />
          <div ref={autoShadow} className="floor-shadow" style={{ "--d": 0.125 } as React.CSSProperties} />
          <Ball ref={autoBall} />
          <Plate name="automate-fg" w={AUTO.w} />
        </div>
        <ActCopy act={automate} className="auto-copy left-[57vw] top-[max(11lvh,5.5rem)] w-[38vw] max-md:left-[5vw] max-md:w-[84vw]" verbs={site.followUp} />
      </div>
      </div>
    </section>
  );
}

// One composition of the Build scene: the empty surface, every part cut from the full
// photograph so it can be set down on its own, and the ball with its shadow.
function BuildSet({
  plate,
  G,
  ball,
  shadow,
  tall,
}: {
  plate: string;
  G: { w: number; h: number; ball: number; parts: readonly Box[] };
  ball: React.Ref<HTMLDivElement>;
  shadow: React.Ref<HTMLDivElement>;
  tall?: boolean;
}) {
  return (
    <>
      {/* The photograph and its parts fade out at the edges on a tall screen; the ball must not, or the red could not fill the frame. */}
      <div className={`absolute inset-0 ${tall ? "tall-fade" : ""}`}>
        <Plate name={`${plate}-empty`} w={G.w} />
        {G.parts.map(([x, y, w, h], i) => (
          <div
            key={i}
            className={`build-part ${tall ? "build-part-tall" : ""}`}
            style={{
              left: `${(x / G.w) * 100}%`,
              top: `${(y / G.h) * 100}%`,
              width: `${(w / G.w) * 100}%`,
              height: `${(h / G.h) * 100}%`,
              backgroundSize: `${(G.w / w) * 100}% ${(G.h / h) * 100}%`,
              backgroundPosition: `${(x / (G.w - w)) * 100}% ${(y / (G.h - h)) * 100}%`,
            }}
          />
        ))}
      </div>
      <div ref={shadow} className="ball-shadow" style={{ "--d": G.ball / G.w } as React.CSSProperties} />
      <div ref={ball} className="ball" style={{ "--d": G.ball / G.w } as React.CSSProperties}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/ball.webp" alt="" />
        <i />
      </div>
    </>
  );
}

function ActCopy({ act, className, verbs }: { act: (typeof site.acts)[number]; className: string; verbs?: readonly string[] }) {
  // Words listed in `verbs` are wrapped so the scene can light them one by one.
  const line = verbs
    ? act.line.split(new RegExp(`\\b(${verbs.join("|")})\\b`)).map((part, i) =>
        verbs.includes(part) ? (
          <span key={i} className="verb">
            {part}
          </span>
        ) : (
          part
        ),
      )
    : act.line;
  return (
    <div className={`absolute ${className}`}>
      <h2 className="display text-[clamp(3rem,7.6vw,9.6rem)] text-ink">
        <Words text={act.word} />
      </h2>
      <p className="fade reading read-size mt-[1.5vw] max-w-[27ch] text-ink/90">{line}</p>
      <ul className="fade small mt-[1.2vw] flex flex-wrap gap-x-5 gap-y-1 text-ink/65">
        {act.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
