"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { site } from "@/content/site";

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Plate geometry, in the pixel space of each raw photograph (see scripts/measure-rail.mjs).
const HERO = { w: 1672, h: 941, ball: 78, from: 172, to: 1530 };
const heroRail = (cx: number) => 479 + 0.15 * (cx - 140);
const HERO_CLIP = "polygon(0 0, 100% 0, 100% 96.6%, 0 81.6%)";
const HERO_FLOOR = 848; // where the blocks meet the floor
const SUN = 0.42; // how far a shadow slides right for every pixel of height, read off the block shadows

const BUILD = { w: 1536, h: 1024, ball: 76, land: [1325, 205] as const, exit: 1640 };

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
const AUTO_CLIP = "polygon(0 0, 100% 0, 100% 100%, 83.5% 100%, 0 73.1%)";

// How large the ball has to grow to flood the whole window with red from anywhere on screen.
const FLOOD = 72;

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

function Plate({ name, w, eager }: { name: string; w: number; eager?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- plates need exact registration, not layout-driven sizing
    <img
      className="plate"
      src={`/art/${name}-1x.webp`}
      srcSet={`/art/${name}-1x.webp ${w}w, /art/${name}-2x.webp ${w * 2}w`}
      sizes="max(100vw, 178svh)"
      alt=""
      decoding="async"
      fetchPriority={eager ? "high" : "auto"}
    />
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

  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // --- Per-scene renderers: one number in, the whole physical state out. ---

      const letters = q<HTMLElement>(".hero-name .ch");
      let centres: number[] | null = null;
      ScrollTrigger.addEventListener("refreshInit", () => (centres = null));

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
        setVars(heroStage.current, { "--cam": cx / HERO.w, "--zoom": 1 + 0.05 * roll });

        // A real cast shadow: it tightens, darkens and closes in as the ball loses height.
        const height = HERO_FLOOR - (cy + HERO.ball / 2);
        setVars(heroShadow.current, {
          "--x": (cx + SUN * height) / HERO.w,
          "--y": (HERO_FLOOR + 6) / HERO.h,
          "--sc": 1 + height / 240,
          "--o": Math.max(0, 0.4 - height / 950) * (1 - clamp01(leap * 3)),
          "--b": `${2 + height / 36}px`,
        });

        // The name feels the ball go by: letters above it narrow and lift, then settle.
        const ballBox = heroBall.current?.getBoundingClientRect();
        if (!ballBox || !letters.length) return;
        if (!centres) centres = letters.map((el) => el.getBoundingClientRect().left + el.offsetWidth / 2);
        const ballX = ballBox.left + ballBox.width / 2;
        const reach = window.innerWidth * 0.12;
        const strength = clamp01(roll * 14) * (1 - clamp01(leap * 4));
        letters.forEach((el, i) => {
          const wave = strength * Math.exp(-(((centres![i] - ballX) / reach) ** 2));
          el.style.fontVariationSettings = `"wdth" ${(118 - 34 * wave).toFixed(1)}`;
          el.style.transform = `translateY(${(-0.09 * wave).toFixed(3)}em)`;
        });
      };

      const renderBuild = (fall: number, hop: number, out: number) => {
        const s = FLOOD ** (1 - fall);
        const lift = clamp01((s - 1) / 5) + Math.sin(hop * Math.PI) * 0.16;
        const cx = lerp(BUILD.land[0], BUILD.exit, out * out);
        const pos = { "--x": cx / BUILD.w, "--y": BUILD.land[1] / BUILD.h };
        setVars(buildBall.current, {
          ...pos,
          "--s": s * (1 + Math.sin(hop * Math.PI) * 0.07),
          "--flat": clamp01((s - 8) / 10),
        });
        setVars(buildShadow.current, { ...pos, "--lift": lift });
        setVars(buildStage.current, { "--cam": 0.93, "--zoom": 1.06 - 0.06 * fall });
      };

      const labels = q<HTMLElement>(".hoop-label");
      const renderAuto = (run: number) => {
        const k = 0.35 * run + 0.65 * run * run;
        const cx = lerp(AUTO.from, AUTO.to, k);
        const d = lerp(126, 138, clamp01(cx / AUTO.w));
        const cy = autoRail(cx) - d / 2 + 10;
        setVars(autoBall.current, { "--x": cx / AUTO.w, "--y": cy / AUTO.h, "--d": d / AUTO.w });
        setVars(autoStage.current, { "--cam": clamp01(cx / AUTO.w), "--zoom": 1.04 - 0.04 * run });
        const height = autoFloor(cx) - (cy + d / 2);
        setVars(autoShadow.current, {
          "--x": (cx + SUN * height) / AUTO.w,
          "--y": (autoFloor(cx + SUN * height) + 10) / AUTO.h,
          "--sc": 1 + height / 300,
          "--o": Math.max(0, 0.42 - height / 1000),
          "--b": `${3 + height / 30}px`,
        });
        labels.forEach((label, i) => {
          const passed = clamp01((cx - (AUTO_HOOPS[i].x - 40)) / 90);
          label.style.opacity = String(passed);
          label.style.transform = `translate(-50%, ${(1 - passed) * 10}px)`;
        });
      };

      renderHero(0, 0);
      renderBuild(0, 0, 0);
      renderAuto(0);
      gsap.set([redLayer.current, buildLayer.current, autoLayer.current], { autoAlpha: 0 });

      // --- Arrival: the name sets itself, then the ball drops onto the rail. ---

      const heroWords = q(".hero-name .word");
      const impact = `${((HERO.from / HERO.w) * 100).toFixed(2)}% ${((heroRail(HERO.from) / HERO.h) * 100).toFixed(2)}%`;
      const DROP = { at: 0.3, lasts: 1.3 };
      const hit = DROP.at + DROP.lasts * 0.364; // first contact of a bounce.out
      const intro = gsap.timeline({ defaults: { ease: "expo.out" } });
      intro
        .fromTo(heroBall.current, { "--up": 11 }, { "--up": 0, duration: DROP.lasts, ease: "bounce.out" }, DROP.at)
        .fromTo(
          q(".hero-reveal"),
          { clipPath: `circle(0% at ${impact})` },
          { clipPath: `circle(160% at ${impact})`, duration: 2.4, ease: "expo.out", clearProps: "clipPath" },
          hit,
        )
        .from(heroWords, { yPercent: 130, duration: 1.3, stagger: 0.09 }, hit + 0.12)
        .fromTo(".hero-name", { "--wdth": 70 }, { "--wdth": 118, duration: 1.7 }, hit + 0.12)
        .from(q(".hero-fade"), { opacity: 0, y: 14, duration: 1, stagger: 0.08, ease: "power3.out" }, hit + 0.7);
      setVars(heroBall.current, { "--clip": "none" });
      intro.add(() => setVars(heroBall.current, { "--clip": HERO_CLIP }), DROP.at + DROP.lasts);

      if (reduced) return;

      // --- The film: one scrubbed timeline, pinned for its whole length. ---

      const hero = { roll: 0, leap: 0 };
      const build = { fall: 0, hop: 0, out: 0 };
      const auto = { run: 0 };
      const drawHero = () => renderHero(hero.roll, hero.leap);
      const drawBuild = () => renderBuild(build.fall, build.hop, build.out);

      const autoCopyAt = window.innerWidth < 768 ? 88.5 : 77;

      const tl = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: root.current,
          start: "top top",
          end: "+=1050%",
          pin: true,
          scrub: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
        },
      });

      // Hero: roll the length of the rail, then leap at the lens until the frame is red.
      tl.to(hero, { roll: 1, duration: 24, onUpdate: drawHero }, 0)
        .to(cue.current, { autoAlpha: 0, duration: 2 }, 0.5)
        .to([heroCopy.current, q(".hero-role")], { yPercent: -16, autoAlpha: 0, duration: 4.5, ease: "power1.in" }, 20)
        .to(hero, { leap: 1, duration: 7, onUpdate: drawHero }, 24)
        .fromTo(document.documentElement, { "--nav": "#1b1815" }, { "--nav": "#f4ecdf", duration: 1.5 }, 28.5)
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
        tl.set(lost.parentElement, { overflow: "visible" }, 35.4).to(
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
        .fromTo(document.documentElement, { "--nav": "#f4ecdf" }, { "--nav": "#1b1815", duration: 2, immediateRender: false }, 52)
        .to(build, { hop: 1, duration: 2.2, onUpdate: drawBuild }, 58)
        .from(q(".build-copy .word"), { yPercent: 130, duration: 2.4, stagger: 0.2, ease: "power3.out" }, 57)
        .from(q(".build-copy .fade"), { autoAlpha: 0, y: 16, duration: 2, stagger: 0.3, ease: "power2.out" }, 59)
        .to(build, { out: 1, duration: 6, onUpdate: drawBuild }, 67)
        .to(q(".build-copy"), { autoAlpha: 0, yPercent: -6, duration: 3, ease: "power1.in" }, 70);

      // Automate: dissolve to the assembled run; the ball threads the three hoops.
      tl.to(buildLayer.current, { autoAlpha: 0, duration: 4.5, ease: "power1.inOut" }, 72.5)
        .fromTo(autoLayer.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 4.5, ease: "power1.inOut" }, 72.5)
        .to(auto, { run: 1, duration: 27, onUpdate: () => renderAuto(auto.run) }, 76)
        .from(q(".auto-copy .word"), { yPercent: 130, duration: 2.4, stagger: 0.2, ease: "power3.out" }, autoCopyAt)
        .from(q(".auto-copy .fade"), { autoAlpha: 0, y: 16, duration: 2, stagger: 0.3, ease: "power2.out" }, autoCopyAt + 2)
        .to(autoLayer.current, { autoAlpha: 0, duration: 4, ease: "power1.in" }, 102);

      return () => {
        document.documentElement.style.removeProperty("--nav");
      };
    },
    { scope: root },
  );

  const [build, automate] = site.acts;

  return (
    <section ref={root} id="top" className="relative h-svh w-full overflow-hidden bg-paper" aria-label="Introduction">
      {/* Hero */}
      <div ref={heroLayer} className="layer grain">
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

        <div ref={heroCopy} className="absolute inset-x-0 top-0 px-[5vw] pt-[max(15svh,6.5rem)]">
          <h1 className="hero-name display text-[clamp(3.4rem,11.6vw,15rem)] text-ink">
            {[site.name.first, site.name.last].map((line) => (
              <span key={line} className="line-mask" aria-label={line}>
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
        <div className="hero-role absolute right-[5vw] top-[max(16.5svh,7rem)] max-md:left-[5vw] max-md:right-auto max-md:top-[calc(max(15svh,6.5rem)+7.4rem)]">
          <p className="hero-fade reading max-w-[21ch] text-[clamp(1rem,1.45vw,1.5rem)] text-ink/80">{site.role}</p>
        </div>

        <div ref={cue} className="absolute bottom-[4svh] left-[5vw]">
          <p className="hero-fade small flex items-center gap-3 text-ink/70">
            <span className="block h-px w-10 bg-ink/50" />
            Scroll to follow the lead
          </p>
        </div>
      </div>

      {/* Red */}
      <div ref={redLayer} className="layer grain flex items-center bg-red px-[5vw] text-cream">
        <div className="relative w-full">
          <p className="say-1 display max-w-[15ch] text-[clamp(2.5rem,7.4vw,9rem)]" style={{ "--wdth": 104 } as React.CSSProperties}>
            <Words text={site.statement[0]} />
          </p>
          <div className="caught absolute rounded-full bg-cream" />
          <p
            className="say-2 display absolute inset-x-0 top-1/2 max-w-[12ch] -translate-y-1/2 text-[clamp(3rem,10vw,12.5rem)]"
            style={{ "--wdth": 112 } as React.CSSProperties}
          >
            <Words text={site.statement[1]} />
          </p>
        </div>
      </div>

      {/* Build */}
      <div ref={buildLayer} className="layer grain">
        <div ref={buildStage} className="stage" style={{ "--ar": BUILD.w / BUILD.h } as React.CSSProperties}>
          <Plate name="build" w={BUILD.w} />
          <div ref={buildShadow} className="ball-shadow" style={{ "--d": BUILD.ball / BUILD.w } as React.CSSProperties} />
          <div ref={buildBall} className="ball" style={{ "--d": BUILD.ball / BUILD.w } as React.CSSProperties}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/art/ball.webp" alt="" />
            <i />
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[58svh] bg-gradient-to-t from-paper from-35% via-paper/80 to-transparent md:hidden" />
        <ActCopy act={build} className="build-copy left-[5vw] top-1/2 w-[min(31vw,30rem)] -translate-y-1/2 max-md:bottom-[8svh] max-md:top-auto max-md:w-[84vw] max-md:translate-y-0" />
      </div>

      {/* Automate */}
      <div ref={autoLayer} className="layer grain">
        <div ref={autoStage} className="stage" style={{ "--ar": AUTO.w / AUTO.h, "--ay": 0.42 } as React.CSSProperties}>
          <Plate name="automate" w={AUTO.w} />
          <div ref={autoShadow} className="floor-shadow" style={{ "--d": 0.125 } as React.CSSProperties} />
          <Ball ref={autoBall} clip={AUTO_CLIP} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="plate"
            src="/art/automate-fg-1x.webp"
            srcSet={`/art/automate-fg-1x.webp ${AUTO.w}w, /art/automate-fg-2x.webp ${AUTO.w * 2}w`}
            sizes="max(100vw, 178svh)"
            alt=""
          />
          {AUTO_HOOPS.map((hoop, i) => (
            <span
              key={site.followUp[i]}
              className="hoop-label small absolute text-ink"
              style={{ left: `${(hoop.x / AUTO.w) * 100}%`, top: `${((hoop.top - 44) / AUTO.h) * 100}%`, opacity: 0 }}
            >
              {site.followUp[i]}
            </span>
          ))}
        </div>
        <ActCopy act={automate} className="auto-copy right-[5vw] top-[max(10.5svh,5.5rem)] w-[51vw] max-md:left-[5vw] max-md:right-auto max-md:w-[84vw]" indent />
      </div>
    </section>
  );
}

function ActCopy({ act, className, indent }: { act: (typeof site.acts)[number]; className: string; indent?: boolean }) {
  const side = indent ? "md:ml-auto md:w-[35vw]" : "";
  return (
    <div className={`absolute ${className}`}>
      <h2 className="display text-[clamp(3.2rem,8.8vw,11rem)] text-ink">
        <Words text={act.word} />
      </h2>
      <p className={`fade reading mt-[1.6vw] max-w-[26ch] text-[clamp(1.05rem,1.5vw,1.55rem)] text-ink/85 ${side}`}>
        {act.line}
      </p>
      <ul className={`fade small mt-[1.4vw] flex flex-wrap gap-x-5 gap-y-1 text-ink/65 ${side}`}>
        {act.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
