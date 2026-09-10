import { describe, expect, it } from "vitest";
import {
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  normalizeEmail,
  registerSchema,
  resetPasswordSchema,
  toValidationError,
  verifyEmailSchema,
} from "./validation";

describe("normalizeEmail (spec §8.1: normalized unique email)", () => {
  it("trims surrounding whitespace and lowercases the address", () => {
    expect(normalizeEmail("  ALICE@Example.COM ")).toBe("alice@example.com");
  });

  it("leaves an already-normalized address untouched", () => {
    expect(normalizeEmail("bob@example.com")).toBe("bob@example.com");
  });
});

describe("registerSchema", () => {
  const valid = {
    email: "alice@example.com",
    password: "s3cure-password",
    timezone: "Europe/Berlin",
  };

  it("accepts a valid payload and normalizes the email", () => {
    const parsed = registerSchema.parse({
      ...valid,
      email: "  ALICE@Example.COM ",
    });
    expect(parsed.email).toBe("alice@example.com");
    expect(parsed.timezone).toBe("Europe/Berlin");
  });

  it("defaults an omitted timezone to UTC (spec §8.7 editable later)", () => {
    const { timezone: _omitted, ...withoutTimezone } = valid;
    void _omitted;
    expect(registerSchema.parse(withoutTimezone).timezone).toBe("UTC");
  });

  it("rejects passwords shorter than 8 characters (spec §8.1)", () => {
    expect(
      registerSchema.safeParse({ ...valid, password: "1234567" }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...valid, password: "12345678" }).success,
    ).toBe(true);
  });

  it("rejects passwords that exceed the bcrypt 72-byte input cap", () => {
    expect(
      registerSchema.safeParse({ ...valid, password: "a".repeat(72) }).success,
    ).toBe(true);
    expect(
      registerSchema.safeParse({ ...valid, password: "a".repeat(73) }).success,
    ).toBe(false);
    // 37 × U+00E9 is 37 chars but 74 bytes: must fail on bytes, not chars.
    expect(
      registerSchema.safeParse({ ...valid, password: "é".repeat(37) }).success,
    ).toBe(false);
  });

  it("rejects malformed emails, over-long emails, and unknown timezones", () => {
    expect(
      registerSchema.safeParse({ ...valid, email: "not-an-email" }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...valid, email: `${"a".repeat(250)}@x.com` })
        .success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({ ...valid, timezone: "Mars/Olympus" }).success,
    ).toBe(false);
  });
});

describe("loginSchema", () => {
  it("accepts valid credentials and normalizes the email", () => {
    const parsed = loginSchema.parse({
      email: "BOB@Example.com",
      password: "whatever-length",
    });
    expect(parsed.email).toBe("bob@example.com");
  });

  it("rejects empty passwords and malformed emails", () => {
    expect(
      loginSchema.safeParse({ email: "bob@example.com", password: "" })
        .success,
    ).toBe(false);
    expect(
      loginSchema.safeParse({ email: "bob", password: "s3cure-password" })
        .success,
    ).toBe(false);
  });
});

describe("verifyEmailSchema / forgotPasswordSchema / resetPasswordSchema", () => {
  it("requires a non-empty token for verification", () => {
    expect(verifyEmailSchema.safeParse({ token: "" }).success).toBe(false);
    expect(verifyEmailSchema.parse({ token: "abc123" }).token).toBe("abc123");
  });

  it("normalizes the forgot-password email", () => {
    expect(forgotPasswordSchema.parse({ email: " C@X.com " }).email).toBe(
      "c@x.com",
    );
    expect(
      forgotPasswordSchema.safeParse({ email: "nope" }).success,
    ).toBe(false);
  });

  it("applies the same password policy on reset as on register", () => {
    expect(
      resetPasswordSchema.safeParse({ token: "t", password: "short" }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ token: "", password: "long-enough-1" })
        .success,
    ).toBe(false);
    expect(
      resetPasswordSchema.parse({ token: "t", password: "long-enough-1" })
        .password,
    ).toBe("long-enough-1");
  });
});

describe("toValidationError (API envelope per SYSTEM_DESIGN §6)", () => {
  it("maps Zod issues to a 400 envelope with field-associated messages", () => {
    const result = registerSchema.safeParse({ email: "bad", password: "x" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const err = toValidationError(result.error);
    expect(err.status).toBe(400);
    expect(err.body.error.code).toBe("VALIDATION_ERROR");
    expect(err.body.error.fields?.email?.length).toBeGreaterThan(0);
    expect(err.body.error.fields?.password?.length).toBeGreaterThan(0);
    // Envelope carries no user content beyond the field messages.
    expect(JSON.stringify(err.body)).not.toContain("password123");
  });
});

describe("deleteAccountSchema (spec §8.1: explicit confirmation)", () => {
  it("accepts exactly the DELETE confirmation literal", () => {
    expect(deleteAccountSchema.parse({ confirmation: "DELETE" })).toEqual({
      confirmation: "DELETE",
    });
  });

  it("rejects missing, mistyped, wrong-case, and padded confirmations", () => {
    const bad: unknown[] = [
      {},
      null,
      [],
      "DELETE",
      { confirmation: "" },
      { confirmation: "delete" },
      { confirmation: " DELETE" },
      { confirmation: "DELETE " },
      { confirmation: "YES" },
    ];
    for (const input of bad) {
      expect(deleteAccountSchema.safeParse(input).success).toBe(false);
    }
  });
});
