import { describe, expect, it } from "vitest";
import {
  clampAlarmVolume,
  isValidAlarmVolume,
  volumeToGain,
} from "./volume";

/**
 * Seam 1 (unit, pure): volume validation for issue 13 (spec §8.7 + §10.2
 * volume 0–100, mirrored from the settings Zod boundary in issue 09).
 *
 * The server stays authoritative (out-of-range PATCHes still 400); these
 * helpers keep the client honest — preview + playback honor the same range
 * without forking the contract.
 */
describe("alarm volume (issue 13)", () => {
  it("accepts 0–100 integers, rejects everything else", () => {
    expect(isValidAlarmVolume(0)).toBe(true);
    expect(isValidAlarmVolume(80)).toBe(true);
    expect(isValidAlarmVolume(100)).toBe(true);
    expect(isValidAlarmVolume(-1)).toBe(false);
    expect(isValidAlarmVolume(101)).toBe(false);
    expect(isValidAlarmVolume(80.5)).toBe(false);
    expect(isValidAlarmVolume("80")).toBe(false);
    expect(isValidAlarmVolume(NaN)).toBe(false);
    expect(isValidAlarmVolume(undefined)).toBe(false);
  });

  it("maps volume to a 0–1 gain linearly", () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(100)).toBe(1);
    expect(volumeToGain(80)).toBeCloseTo(0.8, 5);
    expect(volumeToGain(50)).toBeCloseTo(0.5, 5);
  });

  it("clamps out-of-range input into the valid range", () => {
    expect(clampAlarmVolume(-20)).toBe(0);
    expect(clampAlarmVolume(1000)).toBe(100);
    expect(clampAlarmVolume(42.7)).toBe(43);
  });
});
