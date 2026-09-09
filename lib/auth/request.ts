import { resolveEmailProvider } from "@/lib/email/resolve";
import {
  AUTH_RATE_LIMITS,
  bucketKey,
  checkRateLimit,
  clientIp,
  type RateLimitBucket,
} from "@/lib/rate-limit/limiter";
import { createPrismaRateLimitStore } from "@/lib/rate-limit/prisma-store";
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
 *
 * Pass `rateLimitBucket` on abuse-sensitive mutation routes (issue 05,
 * spec §8.1): the gate records a DB-backed fixed-window hit per caller IP
 * before the service runs. Reads and idempotent logout bind no bucket.
 */
export function prodDeps(opts?: {
  rateLimitBucket?: RateLimitBucket;
}): HandlerDeps {
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
    // Single source for the CSRF gate's expected origin (issue 05).
    appUrl: appBaseUrl(),
    rateLimit: opts?.rateLimitBucket
      ? async (request: Request) => {
          const { db } = await import("@/lib/db");
          const bucket = opts.rateLimitBucket as RateLimitBucket;
          return checkRateLimit(
            createPrismaRateLimitStore(db),
            AUTH_RATE_LIMITS[bucket],
            bucketKey(bucket, clientIp(request)),
            new Date(),
          );
        }
      : undefined,
  };
}
