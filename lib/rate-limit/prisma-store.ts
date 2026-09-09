import type { PrismaClient } from "@prisma/client";
import type { RateLimitStore, WindowCount } from "./limiter";

/**
 * Prune horizon: rows older than the largest configured window (1h) can
 * never fall inside a future window, so each hit deletes them. Keeps the
 * table at personal scale without a background worker (SYSTEM_DESIGN: no
 * workers in the MVP).
 */
export const RATE_LIMIT_PRUNE_AFTER_MS = 60 * 60_000;

/**
 * DB-backed sliding-window store (issue 05, ADR-0003): one row per guarded
 * attempt in `rate_limit_hits`, counted transactionally with the insert so
 * the count always includes the current hit. `resetAt` derives from the
 * oldest in-window hit, so `Retry-After` tracks the real window edge
 * instead of an approximation. The clock is injected (TEST_STRATEGY
 * determinism rules); production passes wall-clock time.
 */
export function createPrismaRateLimitStore(
  db: PrismaClient,
): RateLimitStore {
  return {
    async hit(key: string, windowMs: number, now: Date): Promise<WindowCount> {
      const windowStart = new Date(now.getTime() - windowMs);
      const [, count, oldest] = await db.$transaction([
        db.rateLimitHit.create({ data: { key, createdAt: now } }),
        db.rateLimitHit.count({
          where: { key, createdAt: { gt: windowStart } },
        }),
        db.rateLimitHit.findFirst({
          where: { key, createdAt: { gt: windowStart } },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
        db.rateLimitHit.deleteMany({
          where: {
            createdAt: { lt: new Date(now.getTime() - RATE_LIMIT_PRUNE_AFTER_MS) },
          },
        }),
      ]);
      // Unreachable in practice (the insert above is always in-window), but
      // total rather than throwing.
      const resetAt = oldest
        ? new Date(oldest.createdAt.getTime() + windowMs)
        : new Date(now.getTime() + windowMs);
      return { count, resetAt };
    },
  };
}
