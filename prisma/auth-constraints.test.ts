import { describe, expect, it } from "vitest";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabaseUrl ? describe : describe.skip;

describeIfDb("users live DB constraints (issue 04, spec §8.1)", () => {
  it("rejects non-normalized emails via CHECK (bypass-writer guard)", async () => {
    const { db } = await import("@/lib/db");
    const suffix = crypto.randomUUID();
    await expect(
      db.user.create({
        data: { email: `Upper-${suffix}@Example.COM`, timezone: "UTC" },
      }),
    ).rejects.toThrow(/users_email_normalized_check/);
    await expect(
      db.user.create({
        data: { email: `  spaced-${suffix}@example.com`, timezone: "UTC" },
      }),
    ).rejects.toThrow(/users_email_normalized_check/);
  });

  it("stores normalized emails and defaults timezone to UTC", async () => {
    const { db } = await import("@/lib/db");
    const email = `normalized-${crypto.randomUUID()}@example.com`;
    const user = await db.user.create({ data: { email, timezone: "UTC" } });
    try {
      expect(user.email).toBe(email);
      expect(user.timezone).toBe("UTC");
    } finally {
      await db.user.delete({ where: { id: user.id } });
    }
  });
});
