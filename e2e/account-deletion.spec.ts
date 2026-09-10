import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Account-deletion journey (issue 18 validation): settings danger zone →
// typed DELETE → signed-out landing; the purged credentials no longer sign
// in, the freed email re-registers, and no user rows survive. Auth setup
// and post-delete probes go through the API (their own journeys live in
// auth-journey.spec.ts); the deletion itself is keyboard-driven
// (Tab / type / Enter — no pointer at any point).

test.skip(
  !process.env.DATABASE_URL,
  "account-deletion journey needs DATABASE_URL (CI provides it)",
);

const APP_ORIGIN = "http://127.0.0.1:3000";
const JOURNEY_PASSWORD = "s3cure-password";

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

function journeyEmail(): string {
  return `e2e-delete-${test.info().parallelIndex}-${crypto.randomUUID()}@example.com`;
}

/** Bidirectional Tab helper (same pattern as tasks-journey.spec.ts). */
async function tabTo(page: Page, target: Locator, what: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  for (let i = 0; i < 60; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Shift+Tab");
  }
  throw new Error(`keyboard focus never reached ${what}`);
}

test("settings danger zone deletes the account and signs out, keyboard-only", async ({
  page,
}) => {
  const email = journeyEmail();
  let userId = "";

  try {
    // --- Lived-in account via the API ---
    await db.rateLimitHit.deleteMany({});
    const register = await page.request.post("/api/auth/register", {
      data: { email, password: JOURNEY_PASSWORD },
      headers: { origin: APP_ORIGIN },
    });
    expect(register.status()).toBe(201);
    const login = await page.request.post("/api/auth/login", {
      data: { email, password: JOURNEY_PASSWORD },
      headers: { origin: APP_ORIGIN },
    });
    expect(login.status()).toBe(200);
    const created = await db.user.findUnique({ where: { email } });
    expect(created).toBeTruthy();
    userId = created!.id;
    const task = await page.request.post("/api/tasks", {
      data: { title: "Doomed journey task" },
      headers: { origin: APP_ORIGIN },
    });
    expect(task.status()).toBe(201);

    // --- Danger zone, keyboard only ---
    await page.goto("/app/settings");
    await expect(
      page.getByRole("heading", { name: /settings/i }),
    ).toBeVisible();
    // Danger zone + privacy notice hold the WCAG 2.1 AA gate (issue 17).
    await expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.goto("/privacy");
    await expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.goto("/app/settings");
    await tabTo(
      page,
      page.getByRole("button", { name: /delete account/i }),
      "delete-account trigger",
    );
    await page.keyboard.press("Enter");
    const confirmation = page.getByLabel(/type delete to confirm/i);
    await expect(confirmation).toBeFocused();
    await page.keyboard.type("DELETE");
    // Enter inside the textbox submits the confirm form. Success signs
    // out to the landing page; the in-between "Account deleted" notice
    // unmounts with the navigation, so assert the durable outcomes (URL +
    // signed-out shell + purged rows), not the transient text.
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${APP_ORIGIN}/`);

    // --- Signed out: the shell offers sign-in again ---
    await expect(
      page.getByRole("link", { name: /sign in/i }),
    ).toBeVisible();

    // --- Live purge: no user-linked rows survive ---
    expect(await db.user.count({ where: { id: userId } })).toBe(0);
    expect(await db.task.count({ where: { userId } })).toBe(0);
    expect(await db.session.count({ where: { userId } })).toBe(0);

    // --- Purged credentials no longer sign in (no existence leak: 401) ---
    const relogin = await page.request.post("/api/auth/login", {
      data: { email, password: JOURNEY_PASSWORD },
      headers: { origin: APP_ORIGIN },
    });
    expect(relogin.status()).toBe(401);

    // --- The freed email re-registers cleanly ---
    await db.rateLimitHit.deleteMany({});
    const reregister = await page.request.post("/api/auth/register", {
      data: { email, password: JOURNEY_PASSWORD },
      headers: { origin: APP_ORIGIN },
    });
    expect(reregister.status()).toBe(201);
    const recreated = await db.user.findUnique({ where: { email } });
    expect(recreated).toBeTruthy();
    userId = recreated!.id;
  } finally {
    if (userId) {
      await db.user.deleteMany({ where: { id: userId } });
    }
  }
});
