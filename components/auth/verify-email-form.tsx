"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type State = "missing" | "verifying" | "verified" | "invalid";

/**
 * One-click landing for the emailed verification link: consumes the token
 * via POST on mount (keyboard users just follow the link and land here),
 * then points at sign-in. Re-clicks show the invalid state (single-use).
 */
export function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [state, setState] = useState<State>(token ? "verifying" : "missing");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!cancelled) setState(res.ok ? "verified" : "invalid");
      } catch {
        if (!cancelled) setState("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state === "missing") {
    return (
      <p role="alert" className="max-w-sm text-sm text-red-700 dark:text-red-400">
        This verification link is missing its token. Ask for a new one from
        the reminder banner after signing in.
      </p>
    );
  }

  return (
    <div className="grid max-w-sm gap-4" aria-live="polite">
      {state === "verifying" && (
        <p role="status" className="text-sm">
          Verifying…
        </p>
      )}
      {state === "verified" && (
        <>
          <p role="status" className="text-sm">
            Email verified. The reminder is gone — welcome in.
          </p>
          <p className="text-sm opacity-80">
            <Link
              href="/login"
              className="underline underline-offset-2"
            >
              Sign in to start focusing
            </Link>
          </p>
        </>
      )}
      {state === "invalid" && (
        <>
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            This link is invalid or has expired. Sign in and use the reminder
            banner to get a fresh one.
          </p>
          <p className="text-sm opacity-80">
            <Link href="/login" className="underline underline-offset-2">
              Sign in
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
