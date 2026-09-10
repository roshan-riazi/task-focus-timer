import bcrypt from "bcryptjs";

/**
 * Production bcrypt cost. ~12 is the current OWASP guidance for interactive
 * logins; tests pass an explicit lower cost for speed (see password.test.ts).
 */
export const PASSWORD_HASH_COST = 12;

/**
 * Hash a validated password (validation caps inputs at 72 UTF-8 bytes, the
 * bcrypt input limit — see lib/auth/validation.ts). bcryptjs is pure JS, so
 * no native toolchain is needed in the slim Docker image.
 */
export async function hashPassword(
  password: string,
  cost: number = PASSWORD_HASH_COST,
): Promise<string> {
  const salt = await bcrypt.genSalt(cost);
  return bcrypt.hash(password, salt);
}

/**
 * Compare a candidate against a stored hash. Returns false (never throws)
 * for malformed hashes so a corrupt row fails closed as "invalid password".
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  if (!password || !hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
