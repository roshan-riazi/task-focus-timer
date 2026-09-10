import { z } from "zod";

/**
 * Zod input boundary for the Timer API (issue 10, spec §8.3 + §11.2/§11.5).
 *
 * The client sends only `intervalType` + optional `taskId` on start —
 * planned durations come from saved settings at start (issue 09 contract,
 * seconds units) and elapsed time is always server-computed. Unknown keys
 * strip silently (repo-wide Zod default, same as tasks/settings) so a
 * forged `userId` or `plannedDurationSeconds` in the body reaches nothing;
 * identity always derives from the session in the handlers.
 */
export const intervalTypeSchema = z.enum(["focus", "short_break", "long_break"]);

export type IntervalType = z.infer<typeof intervalTypeSchema>;

export const startTimerSchema = z.object({
  intervalType: intervalTypeSchema,
  taskId: z.string().uuid("Enter a valid task id.").optional(),
});

export type StartTimerInput = z.infer<typeof startTimerSchema>;

/**
 * `Idempotency-Key` header on complete/cancel/skip-break (SYSTEM_DESIGN §6):
 * opaque client key, 1–128 chars after trimming. Optional — absent keys
 * still finalize, but only a matching key replays (200) instead of
 * conflicting (409 ALREADY_FINALIZED). Malformed keys fail as 400, never
 * as silent new keys.
 */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1, "Enter an idempotency key.")
  .max(128, "Idempotency key must be 128 characters or fewer.");

export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;
