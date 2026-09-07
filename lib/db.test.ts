import { describe, expect, it } from "vitest";

describe("lib/db prisma wiring", () => {
  it("exposes a singleton client with all five delegates", async () => {
    process.env.DATABASE_URL ??=
      "postgres://focusflow:focusflow@localhost:5432/focusflow";
    const { db } = await import("@/lib/db");
    for (const delegate of [
      "user",
      "userSettings",
      "task",
      "timerSession",
      "focusCycleState",
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
