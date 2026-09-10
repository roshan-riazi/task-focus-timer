import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

const T0 = Date.parse("2026-09-10T12:00:00.000Z");

function sampleSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    taskId: null,
    taskTitleSnapshot: null,
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

import { TimerPanel } from "./timer-panel";

function mockNow(at: number) {
  vi.spyOn(Date, "now").mockReturnValue(at);
}

describe("<TimerPanel /> (issue 12)", () => {
  it("announces loading, then offers to start when idle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(sampleCurrent(), 200)),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading timer/i);
    expect(
      await screen.findByRole("button", { name: /start focus/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/loading timer/i)).not.toBeInTheDocument();
  });

  it("restores a running interval on mount with timestamp-derived display", async () => {
    mockNow(T0 + 32_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(sampleCurrent({ session: sampleSession() }), 200)),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    // 1500 - 32 = 1468s = 24:28, derived from stamps — not a local counter.
    expect(await screen.findByText("24:28")).toBeInTheDocument();
    const ring = screen.getByRole("progressbar", { name: /progress/i });
    expect(ring).toHaveAttribute("aria-valuemin", "0");
    expect(ring).toHaveAttribute("aria-valuemax", "100");
    expect(ring).toHaveAttribute("aria-valuenow", "2");
    expect(screen.getByRole("button", { name: /^pause$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /complete early/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
  });

  it("hides the ticking clock from announcements but announces state", async () => {
    mockNow(T0 + 32_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(sampleCurrent({ session: sampleSession() }), 200)),
    );
    const { rerender } = render(
      <TimerPanel selectedTask={null} tickMs={60_000} />,
    );
    await screen.findByText("24:28");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/running/i);
    const announced = status.textContent;
    // Five seconds pass: the clock re-renders from the new stamp…
    mockNow(T0 + 37_000);
    rerender(<TimerPanel selectedTask={null} tickMs={60_000} />);
    expect(await screen.findByText("24:23")).toBeInTheDocument();
    // …but the live region stays silent (spec §12.3: no per-tick chatter).
    expect(screen.getByRole("status").textContent).toBe(announced);
  });

  it("freezes the display while paused and offers resume", async () => {
    mockNow(T0 + 600_000);
    const paused = sampleSession({
      status: "paused",
      pausedAt: "2026-09-10T12:10:00.000Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(sampleCurrent({ session: paused }), 200)),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    // Frozen at pausedAt: 1500 - 600 = 900s = 15:00, not wall-clock.
    expect(await screen.findByText("15:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^resume$/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/paused/i);
    expect(screen.queryByRole("button", { name: /^pause$/i })).not.toBeInTheDocument();
  });

  it("starts a focus interval linked to the selected task", async () => {
    const user = userEvent.setup();
    mockNow(T0 + 32_000);
    const seen: Array<{ url: string; body: unknown }> = [];
    const running = sampleSession({ taskId: "task-1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/timer/current")
          return jsonResponse(sampleCurrent(), 200);
        seen.push({ url, body: JSON.parse(init?.body as string) });
        return jsonResponse({ session: running }, 201);
      }),
    );
    render(
      <TimerPanel
        selectedTask={{ id: "task-1", title: "Write launch notes" }}
        tickMs={60_000}
      />,
    );
    await user.click(await screen.findByRole("button", { name: /start focus/i }));
    await screen.findByRole("button", { name: /^pause$/i });
    expect(seen).toEqual([
      {
        url: "/api/timer/start",
        body: { intervalType: "focus", taskId: "task-1" },
      },
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(/started/i);
  });

  it("pauses and resumes a running interval", async () => {
    const user = userEvent.setup();
    const running = sampleSession();
    const paused = sampleSession({
      status: "paused",
      pausedAt: "2026-09-10T12:05:00.000Z",
    });
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === "/api/timer/current")
          return jsonResponse(sampleCurrent({ session: running }), 200);
        if (url === "/api/timer/pause")
          return jsonResponse({ session: paused }, 200);
        return jsonResponse({ session: running }, 200);
      }),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    await user.click(await screen.findByRole("button", { name: /^pause$/i }));
    expect(await screen.findByRole("button", { name: /^resume$/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/paused/i);
    await user.click(screen.getByRole("button", { name: /^resume$/i }));
    expect(await screen.findByRole("button", { name: /^pause$/i })).toBeInTheDocument();
    expect(calls).toContain("/api/timer/pause");
    expect(calls).toContain("/api/timer/resume");
  });

  it("offers skip-break for breaks, never for focus", async () => {
    mockNow(T0);
    const shortBreak = sampleSession({
      intervalType: "short_break",
      plannedDurationSeconds: 300,
      expectedEndAt: "2026-09-10T12:05:00.000Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(sampleCurrent({ session: shortBreak }), 200)),
    );
    const { unmount } = render(
      <TimerPanel selectedTask={null} tickMs={60_000} />,
    );
    expect(
      await screen.findByRole("button", { name: /skip break/i }),
    ).toBeInTheDocument();
    unmount();

    vi.unstubAllGlobals();
    globalThis.fetch = realFetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(sampleCurrent({ session: sampleSession() }), 200)),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    await screen.findByRole("button", { name: /^pause$/i });
    expect(
      screen.queryByRole("button", { name: /skip break/i }),
    ).not.toBeInTheDocument();
  });

  it("reconciles on visibility change (hidden-tab return corrects the display)", async () => {
    mockNow(T0 + 32_000);
    let current = sampleCurrent({ session: sampleSession() });
    const fetchMock = vi.fn(async () => jsonResponse(current, 200));
    vi.stubGlobal("fetch", fetchMock);
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    await screen.findByText("24:28");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Two minutes pass on a hidden tab; becoming visible refetches and the
    // timestamp-derived display corrects (spec §12.1: within one second —
    // the fetch fires synchronously on the visibility event).
    current = sampleCurrent({ session: sampleSession() });
    mockNow(T0 + 152_000);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // 1500 - 152 = 1348s = 22:28.
    expect(await screen.findByText("22:28")).toBeInTheDocument();
  });

  it("auto-reconciles at expiry within the grace window", async () => {
    mockNow(T0 + 1_500_000 + 60_000);
    const reconciled = sampleSession({
      status: "completed",
      actualDurationSeconds: 1500,
    });
    const autoStarted = sampleSession({
      id: "33333333-3333-4333-8333-333333333333",
      intervalType: "short_break",
      status: "running",
      plannedDurationSeconds: 300,
      startedAt: "2026-09-10T12:26:00.000Z",
      expectedEndAt: "2026-09-10T12:31:00.000Z",
    });
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls += 1;
        if (url === "/api/timer/current" && calls === 1)
          return jsonResponse(sampleCurrent({ session: sampleSession() }), 200);
        return jsonResponse(
          sampleCurrent({
            session: autoStarted,
            reconciled,
            autoStarted,
            cycle: { completedFocusCount: 1, intervalsBeforeLongBreak: 4 },
            next: null,
          }),
          200,
        );
      }),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
    // Server auto-finalized within the grace window (spec §8.4): the
    // reconciled notice shows once, and the live region announces it —
    // asserted separately since both contain "completed".
    expect(await screen.findByText(/counted once in history/i)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/complet/i);
  });

  it("shows the reconciled notice when auto-start leaves the idle post-state", async () => {
    // Auto-start off: the grace-window reconcile finalizes with no follow-up
    // session, so the notice must render in the idle branch too — not only
    // beside a running interval.
    const reconciled = sampleSession({
      status: "completed",
      actualDurationSeconds: 1500,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          sampleCurrent({
            session: null,
            reconciled,
            cycle: { completedFocusCount: 1, intervalsBeforeLongBreak: 4 },
            next: { intervalType: "short_break" },
          }),
          200,
        ),
      ),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    expect(
      await screen.findByText(/counted once in history/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/reconciled/i);
    // The idle picker adopts the server `next` proposal in a post-render
    // effect — wait for it rather than asserting synchronously. Issue 13's
    // reconcile feedback (lazy settings read + alarm attempt) adds async
    // work to this path, widening the race the sync query always had.
    expect(
      await screen.findByRole("button", { name: /start short break/i }),
    ).toBeInTheDocument();
  });

  it("prompts Complete/Discard when expiry is past the confirm window", async () => {
    const user = userEvent.setup();
    mockNow(T0 + 1_500_000 + 7_200_000);
    const expired = sampleSession();
    const pending = {
      session: expired,
      overdueSeconds: 7200,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/timer/current")
          return jsonResponse(sampleCurrent({ session: expired, pendingConfirmation: pending }), 200);
        if (url === "/api/timer/complete")
          return jsonResponse(
            {
              session: { ...expired, status: "completed" },
              autoStarted: null,
              cycle: { completedFocusCount: 1, intervalsBeforeLongBreak: 4 },
              next: { intervalType: "short_break" },
            },
            200,
          );
        throw new Error(`unexpected ${url}`);
      }),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    const dialog = await screen.findByRole("dialog", {
      name: /finish the expired interval/i,
    });
    expect(
      within(dialog).getByRole("button", { name: /complete.*count 25 min/i }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /^discard$/i }),
    ).toBeInTheDocument();
    // Focus moves into the dialog for keyboard users (spec §12.3).
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    await user.click(
      within(dialog).getByRole("button", { name: /complete.*count 25 min/i }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent(/complet/i);
  });

  it("shows only the dialog while expiry confirmation is pending", async () => {
    // Spec §8.4: beyond the grace window the interval finalizes ONLY via
    // explicit Complete/Discard — no background transition may slip in.
    mockNow(T0 + 1_500_000 + 7_200_000);
    const expired = sampleSession();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          sampleCurrent({
            session: expired,
            pendingConfirmation: { session: expired, overdueSeconds: 7200 },
          }),
          200,
        ),
      ),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    await screen.findByRole("dialog", {
      name: /finish the expired interval/i,
    });
    expect(
      screen.queryByRole("button", { name: /^pause$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /complete early/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^cancel$/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("discards the expired interval without counting minutes", async () => {
    const user = userEvent.setup();
    mockNow(T0 + 1_500_000 + 7_200_000);
    const expired = sampleSession();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === "/api/timer/current")
          return jsonResponse(
            sampleCurrent({
              session: expired,
              pendingConfirmation: { session: expired, overdueSeconds: 7200 },
            }),
            200,
          );
        return jsonResponse(
          {
            session: { ...expired, status: "cancelled" },
            autoStarted: null,
            cycle: { completedFocusCount: 0, intervalsBeforeLongBreak: 4 },
            next: { intervalType: "focus" },
          },
          200,
        );
      }),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    const dialog = await screen.findByRole("dialog", {
      name: /finish the expired interval/i,
    });
    await user.click(within(dialog).getByRole("button", { name: /^discard$/i }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(calls).toContain("/api/timer/cancel");
    expect(screen.getByRole("status")).toHaveTextContent(/discard/i);
  });

  it("retries after a failed load", async () => {
    const user = userEvent.setup();
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1)
          return jsonResponse(
            { error: { code: "REQUEST_FAILED", message: "Something went wrong." } },
            500,
          );
        return jsonResponse(sampleCurrent(), 200);
      }),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/something went wrong/i);
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(
      await screen.findByRole("button", { name: /start focus/i }),
    ).toBeInTheDocument();
  });

  it("exposes the ring without motion for reduced-motion users", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(sampleCurrent({ session: sampleSession() }), 200)),
    );
    render(<TimerPanel selectedTask={null} tickMs={60_000} />);
    const ring = await screen.findByRole("progressbar", { name: /progress/i });
    const prog = ring.querySelector("circle[data-ring-progress]");
    expect(prog).not.toBeNull();
    // Tailwind reduced-motion variant: the 1s sweep transition disables
    // under `prefers-reduced-motion: reduce` (prototype rule, spec §12.3).
    expect(prog?.getAttribute("class") ?? "").toMatch(/motion-reduce:transition-none/);
  });
});
