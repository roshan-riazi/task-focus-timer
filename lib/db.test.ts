import { describe, expect, it } from "vitest";

describe("lib/db prisma wiring", () => {
  it("exposes a singleton client with all delegates", async () => {
    process.env.DATABASE_URL ??=
      "postgres://focusflow:focusflow@localhost:5432/focusflow";
    const { db } = await import("@/lib/db");
    for (const delegate of [
      "user",
      "userSettings",
      "task",
      "timerSession",
      "focusCycleState",
      // Issue 04: Auth.js adapter + email-token delegates.
      "account",
      "session",
      "verificationToken",
      "emailVerificationToken",
      "passwordResetToken",
    ]) {
      expect(db).toHaveProperty(delegate);
    }
  });

  it("returns the same instance on re-import (singleton)", async () => {
    process.env.DATABASE_URL ??=
      "postgres://focusflow:focusflow@localhost:5432/focusflow";
    const first = await import("@/lib/db");
    const second = await import("@/lib/db");
    expect(first.db).toBe(second.db);
  });
});
