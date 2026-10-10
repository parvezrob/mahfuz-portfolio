"use client";

import { useEffect, useRef } from "react";
import type * as Three from "three";
import { site } from "@/content/site";

const act = site.acts[2];
const CELL = 7; // collision grid for the letterforms, in CSS pixels
const INK = "#1b1815";
const FOV = 26;

// The third act is a toy: the word stands on the wall, and leads pour in as you scroll.
// Physics runs in 2D against the real letter shapes. The balls are drawn as real glossy
// spheres shaded from the photographed ball, under a light that makes them cast real
// shadows on the wall and on each other as they pile up. They can be picked up and thrown.
export function Grow() {
  const section = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = section.current;
    const view = canvas.current;
    if (!host || !view) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stop = () => {};
    let disposed = false;

    (async () => {
      const [{ default: Matter }, THREE] = await Promise.all([import("matter-js"), import("three"), document.fonts.ready]);
      if (disposed) return;

      const { Engine, Bodies, Body, Composite, Mouse, MouseConstraint } = Matter;
      const family = getComputedStyle(document.documentElement).getPropertyValue("--font-archivo") || "sans-serif";

      let renderer: Three.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: view, alpha: true, antialias: true });
      } catch {
        return; // no WebGL: the copy still reads, the toy is simply absent
      }
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.toneMapping = THREE.NoToneMapping;

      // Every sphere is shaded from the photographed ball, so it is the same lacquer, the same
      // window reflection and the same falloff as the ball everywhere else on the page.
      const photo = await new THREE.TextureLoader().loadAsync("/art/ball.webp");
      if (disposed) return;
      photo.colorSpace = THREE.SRGBColorSpace;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 10000);
      const sun = new THREE.DirectionalLight(0xfff8ee, 2.4);
      sun.castShadow = true;
      sun.shadow.radius = 7;
      sun.shadow.blurSamples = 16;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 1.5;
      scene.add(sun, sun.target);

      const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true }));
      const shade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ color: 0x1b1815, opacity: 0.3 }));
      shade.receiveShadow = true;
      shade.position.z = 0.6;
      scene.add(wall, shade);

      const lacquer = new THREE.MeshMatcapMaterial({ matcap: photo });
      // A photograph cannot receive shadows, so each ball wears a shell that only draws
      // the shadow falling on it: its own dark side, and the balls stacked above it.
      const shadowed = new THREE.ShadowMaterial({ color: 0x2a0704, opacity: 0.5 });
      shadowed.depthWrite = false;
      const dummy = new THREE.Object3D();
      let spheres: Three.InstancedMesh | null = null;
      let shells: Three.InstancedMesh | null = null;

      let engine = Engine.create();
      let balls: Matter.Body[] = [];
      const mouse = Mouse.create(document.createElement("div"));
      let w = 0;
      let h = 0;
      let radius = 20;
      let quota = 0;
      let distance = 1000;
      let frame = 0;
      const pointer = { x: 0, y: 0 };

      const build = () => {
        w = view.clientWidth;
        h = view.clientHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const small = w < 768;
        radius = Math.max(13, Math.min(w * 0.0165, 28));
        quota = reduced ? 0 : Math.round(Math.max(34, Math.min((w * h) / 16500, 96)));

        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
        distance = h / 2 / Math.tan((FOV * Math.PI) / 360);
        camera.aspect = w / h;
        camera.position.set(0, 0, distance);
        camera.updateProjectionMatrix();

        // Mostly frontal, so a shadow stays tucked under its ball instead of drifting off across the wall.
        sun.position.set(-w * 0.42, h * 0.8, h * 2.3);
        sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
        Object.assign(sun.shadow.camera, { left: -w * 0.8, right: w * 0.8, top: h * 0.9, bottom: -h * 0.9, near: 10, far: h * 4 });
        sun.shadow.camera.updateProjectionMatrix();
        sun.shadow.map?.dispose();
        sun.shadow.map = null;

        // Draw the word once. It is both what you see on the wall and what the balls hit.
        const word = document.createElement("canvas");
        word.width = Math.round(w * dpr);
        word.height = Math.round(h * dpr);
        const wc = word.getContext("2d", { willReadFrequently: true })!;
        wc.scale(dpr, dpr);
        const setFont = (px: number) => {
          wc.font = `780 ${px}px ${family}`;
          if ("fontStretch" in wc) (wc as CanvasRenderingContext2D & { fontStretch: string }).fontStretch = "expanded";
          if ("letterSpacing" in wc) (wc as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${-px * 0.035}px`;
        };
        setFont(200);
        const px = 200 * Math.min((w * 0.92) / wc.measureText(act.word).width, (h * 0.5) / 150);
        setFont(px);
        const metrics = wc.measureText(act.word);
        const left = (w - metrics.width) / 2 + px * 0.0175;
        const baseline = h - Math.max(metrics.actualBoundingBoxDescent, 0) - Math.max(10, h * 0.018);
        wc.fillStyle = INK;
        wc.fillText(act.word, left, baseline);

        const pixels = wc.getImageData(0, 0, word.width, word.height).data;
        const solid = (x: number, y: number) => pixels[(Math.round(y * dpr) * word.width + Math.round(x * dpr)) * 4 + 3] > 120;

        engine = Engine.create({ gravity: { x: 0, y: 1.15 } });
        balls = [];
        const statics: Matter.Body[] = [];
        for (let y = CELL / 2; y < h; y += CELL) {
          let run = -1;
          for (let x = CELL / 2; x <= w + CELL; x += CELL) {
            const on = x < w && solid(x, y);
            if (on && run < 0) run = x;
            if (!on && run >= 0) {
              const width = x - run;
              statics.push(Bodies.rectangle(run - CELL / 2 + width / 2, y, width, CELL, { isStatic: true }));
              run = -1;
            }
          }
        }
        const fixed = { isStatic: true };
        statics.push(
          Bodies.rectangle(w / 2, h + 40, w * 2, 80, fixed),
          Bodies.rectangle(-40, h / 2, 80, h * 4, fixed),
          Bodies.rectangle(w + 40, h / 2, 80, h * 4, fixed),
        );
        Composite.add(engine.world, statics);
        Composite.add(engine.world, MouseConstraint.create(engine, { mouse, constraint: { stiffness: 0.16, damping: 0.1 } }));

        // The letters stand a ball's depth off the wall, so they throw a soft shadow too.
        const texture = document.createElement("canvas");
        texture.width = word.width;
        texture.height = word.height;
        const tc = texture.getContext("2d")!;
        tc.shadowColor = "rgba(58,40,26,0.34)";
        tc.shadowBlur = radius * 0.9 * dpr;
        tc.shadowOffsetX = radius * 0.34 * dpr;
        tc.shadowOffsetY = radius * 0.5 * dpr;
        tc.drawImage(word, 0, 0);
        const map = new THREE.CanvasTexture(texture);
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = 4;
        const face = wall.material as Three.MeshBasicMaterial;
        face.map?.dispose();
        face.map = map;
        face.needsUpdate = true;
        wall.scale.set(w, h, 1);
        shade.scale.set(w, h, 1);

        for (const old of [spheres, shells]) {
          if (!old) continue;
          scene.remove(old);
          old.geometry.dispose();
        }
        const [around, across] = small ? [32, 22] : [48, 32];
        spheres = new THREE.InstancedMesh(new THREE.SphereGeometry(radius, around, across), lacquer, Math.max(1, quota));
        spheres.castShadow = true;
        shells = new THREE.InstancedMesh(new THREE.SphereGeometry(radius * 1.004, around, across), shadowed, Math.max(1, quota));
        shells.receiveShadow = true;
        shells.renderOrder = 2;
        for (const mesh of [spheres, shells]) {
          mesh.count = 0;
          mesh.frustumCulled = false;
          scene.add(mesh);
        }
      };

      const spawn = () => {
        const x = w * (0.08 + 0.84 * Math.random());
        const ball = Bodies.circle(x, -radius * (2 + Math.random() * 6), radius, {
          restitution: 0.42,
          friction: 0.02,
          frictionAir: 0.004,
          density: 0.0018,
        });
        Body.setVelocity(ball, { x: (Math.random() - 0.5) * 3, y: 2 + Math.random() * 3 });
        balls.push(ball);
        Composite.add(engine.world, ball);
      };

      const draw = () => {
        if (!spheres || !shells) return;
        balls.forEach(({ position: p }, i) => {
          dummy.position.set(p.x - w / 2, h / 2 - p.y, radius);
          dummy.updateMatrix();
          spheres!.setMatrixAt(i, dummy.matrix);
          shells!.setMatrixAt(i, dummy.matrix);
        });
        for (const mesh of [spheres, shells]) {
          mesh.count = balls.length;
          mesh.instanceMatrix.needsUpdate = true;
        }
        // A few pixels of camera drift toward the pointer lets the depth read.
        camera.position.x += (pointer.x * w * 0.012 - camera.position.x) * 0.06;
        camera.position.y += (-pointer.y * h * 0.012 - camera.position.y) * 0.06;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      };

      const tick = () => {
        frame = requestAnimationFrame(tick);
        const rect = host.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        const progress = Math.min(1, Math.max(0, (window.innerHeight * 0.55 - rect.top) / (rect.height - window.innerHeight * 0.6)));
        const want = Math.round(quota * Math.min(1, progress * 1.25));
        if (balls.length < want && Math.random() < 0.5) spawn();
        Engine.update(engine, 1000 / 60);
        draw();
      };

      // Pointer to the plane the balls live on (they sit one radius in front of the wall).
      const toPlane = (event: PointerEvent) => {
        const box = view.getBoundingClientRect();
        const k = (distance - radius) / distance;
        const sx = event.clientX - box.left;
        const sy = event.clientY - box.top;
        mouse.position.x = (sx - w / 2) * k + w / 2;
        mouse.position.y = (sy - h / 2) * k + h / 2;
        pointer.x = (sx / w) * 2 - 1;
        pointer.y = (sy / h) * 2 - 1;
      };
      const fine = window.matchMedia("(pointer: fine)").matches;
      const onDown = (event: PointerEvent) => {
        toPlane(event);
        mouse.button = 0;
      };
      const onUp = () => {
        mouse.button = -1;
      };
      if (fine) {
        view.addEventListener("pointermove", toPlane);
        view.addEventListener("pointerdown", onDown);
        window.addEventListener("pointerup", onUp);
      }

      build();
      draw();
      frame = requestAnimationFrame(tick);

      let timer = 0;
      let lastWidth = window.innerWidth;
      const onResize = () => {
        // Mobile browsers resize on every address-bar slide; only rebuild when the width changes.
        if (window.innerWidth === lastWidth) return;
        lastWidth = window.innerWidth;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          build();
          draw();
        }, 180);
      };
      window.addEventListener("resize", onResize);
      stop = () => {
        cancelAnimationFrame(frame);
        window.clearTimeout(timer);
        window.removeEventListener("resize", onResize);
        view.removeEventListener("pointermove", toPlane);
        view.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
        renderer.dispose();
        photo.dispose();
      };
    })();

    return () => {
      disposed = true;
      stop();
    };
  }, []);

  return (
    <section ref={section} id="grow" className="relative h-[240svh]" aria-labelledby="grow-title">
      <div className="grain sticky top-0 h-svh overflow-hidden">
        <h2 id="grow-title" className="sr-only">
          {act.word}
        </h2>
        <canvas ref={canvas} className="absolute inset-0 size-full" aria-hidden />
        <div className="pointer-events-none absolute left-[5vw] top-[max(13svh,6rem)] w-[min(84vw,30rem)]">
          <p className="reading max-w-[24ch] text-[clamp(1.25rem,2.1vw,2.2rem)] text-ink">{act.line}</p>
          <ul className="small mt-4 flex flex-wrap gap-x-5 gap-y-1 text-ink/65">
            {act.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
