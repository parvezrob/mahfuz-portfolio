import { About } from "@/components/About";
import { Contact } from "@/components/Contact";
import { Film } from "@/components/Film";
import { Grow } from "@/components/Grow";
import { Nav } from "@/components/Nav";
import { Samples } from "@/components/Samples";
import { SmoothScroll } from "@/components/SmoothScroll";

export default function Home() {
  return (
    <>
      <SmoothScroll />
      <Nav />
      <main>
        <Film />
        <Grow />
        <Samples />
        <About />
        <Contact />
      </main>
    </>
  );
}
