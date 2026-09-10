"use client";

import { useState } from "react";
import type { PublicTask } from "@/lib/tasks/service";
import { TaskPanel } from "./task-panel";

/**
 * Focus workspace (spec §9.3, prototype `workspace.html`): task list with
 * quick-add on the left, timer in the main area. The timer itself lands in
 * milestone 3 (issue 12) — this slot only mirrors the focus selection so
 * task→timer wiring is already exercised keyboard-first. No timer logic here.
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
        <p className="mt-2 text-xs opacity-70">
          The focus timer lands in milestone 3 — task selection already works
          with keyboard only.
        </p>
      </section>
    </div>
  );
}
