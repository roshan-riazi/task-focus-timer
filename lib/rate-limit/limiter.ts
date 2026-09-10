/**
 * Fixed-window rate-limit semantics (issue 05, spec §8.1/§12.2).
 *
 * Pure counting logic over an injected {@link RateLimitStore}: production
 * wires the DB-backed Prisma store (prisma-store.ts, zero extra
 * infrastructure per ADR-0003); tests inject fakes. The clock is a parameter
 * (TEST_STRATEGY determinism rules) — callers pass `now`, defaulting to the
 * wall clock only outside tests. Counts run over a trailing sliding window;
 * see the store for the exact `resetAt` derivation.
 */

export interface RateLimitRule {
  /** Max recorded hits per window (inclusive: the `limit`-th hit passes). */
  limit: number;
  windowMs: number;
}

export type RateLimitBucket =
  | "auth:register"
  | "auth:login"
  | "auth:forgot-password"
  | "auth:reset-password"
  | "auth:verify-email"
  | "auth:resend-verification"
  | "account:delete";

/**
 * Per-IP trailing windows, deliberately generous: a user retrying a typo'd
 * password or requesting one reset mail must never see a 429, while bulk
 * credential-stuffing / mail-bombing from one IP hits the ceiling fast.
 * Keyed by IP (not email) so an attacker cannot lock a victim out by
 * burning their budget.
 */
export const AUTH_RATE_LIMITS: Record<RateLimitBucket, RateLimitRule> = {
  "auth:register": { limit: 10, windowMs: 10 * 60_000 },
  "auth:login": { limit: 20, windowMs: 10 * 60_000 },
  "auth:forgot-password": { limit: 5, windowMs: 60 * 60_000 },
  "auth:reset-password": { limit: 10, windowMs: 60 * 60_000 },
  "auth:verify-email": { limit: 20, windowMs: 60 * 60_000 },
  "auth:resend-verification": { limit: 5, windowMs: 60 * 60_000 },
  // Destructive, cookie-authed, CSRF-gated: nobody legitimately deletes
  // several accounts per hour from one IP, so a tight ceiling only bites
  // automated abuse of a stolen session.
  "account:delete": { limit: 5, windowMs: 60 * 60_000 },
};

export interface WindowCount {
  /** 1-based hit count inside the current window (after recording). */
  count: number;
  resetAt: Date;
}

export interface RateLimitStore {
  /**
   * Atomically record one hit for `key` and report the window count.
   * Implementations prune entries older than the window; callers treat
   * overshoot under concurrency as acceptable (abuse throttle, not quota).
   */
  hit(key: string, windowMs: number, now: Date): Promise<WindowCount>;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until retry (0 when allowed); served as `Retry-After`. */
  retryAfterSeconds: number;
  resetAt: Date;
}

export async function checkRateLimit(
  store: RateLimitStore,
  rule: RateLimitRule,
  key: string,
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const { count, resetAt } = await store.hit(key, rule.windowMs, now);
  const allowed = count <= rule.limit;
  return {
    allowed,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
    resetAt,
  };
}

/** One budget per endpoint per caller IP (`auth:login:1.2.3.4`). */
export function bucketKey(bucket: RateLimitBucket, ip: string): string {
  return `${bucket}:${ip}`;
}

/**
 * Best-effort caller IP: leftmost `X-Forwarded-For` (the client-facing proxy
 * entry), then `X-Real-IP`, then a shared `"unknown"` bucket.
 *
 * Known limitation: direct callers can spoof these headers to mint fresh
 * buckets, so this is a throttle — not authentication. Real auth security
 * rests on cost-12 password hashing, no-enumeration responses, and single-use
 * expiring tokens; the throttle only raises the cost of bulk abuse. A
 * trusted-proxy allow-list is future work if abuse ever demands it.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}
