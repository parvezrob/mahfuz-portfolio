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

      // The section is made taller by the sideways distance and its row is sticky,
      // so scrolling down carries the row across without any scripted pinning.
      const size = () => root.current?.style.setProperty("--travel", `${Math.round(distance() * 1.15)}px`);
      size();
      ScrollTrigger.addEventListener("refreshInit", size);

      const travel = gsap.to(row, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: root.current,
          start: "top top",
          end: "bottom bottom",
          scrub: true,
          invalidateOnRefresh: true,
          // The lead rides a rail under the row and marks how far along you are.
          onUpdate: (self) => root.current?.style.setProperty("--p", self.progress.toFixed(4)),
        },
      });

      q<HTMLElement>(".sample").forEach((card) => {
        const range = { trigger: card, containerAnimation: travel, start: "left right", end: "right left" };
        gsap.fromTo(card.querySelector("img"), { xPercent: -7 }, { xPercent: 7, ease: "none", scrollTrigger: { ...range, scrub: true } });
      });
      // The prints unveil as the wall arrives, before the row starts to travel.
      gsap.from(q(".sample-frame"), {
        clipPath: "inset(0 0 100% 0)",
        duration: 1.3,
        ease: "expo.out",
        stagger: 0.12,
        scrollTrigger: { trigger: root.current, start: "top 55%" },
      });
    },
    { scope: root },
  );

  const { heading, note, items } = site.samples;
  // A hang, not a grid: each print has its own height (in lvh) and sits a little high or low.
  const HANG = [
    { h: 76, y: -2 },
    { h: 54, y: 9 },
    { h: 68, y: -6 },
    { h: 50, y: 8 },
  ];

  return (
    <section ref={root} id="work" className="relative" style={{ height: "calc(100lvh + var(--travel, 0px))" }} aria-label={heading}>
      <div className="sample-stage wall sticky top-0 h-lvh overflow-hidden">
      <div ref={track} className="sample-track flex h-full w-max items-center gap-[5vw] overflow-x-auto px-[5vw] will-change-transform">
        <div className="w-[min(78vw,34rem)] shrink-0 md:w-[36vw]">
          <h2 className="display text-[clamp(3rem,7.6vw,9.6rem)] max-md:text-[13vw]">{heading}</h2>
          <p className="small mt-6 text-ink/60">{note}</p>
        </div>

        {items.map((item, i) => (
          <figure
            key={item.id}
            className="sample w-[min(72vw,26rem)] shrink-0 md:w-[calc(var(--h)*0.8lvh)] md:translate-y-[calc(var(--y)*1lvh)]"
            style={{ "--h": HANG[i % HANG.length].h, "--y": HANG[i % HANG.length].y } as React.CSSProperties}
          >
            <div className="sample-frame relative aspect-[4/5] overflow-hidden bg-ink/10 shadow-[14px_22px_44px_-14px_rgba(58,40,26,0.5)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/art/sample-${item.id}.webp`}
                srcSet={`/art/sample-${item.id}.webp 1122w, /art/sample-${item.id}-2x.webp 2244w`}
                sizes="(max-width: 899px) 84vw, 62lvh"
                alt={`${item.title}: illustrative product shot`}
                loading="lazy"
                className="absolute inset-y-0 left-[-8%] h-full w-[116%] max-w-none object-cover"
              />
            </div>
            <figcaption className="mt-4 flex items-baseline justify-between gap-6">
              <span className="reading read-size">{item.title}</span>
              <span className="small max-w-[22ch] text-right text-ink/65">{item.line}</span>
            </figcaption>
          </figure>
        ))}
        <div className="w-[2vw] shrink-0" />
      </div>

      <div className="pointer-events-none absolute inset-x-[5vw] bottom-[5.5lvh] h-px bg-brass/60" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/art/ball.webp"
          alt=""
          className="absolute bottom-0 size-[clamp(1rem,1.5vw,1.5rem)] -translate-x-1/2 rounded-full"
          style={{ left: "calc(var(--p, 0) * 100%)" }}
        />
      </div>
      </div>
    </section>
  );
}
