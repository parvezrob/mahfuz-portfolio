// The sound of the marble run: a lacquered ball on brass rails, steel hoops, stone, in a
// small plaster room. There are no audio files. Every sound is built from oscillators and
// filtered noise with the Web Audio API, and it stays off until the visitor turns it on.
//
// Two layers live here. createEngine() builds the instrument on any audio context, which is
// what lets scripts/sound-check.mjs render it offline and measure it. `sound` is the one
// instance the site uses: it owns the real AudioContext, the on/off choice and the rules
// about when the context may run.

export type HoopIndex = 0 | 1 | 2;

export interface SoundEngine {
  /** The ball rolling on the rails. 0..1, called every frame; 0 fades it out. */
  roll(speed: number): void;
  /** The ball passing a steel hoop. Three pitches that climb to a resolved top note. */
  tick(index: HoopIndex): void;
  /** The ball landing on stone. 0..1. */
  thud(strength: number): void;
  /** Two lacquered balls, or a ball and a letter, colliding. 0..1, rate-limited. */
  clink(strength: number): void;
  /** Air pressing in as the ball flies at the camera. 0..1, called every frame; 0 fades it out. */
  swell(amount: number): void;
  /** A word falling out of its sentence. */
  drop(): void;
}

export interface Sound extends SoundEngine {
  /** Whether sound is on right now. */
  readonly enabled: boolean;
  /** Turns sound on or off and remembers the choice. Turning it on must happen inside a click. */
  setEnabled(on: boolean): void;
  /** Calls `fn` whenever sound is turned on or off. Returns the unsubscribe. */
  subscribe(fn: (on: boolean) => void): () => void;
}

const TAU = Math.PI * 2;

// How loud each sound is, as linear gain into the mix. They are set by measurement (run
// scripts/sound-check.mjs) so that the loudest one-shot, a full-strength thud, peaks near
// -12 dBFS and the two continuous layers, flat out, average some 20 dB below that.
const LEVEL = {
  thud: 0.176,
  clink: 0.19,
  tick: 0.085,
  drop: 0.08,
  rollBody: 0.127,
  rollRails: 0.22,
  rollHiss: 0.04,
  swell: 0.16,
};

// How much of each family is sent to the room. The thud stays dry, as stone is; the hoops
// and the falling word are what the room is heard on.
const ROOM_SEND = { roll: 0.12, tick: 0.3, thud: 0.06, clink: 0.2, drop: 0.34 };

// The limiter only works when sounds pile up; a single sound never reaches the threshold.
const LIMIT_THRESHOLD_DB = -11;
const LIMIT_RATIO = 12;
// A DynamicsCompressorNode adds make-up gain of its own accord. With a hard knee it is 0.6
// of the reduction a full-scale signal would get, in decibels. The engine takes it back out
// after the limiter, so everything under the threshold leaves at the level it was mixed at.
const LIMIT_MAKEUP_DB = -0.6 * LIMIT_THRESHOLD_DB * (1 - 1 / LIMIT_RATIO);

// The three hoops are the third, fifth and octave of C, in pure ratios (5:6:8), so the run
// ends on the keynote: E5, G5, C6.
const HOOP_HZ = [523.25 * 1.25, 523.25 * 1.5, 523.25 * 2];
// What makes it a steel ring and not a beep: the overtones of a ring are not harmonics.
// Each row is [frequency ratio, level, seconds to fall 60 dB]. The second row sits a hair
// above the first: no real hoop is perfectly even, so its note is two notes very close
// together, and it shimmers slowly as it dies.
const HOOP_PARTIALS = [
  [1, 1, 0.8],
  [1.004, 0.3, 0.8],
  [2.83, 0.26, 0.4],
  [5.42, 0.09, 0.2],
  [8.77, 0.035, 0.1],
];

// Three bending modes of a short brass rod, as [frequency, sharpness, level]. Noise from
// the rolling contact excites them, so the rails sing faintly and never hold a steady note.
// The modes of a rod are not harmonics, and these three do not add up to a chord.
const RAIL_MODES = [
  [1262, 55, 0.9],
  [1763, 60, 1],
  [2347, 60, 0.7],
];

