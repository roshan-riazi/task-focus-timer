"use client";

import { useState } from "react";
import type { PublicTask } from "@/lib/tasks/service";
import { TimerPanel } from "../timer/timer-panel";
import { TaskPanel } from "./task-panel";

/**
 * Focus workspace (spec §9.3, prototype `workspace.html`): task list with
 * quick-add on the left, timer in the main area. The selected task links
 * the next start; a running interval keeps its server snapshot instead
 * (spec §8.2 — no task switch mid-interval).
 */
export function Workspace() {
  const [selected, setSelected] = useState<PublicTask | null>(null);

  return (
    <div className="grid items-start gap-4 md:grid-cols-[18rem_1fr]">
      <TaskPanel onSelectionChange={setSelected} />
      <section
        aria-labelledby="focus-heading"
        className="order-first min-w-0 rounded-md border p-4 md:order-none"
      >
        <h1 id="focus-heading" className="text-base font-semibold">
          {selected ? `Focus · ${selected.title}` : "Focus"}
        </h1>
        {selected ? (
          <p className="mt-2 text-sm">
            Lined up for your next focus interval:{" "}
            <strong>{selected.title}</strong>
          </p>
        ) : (
          <p className="mt-2 text-sm opacity-80">
            Select a task to line up your next focus interval.
          </p>
        )}
        <div className="mt-4">
          <TimerPanel selectedTask={selected} />
        </div>
      </section>
    </div>
  );
}
