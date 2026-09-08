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
