import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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

type Row = Record<string, unknown> & { id: string; title: string; status: string };

function makeRow(overrides: Partial<Row> & { id: string }): Row {
  return {
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

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

/**
 * In-memory task server: list/create/update/complete/reopen/delete/reorder
 * with the same shapes as /api/tasks. `locked` ids answer 409 like a task
 * backing a running interval (spec §8.2, `TASK_LOCKED_BY_TIMER`).
 */
function stubCrudServer(seed: Row[], locked: string[] = []) {
  let tasks = seed.map((row) => ({ ...row }));
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    let body: unknown = null;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      body = null;
    }
    calls.push({ method, url, body });
    const path = new URL(url, "https://app.example").pathname;
    if (path === "/api/tasks" && method === "GET") {
      const status = new URL(url, "https://app.example").searchParams.get("status");
      const rows =
        status === "all"
          ? tasks
          : tasks.filter((task) => task.status === status);
      return jsonResponse({ tasks: rows, nextCursor: null }, 200);
    }
    if (path === "/api/tasks" && method === "POST") {
      const created = makeRow({
        id: `created-${tasks.length}`,
        title: (body as { title: string }).title,
        position: tasks.length * 1000 + 1000,
      });
      tasks.push(created);
      return jsonResponse({ task: created }, 201);
    }
    if (path === "/api/tasks/reorder" && method === "POST") {
      const ids = (body as { taskIds: string[] }).taskIds;
      const order = new Map(ids.map((id, index) => [id, (index + 1) * 1000]));
      tasks = tasks
        .map((task) => ({ ...task, position: order.get(task.id) ?? task.position }))
        .sort((a, b) => (a.position as number) - (b.position as number));
      return jsonResponse({ tasks }, 200);
    }
    const match = path.match(/^\/api\/tasks\/([^/]+)(\/(complete|reopen))?$/);
    if (match) {
      const [, id, , action] = match;
      const task = tasks.find((row) => row.id === id);
      if (!task) {
        return jsonResponse(
          { error: { code: "NOT_FOUND", message: "Not found." } },
          404,
        );
      }
      if (method !== "GET" && locked.includes(id)) {
        return jsonResponse(
          {
            error: {
              code: "TASK_LOCKED_BY_TIMER",
              message:
                "Finish or cancel the current interval before changing this task.",
            },
          },
          409,
        );
      }
      if (action === "complete") {
        Object.assign(task, { status: "completed", completedAt: "2026-09-09T01:00:00.000Z" });
        return jsonResponse({ task }, 200);
      }
      if (action === "reopen") {
        Object.assign(task, { status: "active", completedAt: null });
        return jsonResponse({ task }, 200);
      }
      if (method === "PATCH") {
        Object.assign(task, body);
        return jsonResponse({ task }, 200);
      }
      if (method === "DELETE") {
        tasks = tasks.filter((row) => row.id !== id);
        return jsonResponse({ task: { ...task, deletedAt: "2026-09-09T02:00:00.000Z" } }, 200);
      }
    }
    throw new Error(`unstubbed ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, live: () => tasks };
}

import { TaskPanel, SELECTED_TASK_KEY } from "./task-panel";

const SEED = () => [
  makeRow({ id: ID_A, title: "Write launch notes", position: 1000 }),
  makeRow({ id: ID_B, title: "Review pull requests", position: 2000 }),
];

function rowItem(title: string) {
  const item = screen.getByText(title).closest("li");
  expect(item).not.toBeNull();
  return item as HTMLElement;
}

describe("<TaskPanel /> row actions (slice 4)", () => {
  it("completes an active task and announces it", async () => {
    const user = userEvent.setup();
    const { calls } = stubCrudServer(SEED());
    render(<TaskPanel />);
    await screen.findByText(/write launch notes/i);

    await user.click(
      within(rowItem("Write launch notes")).getByRole("button", { name: /complete/i }),
    );
    expect(
      calls.some((call) => call.url === `/api/tasks/${ID_A}/complete`),
    ).toBe(true);
    await screen.findByText(/completed\./i);
    expect(screen.queryByText("Write launch notes")).not.toBeInTheDocument();
    expect(screen.getByText("Review pull requests")).toBeInTheDocument();
  });

  it("reopens a completed task from the Completed filter", async () => {
    const user = userEvent.setup();
    stubCrudServer([
      makeRow({ id: ID_A, title: "Done yesterday", status: "completed" }),
    ]);
    render(<TaskPanel />);
    await user.click(screen.getByRole("radio", { name: /completed/i }));
    await screen.findByText(/done yesterday/i);

    await user.click(
      within(rowItem("Done yesterday")).getByRole("button", { name: /reopen/i }),
    );
    await screen.findByText(/reopened/i);
    expect(screen.getByText(/no completed tasks yet/i)).toBeInTheDocument();
    // The mutation notice announces (its own status region — the empty
    // state carries a second one, so match by announced text).
    const statuses = screen.getAllByRole("status");
    expect(
      statuses.some((region) => /reopened/i.test(region.textContent ?? "")),
    ).toBe(true);
  });

  it("archives from Active and unarchives from Archived", async () => {
    const user = userEvent.setup();
    stubCrudServer(SEED());
    render(<TaskPanel />);
    await screen.findByText(/write launch notes/i);

    await user.click(
      within(rowItem("Write launch notes")).getByRole("button", { name: /archive/i }),
    );
    await screen.findByText(/archived\./i);
    expect(screen.queryByText("Write launch notes")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /archived/i }));
    const archivedList = await screen.findByRole("list", { name: /tasks/i });
    expect(
      within(archivedList).getByText("Write launch notes"),
    ).toBeInTheDocument();
    await user.click(
      within(rowItem("Write launch notes")).getByRole("button", { name: /unarchive/i }),
    );
    await screen.findByText(/unarchived/i);
  });

  it("deletes only after an explicit inline confirm", async () => {
    const user = userEvent.setup();
    const { calls, live } = stubCrudServer(SEED());
    render(<TaskPanel />);
    await screen.findByText(/write launch notes/i);

    const item = rowItem("Write launch notes");
    await user.click(
      within(item).getByRole("button", { name: /delete/i }),
    );
    // First click only arms the confirm — nothing is deleted yet.
    expect(
      calls.some((call) => call.method === "DELETE"),
    ).toBe(false);
    await user.click(
      within(item).getByRole("button", {
        name: /confirm delete/i,
      }),
    );
    await screen.findByText(/deleted/i);
    expect(live().some((task) => task.id === ID_A)).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent(/deleted/i);
  });

  it("edits title, notes, and category with field-associated errors", async () => {
    const user = userEvent.setup();
    const { calls } = stubCrudServer(SEED());
    render(<TaskPanel />);
    await screen.findByText(/write launch notes/i);

    const item = rowItem("Write launch notes");
    await user.click(
      within(item).getByRole("button", { name: /edit/i }),
    );
    await user.clear(within(item).getByRole("textbox", { name: /^title$/i }));
    await user.type(within(item).getByRole("textbox", { name: /^title$/i }), "Launch notes v2");
    await user.type(within(item).getByRole("textbox", { name: /notes/i }), "Ship it");
    await user.type(within(item).getByRole("textbox", { name: /category/i }), "Writing");
    await user.click(within(item).getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/updated\./i)).toBeInTheDocument();
    const list = screen.getByRole("list", { name: /tasks/i });
    expect(within(list).getByText("Launch notes v2")).toBeInTheDocument();
    expect(
      calls.some(
        (call) =>
          call.method === "PATCH" &&
          call.url === `/api/tasks/${ID_A}` &&
          (call.body as { title: string }).title === "Launch notes v2",
      ),
    ).toBe(true);
  });

  it("associates edit validation errors with their fields", async () => {    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          return jsonResponse(
            {
              tasks: [
                makeRow({ id: ID_A, title: "Write launch notes", position: 1000 }),
              ],
              nextCursor: null,
            },
            200,
          );
        }
        return jsonResponse(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Check the highlighted fields and try again.",
              fields: { title: ["Enter a task title."] },
            },
          },
          400,
        );
      }),
    );
    render(<TaskPanel />);
    await screen.findByText(/write launch notes/i);

    const item = rowItem("Write launch notes");
    await user.click(within(item).getByRole("button", { name: /edit/i }));
    await user.clear(within(item).getByRole("textbox", { name: /^title$/i }));
    await user.click(within(item).getByRole("button", { name: /save/i }));

    const titleField = within(item).getByRole("textbox", { name: /^title$/i });
    expect(titleField).toHaveAttribute("aria-invalid", "true");
    expect(await within(item).findByRole("alert")).toHaveTextContent(
      /enter a task title/i,
    );
    // The failed save stays in the form — nothing is lost or refetched.
    expect(
      within(item).getByRole("button", { name: /cancel/i }),
    ).toBeInTheDocument();
  });

  it("clears notes and category when the edit empties them", async () => {
    const user = userEvent.setup();
    const { calls } = stubCrudServer([
      makeRow({
        id: ID_A,
        title: "Write launch notes",
        notes: "Old notes",
        category: "Writing",
        position: 1000,
      }),
    ]);
    render(<TaskPanel />);
    await screen.findByText(/old notes/i);

    const item = rowItem("Write launch notes");
    await user.click(within(item).getByRole("button", { name: /edit/i }));
    await user.clear(within(item).getByRole("textbox", { name: /notes/i }));
    await user.clear(within(item).getByRole("textbox", { name: /category/i }));
    await user.click(within(item).getByRole("button", { name: /save/i }));

    // Explicit nulls (not ""): the PATCH boundary reads null as "clear".
    const patch = calls.find((call) => call.method === "PATCH");
    expect((patch?.body as { notes: unknown }).notes).toBeNull();
    expect((patch?.body as { category: unknown }).category).toBeNull();
    await screen.findByText(/updated\./i);
    expect(screen.queryByText("Old notes")).not.toBeInTheDocument();
  });

  it("explains the timer lock instead of dropping the task", async () => {
    const user = userEvent.setup();
    stubCrudServer(SEED(), [ID_A]);
    render(<TaskPanel />);
    await screen.findByText(/write launch notes/i);

    await user.click(
      within(rowItem("Write launch notes")).getByRole("button", { name: /complete/i }),
    );
    const item = rowItem("Write launch notes");
    expect(await within(item).findByRole("alert")).toHaveTextContent(
      /finish or cancel the current interval/i,
    );
    // The task stays put — a lock never removes or rewrites the row.
    expect(screen.getByText("Write launch notes")).toBeInTheDocument();
  });

  it("reorders with move up/down over the full active order", async () => {
    const user = userEvent.setup();
    const { calls } = stubCrudServer(SEED());
    render(<TaskPanel />);
    await screen.findByText(/write launch notes/i);

    await user.click(
      within(rowItem("Review pull requests")).getByRole("button", { name: /move .* up/i }),
    );
    const reorder = calls.find((call) => call.url === "/api/tasks/reorder");
    expect(reorder?.method).toBe("POST");
    expect((reorder?.body as { taskIds: string[] }).taskIds).toEqual([ID_B, ID_A]);
    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveTextContent(/review pull requests/i);
  });

  it("completing the selected task clears the focus selection", async () => {
    const user = userEvent.setup();
    stubCrudServer(SEED());
    const onSelectionChange = vi.fn();
    render(<TaskPanel onSelectionChange={onSelectionChange} />);
    await screen.findByText(/write launch notes/i);

    await user.click(
      within(rowItem("Write launch notes")).getByRole("button", {
        name: /select .* for focus/i,
      }),
    );
    expect(window.localStorage.getItem(SELECTED_TASK_KEY)).toContain(ID_A);

    await user.click(
      within(rowItem("Write launch notes")).getByRole("button", { name: /complete/i }),
    );
    await screen.findByText(/completed\./i);
    expect(window.localStorage.getItem(SELECTED_TASK_KEY)).toBeNull();
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });

  it("returns focus to the opener when edit is cancelled (WCAG 2.4.3)", async () => {
    const user = userEvent.setup();
    stubCrudServer(SEED());
    render(<TaskPanel />);
    await screen.findByText(/write launch notes/i);

    const item = rowItem("Write launch notes");
    await user.click(within(item).getByRole("button", { name: /edit/i }));
    expect(
      within(item).getByRole("textbox", { name: /^title$/i }),
    ).toHaveFocus();
    await user.click(within(item).getByRole("button", { name: /cancel/i }));
    expect(
      within(rowItem("Write launch notes")).getByRole("button", {
        name: /edit write launch notes/i,
      }),
    ).toHaveFocus();
  });

  it("returns focus to the opener when the delete confirm is dismissed (WCAG 2.4.3)", async () => {
    const user = userEvent.setup();
    stubCrudServer(SEED());
    render(<TaskPanel />);
    await screen.findByText(/write launch notes/i);

    const item = rowItem("Write launch notes");
    await user.click(within(item).getByRole("button", { name: /delete/i }));
    expect(
      within(item).getByRole("button", { name: /confirm delete/i }),
    ).toHaveFocus();
    await user.click(within(item).getByRole("button", { name: /keep/i }));
    expect(
      within(rowItem("Write launch notes")).getByRole("button", {
        name: /delete write launch notes/i,
      }),
    ).toHaveFocus();
  });

  it("recovers focus to quick-add after a row unmounts (WCAG 2.4.3)", async () => {
    const user = userEvent.setup();
    stubCrudServer(SEED());
    render(<TaskPanel />);
    await screen.findByText(/write launch notes/i);

    await user.click(
      within(rowItem("Write launch notes")).getByRole("button", {
        name: /complete/i,
      }),
    );
    await screen.findByText(/completed\./i);
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: /new task title/i }),
      ).toHaveFocus(),
    );
  });
});
