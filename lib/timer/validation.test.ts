import { describe, expect, it } from "vitest";
import { idempotencyKeySchema, startTimerSchema } from "./validation";

/**
 * Seam 1 (unit, hermetic): Zod input boundary for the Timer API
 * (issue 10, spec §8.3/§11.2 + §11.5).
 *
 * The client sends only `intervalType` + optional `taskId` — planned
 * durations come from saved settings at start, elapsed time is always
 * server-computed. Identity stays session-derived: unknown keys (incl. a
 * forged `userId`) strip silently, mirroring the task/settings boundary.
 */
describe("startTimerSchema", () => {
  it("accepts every interval type without a task", () => {
    for (const intervalType of ["focus", "short_break", "long_break"]) {
      expect(startTimerSchema.safeParse({ intervalType }).success).toBe(true);
    }
  });

  it("accepts a valid task id", () => {
    const taskId = crypto.randomUUID();
    expect(
      startTimerSchema.safeParse({ intervalType: "focus", taskId }),
    ).toEqual({ success: true, data: { intervalType: "focus", taskId } });
  });

  it("rejects missing or unknown interval types", () => {
    expect(startTimerSchema.safeParse({}).success).toBe(false);
    expect(
      startTimerSchema.safeParse({ intervalType: "nap" }).success,
    ).toBe(false);
    expect(
      startTimerSchema.safeParse({ intervalType: "FOCUS" }).success,
    ).toBe(false);
  });

  it("rejects non-uuid task ids", () => {
    expect(
      startTimerSchema.safeParse({ intervalType: "focus", taskId: "not-a-uuid" })
        .success,
    ).toBe(false);
    expect(
      startTimerSchema.safeParse({ intervalType: "focus", taskId: "" }).success,
    ).toBe(false);
  });

  it("strips unknown keys so a forged userId never reaches the service", () => {
    const result = startTimerSchema.safeParse({
      intervalType: "focus",
      userId: "victim-id",
      plannedDurationSeconds: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ intervalType: "focus" });
    }
  });
});

describe("idempotencyKeySchema", () => {
  it("accepts opaque client keys", () => {
    expect(idempotencyKeySchema.safeParse(crypto.randomUUID()).success).toBe(
      true,
    );
    expect(idempotencyKeySchema.safeParse("retry-1").success).toBe(true);
  });

  it("rejects empty, whitespace-only, overlong, and non-string keys", () => {
    expect(idempotencyKeySchema.safeParse("").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("   ").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("x".repeat(129)).success).toBe(false);
    expect(idempotencyKeySchema.safeParse(42).success).toBe(false);
  });
});
