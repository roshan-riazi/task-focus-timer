import { randomUUID } from "node:crypto";
import { z } from "zod";
import { reportError } from "../errors";
import {
  hashPassword as defaultHashPassword,
  verifyPassword as defaultVerifyPassword,
} from "./password";
import {
  hashToken,
  mintToken,
  PASSWORD_RESET_TTL_MS,
  VERIFY_EMAIL_TTL_MS,
} from "./tokens";
export { PASSWORD_RESET_TTL_MS, VERIFY_EMAIL_TTL_MS };
import {
  forgotPasswordSchema,
  flattenZodFields,
  loginSchema,
  normalizeEmail,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "./validation";

export type AuthErrorCode =
  | "VALIDATION_ERROR"
  | "EMAIL_TAKEN"
  | "INVALID_CREDENTIALS"
  | "INVALID_TOKEN";

/**
 * Typed service failure. Routes map codes to HTTP status + envelope
 * (EMAIL_TAKEN → 409, INVALID_CREDENTIALS → 401, INVALID_TOKEN → 400,
 * VALIDATION_ERROR → 400 via `toValidationError`); anything else is a 500.
 * Messages are generic by design: wrong password, unknown email, expired
 * token, and consumed token are indistinguishable to callers.
 */
export class AuthServiceError extends Error {
  readonly fields?: Record<string, string[]>;
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AuthServiceError";
    this.fields = fields;
  }
}

/** Auth.js database-session lifetime (matches `session.maxAge` in config). */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Precomputed cost-12 bcrypt hash of a random password. Unknown-email logins
 * still pay for one comparison so response timing reveals nothing about
 * which emails exist (spec §12.2: error responses must not leak existence;
 * timing is part of that).
 */
const DUMMY_PASSWORD_HASH =
  "$2b$12$zNwGi5UZLn4ALlOHDYEEeuI35Z46QmzBf/0iVqMZy8snbJrs72ckS";

export interface ServiceUser {
  id: string;
  email: string;
  passwordHash: string | null;
  emailVerified: Date | null;
  timezone: string;
}

