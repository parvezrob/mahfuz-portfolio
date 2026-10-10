"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { site } from "@/content/site";

gsap.registerPlugin(ScrollTrigger, useGSAP);

// The portrait plate: where he stands and where the red ball rests, as fractions of the frame.
// The room opens out of that ball, and on a narrow screen the plate pans to keep him in view.
const SET = { src: "/art/portrait-c.webp", w: 1536, h: 1024, ball: "89.3% 67%", cam: 0.86, headroom: 0.35 };

export function About() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const q = gsap.utils.selector(root);
      const set = q(".about-set")[0];

      gsap.fromTo(
        q(".about-iris"),
        { clipPath: `circle(0% at ${SET.ball})` },
        { clipPath: `circle(150% at ${SET.ball})`, ease: "power2.inOut", scrollTrigger: { trigger: set, start: "top 88%", end: "top 8%", scrub: true } },
      );
      gsap.fromTo(q(".about-iris img"), { scale: 1.1 }, { scale: 1, ease: "none", scrollTrigger: { trigger: set, start: "top bottom", end: "bottom top", scrub: true } });
      gsap.from(q(".about-word .word"), { yPercent: 130, duration: 1.2, stagger: 0.08, ease: "expo.out", scrollTrigger: { trigger: q(".about-word"), start: "top 70%" } });
      gsap.fromTo(q(".about-word"), { "--wdth": 80 }, { "--wdth": 125, duration: 1.6, ease: "expo.out", scrollTrigger: { trigger: q(".about-word"), start: "top 70%" } });
      gsap.from(q(".about-fade"), { autoAlpha: 0, y: 22, duration: 1.1, ease: "power3.out", scrollTrigger: { trigger: q(".about-fade"), start: "top 82%" } });
    },
    { scope: root },
  );

  const [greeting, story] = site.about.lines;

  return (
    <section ref={root} id="about" className="relative md:h-lvh">
      {/* One portrait for every screen: full height beside the text on wide screens, a tall band above it on phones. */}
      <div className="about-set relative h-[66lvh] overflow-hidden [--vh:66lvh] md:absolute md:inset-0 md:h-auto md:[--vh:100lvh]">
        <div className="about-iris stage" style={{ "--ar": SET.w / SET.h, "--ay": SET.headroom, "--cam": SET.cam } as React.CSSProperties}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="plate"
            src={SET.src}
            srcSet={`${SET.src} ${SET.w}w, ${SET.src.replace(".webp", "-2x.webp")} ${SET.w * 2}w`}
            sizes="(max-width: 899px) 100lvh, max(100vw, 150lvh)"
            alt={`${site.name.first} ${site.name.last}`}
            loading="lazy"
          />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[15%] bg-gradient-to-t from-paper to-transparent" />
      </div>

      <div className="relative px-[5vw] pb-[12lvh] pt-10 md:absolute md:left-0 md:top-1/2 md:w-[47vw] md:-translate-y-1/2 md:py-0">
        <h2 className="about-word display text-[clamp(3rem,8.6vw,11rem)] max-md:text-[15vw]">
          {greeting.split(" ").map((word) => (
            <span key={word} className="inline-block overflow-clip pb-[0.14em] align-top">
              <span className="word">{word}&nbsp;</span>
            </span>
          ))}
        </h2>
        <p className="about-fade reading read-size mt-[2.2vw] max-w-[33ch] text-ink/90 max-md:mt-5">{story}</p>
      </div>
    </section>
  );
}
