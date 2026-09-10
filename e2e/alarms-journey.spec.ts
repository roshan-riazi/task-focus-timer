import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Alarms + notifications journey (issue 13 validation).
 *
 * E2E slice: the permission-denied path degrades to silent + visual. The
 * browser permission is never granted here, so with `notificationsEnabled`
 * on, finalization must still land the visual status + proposal with no
 * crash — the notification is best-effort, the status region is the
 * baseline. Audible correctness (tone, volume, distinctness) stays a manual
 * M3 exit item per TEST_STRATEGY; unit tests pin preset→pattern + volume.
 */

test.skip(
  !process.env.DATABASE_URL,
  "alarms journey needs DATABASE_URL (CI provides it)",
);

const APP_ORIGIN = "http://127.0.0.1:3000";

let db: PrismaClient;

test.beforeAll(() => {
  db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL as string,
    }),
  });
});

test.afterAll(async () => {
  await db.$disconnect();
});

function journeyEmail(tag: string): string {
  return `e2e-alarms-${tag}-${test.info().parallelIndex}-${crypto.randomUUID()}@example.com`;
}

const JOURNEY_PASSWORD = "s3cure-password";

function timerRegion(page: Page) {
  return page.getByRole("region", { name: /^focus/i });
}

function timerStatus(page: Page) {
  return timerRegion(page).getByRole("status");
}

async function signIn(
  page: Page,
  tag: string,
): Promise<{ userId: string; email: string }> {
  const email = journeyEmail(tag);
  const password = JOURNEY_PASSWORD;
  await db.rateLimitHit.deleteMany({});
  const register = await page.request.post("/api/auth/register", {
    data: { email, password },
    headers: { origin: APP_ORIGIN },
  });
  expect(register.status()).toBe(201);
  const login = await page.request.post("/api/auth/login", {
    data: { email, password },
    headers: { origin: APP_ORIGIN },
  });
  expect(login.status()).toBe(200);
  const created = await db.user.findUnique({ where: { email } });
  expect(created).toBeTruthy();
  return { userId: created!.id, email };
}

async function setSecondsRemaining(userId: string, secondsRemaining: number) {
  const active = await db.timerSession.findFirst({
    where: { userId, status: { in: ["running", "paused"] } },
  });
  expect(active).toBeTruthy();
  const expectedEndAt = new Date(Date.now() + secondsRemaining * 1000);
  const startedAt = new Date(
    expectedEndAt.getTime() - active!.plannedDurationSeconds * 1000,
  );
  await db.timerSession.update({
    where: { id: active!.id },
    data: { startedAt, expectedEndAt },
  });
}

test("permission-denied degrades to silent + visual on grace reconcile", async ({
  page,
}) => {
  let userId = "";
  try {
    userId = (await signIn(page, "denied")).userId;

    // Sound on (bell @ 42) + notifications on — but the browser permission
    // stays ungranted, exercising the denied path.
    const permission = await page.evaluate(() =>
      typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    );
    expect(permission).not.toBe("granted");

    const patch = await page.request.patch("/api/settings", {
      data: {
        soundEnabled: true,
        soundPreset: "bell",
        soundVolume: 42,
        notificationsEnabled: true,
      },
      headers: { origin: APP_ORIGIN },
    });
    expect(patch.status()).toBe(200);

    const start = await page.request.post("/api/timer/start", {
      data: { intervalType: "focus" },
      headers: { origin: APP_ORIGIN },
    });
    expect(start.status()).toBe(201);
    // Expired 5 minutes ago: inside the 60-minute grace window.
    await setSecondsRemaining(userId, -300);

    await page.goto("/app");
    // Visual baseline lands despite denied notifications: reconciled notice
    // + break proposal, no dialog, no error.
    await expect(timerStatus(page)).toContainText(/reconciled/i);
    await expect(
      timerRegion(page).getByText(/counted once in history/i),
    ).toBeVisible();
    await expect(
      timerRegion(page).getByRole("button", { name: /start short break/i }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(timerRegion(page).getByRole("alert")).toHaveCount(0);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});
