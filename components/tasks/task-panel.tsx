"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicTask } from "@/lib/tasks/service";
import {
  TaskApiError,
  archiveTask,
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  reopenTask,
  reorderTasks,
  unarchiveTask,
  updateTask,
  type TaskFilter,
  type UpdateTaskValues,
} from "./api";
import { TaskItem, type MoveDirection } from "./task-item";
import { Button } from "../ui/button";

const TITLE_INPUT_ID = "task-quick-add-title";
const TITLE_ERROR_ID = `${TITLE_INPUT_ID}-error`;

/**
 * localStorage key for the focus selection: the selected task id, plain.
 * The workspace timer slot resolves it against loaded rows (and the timer
 * API in milestone 3 resolves the id server-side) — UI state only, never
 * logged. Only an *active* task id is ever stored: completing, archiving,
 * or deleting the selected task clears it, as does loading a complete
 * active set that no longer contains it.
 */
export const SELECTED_TASK_KEY = "focusflow-selected-task";

const FILTERS: Array<{ value: TaskFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

const EMPTY_COPY: Record<TaskFilter, string> = {
  active: "No active tasks yet. Add your first task above to start focusing.",
  completed: "No completed tasks yet. Complete a task to see it here.",
  archived: "No archived tasks yet.",
  all: "No tasks yet. Add your first task above to start focusing.",
};

/** The stored selection is an opaque id — shape-checked, never trusted. */
function readStoredSelectionId(): string | null {
  try {
    const raw = window.localStorage.getItem(SELECTED_TASK_KEY);
    return raw !== null && raw !== "" ? raw : null;
  } catch {
    return null;
  }
}

interface TaskPanelProps {
  /** Notified whenever the focus selection resolves to a task (or clears). */
  onSelectionChange?: (task: PublicTask | null) => void;
}

/**
 * One filter view: the first page plus any appended "load more" pages.
 * `key` names the request the pages belong to, so loading is derived
 * (`view.key !== key`) instead of reset via setState-in-effect.
 */
interface ListView {
  key: string;
  items: PublicTask[];
  nextCursor: string | null;
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
}

/**
 * Task list + quick-add (spec §8.2, prototype `workspace.html` sidebar).
 * Data-thin: every mutation refetches the current filter so order and
 * pagination stay server-truthful. Announcements use a polite status region
 * plus an assertive alert for failures (spec §12.3); no task content reaches
 * logs.
 */
export function TaskPanel({ onSelectionChange }: TaskPanelProps = {}) {
  const [filter, setFilter] = useState<TaskFilter>("active");
  const [reloadToken, setReloadToken] = useState(0);
  const key = `${filter}:${reloadToken}`;
  const [view, setView] = useState<ListView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [titleErrors, setTitleErrors] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readStoredSelectionId(),
  );
  const announcedSelection = useRef<string | null>(null);
  const validatedSelection = useRef(false);

  useEffect(() => {
    if (view?.key === key) return;
    const requestKey = key;
    const currentFilter = filter;
    let cancelled = false;
    void listTasks(currentFilter).then(
      ({ tasks: rows, nextCursor }) => {
        if (!cancelled) {
          setView({
            key: requestKey,
            items: rows,
            nextCursor,
            error: null,
            loadingMore: false,
            moreError: null,
          });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setView({
            key: requestKey,
            items: [],
            nextCursor: null,
            error:
              error instanceof TaskApiError
                ? error.message
                : "Something went wrong. Check your connection and retry.",
            loadingMore: false,
            moreError: null,
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // `view` is read only as a freshness guard; the continuation writes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, filter]);

  const rows = view?.key === key ? view.items : null;
  const nextCursor = view?.key === key ? view.nextCursor : null;
  const loadError = view?.key === key ? view.error : null;
  const loadingMore = view?.key === key ? view.loadingMore : false;
  const moreError = view?.key === key ? view.moreError : null;

  // Resolve the remembered selection against loaded rows so the workspace
  // timer slot learns the full task exactly once per selection. Notifying
  // the parent writes no local state, so this stays outside the
  // set-state-in-effect rule by construction.
  useEffect(() => {
    if (!rows || !selectedId || announcedSelection.current === selectedId)
      return;
    const match = rows.find((task) => task.id === selectedId);
    if (match) {
      announcedSelection.current = selectedId;
      onSelectionChange?.(match);
    }
  }, [rows, selectedId, onSelectionChange]);

  // Stale-selection sweep: once a *complete* active set is in hand (no more
  // pages), a remembered id that isn't an active task can never back a focus
  // interval, so forget it instead of carrying a phantom selection.
  // Filtered views never sweep — their rows can't prove staleness.
  useEffect(() => {
    if (
      validatedSelection.current ||
      !rows ||
      filter !== "active" ||
      nextCursor !== null ||
      !selectedId
    ) {
      return;
    }
    validatedSelection.current = true;
    if (!rows.some((task) => task.id === selectedId)) {
      clearSelection(selectedId);
    }
    // `clearSelection` is stable-by-construction (state setters + ref);
    // listed for the exhaustive-deps rule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filter, nextCursor, selectedId]);

  function persistSelection(id: string) {
    try {
      window.localStorage.setItem(SELECTED_TASK_KEY, id);
    } catch {
      // Storage unavailable (private mode) — selection still applies.
    }
  }

  function handleSelect(task: PublicTask) {
    setSelectedId(task.id);
    announcedSelection.current = task.id;
    persistSelection(task.id);
    setNotice(`${task.title} selected for focus.`);
    onSelectionChange?.(task);
  }

  function clearSelection(taskId: string) {
    if (selectedId !== taskId) return;
    setSelectedId(null);
    announcedSelection.current = null;
    try {
      window.localStorage.removeItem(SELECTED_TASK_KEY);
    } catch {
      // Storage unavailable — in-memory selection still clears.
    }
    onSelectionChange?.(null);
  }

  function refresh() {
    setReloadToken((token) => token + 1);
  }

  // Every mutation below throws `TaskApiError` on failure (the row displays
  // it inline) and refetches only on success, so a failure — including the
  // timer-lock 409 — never rewrites or drops the row (spec §8.2).
  async function mutate(
    task: PublicTask,
    pastTense: string,
    fn: (id: string) => Promise<PublicTask>,
    clearsSelection: boolean,
  ) {
    await fn(task.id);
    if (clearsSelection) clearSelection(task.id);
    setNotice(`${task.title} ${pastTense}.`);
    refresh();
  }

  async function handleComplete(task: PublicTask) {
    await mutate(task, "completed", completeTask, true);
  }

  async function handleReopen(task: PublicTask) {
    await mutate(task, "reopened", reopenTask, false);
  }

  async function handleArchive(task: PublicTask) {
    await mutate(task, "archived", archiveTask, true);
  }

  async function handleUnarchive(task: PublicTask) {
    await mutate(task, "unarchived", unarchiveTask, false);
  }

  async function handleDelete(task: PublicTask) {
    await mutate(task, "deleted", deleteTask, true);
  }

  async function handleMove(task: PublicTask, direction: MoveDirection) {
    const active = (rows ?? []).filter((row) => row.status === "active");
    const index = active.findIndex((row) => row.id === task.id);
    const swap = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swap < 0 || swap >= active.length) return;
    const ids = active.map((row) => row.id);
    [ids[index], ids[swap]] = [ids[swap]!, ids[index]!];
    // Full-order contract (issue 07): the complete active set, not a delta.
    // The UI only offers moves when every page is loaded (see `showMove`),
    // so `active` here is always the whole set.
    await reorderTasks(ids);
    setNotice("Task order updated.");
    refresh();
  }

  async function handleSaveEdit(task: PublicTask, values: UpdateTaskValues) {
    const updated = await updateTask(task.id, values);
    setNotice(`${updated.title} updated.`);
    refresh();
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (adding) return;
    setAdding(true);
    setTitleErrors([]);
    try {
      await createTask({ title });
      setTitle("");
      setFilter("active");
      setNotice("Task added.");
      refresh();
    } catch (error) {
      if (error instanceof TaskApiError && error.fields.title) {
        setTitleErrors(error.fields.title);
      } else {
        setTitleErrors([
          error instanceof TaskApiError
            ? error.message
            : "Something went wrong. Check your connection and retry.",
        ]);
      }
    } finally {
      setAdding(false);
    }
  }

  /**
   * Cursor pagination (spec §11.5: completed-task lists paginate): appends
   * the next server page to this filter view. Failures stay on a row-level
   * alert with the same button as the retry — nothing already loaded moves.
   */
  async function handleLoadMore() {
    if (!view || view.key !== key || view.loadingMore || !view.nextCursor)
      return;
    const cursor = view.nextCursor;
    const currentFilter = filter;
    const requestKey = key;
    setView({ ...view, loadingMore: true, moreError: null });
    try {
      const { tasks: page, nextCursor: following } = await listTasks(
        currentFilter,
        cursor,
      );
      setView((current) =>
        current && current.key === requestKey
          ? {
              ...current,
              items: [...current.items, ...page],
              nextCursor: following,
              loadingMore: false,
            }
          : current,
      );
      setNotice(
        `Loaded ${page.length} more ${page.length === 1 ? "task" : "tasks"}.`,
      );
    } catch (error) {
      setView((current) =>
        current && current.key === requestKey
          ? {
              ...current,
              loadingMore: false,
              moreError:
                error instanceof TaskApiError
                  ? error.message
                  : "Something went wrong. Check your connection and retry.",
            }
          : current,
      );
    }
  }

  const loading = rows === null;
  const invalid = titleErrors.length > 0;
  // Reorder needs the whole active set (issue 07 full-order contract), so
  // move affordances wait until every page is loaded.
  const completeSet = !loading && nextCursor === null;

  return (
    // min-w-0: grid items floor at descendant min-content by default and
    // would prize the track wider than 320px viewports (spec §12.4); every
    // inner row already wraps, so shrinking to the track is safe.
    <aside aria-labelledby="tasks-heading" className="min-w-0 rounded-md border p-4">
      <h2 id="tasks-heading" className="text-base font-semibold">
        Tasks
      </h2>
      <form
        onSubmit={(e) => void handleAdd(e)}
        className="mt-3 grid gap-2"
        aria-label="Quick add"
      >
        <label htmlFor={TITLE_INPUT_ID} className="text-sm font-medium">
          Quick add
        </label>
        <div className="flex gap-2">
          <input
            id={TITLE_INPUT_ID}
            type="text"
            placeholder="New task title"
            aria-label="New task title"
            maxLength={200}
            autoComplete="off"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? TITLE_ERROR_ID : undefined}
            className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <Button type="submit" disabled={adding}>
            {adding ? "Adding…" : "Add"}
          </Button>
        </div>
        {invalid && (
          <p id={TITLE_ERROR_ID} role="alert" className="text-sm text-red-500">
            {titleErrors.join(" ")}
          </p>
        )}
      </form>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium">Filter tasks</legend>
        <div className="mt-1 flex flex-wrap gap-1">
          {FILTERS.map(({ value, label }) => (
            <label
              key={value}
              className="cursor-pointer rounded-md border px-3 py-1.5 text-sm has-checked:border-primary has-checked:font-semibold focus-within:ring-2 focus-within:ring-primary"
            >
              <input
                type="radio"
                name="task-filter"
                value={value}
                checked={filter === value}
                onChange={() => setFilter(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        {loading && <p role="status">Loading tasks…</p>}
        {!loading && notice && <p role="status">{notice}</p>}
        {loadError && (
          <div className="grid gap-2">
            <p role="alert" className="text-sm text-red-500">
              {loadError}
            </p>
            <Button type="button" variant="ghost" onClick={refresh}>
              Retry
            </Button>
          </div>
        )}
        {!loading && !loadError && rows !== null && rows.length === 0 && (
          <p>{EMPTY_COPY[filter]}</p>
        )}
        {!loading && !loadError && rows !== null && rows.length > 0 && (
          <>
            <ul aria-label="Tasks" className="grid gap-2">
              {rows.map((task, index) => (
                <li
                  key={task.id}
                  className="rounded-md border p-3 focus-within:ring-2 focus-within:ring-primary"
                >
                  <TaskItem
                    task={task}
                    selected={task.id === selectedId}
                    showSelect={task.status === "active"}
                    onSelect={handleSelect}
                    actions={{
                      onComplete: handleComplete,
                      onReopen: handleReopen,
                      onArchive: handleArchive,
                      onUnarchive: handleUnarchive,
                      onDelete: handleDelete,
                      onMove: handleMove,
                      onSaveEdit: handleSaveEdit,
                    }}
                    showMove={filter === "active" && completeSet}
                    isFirst={index === 0}
                    isLast={index === rows.length - 1}
                  />
                </li>
              ))}
            </ul>
            {nextCursor !== null && (
              <div className="mt-3 grid gap-2">
                {moreError && (
                  <p role="alert" className="text-sm text-red-500">
                    {moreError}
                  </p>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={loadingMore}
                  onClick={() => void handleLoadMore()}
                >
                  {loadingMore ? "Loading…" : "Load more tasks"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
