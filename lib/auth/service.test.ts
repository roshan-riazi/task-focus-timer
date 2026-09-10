import { describe, expect, it, vi } from "vitest";
import { hashToken } from "./tokens";
import { AuthServiceError, createAuthService } from "./service";
import type { AuthPorts } from "./service";
import { verifyPassword as realVerify } from "./password";

/**
 * In-memory ports: the service under test never touches Postgres here, so
 * the full register → verify → login → reset journey runs hermetically.
 * Route-level tests (app/api/auth/*) repeat the journey against real
 * Postgres in CI (describeIfDb, TEST_STRATEGY §2).
 */
function createFakePorts(overrides: Partial<AuthPorts> = {}) {
  type User = {
    id: string;
    email: string;
    passwordHash: string | null;
    emailVerified: Date | null;
    timezone: string;
  };
  type TokenRow = {
    id: string;
    userId: string;
    expiresAt: Date;
    consumedAt: Date | null;
  };
  const users = new Map<string, User>();
  const settingsRows = new Set<string>();
  const sessions = new Map<string, { userId: string; expires: Date }>();
  const verifyTokens = new Map<string, TokenRow>();
  const resetTokens = new Map<string, TokenRow>();
  const sent: Array<{ to: string; kind: "verify" | "reset"; url: string }> = [];
  let now = new Date("2026-09-08T12:00:00.000Z");
  let seq = 0;
  const ids = () => `id-${(seq += 1)}`;

  const ports: AuthPorts = {
    now: () => new Date(now),
    appUrl: "https://app.example",
    users: {
      async findByEmail(email) {
        for (const user of users.values()) {
          if (user.email === email) return { ...user };
        }
        return null;
      },
      async findById(id) {
        const user = users.get(id);
        return user ? { ...user } : null;
      },
      async createWithDefaults(data) {
        const id = ids();
        users.set(id, { id, emailVerified: null, ...data });
        settingsRows.add(id);
        return { id };
      },
      async completeEmailVerification({ userId, tokenId, verifiedAt }) {
        const user = users.get(userId);
        if (user) user.emailVerified = verifiedAt;
        for (const row of verifyTokens.values()) {
          if (row.id === tokenId) row.consumedAt = verifiedAt;
        }
      },
      async completePasswordReset({ userId, passwordHash, tokenId, consumedAt }) {
        const user = users.get(userId);
        if (user) user.passwordHash = passwordHash;
        for (const row of resetTokens.values()) {
          if (row.id === tokenId) row.consumedAt = consumedAt;
        }
        for (const [token, session] of sessions) {
          if (session.userId === userId) sessions.delete(token);
        }
      },
    },
    sessions: {
      async create(data) {
        sessions.set(data.sessionToken, {
          userId: data.userId,
          expires: data.expires,
        });
      },
      async deleteByToken(token) {
        sessions.delete(token);
      },
      async deleteAllForUser(userId) {
        for (const [token, session] of sessions) {
          if (session.userId === userId) sessions.delete(token);
        }
      },
    },
    verificationTokens: {
      async replace(userId, row) {
        for (const [hash, existing] of verifyTokens) {
          if (existing.userId === userId && !existing.consumedAt) {
            verifyTokens.delete(hash);
          }
        }
        verifyTokens.set(row.tokenHash, {
          id: ids(),
          userId,
          consumedAt: null,
          expiresAt: row.expiresAt,
        });
      },
      async findByHash(tokenHash) {
        const row = verifyTokens.get(tokenHash);
        return row ? { ...row } : null;
      },
      async consume(id, at) {
        for (const row of verifyTokens.values()) {
          if (row.id === id) row.consumedAt = at;
        }
      },
    },
    resetTokens: {
      async replace(userId, row) {
        for (const [hash, existing] of resetTokens) {
          if (existing.userId === userId && !existing.consumedAt) {
            resetTokens.delete(hash);
          }
        }
        resetTokens.set(row.tokenHash, {
          id: ids(),
          userId,
          consumedAt: null,
          expiresAt: row.expiresAt,
        });
      },
      async findByHash(tokenHash) {
        const row = resetTokens.get(tokenHash);
        return row ? { ...row } : null;
      },
      async consume(id, at) {
        for (const row of resetTokens.values()) {
          if (row.id === id) row.consumedAt = at;
        }
      },
    },
    notifyVerification: async (to: string, url: string) => {
      sent.push({ to, kind: "verify", url });
    },
    notifyReset: async (to: string, url: string) => {
      sent.push({ to, kind: "reset", url });
    },
    ...overrides,
  };
  return {
    ports,
    users,
    sessions,
    verifyTokens,
    resetTokens,
    sent,
    settingsRows,
    setNow: (value: Date) => {
      now = value;
    },
  };
}

async function expectCode(
  promise: Promise<unknown>,
  code: string,
): Promise<AuthServiceError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AuthServiceError);
  expect((error as AuthServiceError).code).toBe(code);
  return error as AuthServiceError;
}

