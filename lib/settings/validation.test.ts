import { describe, expect, it } from "vitest";
import { SOUND_PRESETS, updateSettingsSchema } from "./validation";

/**
 * Seam 1 (unit, hermetic): Zod input boundary for the Settings API
 * (issue 09, spec §8.7 + §10.2).
 *
 * Every expectation below is an independent literal from the spec —
 * durations in seconds converted once from the spec's minute ranges
 * (focus 1–120, short/long 1–60, SYSTEM_DESIGN §10 defaults
 * 1500/300/900), cycle count 1–10, volume 0–100, preset allow-list from
 * the `settings.html` prototype select (Chime/Bell/Pulse/Gong, default
 * chime), IANA timezone — never recomputed from the implementation.
 */
describe("SOUND_PRESETS", () => {
  it("is the prototype's four synthesized presets with chime first", () => {
    expect(SOUND_PRESETS).toEqual(["chime", "bell", "pulse", "gong"]);
  });
});

describe("updateSettingsSchema", () => {
  it("rejects an empty patch like the task PATCH route does", () => {
    expect(() => updateSettingsSchema.parse({})).toThrow("Nothing to update.");
  });

  it("accepts every field together", () => {
    expect(
      updateSettingsSchema.parse({
        focusDurationSeconds: 1500,
        shortBreakSeconds: 300,
        longBreakSeconds: 900,
        intervalsBeforeLongBreak: 4,
        autoStartBreaks: true,
        autoStartFocus: true,
        soundEnabled: false,
        soundPreset: "bell",
        soundVolume: 42,
        notificationsEnabled: true,
        timezone: "Europe/Berlin",
      }),
    ).toEqual({
      focusDurationSeconds: 1500,
      shortBreakSeconds: 300,
      longBreakSeconds: 900,
      intervalsBeforeLongBreak: 4,
      autoStartBreaks: true,
      autoStartFocus: true,
      soundEnabled: false,
      soundPreset: "bell",
      soundVolume: 42,
      notificationsEnabled: true,
      timezone: "Europe/Berlin",
    });
  });

  it("accepts a single-field patch", () => {
    expect(updateSettingsSchema.parse({ soundVolume: 0 })).toEqual({
      soundVolume: 0,
    });
  });

  it("rejects focus durations outside 1–120 minutes (60–7200 seconds)", () => {
    expect(() =>
      updateSettingsSchema.parse({ focusDurationSeconds: 59 }),
    ).toThrow();
    expect(() =>
      updateSettingsSchema.parse({ focusDurationSeconds: 7201 }),
    ).toThrow();
    expect(
      updateSettingsSchema.parse({ focusDurationSeconds: 60 })
        .focusDurationSeconds,
    ).toBe(60);
    expect(
      updateSettingsSchema.parse({ focusDurationSeconds: 7200 })
        .focusDurationSeconds,
    ).toBe(7200);
  });

  it("rejects short/long breaks outside 1–60 minutes (60–3600 seconds)", () => {
    for (const field of ["shortBreakSeconds", "longBreakSeconds"] as const) {
      expect(() => updateSettingsSchema.parse({ [field]: 59 })).toThrow();
      expect(() => updateSettingsSchema.parse({ [field]: 3601 })).toThrow();
      expect(
        updateSettingsSchema.parse({ [field]: 60 })[field],
      ).toBe(60);
      expect(
        updateSettingsSchema.parse({ [field]: 3600 })[field],
      ).toBe(3600);
    }
  });

  it("rejects non-integer durations", () => {
    expect(() =>
      updateSettingsSchema.parse({ focusDurationSeconds: 1500.5 }),
    ).toThrow();
    expect(() =>
      updateSettingsSchema.parse({ focusDurationSeconds: "1500" }),
    ).toThrow();
  });

  it("rejects cycle counts outside 1–10", () => {
    expect(() =>
      updateSettingsSchema.parse({ intervalsBeforeLongBreak: 0 }),
    ).toThrow();
    expect(() =>
      updateSettingsSchema.parse({ intervalsBeforeLongBreak: 11 }),
    ).toThrow();
    expect(
      updateSettingsSchema.parse({ intervalsBeforeLongBreak: 1 })
        .intervalsBeforeLongBreak,
    ).toBe(1);
    expect(
      updateSettingsSchema.parse({ intervalsBeforeLongBreak: 10 })
        .intervalsBeforeLongBreak,
    ).toBe(10);
  });

  it("rejects unknown sound presets and accepts each known one", () => {
    expect(() =>
      updateSettingsSchema.parse({ soundPreset: "synthwave" }),
    ).toThrow();
    expect(() => updateSettingsSchema.parse({ soundPreset: "" })).toThrow();
    expect(() => updateSettingsSchema.parse({ soundPreset: "CHIME" })).toThrow();
    for (const preset of ["chime", "bell", "pulse", "gong"] as const) {
      expect(updateSettingsSchema.parse({ soundPreset: preset }).soundPreset)
        .toBe(preset);
    }
  });

  it("rejects volumes outside 0–100 and non-integers", () => {
    expect(() => updateSettingsSchema.parse({ soundVolume: -1 })).toThrow();
    expect(() => updateSettingsSchema.parse({ soundVolume: 101 })).toThrow();
    expect(() => updateSettingsSchema.parse({ soundVolume: 80.5 })).toThrow();
    expect(updateSettingsSchema.parse({ soundVolume: 0 }).soundVolume).toBe(0);
    expect(updateSettingsSchema.parse({ soundVolume: 100 }).soundVolume).toBe(
      100,
    );
  });

  it("rejects non-boolean flags", () => {
    for (const field of [
      "autoStartBreaks",
      "autoStartFocus",
      "soundEnabled",
      "notificationsEnabled",
    ] as const) {
      expect(() => updateSettingsSchema.parse({ [field]: "true" })).toThrow();
      expect(() => updateSettingsSchema.parse({ [field]: 1 })).toThrow();
      expect(updateSettingsSchema.parse({ [field]: true })[field]).toBe(true);
    }
  });

  it("rejects invalid timezones and accepts IANA names", () => {
    expect(() => updateSettingsSchema.parse({ timezone: "Mars/Olympus" }))
      .toThrow();
    expect(() => updateSettingsSchema.parse({ timezone: "" })).toThrow();
    expect(() => updateSettingsSchema.parse({ timezone: "Not A Zone!" }))
      .toThrow();
    expect(updateSettingsSchema.parse({ timezone: "UTC" }).timezone).toBe(
      "UTC",
    );
    expect(
      updateSettingsSchema.parse({ timezone: "Europe/Berlin" }).timezone,
    ).toBe("Europe/Berlin");
    expect(
      updateSettingsSchema.parse({ timezone: "Pacific/Kiritimati" }).timezone,
    ).toBe("Pacific/Kiritimati");
  });
});
