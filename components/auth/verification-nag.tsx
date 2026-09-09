"use client";

import { useState } from "react";
import { Button } from "../ui/button";

/**
 * Non-blocking verification nag (spec §8.1): unverified users keep full
 * access; this banner (polite live region, keyboard-reachable resend) is the
 * only reminder. Rendered server-side with the session email.
 */
export function VerificationNag() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">(
    "idle",
  );

  async function resend() {
    setState("sending");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
      });
      setState(res.ok ? "sent" : "failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <div
      role="status"
      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
    >
      <p>
        <strong>Verify your email.</strong> Use the app freely meanwhile —
        verification just removes this reminder. Check your inbox for the
        confirmation link.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="default"
          onClick={resend}
          disabled={state === "sending" || state === "sent"}
        >
          {state === "sent" ? "Email sent" : "Resend email"}
        </Button>
        {state === "sending" && <span aria-hidden>…</span>}
        {state === "sent" && <span>Check your inbox.</span>}
        {state === "failed" && (
          <span role="alert">Couldn&apos;t resend. Try again.</span>
        )}
      </div>
    </div>
  );
}
