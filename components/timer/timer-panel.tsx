"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CurrentResult,
  FinalizeResult,
  IntervalType,
  PublicSession,
} from "@/lib/timer/service";
import {
  TimerApiError,
  cancelTimer,
  completeTimer,
  getCurrentTimer,
  pauseTimer,
  resumeTimer,
  skipBreakTimer,
  startTimer,
} from "./api";
import {
  formatRemaining,
  isExpired,
  progressPercent,
  remainingSeconds,
} from "./time";
import { Button } from "../ui/button";
import { getSettings } from "@/components/settings/api";
import { ensureAudioUnlocked, playAlarm } from "@/lib/alarms/player";
import type { AlarmMoment } from "@/lib/alarms/presets";
import { notifyIntervalComplete } from "@/lib/notifications/notify";
import { SOUND_PRESETS, type SoundPreset } from "@/lib/settings/validation";

const RING_RADIUS = 56;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const INTERVAL_LABELS: Record<IntervalType, string> = {
  focus: "Focus",
  short_break: "Short break",
  long_break: "Long break",
};

const INTERVAL_OPTIONS: IntervalType[] = ["focus", "short_break", "long_break"];

export interface TimerSelectedTask {
  id: string;
  title: string;
}

interface TimerPanelProps {
  /** Task to link on start. Ignored by a running interval: the link is fixed
   * at start (spec §8.2 — a task cannot be changed mid-interval) and the
   * panel shows the server snapshot instead. */
  selectedTask?: TimerSelectedTask | null;
  /** Re-render cadence for the timestamp-derived display. Exposed for tests;
   * production uses 1s. Ticks only repaint — truth stays server-side. */
  tickMs?: number;
}

function plannedMinutes(session: PublicSession): number {
  return Math.max(1, Math.round(session.plannedDurationSeconds / 60));
}

interface AlarmSoundSettings {
  soundEnabled: boolean;
  soundPreset: SoundPreset;
  soundVolume: number;
  notificationsEnabled: boolean;
}

const DEFAULT_ALARM_SETTINGS: AlarmSoundSettings = {
  soundEnabled: true,
  soundPreset: "chime",
  soundVolume: 80,
  notificationsEnabled: false,
};

function toAlarmMoment(intervalType: IntervalType): AlarmMoment {
  return intervalType === "focus" ? "focus-end" : "break-end";
}

function sanitizeAlarmSettings(value: unknown): AlarmSoundSettings {
  if (value === null || typeof value !== "object") return DEFAULT_ALARM_SETTINGS;
  const record = value as Record<string, unknown>;
  const preset = record.soundPreset;
  const volume = record.soundVolume;
  return {
    soundEnabled:
      typeof record.soundEnabled === "boolean"
        ? record.soundEnabled
        : DEFAULT_ALARM_SETTINGS.soundEnabled,
    soundPreset: (
      typeof preset === "string" &&
      (SOUND_PRESETS as readonly string[]).includes(preset)
        ? preset
        : DEFAULT_ALARM_SETTINGS.soundPreset
    ) as SoundPreset,
    soundVolume:
      typeof volume === "number" &&
      Number.isInteger(volume) &&
      volume >= 0 &&
      volume <= 100
        ? volume
        : DEFAULT_ALARM_SETTINGS.soundVolume,
    notificationsEnabled:
      typeof record.notificationsEnabled === "boolean"
        ? record.notificationsEnabled
        : DEFAULT_ALARM_SETTINGS.notificationsEnabled,
  };
}

/**
 * Focus timer (spec §8.3–§8.4, prototype `workspace.html` timer section).
 * Server-authoritative: `GET current` restores on mount and reconciles on
 * visibility return; the 1s tick only repaints from the stored stamps.
 * State changes announce once via a polite status region; the ticking clock
 * stays `aria-hidden` and the ring (progressbar role) carries the numeric
 * value without a live region (spec §12.3 — no per-tick announcements).
 *
 * Alarms (issue 13, spec §8.6, SYSTEM_DESIGN §4): a completed finalize
 * plays the saved preset at the set volume — focus-end vs break-end
 * patterns stay distinct — and raises a browser notification when enabled
 * and permitted. Cancelled finalizes (cancel/skip/discard) stay silent.
 * Sound is best-effort and never blocks finalization; denial/unsupported
 * audio degrades to silent + the visual status announcement, and task
 * titles never reach audio/notification payloads (only the interval moment
 * travels — spec §12.2).
 */