// What a stone block does when a ball lands on it, as [frequency, level, seconds to fall
// 60 dB]: two low, heavily damped modes for the weight, and the knock of the ball's shell.
// The knock is the part a small loudspeaker can reproduce.
const THUD_MODES = [
  [92, 1, 0.2],
  [147, 0.5, 0.12],
  [341, 0.4, 0.07],
];

// The modes of one lacquered ball struck by another, as [frequency, level, decay time].
const CLACK_MODES = [
  [2140, 1, 0.011],
  [3380, 0.55, 0.006],
  [5350, 0.3, 0.0035],
];

const CLINK_GAP = 0.035; // seconds; collisions closer together than this are one sound
const CLINK_VOICES = 12;
const GLIDE = 0.06; // seconds; how quickly the continuous layers follow their input
const STEP = 0.004; // the smallest change in roll or swell worth sending to the audio thread
const LEAD = 0.005; // seconds; one-shots start this far ahead so their attack is never cut

/** Clamps to 0..1 and turns NaN into 0. */
function unit(value: number): number {
  return value > 0 ? (value < 1 ? value : 1) : 0;
}

// A small seeded generator. The noise, the room and the variation between hits are the
// same on every visit, and the offline check measures exactly what the site plays.
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Two seconds of pink noise that loops without a seam: the tail is cross-faded into the head.
function pinkNoise(ctx: BaseAudioContext, rand: () => number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 2);
  const fade = Math.floor(ctx.sampleRate * 0.05);
  const raw = new Float32Array(length + fade);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < raw.length; i++) {
    const white = rand() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    raw[i] = b0 + b1 + b2 + white * 0.1848;
  }
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let power = 0;
  for (let i = 0; i < length; i++) {
    const mix = i < fade ? i / fade : 1;
    data[i] = raw[i] * Math.sqrt(mix) + (i < fade ? raw[length + i] * Math.sqrt(1 - mix) : 0);
    power += data[i] * data[i];
  }
  const scale = 0.25 / Math.sqrt(power / length);
  for (let i = 0; i < length; i++) data[i] *= scale;
  return buffer;
}

// A slow curve between -1 and 1 that loops: the unevenness of a ball that is not quite
// round on rails that are not quite smooth. The ball's flaws come round again on every
// turn, five turns a second at normal playback; the rails' never repeat. That returning
// pattern, quickening with speed, is what makes filtered noise read as something rolling.
// It is stored at a low sample rate because nothing in it moves faster than a few hertz.
function unevenness(ctx: BaseAudioContext, rand: () => number): AudioBuffer {
  const rate = 8000;
  const turn = [1, 0.1, -0.6, -0.5]; // one turn of the ball, 400 samples a step: one flaw, mostly
  const track = Array.from({ length: 60 }, () => rand() * 2 - 1); // six seconds of rail, 800 a step
  const curve = (values: number[], span: number, i: number): number => {
    const from = values[Math.floor(i / span) % values.length];
    const to = values[(Math.floor(i / span) + 1) % values.length];
    return from + ((to - from) * (1 - Math.cos(((i % span) / span) * Math.PI))) / 2;
  };
  const buffer = ctx.createBuffer(1, track.length * 800, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = 0.55 * curve(turn, 400, i) + 0.45 * curve(track, 800, i);
  return buffer;
}

// The impulse response of a small plaster room: a few early reflections off the near walls,
// then a short tail that thins out from the top as plaster soaks up the highs. It is stereo,
// so the room has width while every source stays in the middle. Scaled to unit energy, so a
// send of 0.3 means the room returns 0.3 of what it was given.
function plasterRoom(ctx: BaseAudioContext, rand: () => number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * 0.5);
  const buffer = ctx.createBuffer(2, length, rate);
  const reverbTime = 0.38;
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let low = 0;
    let energy = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      const cutoff = 9000 * Math.pow(0.25, t / 0.5);
      low += (1 - Math.exp((-TAU * cutoff) / rate)) * (rand() * 2 - 1 - low);
      data[i] = low * Math.min(1, t / 0.012) * Math.pow(10, (-3 * t) / reverbTime);
      energy += data[i] * data[i];
    }
    // Six reflections in the first 26 ms, each weaker than the last, carrying about a third
    // of the energy the tail does.
    const reflection = Math.sqrt((energy * 0.35) / 6);
    for (let k = 0; k < 6; k++) {
      const at = Math.floor((0.004 + (0.022 * (k + rand())) / 6) * rate);
      data[at] += (k % 2 ? -1 : 1) * reflection * (1.3 - k * 0.12);
    }
    energy = 0;
    for (let i = 0; i < length; i++) energy += data[i] * data[i];
    const scale = 1 / Math.sqrt(energy);
    for (let i = 0; i < length; i++) data[i] *= scale;
  }
  return buffer;
}

