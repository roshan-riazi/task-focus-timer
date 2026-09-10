import type { PublicSession } from "@/lib/timer/service";

/**
 * Timestamp-derived display math (spec §8.4): the UI never runs a
 * decrementing counter as the source of truth. Every render computes from
 * the server-authoritative stamps — `expectedEndAt` minus `now` while
 * running, minus `pausedAt` while paused (the server shifts the expected
 * end forward on resume, so progress derived here matches server math).
 * Client ticks only re-render; reconciliation comes from the server.
 */

function ms(iso: string): number {
  return new Date(iso).getTime();
}

/** Whole seconds left, floored and clamped at 0 (never a negative clock). */
export function remainingSeconds(
  session: PublicSession,
  nowMs: number,
): number {
  const end = ms(session.expectedEndAt);
  const anchor =
    session.status === "paused" && session.pausedAt
      ? ms(session.pausedAt)
      : nowMs;
  return Math.max(0, Math.floor((end - anchor) / 1000));
}

/** 0–100 progress toward the expected end, rounded, from the same stamps. */
export function progressPercent(
  session: PublicSession,
  nowMs: number,
): number {
  const planned = session.plannedDurationSeconds;
  if (planned <= 0) return 100;
  const remaining = remainingSeconds(session, nowMs);
  const done = Math.round(((planned - remaining) / planned) * 100);
  return Math.min(100, Math.max(0, done));
}

/** Clock text: `mm:ss` under an hour, `h:mm:ss` at/over it. */
export function formatRemaining(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

/**
 * Local expiry tripwire: a running interval at/past its expected end needs
 * a server reconcile (`GET current` auto-finalizes within grace or reports
 * `pendingConfirmation` beyond it). Paused intervals never expire — paused
 * time is frozen (spec §8.4).
 */
export function isExpired(session: PublicSession, nowMs: number): boolean {
  if (session.status !== "running") return false;
  return nowMs >= ms(session.expectedEndAt);
}
