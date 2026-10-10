"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { site } from "@/content/site";

gsap.registerPlugin(ScrollTrigger, useGSAP);

// A pinned walk past four product shots. The page scrolls down; the row travels sideways,
// and each photograph drifts inside its frame so the row never feels like a flat strip.
export function Samples() {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const row = track.current;
      if (!row || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const q = gsap.utils.selector(root);
      row.style.overflow = "visible";
      const distance = () => Math.max(0, row.scrollWidth - window.innerWidth);

      const travel = gsap.to(row, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: root.current,
          start: "top top",
          end: () => `+=${distance() * 1.15}`,
          pin: true,
          scrub: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          // The lead rides a rail under the row and marks how far along you are.
          onUpdate: (self) => root.current?.style.setProperty("--p", self.progress.toFixed(4)),
        },
      });

      q<HTMLElement>(".sample").forEach((card) => {
        const range = { trigger: card, containerAnimation: travel, start: "left right", end: "right left" };
        gsap.fromTo(card.querySelector("img"), { xPercent: -7 }, { xPercent: 7, ease: "none", scrollTrigger: { ...range, scrub: true } });
        gsap.from(card.querySelector(".sample-frame"), {
          clipPath: "inset(0 0 100% 0)",
          duration: 1.3,
          ease: "expo.out",
          scrollTrigger: { ...range, start: "left 92%", toggleActions: "play none none none" },
        });
      });
    },
    { scope: root },
  );

  const { heading, note, items } = site.samples;

  return (
    <section ref={root} id="work" className="relative h-svh overflow-hidden" aria-label={heading}>
      <div ref={track} className="flex h-full w-max items-center gap-[4.5vw] overflow-x-auto px-[5vw] will-change-transform">
        <div className="w-[min(78vw,34rem)] shrink-0 md:w-[36vw]">
          <h2 className="display text-[clamp(3rem,8.8vw,11rem)]">{heading}</h2>
          <p className="small mt-6 text-ink/60">{note}</p>
        </div>

        {items.map((item) => (
          <figure key={item.id} className="sample w-[min(72vw,26rem)] shrink-0 md:w-[min(30vw,30rem)]">
            <div className="sample-frame relative aspect-[4/5] overflow-hidden bg-ink/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/art/sample-${item.id}.webp`}
                alt={`${item.title}: illustrative product shot`}
                loading="lazy"
                className="absolute inset-y-0 left-[-8%] h-full w-[116%] max-w-none object-cover"
              />
            </div>
            <figcaption className="mt-5 flex items-baseline justify-between gap-6">
              <span className="reading text-[clamp(1.15rem,1.7vw,1.7rem)]">{item.title}</span>
              <span className="small max-w-[20ch] text-right text-ink/65">{item.line}</span>
            </figcaption>
          </figure>
        ))}
        <div className="w-[2vw] shrink-0" />
      </div>

      <div className="pointer-events-none absolute inset-x-[5vw] bottom-[5.5svh] h-px bg-brass/60" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/art/ball.webp"
          alt=""
          className="absolute bottom-0 size-[clamp(1rem,1.5vw,1.5rem)] -translate-x-1/2 rounded-full"
          style={{ left: "calc(var(--p, 0) * 100%)" }}
        />
      </div>
    </section>
  );
}
