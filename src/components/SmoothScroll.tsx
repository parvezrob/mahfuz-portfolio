"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);
// A phone's address bar sliding away is not a real resize; recalculating on it makes scenes jump.
ScrollTrigger.config({ ignoreMobileResize: true });

// One scroll clock for the whole page: Lenis eases the wheel, GSAP's ticker drives Lenis,
// and ScrollTrigger reads the eased position, so pinned scenes never fight the scroll.
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, syncTouch: false });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    const onAnchor = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
      if (!link) return;
      const target = document.querySelector(link.getAttribute("href")!);
      if (!target) return;
      event.preventDefault();
      lenis.scrollTo(target as HTMLElement, { duration: 1.6 });
    };
    document.addEventListener("click", onAnchor);

    // Scroll positions are measured early; measure again once everything that can change the
    // page's height (late images, the web font) has actually arrived.
    const remeasure = () => ScrollTrigger.refresh();
    window.addEventListener("load", remeasure);
    document.fonts.ready.then(remeasure);

    // "Play the film": run the pinned film at the pace it was cut for. Any wheel or touch takes over.
    const onPlay = () => {
      const film = document.querySelector<HTMLElement>("#top");
      const after = document.querySelector<HTMLElement>("#grow");
      if (!film || !after) return;
      const end = after.getBoundingClientRect().top + window.scrollY;
      const remaining = Math.max(0, end - window.scrollY);
      lenis.scrollTo(end, { duration: Math.max(6, (remaining / window.innerHeight) * 4.1), easing: (t: number) => t });
    };
    document.addEventListener("film:play", onPlay);

    return () => {
      document.removeEventListener("click", onAnchor);
      window.removeEventListener("load", remeasure);
      document.removeEventListener("film:play", onPlay);
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);

  return null;
}