// One collision between lacquered balls, written out sample by sample: the contact itself
// is a click under a millisecond long, and what follows is the balls ringing very briefly.
// Hard surfaces meet over about a fifth of a millisecond, so that is how long it takes to
// rise. Collisions can come a dozen a second, so each one only has to play this back.
function clack(ctx: BaseAudioContext, rand: () => number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * 0.08);
  const onset = Math.ceil(rate * 0.0002);
  const release = Math.floor(rate * 0.004);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    let sample = (rand() * 2 - 1) * 0.5 * Math.exp(-t / 0.0006);
    for (const [hz, level, decay] of CLACK_MODES) sample += level * Math.sin(TAU * hz * t) * Math.exp(-t / decay);
    data[i] = sample * Math.min(1, i / onset, (length - i) / release);
    peak = Math.max(peak, Math.abs(data[i]));
  }
  for (let i = 0; i < length; i++) data[i] /= peak;
  return buffer;
}

/**
 * Builds the whole instrument on `ctx` and plays it into `destination`. Nothing here knows
 * whether the context is live or offline, or whether the visitor has sound on.
 */
export function createEngine(ctx: BaseAudioContext, destination: AudioNode = ctx.destination): SoundEngine {
  const rand = seeded(0x7ab1e);
  const pink = pinkNoise(ctx, rand);

  const gain = (value: number): GainNode => {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  };

  const filter = (type: BiquadFilterType, hz: number, q: number): BiquadFilterNode => {
    const node = ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = hz;
    node.Q.value = q;
    // Filters that follow a control signal are retuned once per block of 128 samples, not
    // once per sample. The signals they follow are already smooth, and it is far cheaper.
    node.detune.automationRate = "k-rate";
    return node;
  };

  const loop = (buffer: AudioBuffer, rate = 1, offset = 0): AudioBufferSourceNode => {
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.loop = true;
    node.playbackRate.value = rate;
    node.start(0, offset);
    return node;
  };

  // Makes `param` follow `signal`, scaled. The parameter's own value is what it rests at.
  const follow = (param: AudioParam, signal: AudioNode, amount: number): void => {
    signal.connect(gain(amount)).connect(param);
  };

  // A control signal that rests at 0. roll() and swell() only move the target of one of
  // these; every filter and gain that depends on it hangs off it inside the graph. That is
  // why the layers glide: there is nothing to step, and nothing is rescheduled per frame.
  const control = (): ConstantSourceNode => {
    const node = ctx.createConstantSource();
    node.offset.value = 0;
    node.start();
    return node;
  };

  // Master: everything sums in `mix`, passes the limiter, and leaves through `trim`.
  const mix = gain(1);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMIT_THRESHOLD_DB;
  limiter.knee.value = 0;
  limiter.ratio.value = LIMIT_RATIO;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.2;
  const trim = gain(Math.pow(10, -LIMIT_MAKEUP_DB / 20));
  mix.connect(limiter).connect(trim).connect(destination);

  const room = ctx.createConvolver();
  room.normalize = false;
  room.buffer = plasterRoom(ctx, rand);
  room.connect(mix);

  // One bus per family of sound: straight into the mix, with its share sent to the room.
  const bus = (send: number): GainNode => {
    const node = gain(1);
    node.connect(mix);
    if (send > 0) node.connect(gain(send)).connect(room);
    return node;
  };
  const rollBus = bus(ROOM_SEND.roll);
  const tickBus = bus(ROOM_SEND.tick);
  const thudBus = bus(ROOM_SEND.thud);
  const clinkBus = bus(ROOM_SEND.clink);
  const dropBus = bus(ROOM_SEND.drop);
  const swellBus = bus(0);

  // Rolling. A rolling ball is a stream of tiny impacts: noise, whose band climbs as the
  // ball speeds up, heard through whatever it is rolling on.
  const noise = loop(pink);
  const speed = control();
  const speedSquared = gain(0);
  speed.connect(speedSquared);
  speed.connect(speedSquared.gain);
  const rolling = gain(1);

  // The ball itself: a soft band of rumble that rises two octaves from a crawl to full
  // speed. Its loudness is 1.6s - 0.6s², which bends the straight line upwards in the
  // middle, so a slow roll is quiet but not lost.
  const bodyCut = filter("highpass", 95, 0.7);
  const bodyBand = filter("bandpass", 190, 0.8);
  const body = gain(0);
  noise.connect(bodyCut).connect(bodyBand).connect(body).connect(rolling);
  follow(bodyCut.detune, speed, 2500);
  follow(bodyBand.detune, speed, 2500);
  follow(body.gain, speed, LEVEL.rollBody * 1.6);
  follow(body.gain, speedSquared, LEVEL.rollBody * -0.6);

  // The rails: they ring more the faster the ball goes, and tighten by about a tone.
  const rails = gain(0);
  follow(rails.gain, speedSquared, LEVEL.rollRails);
  for (const [hz, q, level] of RAIL_MODES) {
    const mode = filter("bandpass", hz, q);
    follow(mode.detune, speed, 180);
    noise.connect(mode).connect(gain(level)).connect(rails);
  }
  rails.connect(rolling);

  // The brushed surface of the brass: a fine hiss that only appears at speed.
  const hiss = gain(0);
  follow(hiss.gain, speedSquared, LEVEL.rollHiss);
  noise.connect(filter("bandpass", 3000, 0.6)).connect(hiss).connect(rolling);

  // Unevenness makes the roll breathe and shifts its colour a little, faster as the ball
  // speeds up, so it never settles into a steady tone the way a synthesiser would.
  const wobble = loop(unevenness(ctx, rand), 0.4);
  follow(wobble.playbackRate, speed, 1.6);
  follow(rolling.gain, wobble, 0.35);
  follow(bodyBand.detune, wobble, 160);
  rolling.connect(rollBus);

  // Swell. Air pressure is noise with everything above a low hum removed. More of it opens
  // the band a little; it never gets bright enough to become a whoosh.
  const pressure = control();
  const airFloor = filter("highpass", 38, 0.7);
  const airBand = filter("lowpass", 95, 0.7);
  const airCeiling = filter("lowpass", 300, 0.7);
  const air = gain(0);
  loop(pink, 0.5, 0.7).connect(airFloor).connect(airBand).connect(airCeiling).connect(air).connect(swellBus);
  follow(airBand.detune, pressure, 1500);
  follow(air.gain, pressure, LEVEL.swell);

  const clackBuffer = clack(ctx, rand);
  let rollTarget = 0;
  let swellTarget = 0;
  let lastClink = -1;
  let clinkVoices = 0;

  // Moves a control signal towards `value`, unless it is already as good as there. Returns
  // the target now in force. The early return is the path taken on almost every frame.
  const steer = (signal: ConstantSourceNode, current: number, input: number): number => {
    const value = unit(input);
    if (value === current || (value !== 0 && Math.abs(value - current) < STEP)) return current;
    signal.offset.setTargetAtTime(value, ctx.currentTime, GLIDE);
    return value;
  };

  // The loudness of a one-shot: up from silence in `attack` seconds, down 60 dB over
  // `decay` seconds, then the last thousandth is let go. Nothing starts or ends on a step.
  const envelope = (param: AudioParam, at: number, peak: number, attack: number, decay: number): number => {
    param.setValueAtTime(0, at);
    param.linearRampToValueAtTime(peak, at + attack);
    param.exponentialRampToValueAtTime(peak * 0.001, at + attack + decay);
    param.linearRampToValueAtTime(0, at + attack + decay + 0.01);
    return at + attack + decay + 0.02;
  };

  // One decaying partial: an oscillator under an envelope, removed from the graph when done.
  const partial = (to: AudioNode, at: number, hz: number, peak: number, attack: number, decay: number, type: OscillatorType = "sine"): OscillatorNode => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    const amp = ctx.createGain();
    const end = envelope(amp.gain, at, peak, attack, decay);
    osc.connect(amp).connect(to);
    osc.start(at);
    osc.stop(end);
    osc.onended = () => amp.disconnect();
    return osc;
  };

  // The moment of contact: a few milliseconds of noise around `hz`.
  const contact = (to: AudioNode, at: number, hz: number, q: number, level: number, decay: number): void => {
    const source = ctx.createBufferSource();
    source.buffer = pink;
    const amp = ctx.createGain();
    const end = envelope(amp.gain, at, level, 0.001, decay);
    source.connect(filter("bandpass", hz, q)).connect(amp).connect(to);
    source.start(at, rand() * 1.5);
    source.stop(end);
    source.onended = () => amp.disconnect();
  };

  return {
    roll(value) {
      rollTarget = steer(speed, rollTarget, value);
    },

    swell(amount) {
      swellTarget = steer(pressure, swellTarget, amount);
    },

    tick(index) {
      const hz = HOOP_HZ[index];
      if (hz === undefined) return;
      const at = ctx.currentTime + LEAD;
      // A 4 ms attack is what keeps it soft: the ball brushes the hoop, it does not hammer it.
      for (const [ratio, level, decay] of HOOP_PARTIALS) partial(tickBus, at, hz * ratio, LEVEL.tick * level, 0.004, decay);
      contact(tickBus, at, 3200, 1.2, LEVEL.tick * 5, 0.012);
    },

    thud(strength) {
      const force = unit(strength);
      if (force < 0.02) return;
      const at = ctx.currentTime + LEAD;
      const level = LEVEL.thud * Math.pow(force, 0.7);
      // Stone does not ring and nothing here bends in pitch: each mode starts, dies, and
      // the whole landing is over in a fifth of a second.
      for (const [hz, share, decay] of THUD_MODES) partial(thudBus, at, hz, level * share, 0.002, decay);
      // The grit of the contact. A harder landing has more of it, and brighter.
      contact(thudBus, at, 1300 + 1400 * force, 0.8, level * 2 * force, 0.03);
    },

    clink(strength) {
      if (!(strength >= 0.05)) return;
      const now = ctx.currentTime;
      if (now - lastClink < CLINK_GAP || clinkVoices >= CLINK_VOICES) return;
      lastClink = now;
      clinkVoices++;
      const force = unit(strength);
      const source = ctx.createBufferSource();
      source.buffer = clackBuffer;
      // No two collisions are the same size or meet at the same spot: about two semitones
      // of spread either way, and a harder hit is brighter as well as louder.
      source.playbackRate.value = 0.88 + rand() * 0.26;
      const amp = gain(LEVEL.clink * Math.pow(force, 0.7));
      source.connect(filter("lowpass", 3000 + 9000 * force, 0.7)).connect(amp).connect(clinkBus);
      source.onended = () => {
        amp.disconnect();
        clinkVoices--;
      };
      source.start(now + LEAD);
    },

    drop() {
      const at = ctx.currentTime + LEAD;
      // A soft, rounded tone that falls a fifth, G4 to C4, landing on the hoops' keynote.
      // It falls faster than it fades, so the fall is heard before the tone is gone.
      const tone = partial(dropBus, at, 392, LEVEL.drop, 0.015, 0.8, "triangle");
      tone.frequency.setValueAtTime(392, at);
      tone.frequency.exponentialRampToValueAtTime(261.63, at + 0.4);
    },
  };
}

