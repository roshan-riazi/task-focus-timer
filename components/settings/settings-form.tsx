"use client";

import { useEffect, useMemo, useState } from "react";
import type { PublicSettings } from "@/lib/settings/service";
import { SOUND_PRESETS, type SoundPreset } from "@/lib/settings/validation";
import { getSettings, SettingsApiError, updateSettings } from "./api";
import { AlarmPreviewButton } from "../alarms/alarm-preview";
import { Button } from "../ui/button";

const FOCUS_ID = "settings-focus-minutes";
const SHORT_ID = "settings-short-minutes";
const LONG_ID = "settings-long-minutes";
const CYCLE_ID = "settings-cycle-count";
const AUTO_BREAKS_ID = "settings-auto-breaks";
const AUTO_FOCUS_ID = "settings-auto-focus";
const SOUND_ID = "settings-sound";
const PRESET_ID = "settings-preset";
const VOLUME_ID = "settings-volume";
const TIMEZONE_ID = "settings-timezone";
const NOTIFICATIONS_ID = "settings-notifications";
const FORM_ERROR_ID = "settings-form-error";

const PRESET_LABELS: Record<SoundPreset, string> = {
  chime: "Chime",
  bell: "Bell",
  pulse: "Pulse",
  gong: "Gong",
};

/** Server field keys (storage units) → local input ids. */
const INPUT_FOR_FIELD: Record<string, string> = {
  focusDurationSeconds: FOCUS_ID,
  shortBreakSeconds: SHORT_ID,
  longBreakSeconds: LONG_ID,
  intervalsBeforeLongBreak: CYCLE_ID,
  autoStartBreaks: AUTO_BREAKS_ID,
  autoStartFocus: AUTO_FOCUS_ID,
  soundEnabled: SOUND_ID,
  soundPreset: PRESET_ID,
  soundVolume: VOLUME_ID,
  notificationsEnabled: NOTIFICATIONS_ID,
  timezone: TIMEZONE_ID,
};

function isPreset(value: string): value is SoundPreset {
  return (SOUND_PRESETS as readonly string[]).includes(value);
}

function secondsToMinutes(seconds: number): string {
  return String(Math.round(seconds / 60));
}

/** Full IANA list when ICU exposes it; a short fallback otherwise. */
function timezoneOptions(current: string): string[] {
  let all: string[] = [];
  try {
    const supported = (
      Intl as unknown as {
        supportedValuesOf?: (key: string) => string[];
      }
    ).supportedValuesOf;
    if (typeof supported === "function") all = supported.call(Intl, "timeZone");
  } catch {
    all = [];
  }
  if (all.length === 0) {
    all = [
      "UTC",
      "Europe/Berlin",
      "Europe/London",
      "America/New_York",
      "America/Chicago",
      "America/Los_Angeles",
      "Asia/Tokyo",
      "Australia/Sydney",
      "Pacific/Auckland",
    ];
  }
  return [...new Set([...all, current])].sort();
}

function toFormState(settings: PublicSettings) {
  return {
    focusMinutes: secondsToMinutes(settings.focusDurationSeconds),
    shortMinutes: secondsToMinutes(settings.shortBreakSeconds),
    longMinutes: secondsToMinutes(settings.longBreakSeconds),
    cycle: String(settings.intervalsBeforeLongBreak),
    autoBreaks: settings.autoStartBreaks,
    autoFocus: settings.autoStartFocus,
    sound: settings.soundEnabled,
    preset: settings.soundPreset,
    volume: settings.soundVolume,
    notifications: settings.notificationsEnabled,
    timezone: settings.timezone,
  };
}

/**
 * Settings form (spec §8.7, prototype `settings.html`): durations in
 * minutes (converted to storage seconds once at the PATCH boundary),
 * auto-start toggles, sound preset with in-settings preview + volume,
 * timezone, and browser notifications.
 *
 * Edits apply to newly created intervals only — the timer snapshots
 * durations at start (spec §8.7), so a running or paused interval never
 * changes under the user; the success notice says so. Validation errors
 * from the API associate with their fields (spec §12.3).
 */
