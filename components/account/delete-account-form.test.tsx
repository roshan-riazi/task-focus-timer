import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import { DeleteAccountSection } from "./delete-account-form";

const realFetch = globalThis.fetch;

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Seam: `<DeleteAccountSection />` over stubbed `fetch` (issue 18,
 * spec §8.1). Behavior only — explainer + privacy link, typed DELETE
 * gate, field/form errors, sign-out redirect on success — never internals.
 */
describe("<DeleteAccountSection /> (spec §8.1)", () => {
  it("explains the purge and links the privacy notice before anything destructive", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ deleted: true }, 200)),
    );
    render(<DeleteAccountSection />);
    expect(
      screen.getByRole("heading", { name: /danger zone/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /privacy/i })).toHaveAttribute(
      "href",
      "/privacy",
    );
    // No confirmation input until the user explicitly starts deletion.
    expect(
      screen.queryByLabelText(/type delete to confirm/i),
    ).not.toBeInTheDocument();
  });

  it("reveals the confirmation step and focuses it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ deleted: true }, 200)),
    );
    const user = userEvent.setup();
    render(<DeleteAccountSection />);
    await user.click(
      screen.getByRole("button", { name: /delete account/i }),
    );
    const input = screen.getByLabelText(/type delete to confirm/i);
    expect(input).toHaveFocus();
  });

  it("enables the final delete only for the exact DELETE literal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ deleted: true }, 200)),
    );
    const user = userEvent.setup();
    render(<DeleteAccountSection />);
    await user.click(
      screen.getByRole("button", { name: /delete account/i }),
    );
    const confirm = screen.getByRole("button", {
      name: /delete my account/i,
    });
    expect(confirm).toBeDisabled();
    await user.type(
      screen.getByLabelText(/type delete to confirm/i),
      "delete",
    );
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByLabelText(/type delete to confirm/i));
    await user.type(screen.getByLabelText(/type delete to confirm/i), "DELETE");
    expect(confirm).toBeEnabled();
  });

  it("deletes via the account API and signs out to the landing page", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        jsonResponse({ deleted: true }, 200),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<DeleteAccountSection />);
    await user.click(
      screen.getByRole("button", { name: /delete account/i }),
    );
    await user.type(screen.getByLabelText(/type delete to confirm/i), "DELETE");
    await user.click(screen.getByRole("button", { name: /delete my account/i }));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/account");
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBe(JSON.stringify({ confirmation: "DELETE" }));
    expect(await screen.findByText(/account deleted/i)).toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces server field errors on the confirmation input", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Check the highlighted fields and try again.",
              fields: { confirmation: ["Type DELETE to confirm."] },
            },
          },
          400,
        ),
      ),
    );
    const user = userEvent.setup();
    render(<DeleteAccountSection />);
    await user.click(
      screen.getByRole("button", { name: /delete account/i }),
    );
    await user.type(screen.getByLabelText(/type delete to confirm/i), "DELETE");
    await user.click(screen.getByRole("button", { name: /delete my account/i }));
    expect(
      await screen.findByText("Type DELETE to confirm."),
    ).toBeInTheDocument();
    // Still signed in: no redirect on failure.
    expect(push).not.toHaveBeenCalled();
  });

  it("cancels back to the closed state with focus restored", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ deleted: true }, 200)),
    );
    const user = userEvent.setup();
    render(<DeleteAccountSection />);
    await user.click(
      screen.getByRole("button", { name: /delete account/i }),
    );
    expect(
      screen.getByLabelText(/type delete to confirm/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(
      screen.queryByLabelText(/type delete to confirm/i),
    ).not.toBeInTheDocument();
    // The trigger remounts on close: re-query, the old node is detached.
    expect(
      screen.getByRole("button", { name: /delete account/i }),
    ).toHaveFocus();
  });
});