const STORAGE_KEY = "sound";
const FADE = 0.02; // seconds; time constant of the ramp when sound is turned on or off
const SUSPEND_AFTER = 250; // ms; long enough for that ramp to reach silence first

let enabled = false;
let audible = false; // enabled, and the page is in view
let context: AudioContext | null = null;
let gate: GainNode | null = null;
let engine: SoundEngine | null = null;
let suspendTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<(on: boolean) => void>();

function remembered(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false; // storage is blocked: every visit starts silent
  }
}

function remember(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Storage is blocked: the choice holds for this visit only.
  }
}

// Runs the context only while it can be heard, and always by way of a ramp on `gate`, so
// turning sound on or off, or switching tabs, never clicks.
function sync(): void {
  if (!context || !gate || !engine) return;
  const ctx = context;
  audible = enabled && !document.hidden;
  clearTimeout(suspendTimer);
  if (audible) {
    void ctx.resume().catch(() => {});
    gate.gain.setTargetAtTime(1, ctx.currentTime, FADE);
  } else {
    // Let go of the continuous layers, or the roll that was sounding when the visitor left
    // would still be sounding when they come back.
    engine.roll(0);
    engine.swell(0);
    gate.gain.setTargetAtTime(0, ctx.currentTime, FADE);
    suspendTimer = setTimeout(() => void ctx.suspend().catch(() => {}), SUSPEND_AFTER);
  }
}

