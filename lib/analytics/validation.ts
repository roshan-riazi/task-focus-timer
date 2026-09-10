import { z } from "zod";

/**
 * Zod input boundary for the Analytics API (issue 15, spec §8.9 + §11.3/§11.5).
 *
 * Filters are period-based, never raw timestamps: `period` selects the
 * rolling local-day window (Today = the user's local calendar day, `7d` =
 * rolling 7 local days incl. today — SYSTEM_DESIGN §7) resolved through
 * the saved IANA timezone in the service. `30d` is history-only
 * (spec §8.8) and rejects here. Unknown keys strip silently (repo-wide
 * Zod default, same as tasks/timer/settings/history) so speculative
 * `from`/`to`/`type` params never reach the store; identity always
 * derives from the session in the handlers.
 */

export const analyticsPeriodSchema = z.enum(["today", "7d"]);

export type AnalyticsPeriod = z.infer<typeof analyticsPeriodSchema>;

/**
 * Summary query: `period` defaults to the rolling week (the history
 * default in issue 14, so history and analytics agree on first paint).
 */
export const analyticsSummaryQuerySchema = z.object({
  period: analyticsPeriodSchema.default("7d"),
});

export type AnalyticsSummaryQuery = z.infer<typeof analyticsSummaryQuerySchema>;