export interface StoredToken {
  id: string;
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface TokenStore {
  replace(
    userId: string,
    row: { tokenHash: string; expiresAt: Date },
  ): Promise<void>;
  findByHash(tokenHash: string): Promise<StoredToken | null>;
  consume(id: string, at: Date): Promise<void>;
}

/**
 * System boundaries behind the auth service (health-route factory pattern:
 * callers inject the boundary; tests inject fakes; routes inject Prisma).
 */
export interface AuthPorts {
  now(): Date;
  /** Base URL for emailed links (APP_URL). */
  appUrl: string;
  crypto?: {
    hash(password: string): Promise<string>;
    verify(candidate: string, hash: string): Promise<boolean>;
  };
  users: {
    findByEmail(email: string): Promise<ServiceUser | null>;
    findById(id: string): Promise<ServiceUser | null>;
    /**
     * Create the user AND the default `user_settings` row in one
     * transaction (issue 04 scope: settings-row bootstrap at registration).
     */
    createWithDefaults(data: {
      email: string;
      passwordHash: string;
      timezone: string;
    }): Promise<{ id: string }>;
    /**
     * Atomic finalize for email verification: stamp `emailVerified` and
     * consume the token in one transaction (no live-token window).
     */
    completeEmailVerification(data: {
      userId: string;
      tokenId: string;
      verifiedAt: Date;
    }): Promise<void>;
    /**
     * Atomic finalize for password reset: set the new hash, consume the
     * token, and revoke all sessions in one transaction.
     */
    completePasswordReset(data: {
      userId: string;
      passwordHash: string;
      tokenId: string;
      consumedAt: Date;
    }): Promise<void>;
  };
  sessions: {
    create(data: {
      sessionToken: string;
      userId: string;
      expires: Date;
    }): Promise<void>;
    deleteByToken(sessionToken: string): Promise<void>;
    deleteAllForUser(userId: string): Promise<void>;
  };
  verificationTokens: TokenStore;
  resetTokens: TokenStore;
  /** Email side effects; failures are caught and reported, never thrown. */
  notifyVerification(to: string, verifyUrl: string): Promise<void>;
  notifyReset(to: string, resetUrl: string): Promise<void>;
}

function validationError(error: z.ZodError): AuthServiceError {
  return new AuthServiceError(
    "VALIDATION_ERROR",
    "Check the highlighted fields and try again.",
    flattenZodFields(error),
  );
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function createAuthService(ports: AuthPorts) {
  const crypto = ports.crypto ?? {
    hash: defaultHashPassword,
    verify: defaultVerifyPassword,
  };

  async function tryNotify(task: Promise<void>): Promise<boolean> {
    try {
      await task;
      return true;
    } catch (cause) {
      // Non-blocking email (issue 04): registration and reset-request
      // succeed even when the provider is down; the failure goes to the
      // scrubbed error pipeline for ops (RUNBOOK), never to the caller.
      await reportError(cause, {});
      return false;
    }
  }

  return {
    async register(input: unknown): Promise<{
      user: { id: string; email: string; emailVerified: null };
      emailed: boolean;
    }> {
      const { email, password, timezone } = parse(registerSchema, input);
      const normalized = normalizeEmail(email);
      const existing = await ports.users.findByEmail(normalized);
      if (existing) {
        throw new AuthServiceError(
          "EMAIL_TAKEN",
          "An account with this email already exists.",
        );
      }
      const passwordHash = await crypto.hash(password);
      const { id } = await ports.users.createWithDefaults({
        email: normalized,
        passwordHash,
        timezone,
      });
      const minted = mintToken({
        ttlMs: VERIFY_EMAIL_TTL_MS,
        now: ports.now(),
      });
      await ports.verificationTokens.replace(id, {
        tokenHash: minted.tokenHash,
        expiresAt: minted.expiresAt,
      });
      const emailed = await tryNotify(
        ports.notifyVerification(
          normalized,
          `${ports.appUrl}/verify-email?token=${minted.token}`,
        ),
      );
      return { user: { id, email: normalized, emailVerified: null }, emailed };
    },

    async login(input: unknown): Promise<{
      user: { id: string; email: string; emailVerified: Date | null };
      sessionToken: string;
      expires: Date;
    }> {
      const { email, password } = parse(loginSchema, input);
      const normalized = normalizeEmail(email);
      const user = await ports.users.findByEmail(normalized);
      const hash = user?.passwordHash ?? null;
      // Unknown users (or hash-less rows) pay for a comparison too, so the
      // INVALID_CREDENTIALS path takes the same shape for everyone.
      const ok =
        hash === null
          ? await crypto.verify(password, DUMMY_PASSWORD_HASH).then(() => false)
          : await crypto.verify(password, hash);
      if (!ok || !user) {
        throw new AuthServiceError(
          "INVALID_CREDENTIALS",
          "Invalid email or password.",
        );
      }
      // Verification is a nag, never a gate (spec §8.1): unverified users
      // receive a session exactly like verified ones.
      const sessionToken = randomUUID();
      const expires = new Date(
        ports.now().getTime() + SESSION_MAX_AGE_SECONDS * 1000,
      );
      await ports.sessions.create({ sessionToken, userId: user.id, expires });
      return {
        user: {
          id: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
        },
        sessionToken,
        expires,
      };
    },

    async logout(input: { sessionToken?: unknown }): Promise<void> {
      if (
        typeof input.sessionToken === "string" &&
        input.sessionToken.length > 0
      ) {
        await ports.sessions.deleteByToken(input.sessionToken);
      }
    },

    async requestVerification(input: {
      userId: string;
    }): Promise<{ emailed: boolean }> {
      const user = await ports.users.findById(input.userId);
      if (!user || user.emailVerified) return { emailed: false };
      const minted = mintToken({ ttlMs: VERIFY_EMAIL_TTL_MS, now: ports.now() });
      await ports.verificationTokens.replace(user.id, {
        tokenHash: minted.tokenHash,
        expiresAt: minted.expiresAt,
      });
      return {
        emailed: await tryNotify(
          ports.notifyVerification(
            user.email,
            `${ports.appUrl}/verify-email?token=${minted.token}`,
          ),
        ),
      };
    },

    async verifyEmail(input: unknown): Promise<{ userId: string }> {
      const { token } = parse(verifyEmailSchema, input);
      const row = await ports.verificationTokens.findByHash(hashToken(token));
      const now = ports.now();
      if (!row || row.consumedAt || row.expiresAt.getTime() <= now.getTime()) {
        throw new AuthServiceError(
          "INVALID_TOKEN",
          "This link is invalid or has expired.",
        );
      }
      await ports.users.completeEmailVerification({
        userId: row.userId,
        tokenId: row.id,
        verifiedAt: now,
      });
      return { userId: row.userId };
    },

    async forgotPassword(input: unknown): Promise<void> {
      const { email } = parse(forgotPasswordSchema, input);
      const user = await ports.users.findByEmail(normalizeEmail(email));
      // Always resolve successfully: existence stays hidden (spec §12.2).
      // Abuse throttling lands with DB-backed rate limits in issue 05.
      if (!user || !user.passwordHash) return;
      const minted = mintToken({
        ttlMs: PASSWORD_RESET_TTL_MS,
        now: ports.now(),
      });
      await ports.resetTokens.replace(user.id, {
        tokenHash: minted.tokenHash,
        expiresAt: minted.expiresAt,
      });
      await tryNotify(
        ports.notifyReset(
          user.email,
          `${ports.appUrl}/reset-password?token=${minted.token}`,
        ),
      );
    },

    async resetPassword(input: unknown): Promise<void> {
      const { token, password } = parse(resetPasswordSchema, input);
      const row = await ports.resetTokens.findByHash(hashToken(token));
      const now = ports.now();
      if (!row || row.consumedAt || row.expiresAt.getTime() <= now.getTime()) {
        throw new AuthServiceError(
          "INVALID_TOKEN",
          "This link is invalid or has expired.",
        );
      }
      const passwordHash = await crypto.hash(password);
      await ports.users.completePasswordReset({
        userId: row.userId,
        passwordHash,
        tokenId: row.id,
        consumedAt: now,
      });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
