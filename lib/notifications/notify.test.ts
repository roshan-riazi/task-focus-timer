import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CANARY_TASK_NOTES,
  CANARY_TASK_TITLE,
} from "@/tests/canary";
import {
  getNotificationContent,
  notifyIntervalComplete,
  requestNotificationPermission,
} from "./notify";

/**
 * Seam 3 (unit, hermetic): browser notifications for issue 13 (spec §8.6,
 * SYSTEM_DESIGN §4 alarms — notification is the reliable hidden-tab
 * channel).
 *
 * Privacy invariant (spec §12.2, TEST_STRATEGY canary rule): task titles and
 * notes never touch notification payloads. The API takes only the interval
 * moment — there is no parameter task content could even flow through — and
 * titles/bodies are fixed first-party strings.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getNotificationContent (issue 13)", () => {
  it("uses distinct copy for focus-end vs break-end", () => {
    const focus = getNotificationContent("focus-end");
    const rest = getNotificationContent("break-end");
    expect(focus.title).toBeTruthy();
    expect(rest.title).toBeTruthy();
    expect(`${focus.title} ${focus.body}`).not.toBe(
      `${rest.title} ${rest.body}`,
    );
  });

  it("never contains user-authored task content", () => {
    for (const moment of ["focus-end", "break-end"] as const) {
      const { title, body } = getNotificationContent(moment);
      expect(`${title} ${body}`).not.toContain(CANARY_TASK_TITLE);
      expect(`${title} ${body}`).not.toContain(CANARY_TASK_NOTES);
    }
  });
});

describe("notifyIntervalComplete (issue 13)", () => {
  it("shows a notification when enabled and permitted", async () => {
    const shown: Array<{ title: string; body: string }> = [];
    vi.stubGlobal(
      "Notification",
      class {
        static permission: NotificationPermission = "granted";
        constructor(title: string, opts?: { body?: string }) {
          shown.push({ title, body: opts?.body ?? "" });
        }
      },
    );
    const result = await notifyIntervalComplete("focus-end", {
      notificationsEnabled: true,
    });
    expect(result.shown).toBe(true);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe(
      getNotificationContent("focus-end").title,
    );
  });

  it("degrades to silent + visual when permission is denied", async () => {
    vi.stubGlobal("Notification", class {
      static permission: NotificationPermission = "denied";
      constructor() {
        throw new Error("must not construct when denied");
      }
    });
    const result = await notifyIntervalComplete("focus-end", {
      notificationsEnabled: true,
    });
    expect(result.shown).toBe(false);
    expect(result.reason).toBe("denied");
  });

  it("stays silent when the flag is off or the API is missing", async () => {
    vi.stubGlobal(
      "Notification",
      class {
        static permission: NotificationPermission = "granted";
        constructor() {
          throw new Error("must not construct when disabled");
        }
      },
    );
    expect(
      (await notifyIntervalComplete("focus-end", { notificationsEnabled: false }))
        .shown,
    ).toBe(false);

    vi.stubGlobal("Notification", undefined);
    expect(
      (await notifyIntervalComplete("break-end", { notificationsEnabled: true }))
        .shown,
    ).toBe(false);
  });

  it("never throws — denial/failure still leaves the visual status path", async () => {
    vi.stubGlobal("Notification", undefined);
    await expect(
      notifyIntervalComplete("focus-end", { notificationsEnabled: true }),
    ).resolves.toMatchObject({ shown: false });
  });
});

describe("requestNotificationPermission (issue 13)", () => {
  it("returns denied when the API is missing", async () => {
    vi.stubGlobal("Notification", undefined);
    await expect(requestNotificationPermission()).resolves.toBe("denied");
  });
});
