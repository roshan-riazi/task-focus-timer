import { resolveEmailProvider } from "@/lib/email/resolve";
import type { HandlerDeps } from "./handlers";
import { createPrismaPorts } from "./prisma-store";
import { getSession } from "./session";
import { createAuthService } from "./service";

export function appBaseUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

/**
 * Production handler wiring. Everything stateful is resolved per request
 * (lazy `db` import keeps route module-load hermetic, per the health-route
 * pattern); the mailer resolves from env with the console fallback, so
 * registration never blocks on email configuration.
 */
export function prodDeps(): HandlerDeps {
  return {
    getService: async () => {
      const { db } = await import("@/lib/db");
      return createAuthService(
        createPrismaPorts(db, {
          now: () => new Date(),
          appUrl: appBaseUrl(),
          mailer: resolveEmailProvider({
            EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
            EMAIL_API_KEY: process.env.EMAIL_API_KEY,
            EMAIL_FROM: process.env.EMAIL_FROM,
            EMAIL_OUTBOX_DIR: process.env.EMAIL_OUTBOX_DIR,
          }),
        }),
      );
    },
    getSession,
  };
}
