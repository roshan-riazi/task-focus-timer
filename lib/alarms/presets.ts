import type { SoundPreset } from "@/lib/settings/validation";

/**
 * Alarm patterns for issue 13 (spec §8.6, decision ticket 10,
 * SYSTEM_DESIGN §4 alarms).
 *
 * Each persisted preset (`SOUND_PRESETS` in `lib/settings/validation` —
 * reused here, never reforked) maps to two WebAudio oscillator schedules:
 * a focus-end pattern and a distinct break-end pattern. No audio assets, no
 * licensing: the player synthesizes these tones in-app.
 *
 * Frequencies are plain musical pitches (Hz); `startAtSeconds` is the
 * offset from the alarm start; `durationSeconds` is the per-tone ring.
 * Tones within a pattern are ordered and non-overlapping so the result
 * reads as a short chime sequence, never a soundscape (total < 5s).
 */

export type AlarmMoment = "focus-end" | "break-end";

export interface AlarmTone {
  frequencyHz: number;
  startAtSeconds: number;
  durationSeconds: number;
  type: OscillatorType;
}

export const ALARM_PATTERNS: Record<
  SoundPreset,
  Record<AlarmMoment, readonly AlarmTone[]>
> = {
  chime: {
    // Warm ascending triad when focus ends; shorter falling pair when a
    // break ends — same voice, unmistakably different shapes.
    "focus-end": [
      { frequencyHz: 659.25, startAtSeconds: 0, durationSeconds: 0.25, type: "sine" },
      { frequencyHz: 783.99, startAtSeconds: 0.3, durationSeconds: 0.25, type: "sine" },
      { frequencyHz: 1046.5, startAtSeconds: 0.6, durationSeconds: 0.5, type: "sine" },
    ],
    "break-end": [
      { frequencyHz: 783.99, startAtSeconds: 0, durationSeconds: 0.25, type: "sine" },
      { frequencyHz: 659.25, startAtSeconds: 0.3, durationSeconds: 0.4, type: "sine" },
    ],
  },
  bell: {
    // Double strike for focus, single lower strike for breaks.
    "focus-end": [
      { frequencyHz: 880, startAtSeconds: 0, durationSeconds: 0.6, type: "triangle" },
      { frequencyHz: 880, startAtSeconds: 0.7, durationSeconds: 0.6, type: "triangle" },
    ],
    "break-end": [
      { frequencyHz: 659.25, startAtSeconds: 0, durationSeconds: 0.8, type: "triangle" },
    ],
  },
  pulse: {
    // Three short pulses for focus, two longer ones for breaks.
    "focus-end": [
      { frequencyHz: 440, startAtSeconds: 0, durationSeconds: 0.15, type: "square" },
      { frequencyHz: 440, startAtSeconds: 0.2, durationSeconds: 0.15, type: "square" },
      { frequencyHz: 440, startAtSeconds: 0.4, durationSeconds: 0.15, type: "square" },
    ],
    "break-end": [
      { frequencyHz: 440, startAtSeconds: 0, durationSeconds: 0.25, type: "square" },
      { frequencyHz: 440, startAtSeconds: 0.35, durationSeconds: 0.25, type: "square" },
    ],
  },
  gong: {
    // Low long swell for focus, higher shorter swell for breaks.
    "focus-end": [
      { frequencyHz: 196, startAtSeconds: 0, durationSeconds: 1.2, type: "sine" },
    ],
    "break-end": [
      { frequencyHz: 293.66, startAtSeconds: 0, durationSeconds: 0.8, type: "sine" },
    ],
  },
};

export function getAlarmPattern(
  preset: SoundPreset,
  moment: AlarmMoment,
): readonly AlarmTone[] {
  return ALARM_PATTERNS[preset][moment];
}
