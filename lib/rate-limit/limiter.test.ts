import { describe, expect, it } from "vitest";
import {
  AUTH_RATE_LIMITS,
  bucketKey,
  checkRateLimit,
  clientIp,
  type RateLimitStore,
} from "./limiter";

function memoryStore(): RateLimitStore & { hits: Map<string, number[]> } {
  const hits = new Map<string, number[]>();
  return {
    hits,
    async hit(key, windowMs, now) {
      const cutoff = now.getTime() - windowMs;
      const kept = (hits.get(key) ?? []).filter((t) => t > cutoff);
      kept.push(now.getTime());
      hits.set(key, kept);
      return {
        count: kept.length,
        resetAt: new Date(now.getTime() + windowMs),
      };
    },
  };
}

/**
 * Rate-limit seam (issue 05, spec §8.1/§12.2): fixed-window budgets over an
 * injected store. The DB-backed store is proven live in prisma-store.test.ts;
 * this file pins the counting semantics hermetically with an explicit clock.
 */
describe("checkRateLimit", () => {
  const rule = { limit: 3, windowMs: 60_000 };

  it("allows requests up to the limit, then blocks with a retry delay", async () => {
    const store = memoryStore();
    const now = new Date("2026-09-09T10:00:00.000Z");
    for (let i = 0; i < 3; i += 1) {
      const decision = await checkRateLimit(store, rule, "k", now);
      expect(decision.allowed).toBe(true);
    }
    const blocked = await checkRateLimit(store, rule, "k", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("resets the budget once the window passes", async () => {
    const store = memoryStore();
    const start = new Date("2026-09-09T10:00:00.000Z");
    for (let i = 0; i < 4; i += 1) {
      await checkRateLimit(store, rule, "k", start);
    }
    expect((await checkRateLimit(store, rule, "k", start)).allowed).toBe(false);
    const later = new Date(start.getTime() + 60_001);
    expect((await checkRateLimit(store, rule, "k", later)).allowed).toBe(true);
  });

  it("isolates budgets by key (no cross-talk between callers)", async () => {
    const store = memoryStore();
    const now = new Date("2026-09-09T10:00:00.000Z");
    for (let i = 0; i < 4; i += 1) {
      await checkRateLimit(store, rule, "victim", now);
    }
    expect((await checkRateLimit(store, rule, "victim", now)).allowed).toBe(
      false,
    );
    expect((await checkRateLimit(store, rule, "other", now)).allowed).toBe(
      true,
    );
  });
});

describe("bucketKey + clientIp", () => {
  it("scopes a bucket to the endpoint and caller IP", () => {
    expect(bucketKey("auth:login", "1.2.3.4")).toBe("auth:login:1.2.3.4");
    expect(bucketKey("auth:login", "1.2.3.4")).not.toBe(
      bucketKey("auth:register", "1.2.3.4"),
    );
    expect(bucketKey("auth:login", "1.2.3.4")).not.toBe(
      bucketKey("auth:login", "5.6.7.8"),
    );
  });

  it("prefers the leftmost X-Forwarded-For entry, then X-Real-IP", () => {
    const xff = new Request("http://x/", {
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    });
    expect(clientIp(xff)).toBe("1.2.3.4");
    const real = new Request("http://x/", {
      headers: { "x-real-ip": "5.6.7.8" },
    });
    expect(clientIp(real)).toBe("5.6.7.8");
    expect(clientIp(new Request("http://x/"))).toBe("unknown");
  });
});

describe("AUTH_RATE_LIMITS (spec §8.1 endpoints)", () => {
  it("covers login, registration, and both password-reset endpoints", () => {
    for (const bucket of [
      "auth:register",
      "auth:login",
      "auth:forgot-password",
      "auth:reset-password",
    ] as const) {
      expect(AUTH_RATE_LIMITS[bucket].limit).toBeGreaterThan(0);
      expect(AUTH_RATE_LIMITS[bucket].windowMs).toBeGreaterThan(0);
    }
  });

  it("keeps legitimate use clear of the ceiling (generous fixed windows)", () => {
    // A user retrying a typo'd password a few times in ten minutes, or
    // requesting one reset mail, must never see a 429.
    expect(AUTH_RATE_LIMITS["auth:login"].limit).toBeGreaterThanOrEqual(10);
    expect(AUTH_RATE_LIMITS["auth:forgot-password"].limit).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("throttles account deletion tightly (issue 18: destructive, cookie-authed)", () => {
    // Nobody legitimately deletes several accounts per hour from one IP,
    // so the ceiling only bites automated abuse of a stolen session.
    expect(AUTH_RATE_LIMITS["account:delete"].limit).toBeGreaterThan(0);
    expect(AUTH_RATE_LIMITS["account:delete"].limit).toBeLessThanOrEqual(10);
    expect(AUTH_RATE_LIMITS["account:delete"].windowMs).toBeGreaterThan(0);
  });
});
