"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { site } from "@/content/site";

gsap.registerPlugin(ScrollTrigger, useGSAP);

// portrait-b.png: he stands right of centre; the red ball rests on a block at the far right.
const SET = { w: 1536, h: 1024, ball: "94.6% 62%" };

function Rise({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((word) => (
        <span key={word} className="inline-block overflow-clip pb-[0.14em] align-top">
          <span className="word">{word}&nbsp;</span>
        </span>
      ))}
    </>
  );
}

export function About() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const q = gsap.utils.selector(root);

      // Wide screens: the room opens out of the ball as the section arrives.
      const set = q(".about-set")[0];
      if (set && set.clientHeight > 0) {
        gsap.fromTo(
          q(".about-iris"),
          { clipPath: `circle(0% at ${SET.ball})` },
          { clipPath: `circle(140% at ${SET.ball})`, ease: "power2.inOut", scrollTrigger: { trigger: set, start: "top 85%", end: "top 5%", scrub: true } },
        );
        gsap.fromTo(q(".about-iris img"), { scale: 1.12 }, { scale: 1, ease: "none", scrollTrigger: { trigger: set, start: "top bottom", end: "bottom top", scrub: true } });
      }

      // Phones: the framed portrait opens like a shutter.
      const frame = q(".about-frame")[0];
      if (frame && frame.clientHeight > 0) {
        gsap.fromTo(frame, { clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0% 0 0 0)", duration: 1.5, ease: "expo.out", scrollTrigger: { trigger: frame, start: "top 80%" } });
      }

      q<HTMLElement>(".about-rise").forEach((block) => {
        if (block.offsetParent === null) return;
        gsap.from(block.querySelectorAll(".word"), { yPercent: 130, duration: 1.2, stagger: 0.08, ease: "expo.out", scrollTrigger: { trigger: block, start: "top 62%" } });
      });
      q<HTMLElement>(".about-fade").forEach((el) => {
        if (el.offsetParent === null) return;
        gsap.from(el, { autoAlpha: 0, y: 22, duration: 1.1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 84%" } });
      });
    },
    { scope: root },
  );

  const [greeting, story] = site.about.lines;
  const name = `${site.name.first} ${site.name.last}`;

  return (
    <section ref={root} id="about" className="relative">
      <div className="about-set grain relative hidden h-svh overflow-hidden md:block">
        <div className="about-iris stage" style={{ "--ar": SET.w / SET.h, "--ay": 0.04 } as React.CSSProperties}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="plate" src="/art/portrait-b.webp" alt={name} loading="lazy" />
        </div>
        <div className="absolute left-[5vw] top-1/2 w-[44vw] -translate-y-1/2">
          <h2 className="about-rise display text-[clamp(3rem,9.4vw,12rem)]">
            <Rise text={greeting} />
          </h2>
          <p className="about-fade reading mt-[2.6vw] max-w-[25ch] text-[clamp(1.2rem,1.9vw,2rem)]">{story}</p>
        </div>
      </div>

      <div className="px-[5vw] pt-[12svh] md:hidden">
        <div className="about-frame relative aspect-[4/5] w-full overflow-hidden bg-ink/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/art/portrait-a.webp" alt={name} width={1122} height={1402} loading="lazy" className="absolute inset-0 size-full object-cover" />
        </div>
        <h2 className="about-rise display mt-10 text-[clamp(3rem,15vw,6rem)]">
          <Rise text={greeting} />
        </h2>
        <p className="about-fade reading mt-6 max-w-[26ch] text-[1.3rem]">{story}</p>
      </div>

      <ul className="mx-[5vw] mb-[14svh] mt-[9svh] border-t border-ink/25 md:ml-auto md:w-[52vw]">
        {site.about.roles.map((role) => (
          <li key={role.at} className="about-fade flex items-baseline justify-between gap-6 border-b border-ink/25 py-[1.15rem]">
            <span className="reading text-[clamp(1.1rem,1.7vw,1.7rem)]">{role.title}</span>
            <span className="small text-ink/65">{role.at}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