export function SettingsForm() {
  const [reloadToken, setReloadToken] = useState(0);
  const key = `settings:${reloadToken}`;
  // Load-settled marker: `null` (or a stale key) means loading; the field
  // states below are written once per settled load in the continuation.
  const [view, setView] = useState<{ key: string; error: string | null } | null>(
    null,
  );
  const [focusMinutes, setFocusMinutes] = useState("25");
  const [shortMinutes, setShortMinutes] = useState("5");
  const [longMinutes, setLongMinutes] = useState("15");
  const [cycle, setCycle] = useState("4");
  const [autoBreaks, setAutoBreaks] = useState(false);
  const [autoFocus, setAutoFocus] = useState(false);
  const [sound, setSound] = useState(true);
  const [preset, setPreset] = useState<SoundPreset>("chime");
  const [volume, setVolume] = useState(80);
  const [notifications, setNotifications] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (view?.key === key) return;
    const requestKey = key;
    let cancelled = false;
    void getSettings().then(
      (settings) => {
        if (cancelled) return;
        const state = toFormState(settings);
        setFocusMinutes(state.focusMinutes);
        setShortMinutes(state.shortMinutes);
        setLongMinutes(state.longMinutes);
        setCycle(state.cycle);
        setAutoBreaks(state.autoBreaks);
        setAutoFocus(state.autoFocus);
        setSound(state.sound);
        setPreset(state.preset);
        setVolume(state.volume);
        setNotifications(state.notifications);
        setTimezone(state.timezone);
        setView({ key: requestKey, error: null });
      },
      (error: unknown) => {
        if (!cancelled) {
          setView({
            key: requestKey,
            error:
              error instanceof SettingsApiError
                ? error.message
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
  }, [key]);

  const zones = useMemo(() => timezoneOptions(timezone), [timezone]);

  function errorIdFor(inputId: string): string | undefined {
    const has = Object.entries(fieldErrors).some(([, messages]) => messages.length > 0) &&
      Object.entries(INPUT_FOR_FIELD).some(
        ([field, id]) =>
          id === inputId &&
          (fieldErrors[field] ?? []).length > 0,
      );
    return has ? `${inputId}-error` : undefined;
  }

  function messagesFor(inputId: string): string[] {
    const fields = Object.entries(INPUT_FOR_FIELD)
      .filter(([, id]) => id === inputId)
      .map(([field]) => field);
    return fields.flatMap((field) => fieldErrors[field] ?? []);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setFieldErrors({});
    setFormErrors([]);
    setNotice(null);
    try {
      const saved = await updateSettings({
        focusDurationSeconds: Math.round(Number(focusMinutes) * 60),
        shortBreakSeconds: Math.round(Number(shortMinutes) * 60),
        longBreakSeconds: Math.round(Number(longMinutes) * 60),
        intervalsBeforeLongBreak: Number(cycle),
        autoStartBreaks: autoBreaks,
        autoStartFocus: autoFocus,
        soundEnabled: sound,
        soundPreset: preset,
        soundVolume: volume,
        notificationsEnabled: notifications,
        timezone,
      });
      const state = toFormState(saved);
      setFocusMinutes(state.focusMinutes);
      setShortMinutes(state.shortMinutes);
      setLongMinutes(state.longMinutes);
      setCycle(state.cycle);
      setAutoBreaks(state.autoBreaks);
      setAutoFocus(state.autoFocus);
      setSound(state.sound);
      setPreset(state.preset);
      setVolume(state.volume);
      setNotifications(state.notifications);
      setTimezone(state.timezone);
      setNotice(
        "Settings saved. Changes apply to new intervals only — a running or paused interval keeps its original durations.",
      );
    } catch (error) {
      if (error instanceof SettingsApiError) {
        const fields: Record<string, string[]> = {};
        const form: string[] = [];
        for (const [field, messages] of Object.entries(error.fields)) {
          if (INPUT_FOR_FIELD[field]) fields[field] = messages;
          else form.push(...messages);
        }
        setFieldErrors(fields);
        setFormErrors(
          form.length > 0 ? form : Object.keys(fields).length === 0 ? [error.message] : [],
        );
      } else {
        setFormErrors([
          "Something went wrong. Check your connection and retry.",
        ]);
      }
    } finally {
      setSaving(false);
    }
  }

  const settled = view && view.key === key ? view : null;
  if (!settled) {
    return (
      <div className="grid gap-2">
        <p role="status">Loading settings…</p>
      </div>
    );
  }
  if (settled.error) {
    return (
      <div className="grid gap-2">
        <p role="alert" className="text-sm text-red-500">
          {settled.error}
        </p>
        <div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setReloadToken((token) => token + 1)}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const inputClass =
    "h-10 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      aria-label="Timer and alarm settings"
      className="grid min-w-0 max-w-xl gap-4"
    >
      {notice && <p role="status">{notice}</p>}
      {formErrors.length > 0 && (
        <p id={FORM_ERROR_ID} role="alert" className="text-sm text-red-500">
          {formErrors.join(" ")}
        </p>
      )}

      <div className="grid gap-3">
        <div className="grid gap-1">
          <label htmlFor={FOCUS_ID} className="text-sm font-medium">
            Focus duration (minutes)
          </label>
          <input
            id={FOCUS_ID}
            type="number"
            min={1}
            max={120}
            value={focusMinutes}
            onChange={(e) => setFocusMinutes(e.target.value)}
            aria-invalid={messagesFor(FOCUS_ID).length > 0 || undefined}
            aria-describedby={errorIdFor(FOCUS_ID)}
            className={inputClass}
          />
          {messagesFor(FOCUS_ID).length > 0 && (
            <p
              id={`${FOCUS_ID}-error`}
              role="alert"
              className="text-sm text-red-500"
            >
              {messagesFor(FOCUS_ID).join(" ")}
            </p>
          )}
        </div>

        <div className="grid gap-1">
          <label htmlFor={SHORT_ID} className="text-sm font-medium">
            Short break (minutes)
          </label>
          <input
            id={SHORT_ID}
            type="number"
            min={1}
            max={60}
            value={shortMinutes}
            onChange={(e) => setShortMinutes(e.target.value)}
            aria-invalid={messagesFor(SHORT_ID).length > 0 || undefined}
            aria-describedby={errorIdFor(SHORT_ID)}
            className={inputClass}
          />
          {messagesFor(SHORT_ID).length > 0 && (
            <p
              id={`${SHORT_ID}-error`}
              role="alert"
              className="text-sm text-red-500"
            >
              {messagesFor(SHORT_ID).join(" ")}
            </p>
          )}
        </div>

        <div className="grid gap-1">
          <label htmlFor={LONG_ID} className="text-sm font-medium">
            Long break (minutes)
          </label>
          <input
            id={LONG_ID}
            type="number"
            min={1}
            max={60}
            value={longMinutes}
            onChange={(e) => setLongMinutes(e.target.value)}
            aria-invalid={messagesFor(LONG_ID).length > 0 || undefined}
            aria-describedby={errorIdFor(LONG_ID)}
            className={inputClass}
          />
          {messagesFor(LONG_ID).length > 0 && (
            <p
              id={`${LONG_ID}-error`}
              role="alert"
              className="text-sm text-red-500"
            >
              {messagesFor(LONG_ID).join(" ")}
            </p>
          )}
        </div>

        <div className="grid gap-1">
          <label htmlFor={CYCLE_ID} className="text-sm font-medium">
            Focus intervals before long break
          </label>
          <input
            id={CYCLE_ID}
            type="number"
            min={1}
            max={10}
            value={cycle}
            onChange={(e) => setCycle(e.target.value)}
            aria-invalid={messagesFor(CYCLE_ID).length > 0 || undefined}
            aria-describedby={errorIdFor(CYCLE_ID)}
            className={inputClass}
          />
          {messagesFor(CYCLE_ID).length > 0 && (
            <p
              id={`${CYCLE_ID}-error`}
              role="alert"
              className="text-sm text-red-500"
            >
              {messagesFor(CYCLE_ID).join(" ")}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            id={AUTO_BREAKS_ID}
            type="checkbox"
            checked={autoBreaks}
            onChange={(e) => setAutoBreaks(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Start breaks automatically
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            id={AUTO_FOCUS_ID}
            type="checkbox"
            checked={autoFocus}
            onChange={(e) => setAutoFocus(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Start focus intervals automatically
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            id={SOUND_ID}
            type="checkbox"
            checked={sound}
            onChange={(e) => setSound(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Sound
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            id={NOTIFICATIONS_ID}
            type="checkbox"
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Browser notifications
        </label>
      </div>

      <div className="grid gap-3">
        <div className="grid gap-1">
          <label htmlFor={PRESET_ID} className="text-sm font-medium">
            Alarm sound
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id={PRESET_ID}
              value={preset}
              onChange={(e) => {
                if (isPreset(e.target.value)) setPreset(e.target.value);
              }}
              aria-describedby={errorIdFor(PRESET_ID)}
              className={inputClass}
            >
              {SOUND_PRESETS.map((option) => (
                <option key={option} value={option}>
                  {PRESET_LABELS[option]}
                </option>
              ))}
            </select>
            <AlarmPreviewButton preset={preset} volume={volume} />
          </div>
          {messagesFor(PRESET_ID).length > 0 && (
            <p
              id={`${PRESET_ID}-error`}
              role="alert"
              className="text-sm text-red-500"
            >
              {messagesFor(PRESET_ID).join(" ")}
            </p>
          )}
        </div>

        <div className="grid gap-1">
          <label htmlFor={VOLUME_ID} className="text-sm font-medium">
            Volume
          </label>
          <div className="flex items-center gap-2">
            <input
              id={VOLUME_ID}
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-describedby={errorIdFor(VOLUME_ID)}
              className="w-full accent-primary"
            />
            <output htmlFor={VOLUME_ID} className="text-sm tabular-nums">
              {volume}
            </output>
          </div>
          {messagesFor(VOLUME_ID).length > 0 && (
            <p
              id={`${VOLUME_ID}-error`}
              role="alert"
              className="text-sm text-red-500"
            >
              {messagesFor(VOLUME_ID).join(" ")}
            </p>
          )}
        </div>

        <div className="grid gap-1">
          <label htmlFor={TIMEZONE_ID} className="text-sm font-medium">
            Timezone
          </label>
          <select
            id={TIMEZONE_ID}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            aria-describedby={errorIdFor(TIMEZONE_ID)}
            className={inputClass}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          {messagesFor(TIMEZONE_ID).length > 0 && (
            <p
              id={`${TIMEZONE_ID}-error`}
              role="alert"
              className="text-sm text-red-500"
            >
              {messagesFor(TIMEZONE_ID).join(" ")}
            </p>
          )}
        </div>
      </div>

      <p className="text-sm opacity-80">
        Edits apply to newly created intervals only — never a running or
        paused one.
      </p>

      <div>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
