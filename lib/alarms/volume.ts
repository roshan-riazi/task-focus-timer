/**
 * Client-side volume helpers for issue 13 (spec §8.7 + §10.2 volume 0–100).
 *
 * The settings Zod boundary (issue 09) stays authoritative — out-of-range
 * PATCHes still 400. These mirrors keep preview + playback honest without
 * forking the contract: validate before playing, clamp defensive input,
 * convert to the 0–1 gain the WebAudio player needs.
 */

/** True for 0–100 integers — the exact range the server persists. */
export function isValidAlarmVolume(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100
  );
}

/** Linear 0–100 → 0–1 gain. Callers clamp first; this clamps again defensively. */
export function volumeToGain(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume / 100));
}

/** Round-and-clamp arbitrary input into the persisted range. */
export function clampAlarmVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(100, Math.max(0, Math.round(volume)));
}
