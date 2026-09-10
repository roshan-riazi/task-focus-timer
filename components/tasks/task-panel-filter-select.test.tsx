import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

/** Routes list calls by ?status=… so filter changes are observable. */
function stubTaskServer(initial: Record<string, unknown[]>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url);
    const status = new URL(url, "https://app.example").searchParams.get("status");
    return jsonResponse(
      { tasks: initial[status ?? "active"] ?? [], nextCursor: null },
      200,
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

import { TaskPanel, SELECTED_TASK_KEY } from "./task-panel";

describe("<TaskPanel /> filters (slice 3)", () => {
  it("defaults to Active and switches to Completed on demand", async () => {
    const user = userEvent.setup();
    const calls = stubTaskServer({
      active: [taskRow()],
      completed: [
        taskRow({
          id: "33333333-3333-4333-8333-333333333333",
          title: "Done yesterday",
          status: "completed",
        }),
      ],
      archived: [],
      all: [],
    });
    render(<TaskPanel />);
    await screen.findByText(/write launch notes/i);
    expect(calls[0]).toContain("status=active");

    await user.click(screen.getByRole("radio", { name: /completed/i }));
    expect(await screen.findByText(/done yesterday/i)).toBeInTheDocument();
    expect(calls.some((url) => url.includes("status=completed"))).toBe(true);
  });

  it("explains each empty filter in words", async () => {
    const user = userEvent.setup();
    stubTaskServer({ active: [], completed: [], archived: [], all: [] });
    render(<TaskPanel />);
    expect(await screen.findByText(/no active tasks yet/i)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /completed/i }));
    expect(await screen.findByText(/no completed tasks yet/i)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /archived/i }));
    expect(await screen.findByText(/no archived tasks/i)).toBeInTheDocument();
  });

  it("keeps quick-add visible while a non-active filter is shown", async () => {
    const user = userEvent.setup();
    stubTaskServer({ active: [], completed: [], archived: [], all: [] });
    render(<TaskPanel />);
    await screen.findByText(/no active tasks yet/i);
    await user.click(screen.getByRole("radio", { name: /completed/i }));
    await screen.findByText(/no completed tasks yet/i);
    expect(
      screen.getByRole("textbox", { name: /new task title/i }),
    ).toBeInTheDocument();
  });
});

describe("<TaskPanel /> select-for-focus (slice 3)", () => {
  it("marks one task selected, announces it, and notifies the workspace", async () => {
    const user = userEvent.setup();
    stubTaskServer({ active: [taskRow()], completed: [], archived: [], all: [] });
    const onSelectionChange = vi.fn();
    render(<TaskPanel onSelectionChange={onSelectionChange} />);
    await screen.findByText(/write launch notes/i);

    await user.click(
      screen.getByRole("button", { name: /select .* for focus/i }),
    );
    const selected = screen.getByRole("button", { name: /selected for focus/i });
    expect(selected).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/selected for focus/i);
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: taskRow().id }),
    );
    // Remembered across reloads: the workspace timer slot reads the same key.
    expect(window.localStorage.getItem(SELECTED_TASK_KEY)).toBe(taskRow().id);
  });

  it("restores the remembered selection on mount", async () => {
    window.localStorage.setItem(SELECTED_TASK_KEY, taskRow().id);
    stubTaskServer({ active: [taskRow()], completed: [], archived: [], all: [] });
    const onSelectionChange = vi.fn();
    render(<TaskPanel onSelectionChange={onSelectionChange} />);
    expect(
      await screen.findByRole("button", { name: /selected for focus/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: taskRow().id }),
    );
  });

  it("reaches quick-add, filters, and selection by keyboard alone", async () => {
    const user = userEvent.setup();
    stubTaskServer({ active: [taskRow()], completed: [], archived: [], all: [] });
    render(<TaskPanel />);
    await screen.findByText(/write launch notes/i);

    await user.tab();
    expect(
      screen.getByRole("textbox", { name: /new task title/i }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: /^add$/i })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("radio", { name: /active/i })).toHaveFocus();
  });

  it("forgets a remembered id that is no longer an active task", async () => {
    // Completed elsewhere (or on another device): the stored id can never
    // back a focus interval, so the panel clears it instead of carrying a
    // phantom selection the workspace would show.
    window.localStorage.setItem(SELECTED_TASK_KEY, "missing-task-id");
    stubTaskServer({ active: [taskRow()], completed: [], archived: [], all: [] });
    const onSelectionChange = vi.fn();
    render(<TaskPanel onSelectionChange={onSelectionChange} />);
    await screen.findByText(/write launch notes/i);
    await screen.findByRole("list", { name: /tasks/i });
    expect(window.localStorage.getItem(SELECTED_TASK_KEY)).toBeNull();
    expect(onSelectionChange).toHaveBeenCalledWith(null);
    expect(
      screen.queryByRole("button", { name: /selected for focus/i }),
    ).not.toBeInTheDocument();
  });
});
