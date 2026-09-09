import { useState } from "react";
import type { PublicTask } from "@/lib/tasks/service";
import { TaskApiError, toTaskApiError, type UpdateTaskValues } from "./api";
import { AuthField } from "../auth/auth-field";
import { Button } from "../ui/button";

export type MoveDirection = "up" | "down";

/** Row-level mutation in flight (disables the row's buttons while set). */
export type RowActionKind =
  | "complete"
  | "reopen"
  | "archive"
  | "unarchive"
  | "delete"
  | "move-up"
  | "move-down"
  | "save";

/**
 * Mutations the panel performs (API + refetch + announcement). They throw
 * `TaskApiError` on failure so the row can display the message inline; the
 * panel refetches only on success, so a failure never rewrites the row.
 */
export interface TaskRowActions {
  onComplete: (task: PublicTask) => Promise<void>;
  onReopen: (task: PublicTask) => Promise<void>;
  onArchive: (task: PublicTask) => Promise<void>;
  onUnarchive: (task: PublicTask) => Promise<void>;
  onDelete: (task: PublicTask) => Promise<void>;
  onMove: (task: PublicTask, direction: MoveDirection) => Promise<void>;
  onSaveEdit: (task: PublicTask, values: UpdateTaskValues) => Promise<void>;
}

interface TaskItemProps {
  task: PublicTask;
  /** True while this task is the workspace focus selection. */
  selected?: boolean;
  /** Rendered only for rows that can back the next focus interval. */
  showSelect?: boolean;
  onSelect?: (task: PublicTask) => void;
  actions?: TaskRowActions;
  /** Reorder affordances (active filter only, full-order contract). */
  showMove?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
}

function toRowError(error: unknown): TaskApiError {
  return error instanceof TaskApiError
    ? error
    : new TaskApiError(
        "NETWORK_ERROR",
        "Something went wrong. Check your connection and retry.",
        0,
      );
}

/**
 * Single task row. State is always textual (selected/expanded/confirmed in
 * words, never color alone — spec §12.3). Destructive deletes arm an inline
 * two-step confirm so keyboard and screen-reader users get the same guard
 * a dialog would give, without focus-trapping a modal.
 */
