"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { site } from "@/content/site";
import { sound } from "@/lib/sound";

gsap.registerPlugin(ScrollTrigger, useGSAP);

// rest.png, in its own pixel space: the near rail, where it ends, and the carved dish.
const REST = { w: 1536, h: 1024, ball: 184, railEnd: 792, dish: [989, 704] as const, reach: 150 };
// The dish's rim as an ellipse. Everything below its near half is redrawn in front of the
// ball, so the ball sits down in the dish instead of perching on it.
const RIM = { cx: 989, cy: 753, rx: 199, ry: 35 };
const LIP = (() => {
  const pts: string[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI - (Math.PI * i) / 24;
    pts.push(`${(((RIM.cx + RIM.rx * Math.cos(a)) / REST.w) * 100).toFixed(2)}% ${(((RIM.cy + RIM.ry * Math.sin(a)) / REST.h) * 100).toFixed(2)}%`);
  }
  return `polygon(0% ${(((RIM.cy) / REST.h) * 100).toFixed(2)}%, ${pts.join(", ")}, 100% ${((RIM.cy / REST.h) * 100).toFixed(2)}%, 100% 100%, 0% 100%)`;
})();
const restRail = (cx: number) => 571.5 + 0.2316 * (cx - 10);
const REST_CLIP = "polygon(0 0, 100% 0, 100% 100%, 88% 100%, 0 78%)";

function links() {
  const { email, whatsapp, linkedin, bookingUrl, placeholder } = site.contact as {
    email: string;
    whatsapp: string;
    linkedin: string;
    bookingUrl: string;
    placeholder: boolean;
  };
  const all = [
    { label: "Book a call", href: bookingUrl },
    { label: email, href: email && `mailto:${email}` },
    { label: "WhatsApp", href: whatsapp && `https://wa.me/${whatsapp.replace(/\D/g, "")}` },
    { label: "LinkedIn", href: linkedin },
  ];
  return all.filter((item) => item.href).map((item) => (placeholder ? { ...item, href: "#contact" } : item));
}

