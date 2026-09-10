"use client";

import { useEffect, useState } from "react";
import type { PublicHistorySession } from "@/lib/sessions/service";
import {
  HistoryApiError,
  listSessions,
  type HistoryPeriod,
  type HistoryType,
} from "./api";
import { Button } from "../ui/button";

const PERIODS: Array<{ value: HistoryPeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const TYPES: Array<{ value: HistoryType; label: string }> = [
  { value: "all", label: "All types" },
  { value: "focus", label: "Focus only" },
];

const TYPE_LABELS: Record<PublicHistorySession["intervalType"], string> = {
  focus: "Focus",
  short_break: "Short break",
  long_break: "Long break",
};

function statusLabel(session: PublicHistorySession): string {
  if (session.status === "cancelled") return "Cancelled";
  if (
    session.actualDurationSeconds !== null &&
    session.actualDurationSeconds < session.plannedDurationSeconds
  ) {
    return "Completed early";
  }
  return "Completed";
}

function actualLabel(session: PublicHistorySession): string {
  if (session.actualDurationSeconds === null) return "—";
  return `${Math.max(0, Math.round(session.actualDurationSeconds / 60))} min`;
}

function startedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/** Completion or cancellation time (spec §8.8) — every listed row is finalized. */
function endedAt(session: PublicHistorySession): string | null {
  return session.completedAt ?? session.cancelledAt;
}

function emptyCopy(period: HistoryPeriod, type: HistoryType): string {
  if (type === "focus") {
    return "No focus intervals here yet. Switch to All types to include breaks, or start a focus interval from the Focus page.";
  }
  if (period === "today") {
    return "No intervals today yet. Start a focus interval from the Focus page and it shows up here.";
  }
  const days = period === "7d" ? "7" : "30";
  return `No intervals in the last ${days} days yet. Start a focus interval from the Focus page and it shows up here.`;
}

interface HistoryView {
  key: string;
  items: PublicHistorySession[];
  nextCursor: string | null;
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
}

/**
 * Session history (spec §8.8, prototype `history.html`): reverse-chron
 * read-only table with Today / 7d / 30d + Focus-only / All-types filters
 * and cursor pagination. Deleted tasks stay legible through their stored
 * snapshots; a null snapshot renders as "Unassigned" (spec §8.8). Status
 * is text ("Completed", "Completed early", "Cancelled") — never color
 * alone (spec §12.3). Empty states guide the next action.
 */
export function HistoryPanel() {
  const [period, setPeriod] = useState<HistoryPeriod>("7d");
  const [type, setType] = useState<HistoryType>("all");
  const [reloadToken, setReloadToken] = useState(0);
  const key = `${period}:${type}:${reloadToken}`;
  const [view, setView] = useState<HistoryView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (view?.key === key) return;
    const requestKey = key;
    let cancelled = false;
    void listSessions({ period, type }).then(
      ({ sessions, nextCursor }) => {
        if (!cancelled) {
          setView({
            key: requestKey,
            items: sessions,
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
              error instanceof HistoryApiError
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
  }, [key, period, type]);

  const rows = view?.key === key ? view.items : null;
  const nextCursor = view?.key === key ? view.nextCursor : null;
  const loadError = view?.key === key ? view.error : null;
  const loadingMore = view?.key === key ? view.loadingMore : false;
  const moreError = view?.key === key ? view.moreError : null;
  const loading = rows === null;

  function refresh() {
    setReloadToken((token) => token + 1);
  }

  async function handleLoadMore() {
    if (!view || view.key !== key || view.loadingMore || !view.nextCursor) {
      return;
    }
    const cursor = view.nextCursor;
    const requestKey = key;
    setView({ ...view, loadingMore: true, moreError: null });
    try {
      const { sessions: page, nextCursor: following } = await listSessions({
        period,
        type,
        cursor,
      });
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
        `Loaded ${page.length} more ${page.length === 1 ? "session" : "sessions"}.`,
      );
    } catch (error) {
      setView((current) =>
        current && current.key === requestKey
          ? {
              ...current,
              loadingMore: false,
              moreError:
                error instanceof HistoryApiError
                  ? error.message
                  : "Something went wrong. Check your connection and retry.",
            }
          : current,
      );
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap gap-4">
        <fieldset>
          <legend className="text-sm font-medium">Period</legend>
          <div className="mt-1 flex flex-wrap gap-1">
            {PERIODS.map(({ value, label }) => (
              <label
                key={value}
                className="cursor-pointer rounded-md border px-3 py-1.5 text-sm has-checked:border-primary has-checked:font-semibold focus-within:ring-2 focus-within:ring-primary"
              >
                <input
                  type="radio"
                  name="history-period"
                  value={value}
                  checked={period === value}
                  onChange={() => setPeriod(value)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium">Interval type</legend>
          <div className="mt-1 flex flex-wrap gap-1">
            {TYPES.map(({ value, label }) => (
              <label
                key={value}
                className="cursor-pointer rounded-md border px-3 py-1.5 text-sm has-checked:border-primary has-checked:font-semibold focus-within:ring-2 focus-within:ring-primary"
              >
                <input
                  type="radio"
                  name="history-type"
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value)}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="grid min-w-0 gap-2">
        {loading && <p role="status">Loading history…</p>}
        {!loading && notice && <p role="status">{notice}</p>}
        {loadError && (
          <div className="grid gap-2">
            <p role="alert" className="text-sm text-red-500">
              {loadError}
            </p>
            <div>
              <Button type="button" variant="ghost" onClick={refresh}>
                Retry
              </Button>
            </div>
          </div>
        )}
        {!loading && !loadError && rows !== null && rows.length === 0 && (
          <p>{emptyCopy(period, type)}</p>
        )}
        {!loading && !loadError && rows !== null && rows.length > 0 && (
          <>
            <div
              className="min-w-0 overflow-x-auto rounded-md border"
              tabIndex={0}
              role="region"
              aria-label="Recent intervals (scrollable table)"
            >
              <table className="w-full border-collapse text-sm">
                <caption className="px-3 py-2 text-left font-medium">
                  Recent intervals
                </caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Type
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Task
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Started
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Ended
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Actual
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-semibold">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((session) => (
                    <tr key={session.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        {TYPE_LABELS[session.intervalType]}
                      </td>
                      <td className="px-3 py-2">
                        {session.taskTitleSnapshot ?? "Unassigned"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <time dateTime={session.startedAt}>
                          {startedLabel(session.startedAt)}
                        </time>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {endedAt(session) ? (
                          <time dateTime={endedAt(session)!}>
                            {startedLabel(endedAt(session)!)}
                          </time>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {actualLabel(session)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {statusLabel(session)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {nextCursor !== null && (
              <div className="grid gap-2">
                {moreError && (
                  <p role="alert" className="text-sm text-red-500">
                    {moreError}
                  </p>
                )}
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={loadingMore}
                    onClick={() => void handleLoadMore()}
                  >
                    {loadingMore ? "Loading…" : "Load more sessions"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
