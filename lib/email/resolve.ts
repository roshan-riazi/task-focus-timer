import { tmpdir } from "node:os";
import { getLogger } from "../log";
import { ConsoleEmailProvider } from "./console";
import { FileOutboxEmailProvider } from "./outbox";
import { ResendEmailProvider } from "./resend";
import type { EmailProvider } from "./types";

export interface EmailEnv {
  EMAIL_PROVIDER?: string;
  EMAIL_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_OUTBOX_DIR?: string;
}

export const DEFAULT_EMAIL_FROM = "FocusFlow <noreply@focusflow.example>";

/**
 * Env-pluggable transactional email (issue 04 scope: Resend default).
 * Explicit `console` or a missing Resend key resolves to the log fallback
 * with a warning — sending mail must never block registration. Unknown
 * provider names fail closed so typos surface at boot, not at 2am.
 */
export function resolveEmailProvider(
  env: EmailEnv,
  opts: { onWarn?: (line: string) => void } = {},
): EmailProvider {
  // Structured server log by default (SYSTEM_DESIGN §8); tests inject onWarn.
  const warn =
    opts.onWarn ?? ((line: string) => getLogger().warn(line));
  const requested = (env.EMAIL_PROVIDER ?? "resend").toLowerCase();
  const from = env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM;

  if (requested === "console") return new ConsoleEmailProvider();
  if (requested === "outbox") {
    // E2E/test only: file outbox instead of delivery (see outbox.ts).
    return new FileOutboxEmailProvider(
      env.EMAIL_OUTBOX_DIR ?? `${tmpdir()}/focusflow-mail-outbox`,
    );
  }
  if (requested === "resend") {
    if (env.EMAIL_API_KEY) {
      return new ResendEmailProvider({ apiKey: env.EMAIL_API_KEY, from });
    }
    warn(
      "[email] EMAIL_PROVIDER=resend but EMAIL_API_KEY is unset; falling back to console logging. Set EMAIL_API_KEY to send real mail.",
    );
    return new ConsoleEmailProvider();
  }
  throw new Error(`Unknown email provider: ${requested}`);
}
