import type { PrismaClient } from "@prisma/client";
import { resetPasswordEmail, verifyEmail } from "../email/templates";
import type { EmailProvider } from "../email/types";
import { AuthServiceError, type AuthPorts } from "./service";

/**
 * Production ports: AuthPorts over Prisma (the only data-access path per
 * SYSTEM_DESIGN §1). Multi-row writes that must not half-apply
 * (registration user+settings, reset hash+consume+revoke) run inside
 * `$transaction`. Prisma P2002 on the registration race maps to EMAIL_TAKEN
 * so concurrent duplicate registers get a 409, not a 500.
 */
export function createPrismaPorts(
  db: PrismaClient,
  deps: {
    now: () => Date;
    appUrl: string;
    mailer: EmailProvider;
  },
): AuthPorts {
  return {
    now: deps.now,
    appUrl: deps.appUrl,
    users: {
      findByEmail: (email) => db.user.findUnique({ where: { email } }),
      findById: (id) => db.user.findUnique({ where: { id } }),
      createWithDefaults: async ({ email, passwordHash, timezone }) => {
        try {
          return await db.$transaction(async (tx) => {
            const user = await tx.user.create({
              data: { email, passwordHash, timezone },
            });
            // Schema defaults (spec §10.2: 1500/300/900/4/false/false/
            // true/chime/80/false) — never client-supplied.
            await tx.userSettings.create({ data: { userId: user.id } });
            return { id: user.id };
          });
        } catch (cause) {
          if (
            typeof cause === "object" &&
            cause !== null &&
            "code" in cause &&
            (cause as { code: unknown }).code === "P2002"
          ) {
            throw new AuthServiceError(
              "EMAIL_TAKEN",
              "An account with this email already exists.",
            );
          }
          throw cause;
        }
      },
      completeEmailVerification: async ({ userId, tokenId, verifiedAt }) => {
        await db.$transaction([
          db.user.update({
            where: { id: userId },
            data: { emailVerified: verifiedAt },
          }),
          db.emailVerificationToken.update({
            where: { id: tokenId },
            data: { consumedAt: verifiedAt },
          }),
        ]);
      },
      completePasswordReset: async ({
        userId,
        passwordHash,
        tokenId,
        consumedAt,
      }) => {
        await db.$transaction([
          db.user.update({ where: { id: userId }, data: { passwordHash } }),
          db.passwordResetToken.update({
            where: { id: tokenId },
            data: { consumedAt },
          }),
          db.session.deleteMany({ where: { userId } }),
        ]);
      },
    },
    sessions: {
      create: async ({ sessionToken, userId, expires }) => {
        await db.session.create({ data: { sessionToken, userId, expires } });
      },
      deleteByToken: async (sessionToken) => {
        // deleteMany: logout stays idempotent (no throw on unknown tokens).
        await db.session.deleteMany({ where: { sessionToken } });
      },
      deleteAllForUser: async (userId) => {
        await db.session.deleteMany({ where: { userId } });
      },
    },
    verificationTokens: {
      replace: async (userId, { tokenHash, expiresAt }) => {
        await db.$transaction([
          db.emailVerificationToken.deleteMany({
            where: { userId, consumedAt: null },
          }),
          db.emailVerificationToken.create({
            data: { userId, tokenHash, expiresAt },
          }),
        ]);
      },
      findByHash: (tokenHash) =>
        db.emailVerificationToken.findUnique({ where: { tokenHash } }),
      consume: async (id, at) => {
        await db.emailVerificationToken.update({
          where: { id },
          data: { consumedAt: at },
        });
      },
    },
    resetTokens: {
      replace: async (userId, { tokenHash, expiresAt }) => {
        await db.$transaction([
          db.passwordResetToken.deleteMany({
            where: { userId, consumedAt: null },
          }),
          db.passwordResetToken.create({
            data: { userId, tokenHash, expiresAt },
          }),
        ]);
      },
      findByHash: (tokenHash) =>
        db.passwordResetToken.findUnique({ where: { tokenHash } }),
      consume: async (id, at) => {
        await db.passwordResetToken.update({
          where: { id },
          data: { consumedAt: at },
        });
      },
    },
    notifyVerification: async (to, verifyUrl) => {
      await deps.mailer.send({ to, ...verifyEmail({ verifyUrl }) });
    },
    notifyReset: async (to, resetUrl) => {
      await deps.mailer.send({ to, ...resetPasswordEmail({ resetUrl }) });
    },
  };
}
