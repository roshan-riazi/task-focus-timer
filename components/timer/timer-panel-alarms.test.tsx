import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CANARY_TASK_TITLE } from "@/tests/canary";

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

function sampleSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    taskId: null,
    taskTitleSnapshot: CANARY_TASK_TITLE,
    categorySnapshot: null,
    intervalType: "focus",
    status: "running",
    plannedDurationSeconds: 1500,
    actualDurationSeconds: null,
    startedAt: "2026-09-10T12:00:00.000Z",
    expectedEndAt: "2026-09-10T12:25:00.000Z",
    pausedAt: null,
    accumulatedPauseSeconds: 0,
    completedAt: null,
    cancelledAt: null,
    createdAt: "2026-09-10T12:00:00.000Z",
    updatedAt: "2026-09-10T12:00:00.000Z",
    ...overrides,
  };
}

function sampleCurrent(overrides: Record<string, unknown> = {}) {
  return {
    session: null,
    reconciled: null,
    pendingConfirmation: null,
    autoStarted: null,
    cycle: { completedFocusCount: 0, intervalsBeforeLongBreak: 4 },
    next: null,
    ...overrides,
  };
}

function sampleSettings(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      focusDurationSeconds: 1500,
      shortBreakSeconds: 300,
      longBreakSeconds: 900,
      intervalsBeforeLongBreak: 4,
      autoStartBreaks: false,
      autoStartFocus: false,
      soundEnabled: true,
      soundPreset: "bell",
      soundVolume: 42,
      notificationsEnabled: true,
      timezone: "UTC",
      updatedAt: "2026-09-10T12:00:00.000Z",
      ...overrides,
    },
  };
}

vi.mock("@/lib/alarms/player", () => ({
  ensureAudioUnlocked: vi.fn(async () => undefined),
  playAlarm: vi.fn(async () => ({ played: true, reason: "played" })),
}));

vi.mock("@/lib/notifications/notify", () => ({
  notifyIntervalComplete: vi.fn(async () => ({ shown: true, reason: "shown" })),
  getNotificationContent: vi.fn((moment: string) => ({
    title: moment === "focus-end" ? "Focus interval complete" : "Break over",
    body: "test",
  })),
  requestNotificationPermission: vi.fn(async () => "granted" as const),
}));

import { TimerPanel } from "./timer-panel";
import { ensureAudioUnlocked, playAlarm } from "@/lib/alarms/player";
import { notifyIntervalComplete } from "@/lib/notifications/notify";

/**
 * Issue 13 integration: the timer plays the correct preset at the set
 * volume on each finalize moment and notifies — task titles never reach
 * audio/notification payloads, denial degrades to silent + visual.
 */
describe("<TimerPanel /> alarms + notifications (issue 13)", () => {
  it("unlocks audio on the start gesture", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/settings") return jsonResponse(sampleSettings(), 200);
        if (url === "/api/timer/current")
          return jsonResponse(sampleCurrent(), 200);
        return jsonResponse({ session: sampleSession() }, 201);
      }),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    await user.click(await screen.findByRole("button", { name: /start focus/i }));
    await screen.findByRole("button", { name: /^pause$/i });
    expect(ensureAudioUnlocked).toHaveBeenCalled();
  });

  it("plays the focus-end preset at the set volume + notifies on grace reconcile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/settings") return jsonResponse(sampleSettings(), 200);
        const reconciled = sampleSession({
          status: "completed",
          actualDurationSeconds: 1500,
        });
        return jsonResponse(
          sampleCurrent({
            session: null,
            reconciled,
            cycle: { completedFocusCount: 1, intervalsBeforeLongBreak: 4 },
            next: { intervalType: "short_break" },
          }),
          200,
        );
      }),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    expect(await screen.findByText(/counted once in history/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(playAlarm).toHaveBeenCalledWith({
        preset: "bell",
        moment: "focus-end",
        volume: 42,
        soundEnabled: true,
      }),
    );
    await waitFor(() =>
      expect(notifyIntervalComplete).toHaveBeenCalledWith("focus-end", {
        notificationsEnabled: true,
      }),
    );
    // Privacy: the canary task title in the session snapshot never reaches
    // audio/notification payloads.
    for (const call of [
      ...(playAlarm as unknown as { mock: { calls: unknown[][] } }).mock.calls,
      ...(notifyIntervalComplete as unknown as { mock: { calls: unknown[][] } })
        .mock.calls,
    ]) {
      expect(JSON.stringify(call)).not.toContain(CANARY_TASK_TITLE);
    }
  });

  it("plays the distinct break-end pattern when a break completes", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/settings") return jsonResponse(sampleSettings(), 200);
        if (url === "/api/timer/current") {
          return jsonResponse(
            sampleCurrent({
              session: sampleSession({
                intervalType: "short_break",
                plannedDurationSeconds: 300,
                expectedEndAt: "2026-09-10T12:05:00.000Z",
              }),
            }),
            200,
          );
        }
        const done = sampleSession({
          intervalType: "short_break",
          status: "completed",
          actualDurationSeconds: 300,
        });
        return jsonResponse(
          {
            session: done,
            autoStarted: null,
            cycle: { completedFocusCount: 0, intervalsBeforeLongBreak: 4 },
            next: { intervalType: "focus" },
          },
          200,
        );
      }),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    await user.click(
      await screen.findByRole("button", { name: /complete early/i }),
    );
    await waitFor(() =>
      expect(playAlarm).toHaveBeenCalledWith(
        expect.objectContaining({ moment: "break-end" }),
      ),
    );
    await waitFor(() =>
      expect(notifyIntervalComplete).toHaveBeenCalledWith(
        "break-end",
        expect.anything(),
      ),
    );
  });

  it("stays silent on cancel/discard — no alarm, no notification", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/settings") return jsonResponse(sampleSettings(), 200);
        if (url === "/api/timer/current")
          return jsonResponse(sampleCurrent({ session: sampleSession() }), 200);
        const cancelled = sampleSession({ status: "cancelled" });
        return jsonResponse(
          {
            session: cancelled,
            autoStarted: null,
            cycle: { completedFocusCount: 0, intervalsBeforeLongBreak: 4 },
            next: { intervalType: "focus" },
          },
          200,
        );
      }),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    await user.click(await screen.findByRole("button", { name: /^cancel$/i }));
    await screen.findByText(/cancelled/i);
    expect(playAlarm).not.toHaveBeenCalled();
    expect(notifyIntervalComplete).not.toHaveBeenCalled();
  });

  it("degrades to silent + visual when notification permission is denied", async () => {
    vi.mocked(notifyIntervalComplete).mockResolvedValueOnce({
      shown: false,
      reason: "denied",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/settings") return jsonResponse(sampleSettings(), 200);
        const reconciled = sampleSession({
          status: "completed",
          actualDurationSeconds: 1500,
        });
        return jsonResponse(
          sampleCurrent({
            session: null,
            reconciled,
            cycle: { completedFocusCount: 1, intervalsBeforeLongBreak: 4 },
            next: { intervalType: "short_break" },
          }),
          200,
        );
      }),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    // Visual path still announces — denial never breaks the finalize flow.
    expect(await screen.findByText(/counted once in history/i)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/reconciled/i);
  });
});
