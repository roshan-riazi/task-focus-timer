import { describe, expect, it } from "vitest";
import { validateEnv } from "./env";

const validEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/focusflow",
  AUTH_SECRET: "a-very-long-test-secret-value-0123456789",
};

describe("validateEnv", () => {
  it("accepts a complete env with required secrets", () => {
    expect(() => validateEnv(validEnv)).not.toThrow();
  });

  it("rejects a missing DATABASE_URL", () => {
    expect(() => validateEnv({ AUTH_SECRET: validEnv.AUTH_SECRET })).toThrow();
  });

  it("rejects a missing AUTH_SECRET", () => {
    expect(() => validateEnv({ DATABASE_URL: validEnv.DATABASE_URL })).toThrow();
  });

  it("rejects empty-string secrets", () => {
    expect(() =>
      validateEnv({ DATABASE_URL: "", AUTH_SECRET: "" }),
    ).toThrow();
  });
});

describe("validateEnv (issue 04: auth email settings)", () => {
  it("accepts a bare required env (email settings are optional)", () => {
    expect(validateEnv(validEnv)).toMatchObject(validEnv);
  });

  it("accepts a fully-configured email env", () => {
    const parsed = validateEnv({
      ...validEnv,
      EMAIL_PROVIDER: "resend",
      EMAIL_API_KEY: "re_test",
      EMAIL_FROM: "FocusFlow <hi@example.com>",
      APP_URL: "https://app.example",
    });
    expect(parsed.EMAIL_PROVIDER).toBe("resend");
    expect(parsed.APP_URL).toBe("https://app.example");
  });

  it("rejects a malformed APP_URL", () => {
    expect(() =>
      validateEnv({ ...validEnv, APP_URL: "not-a-url" }),
    ).toThrow();
  });

  it("rejects an unknown EMAIL_PROVIDER", () => {
    expect(() =>
      validateEnv({ ...validEnv, EMAIL_PROVIDER: "carrier-pigeon" }),
    ).toThrow();
  });
});

describe("validateEnv (issue 06: scrubbed error monitoring DSN)", () => {
  it("accepts a bare env without ERROR_DSN", () => {
    expect(validateEnv(validEnv)).toMatchObject(validEnv);
  });

  it("preserves ERROR_DSN when configured", () => {
    const parsed = validateEnv({
      ...validEnv,
      ERROR_DSN: "https://public@example.ingest.sentry.io/1",
    });
    expect(parsed.ERROR_DSN).toBe(
      "https://public@example.ingest.sentry.io/1",
    );
  });
});
