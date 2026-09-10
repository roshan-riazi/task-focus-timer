import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetAlarmAudioForTests,
  __setAlarmAudioFactoryForTests,
  ensureAudioUnlocked,
  playAlarm,
  scheduleAlarmPattern,
} from "./player";
import { getAlarmPattern } from "./presets";

/**
 * Seam 2 (unit, hermetic): WebAudio synthesis + gesture unlock (issue 13,
 * SYSTEM_DESIGN §4 alarms).
 *
 * The player never touches the network and never logs task content — it
 * synthesizes oscillator schedules from `presets.ts` at the set volume.
 * A fake AudioContext stands in for the browser so scheduling, gain, and
 * unlock paths assert without audible output.
 */

interface FakeOscillator {
  type: OscillatorType;
  frequency: { value: number };
  connect: (node: unknown) => void;
  start: (when: number) => void;
  stop: (when: number) => void;
  startedAt: number[];
  stoppedAt: number[];
}

interface FakeGain {
  gain: { value: number };
  connect: (node: unknown) => void;
}

interface FakeContext {
  currentTime: number;
  state: string;
  resumed: number;
  oscillators: FakeOscillator[];
  gains: FakeGain[];
  destination: object;
  resume: () => Promise<void>;
  createOscillator: () => FakeOscillator;
  createGain: () => FakeGain;
}

function makeFakeContext(): FakeContext {
  const ctx: FakeContext = {
    currentTime: 10,
    state: "suspended",
    resumed: 0,
    oscillators: [],
    gains: [],
    destination: {},
    resume: async () => {
      ctx.resumed += 1;
      ctx.state = "running";
    },
    createOscillator: () => {
      const osc: FakeOscillator = {
        type: "sine",
        frequency: { value: 0 },
        connect: () => {},
        start: (when: number) => {
          osc.startedAt.push(when);
        },
        stop: (when: number) => {
          osc.stoppedAt.push(when);
        },
        startedAt: [],
        stoppedAt: [],
      };
      ctx.oscillators.push(osc);
      return osc;
    },
    createGain: () => {
      const gain: FakeGain = { gain: { value: 0 }, connect: () => {} };
      ctx.gains.push(gain);
      return gain;
    },
  };
  return ctx;
}

beforeEach(() => {
  __resetAlarmAudioForTests();
  vi.unstubAllGlobals();
});

describe("scheduleAlarmPattern (issue 13)", () => {
  it("schedules one oscillator per tone at the pattern frequencies", () => {
    const ctx = makeFakeContext();
    const pattern = getAlarmPattern("chime", "focus-end");
    scheduleAlarmPattern(
      ctx as unknown as Parameters<typeof scheduleAlarmPattern>[0],
      pattern,
      0.8,
    );
    expect(ctx.oscillators).toHaveLength(pattern.length);
    ctx.oscillators.forEach((osc, i) => {
      expect(osc.frequency.value).toBe(pattern[i]!.frequencyHz);
      expect(osc.type).toBe(pattern[i]!.type);
      expect(osc.startedAt).toHaveLength(1);
      expect(osc.stoppedAt).toHaveLength(1);
    });
    // Gain honors the set volume (0.8 → 0.8 on the single shared node).
    expect(ctx.gains).toHaveLength(1);
    expect(ctx.gains[0]!.gain.value).toBeCloseTo(0.8, 5);
  });

  it("offsets each tone by its startAtSeconds", () => {
    const ctx = makeFakeContext();
    const pattern = getAlarmPattern("pulse", "focus-end");
    scheduleAlarmPattern(
      ctx as unknown as Parameters<typeof scheduleAlarmPattern>[0],
      pattern,
      0.5,
    );
    const base = ctx.currentTime;
    pattern.forEach((tone, i) => {
      expect(ctx.oscillators[i]!.startedAt[0]).toBeCloseTo(
        base + tone.startAtSeconds,
        5,
      );
      expect(ctx.oscillators[i]!.stoppedAt[0]).toBeCloseTo(
        base + tone.startAtSeconds + tone.durationSeconds,
        5,
      );
    });
  });
});

describe("playAlarm (issue 13)", () => {
  it("plays the correct preset at the set volume", async () => {
    const ctx = makeFakeContext();
    __setAlarmAudioFactoryForTests(
      () => ctx as unknown as Parameters<typeof scheduleAlarmPattern>[0],
    );
    const result = await playAlarm({
      preset: "bell",
      moment: "break-end",
      volume: 50,
      soundEnabled: true,
    });
    expect(result.played).toBe(true);
    expect(ctx.oscillators).toHaveLength(
      getAlarmPattern("bell", "break-end").length,
    );
    expect(ctx.gains[0]!.gain.value).toBeCloseTo(0.5, 5);
  });

  it("stays silent when sound is disabled or volume is 0", async () => {
    const ctx = makeFakeContext();
    __setAlarmAudioFactoryForTests(
      () => ctx as unknown as Parameters<typeof scheduleAlarmPattern>[0],
    );
    expect(
      (
        await playAlarm({
          preset: "chime",
          moment: "focus-end",
          volume: 80,
          soundEnabled: false,
        })
      ).played,
    ).toBe(false);
    expect(ctx.oscillators).toHaveLength(0);

    const ctx2 = makeFakeContext();
    __setAlarmAudioFactoryForTests(
      () => ctx2 as unknown as Parameters<typeof scheduleAlarmPattern>[0],
    );
    const muted = await playAlarm({
      preset: "chime",
      moment: "focus-end",
      volume: 0,
      soundEnabled: true,
    });
    expect(muted.played).toBe(false);
    expect(muted.reason).toBe("muted");
    expect(ctx2.oscillators).toHaveLength(0);
  });

  it("degrades to silent when WebAudio is unavailable (SSR/unsupported)", async () => {
    __setAlarmAudioFactoryForTests(() => null);
    const result = await playAlarm({
      preset: "chime",
      moment: "focus-end",
      volume: 80,
      soundEnabled: true,
    });
    expect(result.played).toBe(false);
    expect(result.reason).toBe("unsupported");
  });

  it("never throws when the context fails", async () => {
    __setAlarmAudioFactoryForTests(() => {
      throw new Error("boom");
    });
    const result = await playAlarm({
      preset: "chime",
      moment: "focus-end",
      volume: 80,
      soundEnabled: true,
    });
    expect(result.played).toBe(false);
  });
});

describe("ensureAudioUnlocked (issue 13 gesture unlock)", () => {
  it("resumes a suspended context after a user gesture", async () => {
    const ctx = makeFakeContext();
    expect(ctx.state).toBe("suspended");
    __setAlarmAudioFactoryForTests(
      () => ctx as unknown as Parameters<typeof scheduleAlarmPattern>[0],
    );
    await ensureAudioUnlocked();
    expect(ctx.resumed).toBe(1);
    expect(ctx.state).toBe("running");
  });

  it("is a safe no-op when WebAudio is unavailable", async () => {
    __setAlarmAudioFactoryForTests(() => null);
    await expect(ensureAudioUnlocked()).resolves.toBeUndefined();
  });
});
