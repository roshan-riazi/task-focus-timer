"use client";

import { useState } from "react";
import type { SoundPreset } from "@/lib/settings/validation";
import type { AlarmMoment } from "@/lib/alarms/presets";
import { ensureAudioUnlocked, playAlarm } from "@/lib/alarms/player";
import { Button } from "../ui/button";

interface AlarmPreviewButtonProps {
  preset: SoundPreset;
  volume: number;
  /** Which pattern to preview; focus-end by default. */
  moment?: AlarmMoment;
}

/**
 * In-settings alarm preview (spec §8.7, prototype `settings.html` Preview
 * button, issue 13).
 *
 * Keyboard-accessible native button that plays the selected preset at the
 * set volume through the shared WebAudio player. Takes only preset +
 * volume — never task content — so there is nothing user-authored to leak.
 * Silent paths (unsupported audio, muted) announce via a polite status
 * region instead of throwing; the full settings form lands in issue 16 and
 * reuses this button.
 */
export function AlarmPreviewButton({
  preset,
  volume,
  moment = "focus-end",
}: AlarmPreviewButtonProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onPreview() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      // The click is the user gesture that unlocks the AudioContext
      // (SYSTEM_DESIGN §4 alarms). The player never throws by contract;
      // the catch below guards the seam so preview stays silent, never red.
      await ensureAudioUnlocked();
      const result = await playAlarm({
        preset,
        moment,
        volume,
        soundEnabled: true,
      });
      if (!result.played) {
        setNotice("Preview is silent on this device — sound stays off.");
      }
    } catch {
      setNotice("Preview is silent on this device — sound stays off.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        onClick={() => void onPreview()}
      >
        Preview {preset}
      </Button>
      {notice && <span role="status">{notice}</span>}
    </span>
  );
}
