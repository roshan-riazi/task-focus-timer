import { describe, expect, it } from "vitest";
import { analyticsSummaryQuerySchema } from "./validation";

/**
 * Seam 1 (unit, hermetic): Zod input boundary for the Analytics API.
 *
 * Every expectation below is an independent literal from the issue and
 * spec — periods Today/7d only (PRODUCT_SPEC §8.9 + SYSTEM_DESIGN §7;
 * 30d is history-only per spec §8.8), defaulting to the rolling week so
 * history and analytics agree on first paint — never recomputed from
 * the implementation.
 */
describe("analyticsSummaryQuerySchema", () => {
  it("defaults to the rolling week", () => {
    expect(analyticsSummaryQuerySchema.parse({})).toEqual({
      period: "7d",
    });
  });

  it("accepts today and 7d", () => {
    expect(
      analyticsSummaryQuerySchema.parse({ period: "today" }),
    ).toMatchObject({ period: "today" });
    expect(analyticsSummaryQuerySchema.parse({ period: "7d" })).toMatchObject({
      period: "7d",
    });
  });

  it("rejects unknown periods (including history-only 30d)", () => {
    expect(() => analyticsSummaryQuerySchema.parse({ period: "week" })).toThrow();
    expect(() => analyticsSummaryQuerySchema.parse({ period: "30d" })).toThrow();
    expect(() => analyticsSummaryQuerySchema.parse({ period: "1d" })).toThrow();
    expect(() => analyticsSummaryQuerySchema.parse({ period: "" })).toThrow();
  });

  it("ignores speculative params (period is the MVP filter)", () => {
    const parsed = analyticsSummaryQuerySchema.parse({
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-09-10T00:00:00.000Z",
      type: "focus",
    });
    expect(parsed).toEqual({ period: "7d" });
    expect(parsed).not.toHaveProperty("from");
    expect(parsed).not.toHaveProperty("to");
    expect(parsed).not.toHaveProperty("type");
  });
});
