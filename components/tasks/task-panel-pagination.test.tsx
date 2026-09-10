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

function taskRow(id: string, title: string, position: number) {
  return {
    id,
    title,
    notes: null,
    category: null,
    status: "active",
    position,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    completedAt: null,
    deletedAt: null,
  };
}

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

/** Two list pages: the first answers with a cursor, the second without. */
function stubPagedServer() {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url);
    const query = new URL(url, "https://app.example").searchParams;
    if (query.get("cursor") === "page-2") {
      return jsonResponse(
        { tasks: [taskRow(ID_B, "Review pull requests", 2000)], nextCursor: null },
        200,
      );
    }
    return jsonResponse(
      { tasks: [taskRow(ID_A, "Write launch notes", 1000)], nextCursor: "page-2" },
      200,
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

import { TaskPanel } from "./task-panel";

describe("<TaskPanel /> pagination (spec §11.5)", () => {
  it("appends the next page on demand and announces it", async () => {
    const user = userEvent.setup();
    const calls = stubPagedServer();
    render(<TaskPanel />);
    await screen.findByText("Write launch notes");
    expect(screen.queryByText("Review pull requests")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /load more tasks/i }),
    );
    expect(await screen.findByText("Review pull requests")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/loaded 1 more task/i);
    // The second request carries the opaque cursor; no third page exists.
    expect(calls[1]).toContain("cursor=page-2");
    expect(
      screen.queryByRole("button", { name: /load more tasks/i }),
    ).not.toBeInTheDocument();
  });

  it("hides move affordances until every page is loaded", async () => {
    const user = userEvent.setup();
    stubPagedServer();
    render(<TaskPanel />);
    await screen.findByText("Write launch notes");

    // Partial active set: reordering would violate the full-order contract.
    const item = screen.getByText("Write launch notes").closest("li")!;
    expect(
      within(item as HTMLElement).queryByRole("button", { name: /move/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /load more tasks/i }));
    await screen.findByText("Review pull requests");
    const both = await screen.findAllByRole("listitem");
    expect(both[0]).toHaveTextContent(/write launch notes/i);
    expect(
      within(both[1] as HTMLElement).getByRole("button", { name: /move .* up/i }),
    ).toBeInTheDocument();
  });

  it("retries a failed page without losing loaded rows", async () => {
    const user = userEvent.setup();
    let failNext = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const query = new URL(url, "https://app.example").searchParams;
        if (query.get("cursor") === "page-2" && failNext) {
          failNext = false;
          return jsonResponse(
            { error: { code: "REQUEST_FAILED", message: "Something went wrong." } },
            500,
          );
        }
        if (query.get("cursor") === "page-2") {
          return jsonResponse(
            { tasks: [taskRow(ID_B, "Review pull requests", 2000)], nextCursor: null },
            200,
          );
        }
        return jsonResponse(
          { tasks: [taskRow(ID_A, "Write launch notes", 1000)], nextCursor: "page-2" },
          200,
        );
      }),
    );
    render(<TaskPanel />);
    await screen.findByText("Write launch notes");

    failNext = true;
    await user.click(screen.getByRole("button", { name: /load more tasks/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /something went wrong/i,
    );
    // The first page stays put — a failed page never rewrites the list.
    expect(screen.getByText("Write launch notes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /load more tasks/i }));
    expect(await screen.findByText("Review pull requests")).toBeInTheDocument();
  });
});
