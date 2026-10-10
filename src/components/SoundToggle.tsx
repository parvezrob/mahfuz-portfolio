"use client";

import { useSyncExternalStore } from "react";
import { sound } from "@/lib/sound";

const isOn = () => sound.enabled;
const isOnServer = () => false;

// The switch for the sound layer, made to sit in the top bar beside the links. It sets no
// colour of its own, so it turns with the bar when the frame floods red. Two things a link
// has for free and a button does not: the header lets pointer events through and each child
// takes them back, and the cursor has to be asked for. The data attribute is how sound.ts
// knows that a press on this button is the visitor's choice and not just their first click.
export function SoundToggle() {
  const on = useSyncExternalStore(sound.subscribe, isOn, isOnServer);
  return (
    <button
      type="button"
      aria-pressed={on}
      data-sound-toggle
      onClick={() => sound.setEnabled(!on)}
      className="small pointer-events-auto cursor-pointer"
    >
      {on ? "Sound on" : "Sound off"}
    </button>
  );
}
