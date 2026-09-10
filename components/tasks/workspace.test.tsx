import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const realFetch = globalThis.fetch;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Write launch notes",
    notes: null,
    category: null,
    status: "active",
    position: 1000,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    completedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

import { Workspace } from "./workspace";

function stubList(rows: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({ tasks: rows, nextCursor: null }, 200)),
  );
}

describe("<Workspace /> focus page (slice 5)", () => {
  it("pairs the task list with a timer placeholder and no-selection prompt", async () => {
    stubList([taskRow()]);
    render(<Workspace />);
    expect(
      await screen.findByRole("heading", { name: /^focus$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /tasks/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/select a task to line up your next focus/i),
    ).toBeInTheDocument();
  });

  it("shows the selected task in the timer slot", async () => {
    const user = userEvent.setup();
    stubList([taskRow()]);
    render(<Workspace />);
    await screen.findByText(/write launch notes/i);

    await user.click(
      screen.getByRole("button", { name: /select .* for focus/i }),
    );
    expect(
      await screen.findByRole("heading", { name: /focus · write launch notes/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/select a task to line up your next focus/i),
    ).not.toBeInTheDocument();
  });

  it("keeps tasks first in DOM order with the timer visually first on mobile", async () => {
    stubList([taskRow()]);
    render(<Workspace />);
    const tasks = await screen.findByRole("complementary", { name: /^tasks$/i });
    const timer = screen.getByRole("region", { name: /^focus/i });
    expect(
      tasks.compareDocumentPosition(timer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Prototype rule (workspace.html): `.timer{order:-1}` below 46rem, so
    // the timer appears first on narrow screens while DOM order stays
    // tasks-first for a stable keyboard sequence.
    expect(timer.className).toMatch(/order-first/);
  });

  it("exposes the task list as a complementary landmark", async () => {
    stubList([]);
    render(<Workspace />);
    await screen.findByText(/no active tasks yet/i);
    const tasks = screen.getByRole("complementary", { name: /^tasks$/i });
    expect(tasks.tagName).toBe("ASIDE");
  });
});
