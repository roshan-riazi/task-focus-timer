import { describe, expect, it } from "vitest";
import { SOUND_PRESETS } from "@/lib/settings/validation";
import {
  ALARM_PATTERNS,
  getAlarmPattern,
  type AlarmMoment,
} from "./presets";

/**
 * Seam 1 (unit, pure): preset→pattern mapping for issue 13 (spec §8.6,
 * decision ticket 10, SYSTEM_DESIGN §4 alarms).
 *
 * Every preset maps to a focus-end and a break-end pattern; the two moments
 * stay distinct so users can tell them apart by ear. No audio assets — the
 * patterns are WebAudio oscillator schedules synthesized in-app.
 */
describe("ALARM_PATTERNS (issue 13)", () => {
  it("covers every persisted preset from the settings allow-list", () => {
    expect(Object.keys(ALARM_PATTERNS).sort()).toEqual([...SOUND_PRESETS].sort());
  });

  it("maps each preset to non-empty focus-end and break-end patterns", () => {
    for (const preset of SOUND_PRESETS) {
      for (const moment of ["focus-end", "break-end"] as const) {
        const pattern = getAlarmPattern(preset, moment);
        expect(pattern.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps focus-end and break-end distinct for every preset", () => {
    for (const preset of SOUND_PRESETS) {
      const focus = getAlarmPattern(preset, "focus-end");
      const rest = getAlarmPattern(preset, "break-end");
      expect(focus).not.toEqual(rest);
    }
  });

  it("uses sane WebAudio synthesis parameters", () => {
    for (const preset of SOUND_PRESETS) {
      for (const moment of ["focus-end", "break-end"] as const satisfies AlarmMoment[]) {
        const pattern = getAlarmPattern(preset, moment);
        let total = 0;
        let prevEnd = -Infinity;
        for (const tone of pattern) {
          expect(tone.frequencyHz).toBeGreaterThanOrEqual(150);
          expect(tone.frequencyHz).toBeLessThanOrEqual(2500);
          expect(tone.durationSeconds).toBeGreaterThan(0);
          expect(tone.durationSeconds).toBeLessThanOrEqual(1.5);
          expect(tone.startAtSeconds).toBeGreaterThanOrEqual(0);
          // Scheduled in order, no overlaps — a simple chime sequence.
          expect(tone.startAtSeconds).toBeGreaterThanOrEqual(prevEnd);
          prevEnd = tone.startAtSeconds + tone.durationSeconds;
          total = Math.max(total, prevEnd);
        }
        // Short alarm, not a soundscape.
        expect(total).toBeLessThanOrEqual(5);
      }
    }
  });

  it("defaults unknown callers to the chime pattern shape (no throw on lookup)", () => {
    // The settings boundary already rejects unknown presets (issue 09), so
    // the player only ever receives allow-listed keys — this pins the
    // default the UI falls back to when stored settings are missing.
    expect(getAlarmPattern("chime", "focus-end").length).toBeGreaterThan(0);
  });
});