export function TaskItem({
  task,
  selected = false,
  showSelect = false,
  onSelect,
  actions,
  showMove = false,
  isFirst = true,
  isLast = true,
}: TaskItemProps) {
  const [acting, setActing] = useState<RowActionKind | null>(null);
  const [error, setError] = useState<TaskApiError | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [draftNotes, setDraftNotes] = useState(task.notes ?? "");
  const [draftCategory, setDraftCategory] = useState(task.category ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  /**
   * Runs a mutation; resolves with the failure (or null) so callers needing
   * structured fields (edit save) can branch while simple actions ignore it.
   */
  async function run(
    kind: RowActionKind,
    fn: () => Promise<void>,
  ): Promise<TaskApiError | null> {
    // Backstop (buttons already disable while busy): a concurrent action
    // resolves as a caller-visible no-op without touching row state.
    if (acting)
      return new TaskApiError("BUSY", "Still working — try again in a moment.", 0);
    setActing(kind);
    setError(null);
    try {
      await fn();
      return null;
    } catch (cause) {
      const rowError = toTaskApiError(cause);
      setError(rowError);
      return rowError;
    } finally {
      setActing(null);
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!actions) return;
    setFieldErrors({});
    // Emptied optionals send explicit null (the PATCH boundary reads null
    // as "clear"; `""` would mean "absent/skipped" and keep stale text).
    const values: UpdateTaskValues = {
      title: draftTitle,
      notes: draftNotes === "" ? null : draftNotes,
      category: draftCategory === "" ? null : draftCategory,
    };
    const failure = await run("save", () =>
      actions.onSaveEdit(task, values),
    );
    if (!failure) {
      setEditing(false);
      return;
    }
    // Field failures associate with their inputs (spec §12.3); anything
    // else stays on the row alert that `run` already set.
    setFieldErrors(failure.fields);
    if (Object.keys(failure.fields).length > 0) setError(null);
  }

  const busy = acting !== null;
  const titleId = `task-${task.id}-title`;
  const notesId = `task-${task.id}-notes`;
  const categoryId = `task-${task.id}-category`;

  if (editing) {
    return (
      <form onSubmit={(e) => void handleSave(e)} className="grid gap-2">
        <AuthField
          id={titleId}
          label="Title"
          type="text"
          value={draftTitle}
          maxLength={200}
          autoFocus
          onChange={(e) => setDraftTitle(e.target.value)}
          errors={fieldErrors.title}
        />
        <div className="grid gap-1.5">
          <label htmlFor={notesId} className="text-sm font-medium">
            Notes
          </label>
          <textarea
            id={notesId}
            value={draftNotes}
            maxLength={2000}
            rows={2}
            onChange={(e) => setDraftNotes(e.target.value)}
            aria-invalid={!!fieldErrors.notes || undefined}
            aria-describedby={fieldErrors.notes ? `${notesId}-error` : undefined}
            className="rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          {fieldErrors.notes && (
            <p
              id={`${notesId}-error`}
              role="alert"
              className="text-sm text-red-500"
            >
              {fieldErrors.notes.join(" ")}
            </p>
          )}
        </div>
        <AuthField
          id={categoryId}
          label="Category"
          type="text"
          value={draftCategory}
          maxLength={50}
          onChange={(e) => setDraftCategory(e.target.value)}
          errors={fieldErrors.category}
        />
        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setDraftTitle(task.title);
              setDraftNotes(task.notes ?? "");
              setDraftCategory(task.category ?? "");
              setFieldErrors({});
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (confirmingDelete) {
    return (
      <div className="grid gap-2">
        <p className="text-sm">
          Delete “{task.title}”? Session history keeps its snapshot.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy}
            autoFocus
            onClick={() =>
              void run("delete", async () => {
                await actions?.onDelete(task);
                setConfirmingDelete(false);
              })
            }
            aria-label={`Confirm delete ${task.title}`}
          >
            Confirm delete
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirmingDelete(false)}
          >
            Keep
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error.message}
          </p>
        )}
      </div>
    );
  }

  const canAct = task.status === "active";
  const wasCompleted = task.status === "completed";

  return (
    <div>
      <strong>{task.title}</strong>
      <br />
      <span className="text-xs opacity-70">
        {task.category ?? "Uncategorized"} · {task.status}
      </span>
      {task.notes && <p className="mt-1 text-sm opacity-80">{task.notes}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {showSelect && (
          <Button
            type="button"
            variant="ghost"
            aria-pressed={selected}
            aria-label={
              selected
                ? `${task.title} selected for focus`
                : `Select ${task.title} for focus`
            }
            disabled={busy}
            onClick={() => onSelect?.(task)}
          >
            {selected ? "Selected for focus" : "Select for focus"}
          </Button>
        )}
        {actions && canAct && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void run("complete", () => actions.onComplete(task))}
            aria-label={`Complete ${task.title}`}
          >
            Complete
          </Button>
        )}
        {actions && wasCompleted && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void run("reopen", () => actions.onReopen(task))}
            aria-label={`Reopen ${task.title}`}
          >
            Reopen
          </Button>
        )}
        {actions && canAct && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setError(null);
              setEditing(true);
            }}
            aria-label={`Edit ${task.title}`}
          >
            Edit
          </Button>
        )}
        {actions && canAct && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void run("archive", () => actions.onArchive(task))}
            aria-label={`Archive ${task.title}`}
          >
            Archive
          </Button>
        )}
        {actions && task.status === "archived" && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void run("unarchive", () => actions.onUnarchive(task))}
            aria-label={`Unarchive ${task.title}`}
          >
            Unarchive
          </Button>
        )}
        {actions && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
            aria-label={`Delete ${task.title}`}
          >
            Delete
          </Button>
        )}
        {actions && showMove && canAct && (
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || isFirst}
              onClick={() => void run("move-up", () => actions.onMove(task, "up"))}
              aria-label={`Move ${task.title} up`}
            >
              Move up
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || isLast}
              onClick={() => void run("move-down", () => actions.onMove(task, "down"))}
              aria-label={`Move ${task.title} down`}
            >
              Move down
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-500">
          {error.message}
        </p>
      )}
    </div>
  );
}
