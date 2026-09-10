import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const realFetch = globalThis.fetch;

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

import { TaskPanel } from "./task-panel";

describe("<TaskPanel /> list + quick-add (slice 2)", () => {
  it("announces loading, then lists active tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ tasks: [taskRow()], nextCursor: null }, 200),
      ),
    );
    render(<TaskPanel />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading tasks/i);
    expect(
      await screen.findByRole("listitem"),
    ).toHaveTextContent(/write launch notes/i);
    await waitFor(() =>
      expect(screen.queryByText(/loading tasks/i)).not.toBeInTheDocument(),
    );
  });

  it("quick-add posts the title and shows the new task", async () => {
    const user = userEvent.setup();
    // Stateful server double: POST appends, GET returns the current order —
    // the panel refetches after every mutation instead of guessing locally.
    const serverTasks = [taskRow()];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.startsWith("/api/tasks?"))
        return jsonResponse({ tasks: serverTasks, nextCursor: null }, 200);
      expect(init?.method).toBe("POST");
      const created = taskRow({
        id: "99999999-9999-4999-8999-999999999999",
        title: "Plan next week",
      });
      serverTasks.push(created);
      return jsonResponse({ task: created }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskPanel />);
    await screen.findByRole("listitem");

    await user.type(
      screen.getByRole("textbox", { name: /new task title/i }),
      "Plan next week",
    );
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    expect(await screen.findByText(/plan next week/i)).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /new task title/i }),
    ).toHaveValue("");
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === "/api/tasks" &&
          (init as RequestInit)?.method === "POST" &&
          String((init as RequestInit)?.body).includes("Plan next week"),
      ),
    ).toBe(true);
  });

  it("keeps the typed title and associates validation errors with the field", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.startsWith("/api/tasks?"))
          return jsonResponse({ tasks: [], nextCursor: null }, 200);
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
    await screen.findByText(/no active tasks yet/i);

    // Spaces-only title passes the non-empty HTML check but fails server validation.
    await user.type(
      screen.getByRole("textbox", { name: /new task title/i }),
      "   ",
    );
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    const field = screen.getByRole("textbox", {
      name: /new task title/i,
    });
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /enter a task title/i,
    );
  });

  it("shows an explanatory empty state guiding toward quick-add", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ tasks: [], nextCursor: null }, 200),
      ),
    );
    render(<TaskPanel />);
    expect(await screen.findByText(/no active tasks yet/i)).toBeInTheDocument();
    // The quick-add control stays available in the empty state.
    expect(
      screen.getByRole("textbox", { name: /new task title/i }),
    ).toBeInTheDocument();
  });

  it("shows a retryable error when loading fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        { error: { code: "REQUEST_FAILED", message: "Something went wrong." } },
        500,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /something went wrong/i,
    );

    fetchMock.mockImplementation(async () =>
      jsonResponse({ tasks: [taskRow()], nextCursor: null }, 200),
    );
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByRole("listitem")).toHaveTextContent(
      /write launch notes/i,
    );
  });

  it("restricts the title input to 200 characters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ tasks: [], nextCursor: null }, 200),
      ),
    );
    render(<TaskPanel />);
    await screen.findByText(/no active tasks yet/i);
    expect(
      screen.getByRole("textbox", { name: /new task title/i }),
    ).toHaveAttribute("maxLength", "200");
  });

  it("renders tasks inside a list owned by the Tasks heading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            tasks: [
              taskRow(),
              taskRow({
                id: "22222222-2222-4222-8222-222222222222",
                title: "Review pull requests",
              }),
            ],
            nextCursor: null,
          },
          200,
        ),
      ),
    );
    render(<TaskPanel />);
    const list = await screen.findByRole("list", { name: /tasks/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });
});
