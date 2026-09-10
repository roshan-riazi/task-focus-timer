import { describe, expect, it } from "vitest";
import { listSessionsQuerySchema } from "./validation";

/**
 * Seam 1 (unit, hermetic): Zod input boundary for the History API.
 *
 * Every expectation below is an independent literal from the issue and
 * spec — periods Today/7d/30d, types focus/all (PRODUCT_SPEC §8.8), limit
 * 1–100 (SYSTEM_DESIGN §6 pagination) — never recomputed from the
 * implementation.
 */
describe("listSessionsQuerySchema", () => {
  it("defaults to the rolling week with every interval type, page of 20", () => {
    expect(listSessionsQuerySchema.parse({})).toEqual({
      period: "7d",
      type: "all",
      limit: 20,
      cursor: undefined,
    });
  });

  it("accepts every documented period and type, plus a string limit from searchParams", () => {
    expect(
      listSessionsQuerySchema.parse({ period: "today", type: "focus" }),
    ).toMatchObject({ period: "today", type: "focus" });
    expect(
      listSessionsQuerySchema.parse({ period: "30d", type: "all", limit: "25" }),
    ).toMatchObject({ period: "30d", type: "all", limit: 25 });
    expect(listSessionsQuerySchema.parse({ limit: 100 })).toMatchObject({
      limit: 100,
    });
  });

  it("rejects unknown periods/types and out-of-range limits", () => {
    expect(() => listSessionsQuerySchema.parse({ period: "week" })).toThrow();
    expect(() => listSessionsQuerySchema.parse({ period: "1d" })).toThrow();
    expect(() => listSessionsQuerySchema.parse({ type: "breaks" })).toThrow();
    expect(() => listSessionsQuerySchema.parse({ type: "short_break" })).toThrow();
    expect(() => listSessionsQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => listSessionsQuerySchema.parse({ limit: 101 })).toThrow();
    expect(() => listSessionsQuerySchema.parse({ limit: "many" })).toThrow();
  });

  it("ignores speculative from/to params (period is the MVP filter)", () => {
    const parsed = listSessionsQuerySchema.parse({
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-10T00:00:00.000Z",
    });
    expect(parsed).toMatchObject({ period: "7d", type: "all", limit: 20 });
    expect(parsed).not.toHaveProperty("from");
    expect(parsed).not.toHaveProperty("to");
  });
});
