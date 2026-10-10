import { site } from "@/content/site";

// The film recolours the bar through --nav while the frame is red.
export function Nav() {
  return (
    <header
      className="small pointer-events-none fixed inset-x-0 top-0 z-50 flex items-center justify-between px-[5vw] py-[max(2.6svh,1.1rem)]"
      style={{ color: "var(--nav, #1b1815)" }}
    >
      <a href="#top" className="pointer-events-auto flex items-center gap-2.5">
        <span className="block size-2.5 rounded-full bg-red ring-1 ring-current/20" />
        {site.name.first} {site.name.last}
      </a>
      <nav className="pointer-events-auto flex items-center gap-[clamp(1rem,2.2vw,2.4rem)]">
        <a href="#work">Samples</a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
      </nav>
    </header>
  );
}
