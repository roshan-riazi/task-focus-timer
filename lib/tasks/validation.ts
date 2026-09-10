import { z } from "zod";

/**
 * Zod input boundary for the Task API (issue 07, spec §8.2 + §11.5).
 *
 * Limits are independent literals from the spec — title 1–200 after
 * trimming, notes ≤2000, single category ≤50 — mirroring
 * `tasks.title/notes/category VARCHAR` in prisma/schema.prisma.
 */

const titleSchema = z
  .string()
  .trim()
  .min(1, "Enter a task title.")
  .max(200, "Title must be 200 characters or fewer.");

/** Optional free text: empty strings count as absent, never stored. */
function optionalText(max: number, message: string) {
  return textShape(max, message).optional();
}

function textShape(max: number, message: string) {
  return z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === "" ? undefined : value));
}

const notesSchema = optionalText(2000, "Notes must be 2000 characters or fewer.");
const categorySchema = optionalText(50, "Category must be 50 characters or fewer.");

/**
 * Explicit null clears the field (issue 08 edit form sends null for an
 * emptied input; `""` keeps its create-time meaning of "absent/skipped" so
 * the service's `data.notes ?? null` patch lands null → cleared).
 */
function clearableText(max: number, message: string) {
  return z.union([textShape(max, message), z.null()]).optional();
}

export const createTaskSchema = z.object({
  title: titleSchema,
  notes: notesSchema,
  category: categorySchema,
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/**
 * PATCH edits content, never lifecycle: completion goes through
 * POST :id/complete and reopening through POST :id/reopen so those
 * transitions stay explicit (and lock-checked) in the service. Archiving
 * is a content-neutral state change, so `active|archived` is allowed here.
 */
export const updateTaskSchema = z
  .object({
    title: titleSchema.optional(),
    notes: clearableText(2000, "Notes must be 2000 characters or fewer."),
    category: clearableText(50, "Category must be 50 characters or fewer."),
    status: z.enum(["active", "archived"]).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Nothing to update.",
  });

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskListStatusSchema = z.enum([
  "active",
  "completed",
  "archived",
  "all",
]);

/**
 * List query: `status` defaults to the active view (spec §7.3); `limit`
 * coerces from `URLSearchParams` strings (default 50, hard cap 100);
 * `cursor` is the opaque page token minted by the service — validated for
 * shape here, decoded there so a forged cursor fails as a 400, not a 500.
 */
export const listTasksQuerySchema = z.object({
  status: taskListStatusSchema.default("active"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(4096).optional(),
});

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

/**
 * Reorder: the client's desired order as a full list of active task ids.
 * Membership (exact active-set match), ownership, and lock checks live in
 * the service — the schema pins shape only: 1–200 unique UUIDs.
 */
export const reorderTasksSchema = z.object({
  taskIds: z
    .array(z.string().uuid("Enter a valid task id."))
    .min(1, "Add at least one task.")
    .max(200, "Reorder at most 200 tasks at once.")
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Task ids must be unique.",
    }),
});

export type ReorderTasksInput = z.infer<typeof reorderTasksSchema>;

export const taskIdParamSchema = z.string().uuid("Enter a valid task id.");