export function Contact() {
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const ball = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const q = gsap.utils.selector(root);
      const place = (cx: number, cy: number, onRail: boolean, settle: number) => {
        const pos = { "--x": String(cx / REST.w), "--y": String(cy / REST.h) };
        for (const [key, value] of Object.entries(pos)) {
          ball.current?.style.setProperty(key, value);
          shadow.current?.style.setProperty(key, value);
        }
        ball.current?.style.setProperty("--clip", onRail ? REST_CLIP : "none");
        shadow.current?.style.setProperty("opacity", String(settle));
        stage.current?.style.setProperty("--cam", String(Math.min(1, Math.max(0, cx / REST.w))));
      };

      // t runs 0..1 down the rail, then 1..2 while the ball rocks to a stop in the dish.
      let settled = false;
      const render = (t: number) => {
        if (t <= 1) {
          settled = false;
          const cx = -REST.ball + (REST.railEnd + REST.ball) * (0.25 * t + 0.75 * t * t);
          place(cx, restRail(cx) - REST.ball / 2 + 14, true, 0);
          return;
        }
        if (!settled) sound.thud(0.55);
        settled = true;
        const u = t - 1;
        const startX = REST.railEnd - REST.dish[0];
        const dx = startX * Math.exp(-3.6 * u) * Math.cos(u * Math.PI * 5.2);
        const rise = 26 * (dx / REST.reach) ** 2;
        const entry = Math.max(0, 1 - u * 5);
        const cy = REST.dish[1] - rise - entry * (REST.dish[1] - (restRail(REST.railEnd) - REST.ball / 2 + 14) - rise);
        place(REST.dish[0] + dx, cy, false, Math.min(1, u * 4));
      };

      const state = { t: 0 };
      render(0);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        render(2);
        return;
      }

      gsap
        .timeline({ scrollTrigger: { trigger: root.current, start: "top 35%", toggleActions: "play none none reset" } })
        .to(state, { t: 1, duration: 1.5, ease: "none", onUpdate: () => render(state.t) })
        .to(state, { t: 2, duration: 3.4, ease: "none", onUpdate: () => render(state.t) })
        .from(q(".contact-word .word"), { yPercent: 130, duration: 1.3, stagger: 0.08, ease: "expo.out" }, 0.2)
        .from(q(".contact-fade, .contact-word"), { autoAlpha: 0, y: 18, duration: 1, stagger: 0.08, ease: "power3.out" }, 0.9);
    },
    { scope: root },
  );

  const items = links();

  return (
    <section ref={root} id="contact" className="relative h-lvh min-h-[34rem] overflow-hidden">
      <div ref={stage} className="stage" style={{ "--ar": REST.w / REST.h, "--ay": 0.78 } as React.CSSProperties}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="plate"
          src="/art/rest-1x.webp"
          srcSet={`/art/rest-1x.webp ${REST.w}w, /art/rest-2x.webp ${REST.w * 2}w`}
          sizes="max(100vw, 150svh)"
          alt=""
          loading="lazy"
        />
        <div
          ref={shadow}
          className="absolute rounded-[50%]"
          style={{
            left: "calc(var(--x) * 100%)",
            top: `calc(var(--y) * 100% + ${(REST.ball / 2 / REST.h) * 100}%)`,
            width: `${((REST.ball * 1.15) / REST.w) * 100}%`,
            height: `${(26 / REST.h) * 100}%`,
            transform: "translate(-42%, -55%)",
            background: "radial-gradient(closest-side, rgb(60 42 28 / 0.5), rgb(60 42 28 / 0))",
          }}
        />
        <div ref={ball} className="ball" style={{ "--d": REST.ball / REST.w, clipPath: "var(--clip)" } as React.CSSProperties}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/art/ball.webp" alt="" />
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="plate" src="/art/rest-1x.webp" srcSet={`/art/rest-1x.webp ${REST.w}w, /art/rest-2x.webp ${REST.w * 2}w`} sizes="max(100vw, 150lvh)" alt="" loading="lazy" style={{ clipPath: LIP }} />
      </div>

      {/* The photographed wall is a shade off the page colour; feather the join. */}
      <div className="absolute inset-x-0 top-0 h-[26svh] bg-gradient-to-b from-paper to-transparent" />

      <div className="absolute inset-x-0 top-0 px-[5vw] pt-[max(13svh,6rem)]">
        <h2 className="contact-word display text-[clamp(3rem,9.6vw,12.5rem)]">
          {site.contact.heading.split(" ").map((word) => (
            <span key={word} className="inline-block overflow-clip pb-[0.14em] align-top">
              <span className="word">{word}&nbsp;</span>
            </span>
          ))}
        </h2>
        {items.length > 0 && (
          <div className="mt-[2.4vw] flex flex-wrap items-center gap-x-[2.6vw] gap-y-5 max-md:mt-6">
            <a
              href={items[0].href}
              className="contact-fade label inline-flex items-center rounded-full bg-ink px-7 py-4 text-[clamp(1rem,1.2vw,1.25rem)] text-cream transition-colors duration-300 hover:bg-red"
            >
              {items[0].label}
            </a>
            <ul className="flex items-center gap-x-[clamp(1.25rem,2.6vw,2.6rem)]">
              {items.slice(1).map((item) => (
                <li key={item.label} className="contact-fade">
                  <a
                    href={item.href}
                    className="label border-b border-ink/40 pb-1 text-[clamp(1rem,1.2vw,1.25rem)] transition-colors duration-300 hover:border-red hover:text-red"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <p className="small absolute bottom-[3svh] left-[5vw] text-ink/60">
        © {site.year} {site.name.first} {site.name.last}
      </p>
    </section>
  );
}
