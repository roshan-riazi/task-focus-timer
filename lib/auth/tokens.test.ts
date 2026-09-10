import { describe, expect, it } from "vitest";
import { hashToken, mintToken, tokensEqual } from "./tokens";

const NOW = new Date("2026-09-08T12:00:00.000Z");

describe("mintToken (opaque single-use email tokens)", () => {
  it("mints a unique token with a matching SHA-256 hash and TTL expiry", () => {
    const first = mintToken({ ttlMs: 60_000, now: NOW });
    const second = mintToken({ ttlMs: 60_000, now: NOW });
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashToken(first.token));
    expect(first.expiresAt.toISOString()).toBe("2026-09-08T12:01:00.000Z");
    // Raw tokens never appear in storage-shaped values.
    expect(first.tokenHash).not.toContain(first.token.slice(0, 8));
  });

  it("is deterministic under an injected RNG (TEST_STRATEGY §2)", () => {
    const bytes = (n: number) => Buffer.alloc(n, 7);
    const pair = mintToken({
      ttlMs: 1000,
      now: NOW,
      rng: bytes,
    });
    expect(pair).toEqual(
      mintToken({ ttlMs: 1000, now: NOW, rng: bytes }),
    );
  });
});

describe("tokensEqual (constant-time hash comparison)", () => {
  it("accepts matching hashes and rejects mismatches without throwing", () => {
    const { tokenHash } = mintToken({ ttlMs: 1000, now: NOW });
    expect(tokensEqual(tokenHash, hashToken("wrong-token"))).toBe(false);
    expect(tokensEqual(tokenHash, tokenHash)).toBe(true);
    expect(tokensEqual(tokenHash, "short")).toBe(false);
    expect(tokensEqual(tokenHash, "")).toBe(false);
  });
});
