import { z } from "zod";

/** Matches `users.email VARCHAR(255)` (see prisma/schema.prisma). */
export const MAX_EMAIL_LENGTH = 255;

/** Spec §8.1: at least eight characters unless a provider demands more. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * bcrypt (and bcryptjs) silently truncate inputs past 72 bytes, so two
 * distinct long passwords sharing a 72-byte prefix would verify identically.
 * Cap inputs at the byte level — multibyte characters count by UTF-8 bytes,
 * not JS chars.
 */
export const MAX_PASSWORD_BYTES = 72;

const byteLength = (value: string): number =>
  new TextEncoder().encode(value).length;

/**
 * Spec §8.1: email addresses are normalized before storage and uniqueness
 * checks. Trim + full lowercase (covers case variants; provider-specific
 * aliasing such as Gmail dots is intentionally out of scope).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .email("Enter a valid email address.")
      .max(MAX_EMAIL_LENGTH, "Email address is too long."),
  );

const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, "Password must contain at least 8 characters.")
  .refine((value) => byteLength(value) <= MAX_PASSWORD_BYTES, {
    message: "Password is too long.",
  });

function timezoneSchema() {
  return z
    .string()
    .max(64, "Timezone is too long.")
    .refine(
      (value) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: value });
          return true;
        } catch {
          return false;
        }
      },
      { message: "Enter a valid IANA timezone." },
    )
    .default("UTC");
}

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  timezone: timezoneSchema(),
});

export const loginSchema = z.object({
  email: emailSchema,
  // Login accepts any non-empty password: credential validity is decided by
  // hash comparison, and both failures map to the same error code.
  password: z.string().min(1, "Enter your password."),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, "Missing verification token.").max(512),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Missing reset token.").max(512),
  password: passwordSchema,
});

/**
 * Spec §8.1: account deletion requires explicit confirmation. The literal
 * lives server-side (not just client copy) so a bare DELETE request without
 * it fails validation — the UI asks the user to type DELETE.
 */
export const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE", {
    error: "Type DELETE to confirm account deletion.",
  }),
});

export interface FieldErrors {
  [field: string]: string[];
}

export interface ValidationErrorBody {
  error: {
    code: "VALIDATION_ERROR";
    message: string;
    fields: FieldErrors;
  };
}

/**
 * Field-associated 400 envelope (spec §12.3: validation errors belong to
 * their fields; SYSTEM_DESIGN §6: `{ error: { code, message } }` shape, with
 * an additive `fields` map the envelope example leaves room for).
 */
export function toValidationError(issues: z.ZodError): {
  status: 400;
  body: ValidationErrorBody;
} {
  return {
    status: 400,
    body: {
      error: {
        code: "VALIDATION_ERROR",
        message: "Check the highlighted fields and try again.",
        fields: flattenZodFields(issues),
      },
    },
  };
}

/** Zod issues grouped by top-level field (shared by the service error). */
export function flattenZodFields(issues: z.ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of issues.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}
