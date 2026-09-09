import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import {
  PASSWORD_HASH_COST,
  hashPassword,
  verifyPassword,
} from "./password";

// Low cost keeps the suite fast; production callers use the default cost.
// Vectors are real bcrypt hashes, so the assertions are not tautological.
const TEST_COST = 4;

describe("hashPassword / verifyPassword (spec §8.1: never plaintext)", () => {
  it("verifies the correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("s3cure-password", TEST_COST);
    await expect(verifyPassword("s3cure-password", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("never stores or returns the plaintext", async () => {
    const hash = await hashPassword("s3cure-password", TEST_COST);
    expect(hash).not.toContain("s3cure-password");
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  it("salts hashes so identical passwords differ", async () => {
    const [first, second] = await Promise.all([
      hashPassword("same-password", TEST_COST),
      hashPassword("same-password", TEST_COST),
    ]);
    expect(first).not.toBe(second);
    await expect(verifyPassword("same-password", first)).resolves.toBe(true);
    await expect(verifyPassword("same-password", second)).resolves.toBe(true);
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(
      false,
    );
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });

  it("defaults to the production cost factor", async () => {
    const hash = await hashPassword("s3cure-password");
    expect(bcrypt.getRounds(hash)).toBe(PASSWORD_HASH_COST);
  });
});
