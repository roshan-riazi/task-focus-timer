import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

function summaryResponse(overrides: Record<string, unknown> = {}) {
  return {
    period: "7d",
    timezone: "Europe/Berlin",
    window: {
      from: "2026-09-04T00:00:00.000Z",
      to: "2026-09-10T12:00:00.000Z",
    },
    totals: {
      completedFocusMinutes: 370,
      completedFocusIntervals: 15,
      cancelledFocusIntervals: 2,
      completedTasks: 3,
      completionRate: 15 / 17,
      averageCompletedSeconds: 1480,
    },
    daily: [
      { date: "2026-09-04", minutes: 45, intervals: 2 },
      { date: "2026-09-05", minutes: 70, intervals: 3 },
      { date: "2026-09-06", minutes: 30, intervals: 1 },
      { date: "2026-09-07", minutes: 90, intervals: 4 },
      { date: "2026-09-08", minutes: 55, intervals: 2 },
      { date: "2026-09-09", minutes: 20, intervals: 1 },
      { date: "2026-09-10", minutes: 60, intervals: 2 },
    ],
    byTask: [
      { taskId: "task-1", title: "Write launch notes", minutes: 140, intervals: 6 },
      { taskId: null, title: null, minutes: 130, intervals: 5 },
    ],
    byCategory: [
      { category: "Writing", minutes: 140, intervals: 6 },
      { category: null, minutes: 130, intervals: 5 },
    ],
    ...overrides,
  };
}

import { AnalyticsPanel } from "./analytics-panel";

/**
 * Seam: `<AnalyticsPanel />` over stubbed `fetch` (spec §8.9, prototype
 * `analytics.html`). Behavior only — metric cards, SVG bars with their
 * table equivalent, ranked lists, empty states — never internals.
 */
describe("<AnalyticsPanel /> (spec §8.9)", () => {
  it("announces loading, then renders every required metric", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(summaryResponse(), 200)),
    );
    render(<AnalyticsPanel />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading analytics/i);
    const metrics = await screen.findByRole("group", {
      name: /focus metrics/i,
    });
    expect(metrics).toHaveTextContent(/370 focus minutes/i);
    expect(metrics).toHaveTextContent(/15.*focus intervals/i);
    expect(metrics).toHaveTextContent(/3.*tasks/i);
    expect(metrics).toHaveTextContent(/88% completion/i);
  });

  it("pairs the SVG bars with a full table equivalent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(summaryResponse(), 200)),
    );
    render(<AnalyticsPanel />);
    const chart = await screen.findByRole("img", {
      name: /bar chart of focus minutes/i,
    });
    // The accessible name carries the data, not just the shape.
    expect(chart.getAttribute("aria-label")).toMatch(/2026-09-07 90/);
    const table = screen.getByRole("table", {
      name: /daily focus minutes/i,
    });
    for (const minutes of [45, 70, 30, 90, 55, 20, 60]) {
      expect(table).toHaveTextContent(String(minutes));
    }
    // One bar per day.
    expect(chart.querySelectorAll("rect")).toHaveLength(7);
  });

  it("renders ranked lists with Unassigned/Uncategorized fallbacks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(summaryResponse(), 200)),
    );
    render(<AnalyticsPanel />);
    const byTask = await screen.findByRole("table", {
      name: /focus minutes grouped by task/i,
    });
    expect(byTask).toHaveTextContent(/write launch notes/i);
    expect(byTask).toHaveTextContent(/unassigned/i);
    const byCategory = screen.getByRole("table", {
      name: /focus minutes grouped by category/i,
    });
    expect(byCategory).toHaveTextContent(/writing/i);
    expect(byCategory).toHaveTextContent(/uncategorized/i);
    // Ranked minutes-desc: the 140-minute row precedes the 130 one.
    const taskRows = within(byTask).getAllByRole("row");
    expect(taskRows[1]).toHaveTextContent(/write launch notes/i);
  });

  it("explains empty analytics instead of rendering zeros alone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          summaryResponse({
            totals: {
              completedFocusMinutes: 0,
              completedFocusIntervals: 0,
              cancelledFocusIntervals: 0,
              completedTasks: 0,
              completionRate: null,
              averageCompletedSeconds: null,
            },
            daily: [],
            byTask: [],
            byCategory: [],
          }),
          200,
        ),
      ),
    );
    render(<AnalyticsPanel />);
    expect(
      await screen.findByText(/no completed focus yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/complete a focus interval and it shows up here/i),
    ).toBeInTheDocument();
  });

  it("guides action when categories are empty but tasks are not", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(summaryResponse({ byCategory: [] }), 200),
      ),
    );
    render(<AnalyticsPanel />);
    await screen.findByRole("table", {
      name: /focus minutes grouped by task/i,
    });
    expect(
      screen.getByText(/add a category to a task/i),
    ).toBeInTheDocument();
  });

  it("uses period-aware empty copy for the task list", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          summaryResponse({
            totals: {
              completedFocusMinutes: 0,
              completedFocusIntervals: 0,
              cancelledFocusIntervals: 0,
              completedTasks: 0,
              completionRate: null,
              averageCompletedSeconds: null,
            },
            daily: [],
            byTask: [],
            byCategory: [],
          }),
          200,
        ),
      ),
    );
    render(<AnalyticsPanel />);
    await screen.findByText(/no completed tasks this week yet/i);
    await user.click(screen.getByRole("radio", { name: /^today$/i }));
    expect(
      await screen.findByText(/no completed tasks today yet/i),
    ).toBeInTheDocument();
  });

  it("switches periods with the keyboard and refetches", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return jsonResponse(summaryResponse(), 200);
      }),
    );
    render(<AnalyticsPanel />);
    await screen.findByRole("table", { name: /daily focus minutes/i });
    await user.click(screen.getByRole("radio", { name: /^today$/i }));
    await screen.findByText(/analytics — today/i);
    expect(calls[calls.length - 1]).toContain("period=today");
  });

  it("retries a failed summary", async () => {
    const user = userEvent.setup();
    let failNext = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (failNext) {
          failNext = false;
          return jsonResponse(
            { error: { code: "REQUEST_FAILED", message: "Something went wrong." } },
            500,
          );
        }
        return jsonResponse(summaryResponse(), 200);
      }),
    );
    render(<AnalyticsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /something went wrong/i,
    );
    await user.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(
      await screen.findByRole("table", { name: /daily focus minutes/i }),
    ).toBeInTheDocument();
  });
});
