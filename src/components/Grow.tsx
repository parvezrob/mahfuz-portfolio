"use client";

import { useEffect, useRef } from "react";
import type * as Three from "three";
import { site } from "@/content/site";
import { sound } from "@/lib/sound";

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
  const stageRef = useRef<HTMLDivElement>(null);

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

      const { Engine, Bodies, Body, Composite, Events, Mouse, MouseConstraint } = Matter;
      const family = getComputedStyle(document.documentElement).getPropertyValue("--font-display") || "sans-serif";

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
      let drained = false;
      let shown = -1;
      let awake = 60;
      const pointer = { x: 0, y: 0 };

      const build = () => {
        w = view.clientWidth;
        h = view.clientHeight;
        const small = w < 900;
        // A phone's GPU is better spent on frame rate than on a third of a pixel of sharpness.
        const dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
        const cell = small ? 9 : CELL;
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
          wc.font = `680 ${px}px ${family}`;
          if ("fontStretch" in wc) (wc as CanvasRenderingContext2D & { fontStretch: string }).fontStretch = "expanded";
          if ("letterSpacing" in wc) (wc as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${-px * 0.042}px`;
        };
        // One line on a wide screen; on a phone the word stacks in two so the letters stay big.
        // Fit and centre on the ink itself, not the advance width, so nothing is clipped.
        const half = Math.ceil(act.word.length / 2);
        const lines = small ? [act.word.slice(0, half), act.word.slice(half)] : [act.word];
        const inkWidth = (m: TextMetrics) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
        const widest = (size: number) => {
          setFont(size);
          return Math.max(...lines.map((line) => inkWidth(wc.measureText(line))));
        };
        const px = 200 * Math.min((w * 0.9) / widest(200), (h * (small ? 0.56 : 0.5)) / (150 * lines.length));
        const span = widest(px);
        const bottom = h - Math.max(10, h * 0.018);
        wc.fillStyle = INK;
        lines.forEach((line, i) => {
          const metrics = wc.measureText(line);
          const left = (w - span) / 2 + metrics.actualBoundingBoxLeft;
          const baseline = bottom - Math.max(metrics.actualBoundingBoxDescent, 0) - (lines.length - 1 - i) * px * 0.8;
          wc.fillText(line, left, baseline);
        });

        const pixels = wc.getImageData(0, 0, word.width, word.height).data;
        const solid = (x: number, y: number) => pixels[(Math.round(y * dpr) * word.width + Math.round(x * dpr)) * 4 + 3] > 120;

        engine = Engine.create({ gravity: { x: 0, y: 1.15 } });
        balls = [];
        const statics: Matter.Body[] = [];
        for (let y = cell / 2; y < h; y += cell) {
          let run = -1;
          for (let x = cell / 2; x <= w + cell; x += cell) {
            const on = x < w && solid(x, y);
            if (on && run < 0) run = x;
            if (!on && run >= 0) {
              const width = x - run;
              statics.push(Bodies.rectangle(run - cell / 2 + width / 2, y, width, cell, { isStatic: true }));
              run = -1;
            }
          }
        }
        const fixed = { isStatic: true };
        statics.push(
          Bodies.rectangle(w / 2, h + 40, w * 3, 80, fixed),
          Bodies.rectangle(-40, h / 2, 80, h * 4, fixed),
          // The right wall stands back from the edge: balls enter through that gap, and a ramp
          // behind the edge rolls any stray one back into view.
          Bodies.rectangle(w + radius * 9 + 40, h / 2, 80, h * 4, fixed),
          Bodies.rectangle(w + radius * 4.5, h - radius * 2.2, radius * 10, 24, { isStatic: true, angle: -0.42 }),
        );
        Composite.add(engine.world, statics);
        Composite.add(engine.world, MouseConstraint.create(engine, { mouse, constraint: { stiffness: 0.16, damping: 0.1 } }));
        drained = false;

        // Lacquer on lacquer, lacquer on the letters: every real knock makes a sound.
        Events.on(engine, "collisionStart", (event) => {
          for (const { bodyA, bodyB } of event.pairs) {
            if (bodyA.isStatic && bodyB.isStatic) continue;
            const speed = Math.hypot(bodyA.velocity.x - bodyB.velocity.x, bodyA.velocity.y - bodyB.velocity.y);
            if (speed > 1.2) sound.clink(Math.min(1, speed / 16));
          }
        });

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

      // Leads arrive from the right, the way the last scene's rail left the frame, and arc in
      // below the copy instead of raining through it.
      const spawn = () => {
        const ball = Bodies.circle(w + radius * (2 + Math.random() * 5), h * (0.3 + Math.random() * 0.16), radius, {
          restitution: 0.42,
          friction: 0.02,
          frictionAir: 0.004,
          density: 0.0018,
        });
        const reach = 0.5 + w / 1500;
        Body.setVelocity(ball, { x: -(5 + Math.random() * 10) * reach, y: -1 - Math.random() * 4 });
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
        const vh = window.innerHeight;
        // This section starts on top of the film's held last frame and dissolves in over it
        // across the first 0.6 of a screen, so the cut between the two has no blank beat.
        const fade = reduced ? 1 : Math.min(1, Math.max(0, -rect.top / (vh * 0.6)));
        if (fade !== shown) {
          shown = fade;
          stageRef.current?.style.setProperty("opacity", fade.toFixed(3));
          stageRef.current?.style.setProperty("pointer-events", fade > 0.5 ? "auto" : "none");
        }
        if (rect.bottom < 0 || rect.top > 0 || fade === 0) return;
        const progress = Math.min(1, Math.max(0, (-rect.top - vh * 0.45) / (rect.height - vh * 1.75)));
        // At the very end the letters and the floor let go and the whole pile falls out of the
        // bottom of the frame, on toward the next scene. Scrolling back up sets it up again.
        if (progress > 0.965 && !drained) {
          for (const body of Composite.allBodies(engine.world)) {
            if (body.isStatic && body.position.x > 0 && body.position.x < w) Composite.remove(engine.world, body);
          }
          drained = true;
          awake = 240;
        } else if (progress < 0.9 && drained) {
          build();
          awake = 60;
        }
        const want = drained ? 0 : Math.round(quota * Math.min(1, progress * 1.3));
        if (balls.length < want && Math.random() < 0.5) spawn();
        // A settled pile costs nothing: skip the physics and the redraw until something stirs.
        const stirring = balls.length < want || mouse.button === 0 || balls.some((ball) => ball.speed > 0.07);
        if (stirring) awake = 45;
        if (--awake < 0) return;
        Engine.update(engine, 1000 / 60);
        if (drained) {
          // Once a ball has fallen out of the frame there is nothing left to simulate.
          balls = balls.filter((ball) => {
            if (ball.position.y < h + radius * 6) return true;
            Composite.remove(engine.world, ball);
            return false;
          });
        }
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
        awake = 45;
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

      // On a phone the pile answers to gravity: tilt it and the balls roll to the low side.
      // Android reports orientation freely; iOS asks once, on the first touch.
      const onTilt = (event: DeviceOrientationEvent) => {
        if (event.gamma == null) return;
        const lean = Math.max(-1, Math.min(1, event.gamma / 32));
        engine.gravity.x = lean * 1.1;
        engine.gravity.y = 1.15 * Math.max(0.35, 1 - Math.abs(lean) * 0.5);
      };
      const askTilt = () => {
        const api = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
        if (!api) return;
        if (typeof api.requestPermission !== "function") return void window.addEventListener("deviceorientation", onTilt);
        api
          .requestPermission()
          .then((answer) => answer === "granted" && window.addEventListener("deviceorientation", onTilt))
          .catch(() => undefined);
      };
      if (!fine) {
        if (typeof (window.DeviceOrientationEvent as unknown as { requestPermission?: unknown })?.requestPermission === "function") {
          view.addEventListener("touchend", askTilt, { once: true });
        } else {
          askTilt();
        }
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
        window.removeEventListener("deviceorientation", onTilt);
        view.removeEventListener("touchend", askTilt);
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
    <section ref={section} id="grow" className="relative z-10 -mt-[160lvh] h-[300lvh]" aria-labelledby="grow-title">
      <div ref={stageRef} className="wall sticky top-0 h-lvh overflow-hidden opacity-0">
        <h2 id="grow-title" className="sr-only">
          {act.word}
        </h2>
        <canvas ref={canvas} className="absolute inset-0 size-full" aria-hidden />
        <div className="pointer-events-none absolute left-[5vw] top-[max(13lvh,6rem)] w-[min(84vw,30rem)]">
          <p className="reading read-size max-w-[26ch] text-ink">{act.line}</p>
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
