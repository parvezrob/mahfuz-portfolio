"use client";

import { useEffect, useRef } from "react";
import { site } from "@/content/site";
import { SoundToggle } from "@/components/SoundToggle";

// The bar steps out of the way while you travel down and returns the moment you turn back.
// The film recolours it through --nav-l / --nav-r / --nav-dot while the frame is red.
export function Nav() {
  const bar = useRef<HTMLElement>(null);

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const hide = y > last && y > window.innerHeight * 0.6;
      if (Math.abs(y - last) > 6) {
        bar.current?.style.setProperty("transform", hide ? "translateY(-110%)" : "translateY(0)");
        last = y;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      ref={bar}
      className="small pointer-events-none fixed inset-x-0 top-0 z-50 flex items-center justify-between px-[5vw] py-[max(2.6lvh,1.1rem)] transition-transform duration-500 ease-out"
    >
      <a href="#top" className="pointer-events-auto flex items-center gap-2.5" style={{ color: "var(--nav-l)" }}>
        <span className="block size-2.5 rounded-full" style={{ background: "var(--nav-dot)" }} />
        {site.name.first} {site.name.last}
      </a>
      <nav className="pointer-events-auto flex items-center gap-[clamp(0.9rem,2vw,2.2rem)]" style={{ color: "var(--nav-r)" }}>
        <SoundToggle />
        <a href="#work" className="max-sm:hidden">
          Samples
        </a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
      </nav>
    </header>
  );
}
