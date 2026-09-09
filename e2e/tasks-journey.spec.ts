import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Task journeys, keyboard-only (issue 08 validation): every in-page
// interaction uses Tab / arrows / typing / Enter — no pointer at any point.
// Auth setup goes through the API (its own keyboard journey lives in
// auth-journey.spec.ts); everything task-related is keyboard-driven.

test.skip(
  !process.env.DATABASE_URL,
  "task journey needs DATABASE_URL (CI provides it)",
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
  return `e2e-tasks-${tag}-${test.info().parallelIndex}-${crypto.randomUUID()}@example.com`;
}

const JOURNEY_PASSWORD = "s3cure-password";

/** Tab from the current focus until the target control is focused. */
async function tabTo(page: Page, target: Locator, what: string): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`keyboard focus never reached ${what}`);
}

function quickAdd(page: Page): Locator {
  return page.getByRole("textbox", { name: /new task title/i });
}

/**
 * Row assertions stay inside the list: Playwright `getByText(string)` is a
 * substring match, so status notices ("… completed.") would otherwise
 * false-positive row presence/absence checks.
 */
function taskList(page: Page): Locator {
  return page.getByRole("list", { name: /tasks/i });
}

/** Register + login through the API so the journey starts signed in. */
async function signIn(
  page: Page,
  tag: string,
): Promise<{ userId: string; email: string }> {
  const email = journeyEmail(tag);
  const password = JOURNEY_PASSWORD;
  // Test-DB hygiene (same pattern as session-scoping.integration.test.ts):
  // auth rate-limit buckets are per-IP and shared, so reset them before
  // minting journey users — otherwise reruns 429 on their own history.
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

/** Re-login through the API (the UI login journey lives in auth-journey). */
async function signInAgain(page: Page, email: string): Promise<void> {
  const login = await page.request.post("/api/auth/login", {
    data: { email, password: JOURNEY_PASSWORD },
    headers: { origin: APP_ORIGIN },
  });
  expect(login.status()).toBe(200);
}

async function createTask(page: Page, title: string): Promise<void> {
  const res = await page.request.post("/api/tasks", {
    data: { title },
    headers: { origin: APP_ORIGIN },
  });
  expect(res.status()).toBe(201);
}

test("task lifecycle: add → focus → complete → reopen → edit → archive → delete, keyboard-only", async ({
  page,
}) => {
  let userId = "";
  try {
    userId = (await signIn(page, "lifecycle")).userId;
    await page.goto("/app");
    await expect(
      page.getByRole("heading", { name: /^focus$/i }),
    ).toBeVisible();

    // --- Quick-add two tasks, keyboard only ---
    await tabTo(page, quickAdd(page), "quick-add field");
    await page.keyboard.type("Write launch notes");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /^add$/i })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(taskList(page).getByText("Write launch notes")).toBeVisible();

    await tabTo(page, quickAdd(page), "quick-add field");
    await page.keyboard.type("Review pull requests");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(taskList(page).getByText("Review pull requests")).toBeVisible();

    // --- Select the first task for focus, keyboard only ---
    await tabTo(
      page,
      page.getByRole("button", { name: /select write launch notes for focus/i }),
      "select-for-focus button",
    );
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: /focus · write launch notes/i }),
    ).toBeVisible();

    // --- Complete it, keyboard only; it leaves the active view ---
    await tabTo(
      page,
      page.getByRole("button", { name: /complete write launch notes/i }),
      "complete button",
    );
    await page.keyboard.press("Enter");
    await expect(page.getByText(/write launch notes completed/i)).toBeVisible();
    await expect(taskList(page).getByText("Write launch notes")).toHaveCount(0);

    // --- Completed filter (radio group, arrow keys), then reopen ---
    await tabTo(page, page.getByRole("radio", { name: /^active$/i }), "filter group");
    await page.keyboard.press("ArrowRight");
    await expect(taskList(page).getByText("Write launch notes")).toBeVisible();
    await tabTo(
      page,
      page.getByRole("button", { name: /reopen write launch notes/i }),
      "reopen button",
    );
    await page.keyboard.press("Enter");
    await expect(page.getByText(/no completed tasks yet/i)).toBeVisible();

    // --- Back to Active, edit the second task's title ---
    // (the reopened row unmounts, so focus falls back to the top)
    await tabTo(page, page.getByRole("radio", { name: /completed/i }), "filter group");
    await page.keyboard.press("ArrowLeft");
    await expect(taskList(page).getByText("Review pull requests")).toBeVisible();
    await tabTo(
      page,
      page.getByRole("button", { name: /edit review pull requests/i }),
      "edit button",
    );
    await page.keyboard.press("Enter");
    const titleField = page.getByRole("textbox", { name: /^title$/i });
    await expect(titleField).toBeFocused();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Review pull requests v2");
    await page.keyboard.press("Tab");
    // Notes then Category then Save.
    await page.keyboard.type("Ship it");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Work");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /^save$/i })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(taskList(page).getByText("Review pull requests v2")).toBeVisible();

    // --- Archive it, find it under Archived, unarchive it ---
    await tabTo(
      page,
      page.getByRole("button", { name: /archive review pull requests v2/i }),
      "archive button",
    );
    await page.keyboard.press("Enter");
    await expect(page.getByText(/archived\./i)).toBeVisible();
    await tabTo(page, page.getByRole("radio", { name: /^active$/i }), "filter group");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(taskList(page).getByText("Review pull requests v2")).toBeVisible();
    await tabTo(
      page,
      page.getByRole("button", { name: /unarchive review pull requests v2/i }),
      "unarchive button",
    );
    await page.keyboard.press("Enter");
    await expect(page.getByText(/no archived tasks/i)).toBeVisible();

    // --- Delete with the inline confirm, keyboard only ---
    await tabTo(page, page.getByRole("radio", { name: /archived/i }), "filter group");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(taskList(page).getByText("Write launch notes")).toBeVisible();
    await tabTo(
      page,
      page.getByRole("button", { name: /delete write launch notes/i }),
      "delete button",
    );
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: /confirm delete/i }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/deleted\./i)).toBeVisible();
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("empty, error, and signed-out states", async ({ page }) => {
  let userId = "";
  try {
    userId = (await signIn(page, "states")).userId;
    await page.goto("/app");
    await expect(page.getByText(/no active tasks yet/i)).toBeVisible();
    // Quick-add stays available in the empty state.
    await expect(quickAdd(page)).toBeVisible();

    // --- Error state: failed list offers a keyboard-operable retry ---
    // Predicate matcher: only the list GETs fail (POST quick-adds pass).
    // One shared reference — `unroute` needs the identical matcher object.
    const listMatcher = (url: URL) =>
      url.pathname === "/api/tasks" && url.searchParams.has("status");
    await page.route(listMatcher, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "REQUEST_FAILED", message: "Something went wrong." },
        }),
      }),
    );
    await page.goto("/app");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(/something went wrong/i);
    await page.unroute(listMatcher);
    await tabTo(page, page.getByRole("button", { name: /retry/i }), "retry button");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/no active tasks yet/i)).toBeVisible();

    // --- Signed-out visitors are sent to login ---
    await page.context().clearCookies();
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("created tasks survive logout and login (spec §13.1)", async ({
  page,
}) => {
  let userId = "";
  try {
    const credentials = await signIn(page, "persist");
    userId = credentials.userId;
    await page.goto("/app");
    await expect(page.getByText(/no active tasks yet/i)).toBeVisible();

    // Create through the keyboard quick-add (UI login/logout flank it —
    // the UI login journey itself lives in auth-journey.spec.ts).
    await tabTo(page, quickAdd(page), "quick-add field");
    await page.keyboard.type("Persistent task");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(
      taskList(page).getByText("Persistent task"),
    ).toBeVisible();

    // Log out through the header control, keyboard only.
    await tabTo(page, page.getByRole("button", { name: /sign out/i }), "sign out");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("link", { name: /create account/i }),
    ).toBeVisible();

    // Back in: the task is still there.
    await signInAgain(page, credentials.email);
    await page.goto("/app");
    await expect(taskList(page).getByText("Persistent task")).toBeVisible();
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("mobile layout: timer first, no horizontal scrolling", async ({ page }) => {  test.skip(
    test.info().project.name !== "chromium",
    "layout geometry asserted once (chromium)",
  );
  await page.setViewportSize({ width: 320, height: 800 });
  let userId = "";
  try {
    userId = (await signIn(page, "mobile")).userId;
    await createTask(page, "Write launch notes");
    await createTask(page, "Review pull requests");
    await page.goto("/app");
    await expect(taskList(page).getByText("Write launch notes")).toBeVisible();

    const timerBox = await page
      .getByRole("region", { name: /^focus/i })
      .boundingBox();
    const tasksBox = await page
      .getByRole("complementary", { name: /^tasks$/i })
      .boundingBox();
    expect(timerBox).toBeTruthy();
    expect(tasksBox).toBeTruthy();
    // Timer appears first (above the task list) on narrow screens.
    expect(timerBox!.y + timerBox!.height).toBeLessThanOrEqual(tasksBox!.y + 1);

    // No horizontal scrolling at 320px with all critical actions visible.
    const overflow = await page.evaluate(
      () => document.scrollingElement?.scrollWidth ?? 0,
    );
    expect(overflow).toBeLessThanOrEqual(320);
    await expect(quickAdd(page)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /select write launch notes for focus/i }),
    ).toBeVisible();
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("task views pass axe (WCAG 2.1 AA)", async ({ page }) => {
  test.skip(
    test.info().project.name !== "chromium",
    "axe asserted once (chromium)",
  );
  let userId = "";
  try {
    userId = (await signIn(page, "axe")).userId;
    await createTask(page, "Write launch notes");
    await page.goto("/app");
    await expect(
      taskList(page).getByText("Write launch notes"),
    ).toBeVisible();

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 320, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      // Full AA gate per TEST_STRATEGY §1: any violation fails, not just
      // serious/critical — the task views are small enough to hold clean.
      expect(results.violations).toEqual([]);
    }
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});