// Creates the context and the instrument, once. Returns false where there is no Web Audio.
function boot(): boolean {
  if (engine) return true;
  try {
    context = new AudioContext({ latencyHint: "interactive" });
    gate = context.createGain();
    gate.gain.value = 0;
    gate.connect(context.destination);
    engine = createEngine(context, gate);
  } catch {
    void context?.close().catch(() => {});
    context = gate = engine = null;
    return false;
  }
  document.addEventListener("visibilitychange", sync);
  return true;
}

function setEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  stopWaitingForGesture();
  if (on && !boot()) return;
  remember(on);
  if (on !== enabled) {
    enabled = on;
    for (const fn of listeners) fn(on);
  }
  sync();
}

// A visitor who turned sound on last time gets it back, but a browser only lets audio start
// from inside a gesture, so it comes back on their first click or key press. Until then
// `enabled` stays false and the toggle reads "Sound off", which is the truth. A press on the
// toggle itself is left to the toggle: restoring here as well would flip the choice twice.
function onFirstGesture(event: Event): void {
  if (navigator.userActivation && !navigator.userActivation.isActive) return;
  if (event.target instanceof Element && event.target.closest("[data-sound-toggle]")) return;
  setEnabled(true);
}

function stopWaitingForGesture(): void {
  window.removeEventListener("click", onFirstGesture, true);
  window.removeEventListener("keydown", onFirstGesture, true);
}

// Nothing turns itself on for a visitor who asked for reduced motion, not even their own
// earlier choice. The toggle still works for them.
if (typeof window !== "undefined" && remembered() && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  window.addEventListener("click", onFirstGesture, true);
  window.addEventListener("keydown", onFirstGesture, true);
}

// The engine, but only while it can be heard. Every call the page makes goes through here,
// so with sound off, during server rendering, or before any gesture, a call costs one test.
// A suspended context is also refused: sounds scheduled on a stopped clock would all play
// at once when it restarts.
function live(): SoundEngine | null {
  return audible && context !== null && context.state === "running" ? engine : null;
}

export const sound: Sound = {
  get enabled() {
    return enabled;
  },
  setEnabled,
  subscribe(fn) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  roll(speed) {
    live()?.roll(speed);
  },
  tick(index) {
    live()?.tick(index);
  },
  thud(strength) {
    live()?.thud(strength);
  },
  clink(strength) {
    live()?.clink(strength);
  },
  swell(amount) {
    live()?.swell(amount);
  },
  drop() {
    live()?.drop();
  },
};
