import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => ({ get: () => null }),
}));

import { LoginForm } from "./login-form";
import { LogoutButton } from "./logout-button";
import { VerificationNag } from "./verification-nag";

const realFetch = globalThis.fetch;

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

describe("<VerificationNag /> (non-blocking reminder, spec §8.1)", () => {
  it("renders the nag with a resend action", () => {
    render(<VerificationNag />);
    expect(screen.getByRole("status")).toHaveTextContent(/verify your email/i);
    expect(
      screen.getByRole("button", { name: /resend email/i }),
    ).toBeInTheDocument();
  });

  it("announces sending while the resend is in flight", async () => {
    const user = userEvent.setup();
    let resolveResend!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResend = resolve;
          }),
      ),
    );
    render(<VerificationNag />);
    await user.click(screen.getByRole("button", { name: /resend email/i }));
    // Screen-reader users hear progress: the banner is a live region, so
    // the sending copy must be exposed — never an aria-hidden ellipsis.
    const sending = await screen.findByText("Sending…");
    expect(sending).toBeVisible();
    expect(sending).not.toHaveAttribute("aria-hidden");
    expect(sending.closest('[aria-hidden="true"]')).toBeNull();
    resolveResend(new Response("{}", { status: 200 }));
    expect(
      await screen.findByRole("button", { name: /email sent/i }),
    ).toBeDisabled();
  });

  it("posts a resend and confirms without leaving the page", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<VerificationNag />);
    await user.click(screen.getByRole("button", { name: /resend email/i }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/resend-verification",
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      await screen.findByRole("button", { name: /email sent/i }),
    ).toBeDisabled();
  });
});

describe("<LoginForm /> (field-associated errors, spec §12.3)", () => {
  it("maps a 401 envelope onto the form error region", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." },
            }),
            { status: 401 },
          ),
      ),
    );
    render(<LoginForm />);
    await user.type(screen.getByLabelText(/email/i), "a@x.com");
    await user.type(screen.getByLabelText(/password/i), "wrong-pass-1");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /invalid email or password/i,
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("navigates home on success", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 }),
      ),
    );
    render(<LoginForm />);
    await user.type(screen.getByLabelText(/email/i), "a@x.com");
    await user.type(screen.getByLabelText(/password/i), "s3cure-password");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(await screen.findByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalled();
  });
});

describe("<LogoutButton />", () => {
  it("calls the logout endpoint and returns home", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<LogoutButton />);
    await user.click(screen.getByRole("button", { name: /sign out/i }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
    expect(push).toHaveBeenCalledWith("/");
  });
});
