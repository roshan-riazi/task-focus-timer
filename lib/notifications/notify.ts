/**
 * Browser notifications for issue 13 (spec §8.6, SYSTEM_DESIGN §4 alarms).
 *
 * The notification is the reliable hidden-tab channel: WebAudio may stay
 * suspended while the tab is hidden, so finalization always attempts a
 * notification (when enabled + permitted) alongside sound. The visual timer
 * status region remains the baseline — denial degrades to silent + visual,
 * never an error.
 *
 * Privacy (spec §12.2, TEST_STRATEGY canary rule): task titles/notes never
 * touch notification payloads. These functions accept only the interval
 * moment — there is no parameter task content could flow through — and all
 * copy is fixed first-party strings.
 */

import type { AlarmMoment } from "@/lib/alarms/presets";

/** Same moments as the alarm player — one shared vocabulary (spec §8.6). */
export type NotifyMoment = AlarmMoment;

export interface NotificationContent {
  title: string;
  body: string;
}

export function getNotificationContent(moment: NotifyMoment): NotificationContent {
  if (moment === "focus-end") {
    return {
      title: "Focus interval complete",
      body: "Nice work — time for a break.",
    };
  }
  return {
    title: "Break over",
    body: "Ready for your next focus interval?",
  };
}

export type NotifyReason =
  | "shown"
  | "disabled"
  | "denied"
  | "unsupported"
  | "failed";

export interface NotifyResult {
  shown: boolean;
  reason: NotifyReason;
}

type NotificationCtor = new (
  title: string,
  options?: { body?: string },
) => unknown;

function getNotificationCtor(): (NotificationCtor & {
  permission?: NotificationPermission;
  requestPermission?: () => Promise<NotificationPermission>;
}) | null {
  try {
    if (typeof window === "undefined") return null;
    const Ctor = (window as unknown as { Notification?: NotificationCtor }).Notification;
    if (!Ctor) return null;
    return Ctor as NotificationCtor & {
      permission?: NotificationPermission;
      requestPermission?: () => Promise<NotificationPermission>;
    };
  } catch {
    return null;
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  try {
    const Ctor = getNotificationCtor();
    if (!Ctor) return "denied";
    // A denied permission must never re-prompt — browsers ignore/fail the
    // request and the UX is hostile. Only `default` may ask.
    if (Ctor.permission === "granted") return "granted";
    if (Ctor.permission === "denied") return "denied";
    if (typeof Ctor.requestPermission === "function") {
      return await Ctor.requestPermission();
    }
    return Ctor.permission ?? "denied";
  } catch {
    return "denied";
  }
}

/**
 * Show the finalize notification. Never throws and never includes task
 * content — denial, missing API, or disabled flag all resolve to silent so
 * the caller keeps its visual status announcement as the fallback.
 */
export async function notifyIntervalComplete(
  moment: NotifyMoment,
  opts: { notificationsEnabled?: boolean } = {},
): Promise<NotifyResult> {
  if (opts.notificationsEnabled !== true) {
    return { shown: false, reason: "disabled" };
  }
  try {
    const Ctor = getNotificationCtor();
    if (!Ctor) return { shown: false, reason: "unsupported" };
    // `Notification` may be stubbed without `permission` in tests — treat
    // a missing field as granted so the constructor path still asserts.
    const permission =
      (Ctor as { permission?: NotificationPermission }).permission ?? "granted";
    if (permission === "denied") return { shown: false, reason: "denied" };
    if (permission !== "granted") return { shown: false, reason: "denied" };
    const { title, body } = getNotificationContent(moment);
    new Ctor(title, { body });
    return { shown: true, reason: "shown" };
  } catch {
    return { shown: false, reason: "failed" };
  }
}
