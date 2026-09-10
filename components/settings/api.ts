import type { PublicSettings } from "@/lib/settings/service";

/**
 * Typed client for the Settings API (spec §11.4, issue 09 contract).
 * Mirrors `components/tasks/api.ts` + the timer client: JSON envelopes in,
 * `SettingsApiError` out. Never logs settings content — errors carry
 * display strings only.
 *
 * Issue 13 uses the sound/notification slice (`soundEnabled`, `soundPreset`,
 * `soundVolume`, `notificationsEnabled`) to play the correct preset at the
 * set volume and to gate browser notifications; the full public settings
 * travel so the settings page (issue 16) reuses this client.
 */
export class SettingsApiError extends Error {
  readonly fields: Record<string, string[]>;
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "SettingsApiError";
    this.fields = fields ?? {};
  }
}

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string[]>;
  };
}

/** Catch-all for non-envelope throws (network, bugs): retryable message. */
export function toSettingsApiError(error: unknown): SettingsApiError {
  return error instanceof SettingsApiError
    ? error
    : new SettingsApiError(
        "NETWORK_ERROR",
        "Something went wrong. Check your connection and retry.",
        0,
      );
}

async function readEnvelope(res: Response): Promise<ErrorEnvelope> {
  return (await res.json().catch(() => ({}))) as ErrorEnvelope;
}

export async function getSettings(): Promise<PublicSettings> {
  let res: Response;
  try {
    res = await fetch("/api/settings", { method: "GET" });
  } catch {
    throw new SettingsApiError(
      "NETWORK_ERROR",
      "Something went wrong. Check your connection and retry.",
      0,
    );
  }
  if (res.ok) {
    const { settings } = (await res.json()) as { settings: PublicSettings };
    return settings;
  }
  const body = await readEnvelope(res);
  throw new SettingsApiError(
    body.error?.code ?? "REQUEST_FAILED",
    body.error?.message ?? "Something went wrong.",
    res.status,
    body.error?.fields,
  );
}
