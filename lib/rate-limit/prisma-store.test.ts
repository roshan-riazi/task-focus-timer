import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { checkRateLimit } from "./limiter";
import {
  createPrismaRateLimitStore,
  RATE_LIMIT_PRUNE_AFTER_MS,
} from "./prisma-store";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabaseUrl ? describe : describe.skip;

const PREFIX = "test-rl";

/**
 * DB-backed rate-limit store against live Postgres (issue 05): window
 * counting through the real `rate_limit_hits` table, key isolation, and
 * lazy pruning of expired rows. Skips without DATABASE_URL; CI runs it.
 */
describeIfDb("Prisma rate-limit store (live Postgres)", () => {
  let db: PrismaClient;

  async function setup() {
    const mod = await import("@/lib/db");
    db = mod.db;
  }

  function key(suffix: string): string {
    return `${PREFIX}-${suffix}-${crypto.randomUUID()}`;
  }

  afterEach(async () => {
    if (db) {
      await db.rateLimitHit.deleteMany({
        where: { key: { startsWith: PREFIX } },
      });
    }
  });

  it("counts hits inside the window and resets after it passes", async () => {
    await setup();
    const store = createPrismaRateLimitStore(db);
    const rule = { limit: 2, windowMs: 60_000 };
    const k = key("window");
    const start = new Date("2026-09-09T10:00:00.000Z");

    expect((await checkRateLimit(store, rule, k, start)).allowed).toBe(true);
    expect((await checkRateLimit(store, rule, k, start)).allowed).toBe(true);
    const blocked = await checkRateLimit(store, rule, k, start);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    // Precise window edge: the oldest in-window hit was `start`, so the
    // budget resets exactly one window later.
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(blocked.resetAt).toEqual(new Date(start.getTime() + 60_000));

    const later = new Date(start.getTime() + 60_001);
    expect((await checkRateLimit(store, rule, k, later)).allowed).toBe(true);
  });

  it("isolates counts by key", async () => {
    await setup();
    const store = createPrismaRateLimitStore(db);
    const rule = { limit: 1, windowMs: 60_000 };
    const now = new Date("2026-09-09T10:00:00.000Z");
    const a = key("a");
    const b = key("b");

    expect((await checkRateLimit(store, rule, a, now)).allowed).toBe(true);
    expect((await checkRateLimit(store, rule, a, now)).allowed).toBe(false);
    expect((await checkRateLimit(store, rule, b, now)).allowed).toBe(true);
  });

  it("prunes rows older than the horizon on each hit", async () => {
    await setup();
    const store = createPrismaRateLimitStore(db);
    const staleKey = key("stale");
    const ancient = new Date(
      Date.now() - RATE_LIMIT_PRUNE_AFTER_MS - 60_000,
    );
    await db.rateLimitHit.create({
      data: { key: staleKey, createdAt: ancient },
    });
    expect(
      await db.rateLimitHit.count({ where: { key: staleKey } }),
    ).toBe(1);

    await checkRateLimit(
      store,
      { limit: 100, windowMs: 60_000 },
      key("fresh"),
      new Date(),
    );
    expect(
      await db.rateLimitHit.count({ where: { key: staleKey } }),
    ).toBe(0);
  });
});
