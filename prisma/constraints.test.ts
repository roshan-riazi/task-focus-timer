import { describe, expect, it } from "vitest";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabaseUrl ? describe : describe.skip;

function makeTestEmail(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

type TimerStatus = "running" | "paused" | "completed" | "cancelled";

describeIfDb("timer_sessions live DB constraints (spec §10.6)", () => {
  it("rejects a second active session for the same user", async () => {
    process.env.DATABASE_URL ??=
      "postgres://focusflow:focusflow@localhost:5432/focusflow";
    const { db } = await import("@/lib/db");
    const email = makeTestEmail("double-active");

    const user = await db.user.create({
      data: { email, timezone: "Europe/Berlin" },
    });
    const createSession = (overrides: {
      intervalType: "focus" | "short_break" | "long_break";
      status: TimerStatus;
      startedAt: Date;
      expectedEndAt: Date;
      actualDurationSeconds?: number;
      completedAt?: Date;
    }) =>
      db.timerSession.create({
        data: {
          userId: user.id,
          plannedDurationSeconds: 1500,
          ...overrides,
        },
      });
    try {
      const startedAt = new Date();
      const expectedEndAt = new Date(startedAt.getTime() + 25 * 60 * 1000);
      await createSession({ intervalType: "focus", status: "running", startedAt, expectedEndAt });

      await expect(
        createSession({ intervalType: "focus", status: "running", startedAt, expectedEndAt }),
      ).rejects.toMatchObject({ code: "P2002" });

      // A paused second session is also active and must be rejected.
      await expect(
        createSession({ intervalType: "short_break", status: "paused", startedAt, expectedEndAt }),
      ).rejects.toMatchObject({ code: "P2002" });

      // Completed sessions are not active: allowed.
      await expect(
        createSession({
          intervalType: "focus",
          status: "completed",
          startedAt: new Date(startedAt.getTime() - 3600_000),
          expectedEndAt: new Date(startedAt.getTime() - 3600_000 + 1500_000),
          actualDurationSeconds: 1500,
          completedAt: new Date(),
        }),
      ).resolves.toBeDefined();
    } finally {
      await db.user.delete({ where: { id: user.id } });
    }
  });

  it("has the required indexes in pg_indexes", async () => {
    const { db } = await import("@/lib/db");
    const rows = (await db.$queryRawUnsafe(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('timer_sessions','tasks')`,
    )) as Array<{ indexname: string }>;
    const names = rows.map((r) => r.indexname).join("\n");
    expect(names).toMatch(/timer_sessions.*started_at|timer_sessions_user_started/i);
    expect(names).toMatch(/tasks.*status.*position|tasks_user_status_position/i);
    expect(names).toMatch(/one_active_per_user/i);
  });

  it("rejects out-of-range sound_volume via CHECK", async () => {
    const { db } = await import("@/lib/db");
    const email = makeTestEmail("check-volume");
    const user = await db.user.create({
      data: { email, timezone: "Europe/Berlin" },
    });
    try {
      await db.userSettings.create({
        data: { userId: user.id, soundVolume: 80 },
      });
      await expect(
        db.userSettings.update({
          where: { userId: user.id },
          data: { soundVolume: 101 },
        }),
      ).rejects.toThrow();
    } finally {
      await db.user.delete({ where: { id: user.id } });
    }
  });
});
