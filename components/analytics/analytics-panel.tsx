"use client";

import { useEffect, useState } from "react";
import type { AnalyticsSummary } from "@/lib/analytics/service";
import { AnalyticsApiError, getSummary, type AnalyticsPeriod } from "./api";
import { Button } from "../ui/button";

const PERIODS: Array<{ value: AnalyticsPeriod; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
];

const CHART_WIDTH = 700;
const CHART_HEIGHT = 140;
const BAR_WIDTH = 72;
const BAR_GAP = 28;
const LABEL_HEIGHT = 24;

function maxMinutes(summary: AnalyticsSummary): number {
  return summary.daily.reduce((max, day) => Math.max(max, day.minutes), 0);
}

function chartLabel(summary: AnalyticsSummary): string {
  const parts = summary.daily.map(
    (day) => `${day.date} ${day.minutes}`,
  );
  return `Bar chart of focus minutes, ${parts.join(", ")}. Full data in the table below.`;
}

function rateLabel(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)}% completion`;
}

function averageLabel(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = Math.round(seconds / 60);
  return `${minutes} min average`;
}

function shortDay(date: string): string {
  // `YYYY-MM-DD` bucket key → `MM-DD` axis label (the table has the full date).
  return date.length === 10 ? date.slice(5) : date;
}

function isEmpty(summary: AnalyticsSummary): boolean {
  return (
    summary.totals.completedFocusIntervals === 0 &&
    summary.totals.cancelledFocusIntervals === 0
  );
}

interface AnalyticsView {
  key: string;
  summary: AnalyticsSummary | null;
  error: string | null;
}

/**
 * Individual analytics (spec §8.9, prototype `analytics.html`): metric
 * cards, native-SVG daily bars with a full table equivalent, and ranked
 * by-task / by-category lists over Today + rolling-7d periods.
 *
 * Accessibility (spec §12.3): the chart is one `role="img"` whose name
 * carries the data, the table below repeats every value, bars are static
 * (no motion to reduce), and nothing is conveyed by color alone — every
 * value also appears as text. Empty analytics explain the next action
 * instead of rendering bare zeros.
 */
export function AnalyticsPanel() {
  const [period, setPeriod] = useState<AnalyticsPeriod>("7d");
  const [reloadToken, setReloadToken] = useState(0);
  const key = `${period}:${reloadToken}`;
  const [view, setView] = useState<AnalyticsView | null>(null);

  useEffect(() => {
    if (view?.key === key) return;
    const requestKey = key;
    let cancelled = false;
    void getSummary({ period }).then(
      (result) => {
        if (!cancelled) {
          setView({ key: requestKey, summary: result, error: null });
        }
      },
      (failure: unknown) => {
        if (!cancelled) {
          setView({
            key: requestKey,
            summary: null,
            error:
              failure instanceof AnalyticsApiError
                ? failure.message
                : "Something went wrong. Check your connection and retry.",
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // `view` is read only as a freshness guard; the continuation writes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, period]);

  function refresh() {
    setReloadToken((token) => token + 1);
  }

  const summary = view?.key === key ? view.summary : null;
  const error = view?.key === key ? view.error : null;
  const loading = summary === null && error === null;
  const heading =
    period === "today" ? "Analytics — today" : "Analytics — last 7 days";

  return (
    <div className="grid min-w-0 gap-4">
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
                name="analytics-period"
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

      {loading && <p role="status">Loading analytics…</p>}
      {error && (
        <div className="grid gap-2">
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
          <div>
            <Button type="button" variant="ghost" onClick={refresh}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {summary && (
        <div className="grid min-w-0 gap-4">
          <h2 className="text-base font-semibold">{heading}</h2>

          {isEmpty(summary) && (
            <p>
              No completed focus yet in this period — complete a focus
              interval and it shows up here.
            </p>
          )}

          <div role="group" aria-label="Focus metrics">
          <dl className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-3">
            <div className="rounded-md border p-3">
              <dt className="text-sm opacity-80">Focus minutes</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {summary.totals.completedFocusMinutes} focus minutes
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-sm opacity-80">Focus intervals</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {summary.totals.completedFocusIntervals} focus intervals
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-sm opacity-80">Tasks completed</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {summary.totals.completedTasks} tasks done
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-sm opacity-80">Completion rate</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {rateLabel(summary.totals.completionRate)}
              </dd>
            </div>
            <div className="rounded-md border p-3">
              <dt className="text-sm opacity-80">Average focus length</dt>
              <dd className="text-xl font-semibold tabular-nums">
                {averageLabel(summary.totals.averageCompletedSeconds)}
              </dd>
            </div>
          </dl>
          </div>

          {summary.daily.length > 0 && (
            <section aria-labelledby="daily-heading" className="grid gap-2">
              <h3 id="daily-heading" className="text-sm font-semibold">
                Daily focus minutes
              </h3>
              <svg
                role="img"
                aria-label={chartLabel(summary)}
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                className="h-auto w-full"
              >
                {summary.daily.map((day, index) => {
                  const max = maxMinutes(summary);
                  const plotHeight = CHART_HEIGHT - LABEL_HEIGHT - 20;
                  const height =
                    max > 0
                      ? Math.max(
                          day.minutes > 0 ? 4 : 0,
                          Math.round((day.minutes / max) * plotHeight),
                        )
                      : 0;
                  const x = index * (BAR_WIDTH + BAR_GAP);
                  const y = plotHeight + 16 - height;
                  return (
                    <g key={day.date}>
                      <rect
                        x={x}
                        y={y}
                        width={BAR_WIDTH}
                        height={height}
                        rx={4}
                        className="fill-primary"
                      />
                      <text
                        x={x + BAR_WIDTH / 2}
                        y={y - 4}
                        textAnchor="middle"
                        fontSize={12}
                        className="fill-foreground"
                      >
                        {day.minutes}
                      </text>
                      <text
                        x={x + BAR_WIDTH / 2}
                        y={CHART_HEIGHT - 4}
                        textAnchor="middle"
                        fontSize={12}
                        className="fill-foreground"
                      >
                        {shortDay(day.date)}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <div
                className="min-w-0 overflow-x-auto rounded-md border"
                tabIndex={0}
                role="region"
                aria-label="Daily focus minutes (scrollable table)"
              >
                <table className="w-full border-collapse text-sm">
                  <caption className="px-3 py-2 text-left font-medium">
                    Daily focus minutes (text equivalent of the chart)
                  </caption>
                  <thead>
                    <tr className="border-b">
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        Day
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        Minutes
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        Intervals
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.daily.map((day) => (
                      <tr key={day.date} className="border-b last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap">{day.date}</td>
                        <td className="px-3 py-2 tabular-nums">{day.minutes}</td>
                        <td className="px-3 py-2 tabular-nums">{day.intervals}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section aria-labelledby="by-task-heading" className="grid gap-2">
            <h3 id="by-task-heading" className="text-sm font-semibold">
              By task
            </h3>
            {summary.byTask.length === 0 ? (
              <p>
                {period === "today"
                  ? "No completed tasks today yet — complete a task and it shows up here."
                  : "No completed tasks this week yet — complete a task and it shows up here."}
              </p>
            ) : (
              <div
                className="min-w-0 overflow-x-auto rounded-md border"
                tabIndex={0}
                role="region"
                aria-label="Focus minutes by task (scrollable table)"
              >
                <table className="w-full border-collapse text-sm">
                  <caption className="px-3 py-2 text-left font-medium">
                    Focus minutes grouped by task
                  </caption>
                  <thead>
                    <tr className="border-b">
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        Task
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        Minutes
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        Intervals
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byTask.map((entry) => (
                      <tr
                        key={entry.taskId ?? "unassigned"}
                        className="border-b last:border-0"
                      >
                        <td className="px-3 py-2">
                          {entry.title ?? "Unassigned"}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{entry.minutes}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {entry.intervals}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {summary.byCategory.length > 0 ? (
            <section aria-labelledby="by-category-heading" className="grid gap-2">
              <h3 id="by-category-heading" className="text-sm font-semibold">
                By category
              </h3>
              <div
                className="min-w-0 overflow-x-auto rounded-md border"
                tabIndex={0}
                role="region"
                aria-label="Focus minutes by category (scrollable table)"
              >
                <table className="w-full border-collapse text-sm">
                  <caption className="px-3 py-2 text-left font-medium">
                    Focus minutes grouped by category
                  </caption>
                  <thead>
                    <tr className="border-b">
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        Category
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        Minutes
                      </th>
                      <th scope="col" className="px-3 py-2 text-left font-semibold">
                        Intervals
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byCategory.map((entry) => (
                      <tr
                        key={entry.category ?? "uncategorized"}
                        className="border-b last:border-0"
                      >
                        <td className="px-3 py-2">
                          {entry.category ?? "Uncategorized"}
                        </td>
                        <td className="px-3 py-2 tabular-nums">{entry.minutes}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {entry.intervals}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : summary.byTask.length > 0 ? (
            <section aria-labelledby="by-category-heading" className="grid gap-2">
              <h3 id="by-category-heading" className="text-sm font-semibold">
                By category
              </h3>
              <p>
                No categories with focus here yet — add a category to a task
                and its focus shows up here.
              </p>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
