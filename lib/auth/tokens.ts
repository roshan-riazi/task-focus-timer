import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface MintedToken {
  /** Raw token: emailed to the user, never stored. */
  token: string;
  /** SHA-256 hex of the token: the only form persisted. */
  tokenHash: string;
  expiresAt: Date;
}

export interface MintOptions {
  ttlMs: number;
  now?: Date;
  /** Injected entropy source for deterministic tests (TEST_STRATEGY §2). */
  rng?: (bytes: number) => Buffer;
}

/**
 * Mint an opaque single-use token. 256 bits of entropy, base64url-encoded
 * for URL-safe email links; stored as SHA-256 so a DB read never yields a
 * usable token.
 */
export function mintToken({ ttlMs, now = new Date(), rng }: MintOptions): MintedToken {
  const generate = rng ?? randomBytes;
  const token = generate(32).toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + ttlMs),
  };
}

/** SHA-256 hex digest — the storage form of an emailed token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison for stored token hashes. Length mismatches fail
 * closed without throwing (timingSafeEqual requires equal lengths).
 */
export function tokensEqual(stored: string, presented: string): boolean {
  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
