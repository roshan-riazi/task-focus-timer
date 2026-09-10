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

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    taskId: null,
    taskTitleSnapshot: "Write launch notes",
    categorySnapshot: "Writing",
    intervalType: "focus",
    status: "completed",
    plannedDurationSeconds: 1500,
    actualDurationSeconds: 1500,
    startedAt: "2026-09-10T07:15:00.000Z",
    expectedEndAt: "2026-09-10T07:40:00.000Z",
    completedAt: "2026-09-10T07:40:00.000Z",
    cancelledAt: null,
    ...overrides,
  };
}

import { HistoryPanel } from "./history-panel";

/**
 * Seam: `<HistoryPanel />` over stubbed `fetch` (spec §8.8, prototype
 * `history.html`). Behavior only — filters, rows, deleted-task snapshots,
 * pagination, empty/error states — never implementation internals.
 */
describe("<HistoryPanel /> (spec §8.8)", () => {
  it("announces loading, then renders one row per session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            sessions: [
              sessionRow(),
              sessionRow({
                id: "22222222-2222-4222-8222-222222222222",
                taskTitleSnapshot: null,
                intervalType: "short_break",
                actualDurationSeconds: 300,
                plannedDurationSeconds: 300,
              }),
            ],
            nextCursor: null,
          },
          200,
        ),
      ),
    );
    render(<HistoryPanel />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading history/i);
    const table = await screen.findByRole("table", {
      name: /recent intervals/i,
    });
    const rows = within(table).getAllByRole("row");
    // Header + two sessions.
    expect(rows).toHaveLength(3);
    expect(table).toHaveTextContent(/write launch notes/i);
    expect(table).toHaveTextContent(/unassigned/i);
    expect(table).toHaveTextContent(/short break/i);
  });

  it("shows the completion or cancellation time per row (spec §8.8)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            sessions: [
              sessionRow(),
              sessionRow({
                id: "22222222-2222-4222-8222-222222222222",
                status: "cancelled",
                actualDurationSeconds: null,
                cancelledAt: "2026-09-10T07:20:00.000Z",
                completedAt: null,
              }),
            ],
            nextCursor: null,
          },
          200,
        ),
      ),
    );
    render(<HistoryPanel />);
    const table = await screen.findByRole("table", {
      name: /recent intervals/i,
    });
    expect(
      within(table).getByRole("columnheader", { name: /^ended$/i }),
    ).toBeInTheDocument();
    expect(table.querySelector('time[dateTime="2026-09-10T07:40:00.000Z"]')).not.toBeNull();
    expect(table.querySelector('time[dateTime="2026-09-10T07:20:00.000Z"]')).not.toBeNull();
  });

  it("marks completed-early and cancelled rows in text, not color alone", async () => {    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            sessions: [
              sessionRow({ actualDurationSeconds: 1080 }),
              sessionRow({
                id: "22222222-2222-4222-8222-222222222222",
                status: "cancelled",
                actualDurationSeconds: null,
                cancelledAt: "2026-09-10T07:20:00.000Z",
                completedAt: null,
              }),
            ],
            nextCursor: null,
          },
          200,
        ),
      ),
    );
    render(<HistoryPanel />);
    const table = await screen.findByRole("table", {
      name: /recent intervals/i,
    });
    expect(table).toHaveTextContent(/completed early/i);
    expect(table).toHaveTextContent(/cancelled/i);
  });

  it("keeps deleted-task sessions legible through their snapshots", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            // The task row is gone server-side (taskId nulled on delete);
            // the snapshot still names the work.
            sessions: [
              sessionRow({
                taskId: null,
                taskTitleSnapshot: "Old task (deleted)",
              }),
            ],
            nextCursor: null,
          },
          200,
        ),
      ),
    );
    render(<HistoryPanel />);
    const table = await screen.findByRole("table", {
      name: /recent intervals/i,
    });
    expect(table).toHaveTextContent(/old task \(deleted\)/i);
  });

  it("switches filters with the keyboard and refetches", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return jsonResponse({ sessions: [], nextCursor: null }, 200);
      }),
    );
    render(<HistoryPanel />);
    await screen.findByText(/no intervals in the last 7 days/i);

    await user.click(screen.getByRole("radio", { name: /^today$/i }));
    expect(await screen.findByText(/no intervals today/i)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /^focus only$/i }));
    expect(calls[calls.length - 1]).toContain("type=focus");
    expect(calls[calls.length - 1]).toContain("period=today");
  });

  it("guides action from the focus-only empty state", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ sessions: [], nextCursor: null }, 200),
      ),
    );
    render(<HistoryPanel />);
    await screen.findByText(/no intervals in the last 7 days/i);
    await user.click(screen.getByRole("radio", { name: /^focus only$/i }));
    expect(
      await screen.findByText(/switch to all types to include breaks/i),
    ).toBeInTheDocument();
  });

  it("appends the next page on demand and announces it", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const query = new URL(url, "https://app.example").searchParams;
        if (query.get("cursor") === "page-2") {
          return jsonResponse(
            {
              sessions: [
                sessionRow({
                  id: "22222222-2222-4222-8222-222222222222",
                  taskTitleSnapshot: "Review pull requests",
                }),
              ],
              nextCursor: null,
            },
            200,
          );
        }
        return jsonResponse(
          { sessions: [sessionRow()], nextCursor: "page-2" },
          200,
        );
      }),
    );
    render(<HistoryPanel />);
    await screen.findByText("Write launch notes");
    await user.click(
      screen.getByRole("button", { name: /load more sessions/i }),
    );
    expect(await screen.findByText("Review pull requests")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/loaded 1 more/i);
  });

  it("retries a failed list without losing the filters", async () => {
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
        return jsonResponse({ sessions: [], nextCursor: null }, 200);
      }),
    );
    render(<HistoryPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /something went wrong/i,
    );
    await user.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(
      await screen.findByText(/no intervals in the last 7 days/i),
    ).toBeInTheDocument();
  });
});
