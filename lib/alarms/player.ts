import type { SoundPreset } from "@/lib/settings/validation";
import { getAlarmPattern, type AlarmMoment, type AlarmTone } from "./presets";
import { volumeToGain } from "./volume";

/**
 * WebAudio alarm player for issue 13 (spec §8.6, SYSTEM_DESIGN §4 alarms).
 *
 * Sounds are synthesized in-app — no audio assets, no licensing. The start /
 * confirm click provides the user gesture that unlocks the AudioContext;
 * when the tab is hidden at expiry the browser notification (see
 * `lib/notifications/notify`) is the reliable channel and sound plays on
 * return if still enabled.
 *
 * Privacy: this module never receives task content — only the preset key,
 * moment, and numeric volume — so there is nothing user-authored to leak
 * into logs or error payloads. All failures degrade to silent (never throw)
 * so a denied/unsupported audio path never breaks the timer finalize flow.
 */

export interface AlarmPlayInput {
  preset: SoundPreset;
  moment: AlarmMoment;
  /** 0–100, the persisted settings unit. */
  volume: number;
  /** False skips playback entirely (spec §8.7 sound on/off). */
  soundEnabled?: boolean;
}

export type AlarmPlayReason =
  | "played"
  | "disabled"
  | "muted"
  | "unsupported"
  | "failed";

export interface AlarmPlayResult {
  played: boolean;
  reason: AlarmPlayReason;
}

type MinimalOscillator = {
  type: OscillatorType;
  frequency: { value: number };
  connect: (node: unknown) => void;
  start: (when: number) => void;
  stop: (when: number) => void;
};

type MinimalGain = {
  gain: { value: number };
  connect: (node: unknown) => void;
};

type MinimalAudioContext = {
  currentTime: number;
  state: string;
  resume: () => Promise<void>;
  createOscillator: () => MinimalOscillator;
  createGain: () => MinimalGain;
  destination: unknown;
};

type AudioFactory = () => MinimalAudioContext | null;

let sharedContext: MinimalAudioContext | null = null;
let factoryOverride: AudioFactory | null = null;

function defaultFactory(): MinimalAudioContext | null {
  try {
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    if (sharedContext) return sharedContext;
    sharedContext = new Ctor() as unknown as MinimalAudioContext;
    return sharedContext;
  } catch {
    return null;
  }
}

function resolveFactory(): AudioFactory {
  return factoryOverride ?? defaultFactory;
}

/**
 * Schedule every tone of a pattern on one shared gain node. Exported for
 * unit tests with a fake context — production callers use `playAlarm`.
 */
export function scheduleAlarmPattern(
  ctx: MinimalAudioContext,
  pattern: readonly AlarmTone[],
  gainValue: number,
): void {
  const gain = ctx.createGain();
  gain.gain.value = gainValue;
  gain.connect(ctx.destination);
  const base = ctx.currentTime;
  for (const tone of pattern) {
    const osc = ctx.createOscillator();
    osc.type = tone.type;
    osc.frequency.value = tone.frequencyHz;
    osc.connect(gain);
    osc.start(base + tone.startAtSeconds);
    osc.stop(base + tone.startAtSeconds + tone.durationSeconds);
  }
}

/**
 * Unlock audio after a user gesture (the start/confirm click provides it).
 * Resumes a suspended context; safe no-op when WebAudio is unavailable
 * (SSR, unsupported browser) — never throws.
 */
export async function ensureAudioUnlocked(): Promise<void> {
  try {
    const ctx = resolveFactory()();
    if (!ctx) return;
    if (ctx.state === "suspended") await ctx.resume();
  } catch {
    // Audio must never break the timer flow.
  }
}

export async function playAlarm(input: AlarmPlayInput): Promise<AlarmPlayResult> {
  const soundEnabled = input.soundEnabled ?? true;
  if (!soundEnabled) return { played: false, reason: "disabled" };
  if (!Number.isFinite(input.volume) || input.volume <= 0) {
    return { played: false, reason: "muted" };
  }
  try {
    const ctx = resolveFactory()();
    if (!ctx) return { played: false, reason: "unsupported" };
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // A suspended context still schedules — the browser decides.
      }
    }
    scheduleAlarmPattern(
      ctx,
      getAlarmPattern(input.preset, input.moment),
      volumeToGain(input.volume),
    );
    return { played: true, reason: "played" };
  } catch {
    return { played: false, reason: "failed" };
  }
}

/** Test seam: inject a fake AudioContext factory. */
export function __setAlarmAudioFactoryForTests(
  factory: AudioFactory,
): void {
  factoryOverride = factory;
}

/** Test seam: clear the injected factory + shared context. */
export function __resetAlarmAudioForTests(): void {
  factoryOverride = null;
  sharedContext = null;
}
