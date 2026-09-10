import { describe, expect, it } from "vitest";
import { notFound, requireUser } from "./guards";
import type { AppSession } from "./session";

const SESSION: AppSession = {
  user: {
    id: "user-a",
    email: "a@example.com",
    emailVerified: null,
    timezone: "Europe/Berlin",
  },
  expires: new Date("2026-10-08T12:00:00.000Z").toISOString(),
};

/**
 * Per-request scoping seam (issue 05, spec §8.1/§11.5): identity always
 * derives from the session, never from client input. Every guarded route
 * (current resend-verification; future tasks/timer/settings/history) enters
 * through `requireUser`; cross-user denials answer `notFound` so existence
 * never leaks (spec §12.2).
 */
describe("requireUser", () => {
  it("returns the session user when signed in", async () => {
    const result = await requireUser(
      { getSession: async () => SESSION },
      "req-1",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user).toEqual(SESSION.user);
    }
  });

  it("answers 401 UNAUTHENTICATED with the request id when signed out", async () => {
    const result = await requireUser(
      { getSession: async () => null },
      "req-2",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(result.response.headers.get("x-request-id")).toBe("req-2");
      const body = (await result.response.json()) as {
        error: { code: string };
      };
      expect(body.error.code).toBe("UNAUTHENTICATED");
    }
  });
});

describe("notFound (leak-free denial)", () => {
  it("answers 404 NOT_FOUND without distinguishing missing from foreign", async () => {
    const res = notFound("req-3");
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error).toEqual({ code: "NOT_FOUND", message: "Not found." });
  });
});
