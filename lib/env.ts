import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  // Issue 04 (auth email): all optional so existing deploys keep booting;
  // the mailer falls back to console logging when no key is configured.
  EMAIL_PROVIDER: z.enum(["resend", "console", "outbox"]).optional(),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_OUTBOX_DIR: z.string().optional(),
  APP_URL: z.string().url("APP_URL must be a valid URL").optional(),
  // Issue 06 (scrubbed error monitoring): optional so existing deploys keep
  // booting; when absent the Sentry SDK initializes disabled (no-op) and
  // reportError only writes the content-free log line.
  ERROR_DSN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(value: unknown): Env {
  return envSchema.parse(value);
}
