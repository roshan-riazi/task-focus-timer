import { z } from "zod";

/**
 * Zod input boundary for the History API (issue 14, spec §8.8 + §11.3/§11.5).
 *
 * Filters are period-based, never raw timestamps: `period` selects the
 * rolling local-day window (Today = the user's local calendar day, `7d` =
 * rolling 7 local days incl. today, `30d` = rolling 30 local days incl.
 * today — SYSTEM_DESIGN §7, extended to 30d per spec §8.8) resolved through
 * the saved IANA timezone in the service; `type` controls break display
 * (`focus` hides persisted breaks, `all` shows every interval type).
 * Unknown keys strip silently (repo-wide Zod default, same as
 * tasks/timer/settings) so speculative `from`/`to` params never reach the
 * store; identity always derives from the session in the handlers.
 */

export const historyPeriodSchema = z.enum(["today", "7d", "30d"]);

export type HistoryPeriod = z.infer<typeof historyPeriodSchema>;

export const historyTypeSchema = z.enum(["focus", "all"]);

export type HistoryType = z.infer<typeof historyTypeSchema>;

/**
 * List query: `period` defaults to the rolling week (the analytics default
 * in issue 15, so history and analytics agree on first paint); `type`
 * defaults to `all` (breaks are persisted by default per spec §8.8, the
 * filter only hides them); `limit` coerces from `URLSearchParams` strings
 * (default 20, hard cap 100); `cursor` is the opaque page token minted by
 * the service — validated for shape here, decoded there so a forged cursor
 * fails as a 400, not a 500.
 */
export const listSessionsQuerySchema = z.object({
  period: historyPeriodSchema.default("7d"),
  type: historyTypeSchema.default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(4096).optional(),
});

export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>;