describe("register (spec §8.1)", () => {
  it("creates the user with normalized email, hashed password, and bootstrapped settings", async () => {
    const { ports, users, settingsRows, sent } = createFakePorts();
    const service = createAuthService(ports);
    const result = await service.register({
      email: "  ALICE@Example.COM ",
      password: "s3cure-password",
      timezone: "Europe/Berlin",
    });
    expect(result.user.email).toBe("alice@example.com");
    expect(result.user.emailVerified).toBeNull();
    const stored = [...users.values()].find((u) => u.id === result.user.id);
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored?.timezone).toBe("Europe/Berlin");
    // Settings-row bootstrap (issue 04 scope) with schema defaults.
    expect(settingsRows.has(result.user.id)).toBe(true);
    // Non-blocking verification email carries the token link.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "alice@example.com", kind: "verify" });
    expect(sent[0].url).toContain("/verify-email?token=");
    expect(result.emailed).toBe(true);
  });

  it("rejects a duplicate email (normalized) without leaking the hash", async () => {
    const { ports } = createFakePorts();
    const service = createAuthService(ports);
    await service.register({
      email: "alice@example.com",
      password: "s3cure-password",
    });
    const error = await expectCode(
      service.register({
        email: "ALICE@example.com",
        password: "other-pass-1",
      }),
      "EMAIL_TAKEN",
    );
    expect(JSON.stringify(error)).not.toContain("s3cure-password");
  });

  it("still registers when the mailer fails (non-blocking email)", async () => {
    const { ports, sent } = createFakePorts({
      notifyVerification: async () => {
        throw new Error("smtp down");
      },
    });
    const service = createAuthService(ports);
    const result = await service.register({
      email: "bob@example.com",
      password: "s3cure-password",
    });
    expect(result.user.email).toBe("bob@example.com");
    expect(result.emailed).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("rejects invalid input with field errors", async () => {
    const { ports } = createFakePorts();
    const service = createAuthService(ports);
    const error = await expectCode(
      service.register({ email: "bad", password: "short" }),
      "VALIDATION_ERROR",
    );
    expect(Object.keys(error.fields ?? {}).sort()).toEqual([
      "email",
      "password",
    ]);
  });
});

describe("login / logout (unverified users are NOT blocked)", () => {
  async function registered() {
    const fake = createFakePorts();
    const service = createAuthService(fake.ports);
    const { user } = await service.register({
      email: "carol@example.com",
      password: "s3cure-password",
    });
    return { ...fake, service, userId: user.id };
  }

  it("logs in an unverified user (verification nag, not a gate)", async () => {
    const { service, sessions, userId } = await registered();
    const result = await service.login({
      email: "CAROL@example.com",
      password: "s3cure-password",
    });
    expect(result.user.id).toBe(userId);
    expect(result.user.emailVerified).toBeNull();
    expect(result.sessionToken.length).toBeGreaterThan(20);
    expect(result.expires.getTime()).toBeGreaterThan(
      new Date("2026-09-08T12:00:00.000Z").getTime(),
    );
    expect(sessions.has(result.sessionToken)).toBe(true);
  });

  it("rejects wrong passwords and unknown emails with one code (no oracle)", async () => {
    const { service } = await registered();
    await expectCode(
      service.login({ email: "carol@example.com", password: "wrong-pass-1" }),
      "INVALID_CREDENTIALS",
    );
    await expectCode(
      service.login({ email: "nobody@example.com", password: "wrong-pass-1" }),
      "INVALID_CREDENTIALS",
    );
  });

  it("logs out idempotently (unknown tokens still succeed)", async () => {
    const { service, sessions } = await registered();
    const { sessionToken } = await service.login({
      email: "carol@example.com",
      password: "s3cure-password",
    });
    expect(sessions.has(sessionToken)).toBe(true);
    await service.logout({ sessionToken });
    expect(sessions.has(sessionToken)).toBe(false);
    await expect(service.logout({ sessionToken })).resolves.toBeUndefined();
  });
});

describe("verifyEmail (single-use, expiring)", () => {
  async function registeredWithToken() {
    const fake = createFakePorts();
    const service = createAuthService(fake.ports);
    const { user } = await service.register({
      email: "dave@example.com",
      password: "s3cure-password",
    });
    const url = fake.sent[0].url;
    const token = new URL(url).searchParams.get("token") ?? "";
    expect(token.length).toBeGreaterThan(20);
    return { ...fake, service, userId: user.id, token };
  }

  it("marks the email verified and consumes the token", async () => {
    const { service, users, userId, token } = await registeredWithToken();
    await expect(service.verifyEmail({ token })).resolves.toMatchObject({
      userId,
    });
    expect(users.get(userId)?.emailVerified).toBeInstanceOf(Date);
    // Reuse fails: single-use.
    await expectCode(service.verifyEmail({ token }), "INVALID_TOKEN");
  });

  it("rejects unknown and expired tokens without distinguishing them", async () => {
    const { service, setNow, token } = await registeredWithToken();
    await expectCode(service.verifyEmail({ token: "bogus" }), "INVALID_TOKEN");
    setNow(new Date("2026-09-20T12:00:00.000Z")); // past 24h TTL
    await expectCode(service.verifyEmail({ token }), "INVALID_TOKEN");
  });

  it("resends a fresh token, invalidating the predecessor", async () => {
    const { service, sent, userId, token: first } =
      await registeredWithToken();
    const result = await service.requestVerification({ userId });
    expect(result.emailed).toBe(true);
    expect(sent).toHaveLength(2);
    const second = new URL(sent[1].url).searchParams.get("token") ?? "";
    expect(second).not.toBe(first);
    await expectCode(service.verifyEmail({ token: first }), "INVALID_TOKEN");
    await expect(service.verifyEmail({ token: second })).resolves.toMatchObject(
      { userId },
    );
  });

  it("stores only hashes: the persisted form equals the recomputed digest", async () => {
    const { verifyTokens, token } = await registeredWithToken();
    expect(verifyTokens.has(hashToken(token))).toBe(true);
    expect(verifyTokens.has(token)).toBe(false);
  });
});

describe("forgotPassword / resetPassword (no enumeration, session revocation)", () => {
  async function setup() {
    const fake = createFakePorts();
    const service = createAuthService(fake.ports);
    const { user } = await service.register({
      email: "erin@example.com",
      password: "old-password-1",
    });
    const { sessionToken } = await service.login({
      email: "erin@example.com",
      password: "old-password-1",
    });
    return { ...fake, service, userId: user.id, sessionToken };
  }

  function resetTokenFromSent(sent: Array<{ url: string }>): string {
    const reset = sent.find((m) => m.url.includes("/reset-password?token="));
    const token = reset ? new URL(reset.url).searchParams.get("token") : null;
    if (!token) throw new Error("expected a reset email in the outbox");
    return token;
  }

  it("always succeeds, emailing only existing addresses", async () => {
    const { service, sent } = await setup();
    const before = sent.length;
    await expect(
      service.forgotPassword({ email: "ghost@example.com" }),
    ).resolves.toBeUndefined();
    expect(sent).toHaveLength(before);
    await expect(
      service.forgotPassword({ email: " ERIN@Example.com " }),
    ).resolves.toBeUndefined();
    expect(sent).toHaveLength(before + 1);
    expect(sent[sent.length - 1].url).toContain("/reset-password?token=");
  });

  it("resets the password, revokes sessions, and burns the token", async () => {
    const { service, sessions, sent, sessionToken } = await setup();
    await service.forgotPassword({ email: "erin@example.com" });
    const token = resetTokenFromSent(sent);
    await service.resetPassword({ token, password: "brand-new-pass-2" });
    // Old password dead, new password works.
    await expectCode(
      service.login({ email: "erin@example.com", password: "old-password-1" }),
      "INVALID_CREDENTIALS",
    );
    await expect(
      service.login({
        email: "erin@example.com",
        password: "brand-new-pass-2",
      }),
    ).resolves.toMatchObject({ user: { email: "erin@example.com" } });
    // Pre-reset session revoked.
    expect(sessions.has(sessionToken)).toBe(false);
    // Token single-use.
    await expectCode(
      service.resetPassword({ token, password: "another-pass-3" }),
      "INVALID_TOKEN",
    );
  });

  it("rejects unknown and expired reset tokens identically", async () => {
    const { service, setNow, sent } = await setup();
    await service.forgotPassword({ email: "erin@example.com" });
    const token = resetTokenFromSent(sent);
    await expectCode(
      service.resetPassword({ token: "bogus", password: "brand-new-pass-2" }),
      "INVALID_TOKEN",
    );
    setNow(new Date("2026-09-08T14:00:00.001Z")); // past 1h TTL
    await expectCode(
      service.resetPassword({ token, password: "brand-new-pass-2" }),
      "INVALID_TOKEN",
    );
  });

  it("compares against a dummy hash for unknown users (timing-oracle guard)", async () => {
    const seen: string[] = [];
    const fake = createFakePorts({
      crypto: {
        hash: async (password: string) => {
          const { hashPassword } = await import("./password");
          return hashPassword(password, 4);
        },
        verify: async (candidate: string, hash: string) => {
          seen.push(candidate);
          return realVerify(candidate, hash);
        },
      },
    });
    const service = createAuthService(fake.ports);
    await service.register({
      email: "frank@example.com",
      password: "s3cure-password",
    });
    await expectCode(
      service.login({
        email: "nobody-here@example.com",
        password: "x".repeat(12),
      }),
      "INVALID_CREDENTIALS",
    );
    expect(seen).toEqual(["x".repeat(12)]);
  });

  it("reports mailer spy calls without touching the network", async () => {
    const notifyReset = vi.fn(async () => undefined);
    const fake = createFakePorts({ notifyReset });
    const service = createAuthService(fake.ports);
    await service.register({
      email: "gina@example.com",
      password: "s3cure-password",
    });
    await service.forgotPassword({ email: "gina@example.com" });
    expect(notifyReset).toHaveBeenCalledOnce();
  });
});