export function TimerPanel({ selectedTask = null, tickMs = 1000 }: TimerPanelProps) {
  const [current, setCurrent] = useState<CurrentResult | null>(null);
  const [announcement, setAnnouncement] = useState("Loading timer…");
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [chosen, setChosen] = useState<IntervalType>("focus");
  const [tick, setTick] = useState(0);

  // Announce each distinct timer state once: visibility polls and ticks
  // must not repeat the live region (spec §12.3).
  const lastSignature = useRef<string | null>(null);
  // Expiry tripwire fires one reconcile per session id.
  const reconcileGuard = useRef<string | null>(null);
  // The user-picked interval wins over the server proposal afterwards.
  const choseManually = useRef(false);
  // Focus return for the expiry dialog (spec §12.3 focus management).
  const returnFocusTo = useRef<Element | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasPending = useRef(false);
  // Keyboard continuity after actions (see the retention effect below).
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const expectFocusMove = useRef(false);
  const [actionCount, setActionCount] = useState(0);
  // Saved alarm preferences (issue 13): read fresh on every finalize
  // that needs them — never cached across intervals, so a settings change
  // between intervals applies to the next moment (spec: correct preset at
  // the set volume on *each* moment). Lazy (not on mount) so normal mounts
  // keep the single `GET current` fetch — issue 12's restore / reconcile
  // timing stays untouched. Failures/malformed payloads fall back to the
  // defaults; no state, so playback never re-renders.
  const loadAlarmSettings = useCallback((): Promise<AlarmSoundSettings> => {
    return (async () => {
      try {
        return sanitizeAlarmSettings(await getSettings());
      } catch {
        return DEFAULT_ALARM_SETTINGS;
      }
    })();
  }, []);

  // Rendered from the server stamps on every paint — never stored.
  const nowMs = Date.now();

  function signatureOf(result: CurrentResult): string {
    return [
      result.session
        ? `${result.session.id}:${result.session.status}:${result.session.expectedEndAt}`
        : "idle",
      result.reconciled ? `reconciled:${result.reconciled.id}` : "no-reconcile",
      result.pendingConfirmation
        ? `pending:${result.pendingConfirmation.session.id}`
        : "no-pending",
      result.autoStarted ? `auto:${result.autoStarted.id}` : "no-auto",
    ].join("|");
  }

  function announceFor(result: CurrentResult): string {
    if (result.pendingConfirmation) {
      const minutes = plannedMinutes(result.pendingConfirmation.session);
      return (
        `Your ${minutes}-minute interval expired over 60 minutes ago. ` +
        `Complete it to count the minutes, or discard it.`
      );
    }
    if (result.reconciled) {
      return "Expired interval completed and reconciled.";
    }
    const session = result.session;
    if (!session) {
      return result.next
        ? `No interval running. Up next: ${INTERVAL_LABELS[result.next.intervalType]}.`
        : "No interval running.";
    }
    const label = INTERVAL_LABELS[session.intervalType];
    if (session.status === "paused") {
      return `${label} paused — remaining time is frozen; paused time never counts.`;
    }
    return `${label} interval running — ${formatRemaining(remainingSeconds(session, Date.now()))} left.`;
  }

  /**
   * Fire the finalize feedback for a completed interval: the saved preset
   * at the set volume plus a browser notification when enabled. Only the
   * interval *moment* travels — never task titles/snapshots (spec §12.2).
   * Best-effort and never throws, so denial/unsupported audio degrades to
   * silent + the visual status announcement.
   */
  const soundForFinalized = useCallback((session: PublicSession) => {
    if (session.status !== "completed") return;
    const moment = toAlarmMoment(session.intervalType);
    void (async () => {
      let settings: AlarmSoundSettings;
      try {
        settings = await loadAlarmSettings();
      } catch {
        settings = DEFAULT_ALARM_SETTINGS;
      }
      try {
        await playAlarm({
          preset: settings.soundPreset,
          moment,
          volume: settings.soundVolume,
          soundEnabled: settings.soundEnabled,
        });
      } catch {
        // Player already degrades to silent; this guards the seam.
      }
      try {
        await notifyIntervalComplete(moment, {
          notificationsEnabled: settings.notificationsEnabled,
        });
      } catch {
        // Denial stays silent + visual (issue 13 validation).
      }
    })();
  }, [loadAlarmSettings]);

  const refresh = useCallback(async () => {
    try {
      const result = await getCurrentTimer();
      setCurrent(result);
      setError(null);
      const signature = signatureOf(result);
      if (lastSignature.current !== signature) {
        lastSignature.current = signature;
        setAnnouncement(announceFor(result));
      }
      // Grace-window auto-finalize landed on this call: sound + notify once
      // for the reconciled interval (spec §8.6). `reconciled` appears on
      // exactly one `current` response, so this fires once per finalize.
      if (result.reconciled) soundForFinalized(result.reconciled);
    } catch (err) {
      setError(
        err instanceof TimerApiError
          ? err.message
          : "Something went wrong. Check your connection and retry.",
      );
    }
  }, [soundForFinalized]);

  // Mount: restore the running/paused interval (spec §8.4 refresh rule).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Tick: repaint only. The display derives from stamps each render.
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);
  void tick;

  // Hidden-tab return: reconcile immediately so the display corrects within
  // a second (spec §12.1) instead of waiting for the next tick/expiry.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") return;
      setTick((n) => n + 1);
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh]);

  // Expiry tripwire: a locally-expired running interval needs one server
  // reconcile — auto-complete within the grace window, or the
  // Complete/Discard dialog beyond it (spec §8.4, issue 11 contract).
  useEffect(() => {
    const session = current?.session;
    if (!session || current?.pendingConfirmation) return;
    if (
      session.status === "running" &&
      isExpired(session, Date.now()) &&
      reconcileGuard.current !== session.id
    ) {
      reconcileGuard.current = session.id;
      void refresh();
    }
  }, [current, tick, refresh]);

  // Idle proposal: default the interval picker to the server's `next`
  // until the user picks otherwise.
  useEffect(() => {
    if (current && !current.session && current.next && !choseManually.current) {
      setChosen(current.next.intervalType);
    }
  }, [current]);

  const pending = current?.pendingConfirmation ?? null;

  // Expiry dialog focus: move keyboard focus inside on open, return it on
  // close (spec §12.3 dialogs manage focus). Guarded by transition so
  // background refreshes while the dialog is open don't re-grab focus.
  useEffect(() => {
    if (pending && !wasPending.current) {
      wasPending.current = true;
      returnFocusTo.current = document.activeElement;
      confirmButtonRef.current?.focus();
    } else if (!pending && wasPending.current) {
      wasPending.current = false;
      if (returnFocusTo.current instanceof HTMLElement) {
        returnFocusTo.current.focus();
        returnFocusTo.current = null;
      }
    }
  }, [pending]);

  // Keep keyboard users in the flow: when the control they just activated
  // unmounts (Pause↔Resume swap, start→running, finalize→idle), focus
  // drops to <body> — move it to the first live control instead of
  // restarting tab order at the top of the page. Only fires after a
  // successful action, never on background refreshes.
  useEffect(() => {
    if (!expectFocusMove.current) return;
    expectFocusMove.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const next = scopeRef.current?.querySelector("button:not(:disabled)");
    if (next instanceof HTMLButtonElement) next.focus();
  }, [actionCount]);

  /**
   * Commit a post-action state with its announcement. The signature is the
   * true `signatureOf` the committed result (not a `local:` marker) so the
   * next background refresh that returns the identical server state stays
   * silent instead of re-announcing it. A manual interval pick lasts until
   * this commit — the next idle adopts the server proposal again.
   */
  function commit(result: CurrentResult, notice: string) {
    setCurrent(result);
    lastSignature.current = signatureOf(result);
    choseManually.current = false;
    setAnnouncement(notice);
  }

  function applySession(session: PublicSession, notice: string) {
    commit(
      {
        session,
        reconciled: null,
        pendingConfirmation: null,
        autoStarted: null,
        cycle: current?.cycle ?? {
          completedFocusCount: 0,
          intervalsBeforeLongBreak: 4,
        },
        next: null,
      },
      notice,
    );
  }

  function applyFinalized(result: FinalizeResult, verb: string) {
    const nextLabel = result.autoStarted
      ? ` ${INTERVAL_LABELS[result.autoStarted.intervalType]} started automatically.`
      : result.next
        ? ` Up next: ${INTERVAL_LABELS[result.next.intervalType]}.`
        : "";
    commit(
      {
        session: result.autoStarted,
        reconciled: null,
        pendingConfirmation: null,
        autoStarted: result.autoStarted,
        cycle: result.cycle,
        next: result.next,
      },
      `${verb}.${nextLabel}`,
    );
    // Explicit finalize (complete / confirm-complete): completed intervals
    // sound + notify; cancelled ones (cancel/skip/discard) stay silent
    // (spec §8.6 — the alarm marks an interval *end*, not an abort).
    soundForFinalized(result.session);
  }

  /** 409s mean another writer moved first — resync instead of guessing. */
  async function resyncAfterConflict() {
    try {
      await refresh();
    } catch {
      // The conflict message below already stands; a failed resync keeps it.
    }
  }

  async function runAction(name: string, fn: () => Promise<void>) {
    if (pendingAction) return;
    // The click is the user gesture that unlocks WebAudio (SYSTEM_DESIGN
    // §4 alarms). Fire-and-forget: unlock must never delay the action, and
    // the player degrades to silent when unlock fails.
    void ensureAudioUnlocked().catch(() => undefined);
    setPendingAction(name);
    setError(null);
    try {
      await fn();
      expectFocusMove.current = true;
    } catch (err) {
      if (
        err instanceof TimerApiError &&
        (err.code === "ACTIVE_TIMER_EXISTS" ||
          err.code === "ALREADY_FINALIZED" ||
          err.code === "NO_ACTIVE_TIMER" ||
          err.code === "INVALID_TRANSITION")
      ) {
        setError(err.message);
        void resyncAfterConflict();
      } else {
        setError(
          err instanceof TimerApiError
            ? err.message
            : "Something went wrong. Check your connection and retry.",
        );
      }
    } finally {
      setPendingAction(null);
      setActionCount((n) => n + 1);
    }
  }

  const busy = pendingAction !== null;
  const session = current?.session ?? null;

  if (!current) {
    return (
      <div ref={scopeRef} className="grid gap-2">
        <p role="status">{announcement}</p>
        {error && (
          <div className="grid gap-2">
            <p role="alert" className="text-sm text-red-500">
              {error}
            </p>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void refresh()}
            >
              Retry
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!session) {
    const nextLabel = current.next
      ? INTERVAL_LABELS[current.next.intervalType]
      : null;
    return (
      <div ref={scopeRef} className="grid gap-3">
        <p role="status">{announcement}</p>
        {error && (
          <div className="grid gap-2">
            <p role="alert" className="text-sm text-red-500">
              {error}
            </p>
            <div>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Retry
              </Button>
            </div>
          </div>
        )}
        {current.reconciled && (
          <p className="text-sm">
            The expired interval was completed and reconciled — counted once
            in history.
          </p>
        )}
        <p className="text-sm opacity-80">
          Cycle {current.cycle.completedFocusCount} of{" "}
          {current.cycle.intervalsBeforeLongBreak} before a long break.
          {nextLabel ? ` Up next: ${nextLabel}.` : ""}
        </p>
        {selectedTask ? (
          <p className="text-sm">
            Lined up: <strong>{selectedTask.title}</strong> — starting links
            this interval to it.
          </p>
        ) : (
          <p className="text-sm opacity-80">
            Select a task to link focus time — or start unassigned.
          </p>
        )}
        <fieldset>
          <legend className="text-sm font-medium">Interval</legend>
          <div className="mt-1 flex flex-wrap gap-1">
            {INTERVAL_OPTIONS.map((option) => (
              <label
                key={option}
                className="cursor-pointer rounded-md border px-3 py-1.5 text-sm has-checked:border-primary has-checked:font-semibold focus-within:ring-2 focus-within:ring-primary"
              >
                <input
                  type="radio"
                  name="timer-interval"
                  value={option}
                  checked={chosen === option}
                  onChange={() => {
                    choseManually.current = true;
                    setChosen(option);
                  }}
                  className="sr-only"
                />
                {INTERVAL_LABELS[option]}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              void runAction("start", async () => {
                const started = await startTimer(
                  selectedTask
                    ? { intervalType: chosen, taskId: selectedTask.id }
                    : { intervalType: chosen },
                );
                applySession(
                  started,
                  `${INTERVAL_LABELS[started.intervalType]} interval started.`,
                );
              })
            }
          >
            Start {INTERVAL_LABELS[chosen].toLowerCase()}
          </Button>
        </div>
      </div>
    );
  }

  // Expired beyond the grace window (spec §8.4): the interval finalizes
  // ONLY via explicit Complete (= completed minutes, bounded by the plan)
  // or Discard (= cancelled, no minutes/cycle). The dialog replaces the
  // ring and controls entirely — no background transition can slip in
  // first — and keyboard focus moves inside until a choice is made.
  if (pending) {
    return (
      <div ref={scopeRef} className="grid gap-3">
        <p role="status">{announcement}</p>
        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="timer-confirm-heading"
          className="grid gap-3 rounded-md border p-4"
        >
          <h2 id="timer-confirm-heading" className="text-base font-semibold">
            Finish the expired interval?
          </h2>
          <p className="text-sm">
            Your {plannedMinutes(pending.session)}-minute{" "}
            {INTERVAL_LABELS[pending.session.intervalType].toLowerCase()} ended
            over 60 minutes ago. Count its{" "}
            {plannedMinutes(pending.session)} minutes as completed, or discard
            it (no minutes, no cycle step)?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={confirmButtonRef}
              type="button"
              disabled={busy}
              onClick={() =>
                void runAction("confirm-complete", async () => {
                  const result = await completeTimer(crypto.randomUUID());
                  applyFinalized(result, "Expired interval completed");
                })
              }
            >
              Complete — count {plannedMinutes(pending.session)} min
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void runAction("confirm-discard", async () => {
                  const result = await cancelTimer(crypto.randomUUID());
                  applyFinalized(result, "Expired interval discarded — no minutes counted");
                })
              }
            >
              Discard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const remaining = remainingSeconds(session, nowMs);
  const progress = progressPercent(session, nowMs);
  const label = INTERVAL_LABELS[session.intervalType];
  const isBreak = session.intervalType !== "focus";
  const paused = session.status === "paused";
  const offset = RING_CIRCUMFERENCE * (1 - progress / 100);

  return (
    <div ref={scopeRef} className="grid gap-3">
      <p role="status">{announcement}</p>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      {current.reconciled && (
        <p className="text-sm">
          The expired interval was completed and reconciled — counted once in
          history.
        </p>
      )}
      {session.taskTitleSnapshot ? (
        <p className="text-sm">
          Linked task: <strong>{session.taskTitleSnapshot}</strong>
        </p>
      ) : (
        <p className="text-sm opacity-80">Unassigned interval.</p>
      )}
      <div
        role="progressbar"
        aria-label={`${label} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={`${formatRemaining(remaining)} remaining of ${formatRemaining(session.plannedDurationSeconds)}`}
        className="relative h-48 w-48"
      >
        <svg viewBox="0 0 132 132" aria-hidden="true" className="absolute inset-0 -rotate-90">
          <circle
            cx="66"
            cy="66"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="10"
            className="stroke-muted"
          />
          <circle
            cx="66"
            cy="66"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            data-ring-progress
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={offset}
            className="stroke-primary transition-[stroke-dashoffset] duration-1000 ease-linear motion-reduce:transition-none"
          />
        </svg>
        <p
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center text-3xl tabular-nums"
        >
          {formatRemaining(remaining)}
        </p>
      </div>
      <p className="text-sm opacity-80">
        {paused
          ? "Paused — remaining time is frozen; paused time never counts."
          : `Running — calculated from the server timestamp, ends ${new Date(session.expectedEndAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`}
      </p>
      <p className="text-sm opacity-80">
        Cycle {current.cycle.completedFocusCount} of{" "}
        {current.cycle.intervalsBeforeLongBreak} before a long break.
      </p>
      <div className="flex flex-wrap gap-2">
        {paused ? (
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              void runAction("resume", async () => {
                const resumed = await resumeTimer();
                applySession(
                  resumed,
                  `${INTERVAL_LABELS[resumed.intervalType]} interval resumed.`,
                );
              })
            }
          >
            Resume
          </Button>
        ) : (
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              void runAction("pause", async () => {
                const halted = await pauseTimer();
                applySession(
                  halted,
                  `${INTERVAL_LABELS[halted.intervalType]} paused — remaining time is frozen; paused time never counts.`,
                );
              })
            }
          >
            Pause
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void runAction("complete", async () => {
              const result = await completeTimer(crypto.randomUUID());
              applyFinalized(result, "Interval completed");
            })
          }
        >
          Complete early
        </Button>
        {isBreak && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void runAction("skip", async () => {
                const result = await skipBreakTimer(crypto.randomUUID());
                applyFinalized(result, "Break skipped");
              })
            }
          >
            Skip break
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void runAction("cancel", async () => {
              const result = await cancelTimer(crypto.randomUUID());
              applyFinalized(
                result,
                result.session.status === "cancelled"
                  ? "Interval cancelled"
                  : "Interval finalized",
              );
            })
          }
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
