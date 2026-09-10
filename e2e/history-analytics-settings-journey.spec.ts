import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// History + analytics + settings journeys, keyboard-only (issue 16
// validation): every in-page interaction uses Tab / arrows / typing /
// Enter — no pointer at any point. Auth setup and timer seeding go through
// the API (their own keyboard journeys live in auth/timer specs);
// everything history/analytics/settings-related is keyboard-driven.

test.skip(
  !process.env.DATABASE_URL,
  "history/analytics/settings journey needs DATABASE_URL (CI provides it)",
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
  return `e2e-has-${tag}-${test.info().parallelIndex}-${crypto.randomUUID()}@example.com`;
}

const JOURNEY_PASSWORD = "s3cure-password";

/**
 * Tab from the current focus until the target control is focused.
 * Forward first, then backward (same Firefox/WebKit resume quirk as the
 * tasks/timer journeys — Shift+Tab is the keyboard-only continuation).
 */
async function tabTo(page: Page, target: Locator, what: string): Promise<void> {
  for (let i = 0; i < 80; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  for (let i = 0; i < 80; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Shift+Tab");
  }
  throw new Error(`keyboard focus never reached ${what}`);
}

/** Register + login through the API so the journey starts signed in. */
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

async function createTask(page: Page, title: string): Promise<string> {
  const res = await page.request.post("/api/tasks", {
    data: { title },
    headers: { origin: APP_ORIGIN },
  });
  expect(res.status()).toBe(201);
  const { task } = (await res.json()) as { task: { id: string } };
  return task.id;
}

async function completeTask(page: Page, id: string): Promise<void> {
  const res = await page.request.post(`/api/tasks/${id}/complete`, {
    headers: { origin: APP_ORIGIN },
  });
  expect(res.status()).toBe(200);
}

async function deleteTask(page: Page, id: string): Promise<void> {
  const res = await page.request.delete(`/api/tasks/${id}`, {
    headers: { origin: APP_ORIGIN },
  });
  expect(res.status()).toBe(200);
}

/**
 * Finalized session rows straight to the DB (no wall-clock waits): the
 * lifecycle that produced them is covered by the timer journey; here only
 * the rendering + filtering of history/analytics is under test.
 */
async function seedSession(
  userId: string,
  values: {
    taskId?: string | null;
    title?: string | null;
    category?: string | null;
    intervalType?: "focus" | "short_break" | "long_break";
    status?: "completed" | "cancelled";
    actualSeconds?: number | null;
    startedAt?: Date;
  } = {},
): Promise<void> {
  const startedAt = values.startedAt ?? new Date();
  const status = values.status ?? "completed";
  const actualSeconds = values.actualSeconds ?? 1500;
  await db.timerSession.create({
    data: {
      userId,
      taskId: values.taskId ?? null,
      taskTitleSnapshot: values.title ?? null,
      categorySnapshot: values.category ?? null,
      intervalType: values.intervalType ?? "focus",
      status,
      plannedDurationSeconds: 1500,
      actualDurationSeconds: status === "completed" ? actualSeconds : null,
      startedAt,
      expectedEndAt: new Date(startedAt.getTime() + 1500 * 1000),
      completedAt: status === "completed" ? startedAt : null,
      cancelledAt: status === "cancelled" ? startedAt : null,
    },
  });
}

function historyTable(page: Page): Locator {
  return page.getByRole("table", { name: /recent intervals/i });
}

test("history: filters, deleted-task rows, and empty states, keyboard-only", async ({
  page,
}) => {
  let userId = "";
  try {
    userId = (await signIn(page, "history")).userId;
    const taskId = await createTask(page, "Write launch notes");
    await seedSession(userId, {
      taskId,
      title: "Write launch notes",
      category: "Writing",
    });
    await seedSession(userId, {
      intervalType: "short_break",
      actualSeconds: 300,
    });
    // Outside the 7-day window but inside 30d: a deleted task's snapshot.
    await seedSession(userId, {
      title: "Old task (deleted)",
      startedAt: new Date(Date.now() - 10 * 86_400_000),
    });
    // Deleting the live task nulls the link (SetNull) — the snapshot must
    // stay legible instead of flipping to Unassigned.
    await deleteTask(page, taskId);

    await page.goto("/app/history");
    await expect(
      page.getByRole("heading", { name: /^history$/i }),
    ).toBeVisible();
    await expect(historyTable(page).getByText("Write launch notes")).toBeVisible();
    await expect(
      historyTable(page).getByText("Short break"),
    ).toBeVisible();
    await expect(
      historyTable(page).getByText("Old task (deleted)"),
    ).toHaveCount(0);

    // --- Period filter, keyboard only: 30d reveals the older row ---
    await tabTo(
      page,
      page.getByRole("radio", { name: /^last 7 days$/i }),
      "period group",
    );
    await page.keyboard.press("ArrowRight");
    await expect(
      historyTable(page).getByText("Old task (deleted)"),
    ).toBeVisible();

    // --- Type filter, keyboard only: Focus only hides the break ---
    await tabTo(
      page,
      page.getByRole("radio", { name: /^all types$/i }),
      "type group",
    );
    await page.keyboard.press("ArrowRight");
    await expect(historyTable(page).getByText("Short break")).toHaveCount(0);
    await expect(
      historyTable(page).getByText("Write launch notes"),
    ).toBeVisible();

    // --- Back to Today: only today's rows remain ---
    await tabTo(
      page,
      page.getByRole("radio", { name: /^last 30 days$/i }),
      "period group",
    );
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(
      historyTable(page).getByText("Old task (deleted)"),
    ).toHaveCount(0);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("analytics: metric cards, bars with table equivalent, ranked lists", async ({
  page,
}) => {
  let userId = "";
  try {
    userId = (await signIn(page, "analytics")).userId;
    const taskId = await createTask(page, "Write launch notes");
    await seedSession(userId, {
      taskId,
      title: "Write launch notes",
      category: "Work",
    });
    await seedSession(userId, {});
    await seedSession(userId, { status: "cancelled" });
    await completeTask(page, taskId);

    await page.goto("/app/analytics");
    await expect(
      page.getByRole("heading", { name: /^analytics$/i }),
    ).toBeVisible();

    const metrics = page.getByRole("group", { name: /focus metrics/i });
    await expect(metrics).toContainText(/50 focus minutes/i);
    await expect(metrics).toContainText(/2 focus intervals/i);
    await expect(metrics).toContainText(/1 tasks done/i);
    await expect(metrics).toContainText(/67% completion/i);

    // Chart + full table equivalent carry the same numbers.
    const chart = page.getByRole("img", { name: /bar chart of focus minutes/i });
    await expect(chart).toBeVisible();
    expect(await chart.locator("rect").count()).toBe(7);
    const daily = page.getByRole("table", { name: /daily focus minutes/i });
    await expect(daily).toContainText("50");

    const byTask = page.getByRole("table", {
      name: /focus minutes grouped by task/i,
    });
    await expect(byTask.getByText("Write launch notes")).toBeVisible();
    await expect(byTask.getByText("Unassigned")).toBeVisible();
    await expect(
      page
        .getByRole("table", { name: /focus minutes grouped by category/i })
        .getByText("Work"),
    ).toBeVisible();

    // --- Period switch, keyboard only ---
    await tabTo(page, page.getByRole("radio", { name: /^last 7 days$/i }), "period group");
    await page.keyboard.press("ArrowLeft");
    await expect(
      page.getByRole("heading", { name: /analytics — today/i }),
    ).toBeVisible();
    await expect(metrics).toContainText(/50 focus minutes/i);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("empty states guide action on history and analytics", async ({ page }) => {
  let userId = "";
  try {
    userId = (await signIn(page, "empty")).userId;
    await page.goto("/app/history");
    await expect(page.getByText(/no intervals in the last 7 days/i)).toBeVisible();
    await expect(page.getByText(/start a focus interval/i)).toBeVisible();

    await page.goto("/app/analytics");
    await expect(page.getByText(/no completed focus yet/i)).toBeVisible();
    await expect(
      page.getByText(/complete a focus interval and it shows up here/i),
    ).toBeVisible();
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("settings cutover: edits apply to new intervals only, keyboard-only", async ({
  page,
}) => {
  let userId = "";
  try {
    userId = (await signIn(page, "cutover")).userId;
    // A running interval snapshots the current 25-minute default.
    const started = await page.request.post("/api/timer/start", {
      data: { intervalType: "focus" },
      headers: { origin: APP_ORIGIN },
    });
    expect(started.status()).toBe(201);

    await page.goto("/app/settings");
    await expect(
      page.getByRole("heading", { name: /^settings$/i }),
    ).toBeVisible();
    const focus = page.getByRole("spinbutton", {
      name: /focus duration/i,
    });
    await tabTo(page, focus, "focus duration field");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("1");
    await tabTo(
      page,
      page.getByRole("button", { name: /save settings/i }),
      "save button",
    );
    await page.keyboard.press("Enter");
    await expect(page.getByText(/new intervals only/i)).toBeVisible();

    // The running interval keeps its original plan…
    const current = await page.request.get("/api/timer/current");
    expect(current.status()).toBe(200);
    const { session } = (await current.json()) as {
      session: { plannedDurationSeconds: number } | null;
    };
    expect(session?.plannedDurationSeconds).toBe(1500);

    // …while the next interval picks up the saved minute.
    const completed = await page.request.post("/api/timer/complete", {
      headers: { origin: APP_ORIGIN },
    });
    expect(completed.status()).toBe(200);
    const restarted = await page.request.post("/api/timer/start", {
      data: { intervalType: "focus" },
      headers: { origin: APP_ORIGIN },
    });
    expect(restarted.status()).toBe(201);
    const { session: next } = (await restarted.json()) as {
      session: { plannedDurationSeconds: number };
    };
    expect(next.plannedDurationSeconds).toBe(60);

    // And the saved value survives a reload.
    await page.goto("/app/settings");
    await expect(
      page.getByRole("spinbutton", { name: /focus duration/i }),
    ).toHaveValue("1");
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("signed-out visitors are sent to login", async ({ page }) => {
  let userId = "";
  try {
    userId = (await signIn(page, "signedout")).userId;
    await page.context().clearCookies();
    for (const path of ["/app/history", "/app/analytics", "/app/settings"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("mobile layout: history, analytics, and settings fit 320px", async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== "chromium",
    "layout geometry asserted once (chromium)",
  );
  await page.setViewportSize({ width: 320, height: 800 });
  let userId = "";
  try {
    userId = (await signIn(page, "mobile")).userId;
    const taskId = await createTask(page, "Write launch notes");
    await seedSession(userId, { taskId, title: "Write launch notes" });

    for (const [path, heading] of [
      ["/app/history", /^history$/i],
      ["/app/analytics", /^analytics$/i],
      ["/app/settings", /^settings$/i],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.scrollingElement?.scrollWidth ?? 0,
      );
      expect(overflow).toBeLessThanOrEqual(320);
    }
    // Critical controls stay reachable without horizontal scrolling.
    await page.goto("/app/settings");
    await expect(
      page.getByRole("button", { name: /save settings/i }),
    ).toBeVisible();
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("reduced-motion: analytics chart renders statically", async ({ page }) => {
  test.skip(
    test.info().project.name !== "chromium",
    "reduced-motion geometry asserted once (chromium)",
  );
  let userId = "";
  try {
    userId = (await signIn(page, "motion")).userId;
    await seedSession(userId, {});
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/app/analytics");
    const chart = page.getByRole("img", {
      name: /bar chart of focus minutes/i,
    });
    await expect(chart).toBeVisible();
    // Static SVG bars: no transition to reduce — zero duration by
    // construction (spec §12.3), and the table equivalent stays put.
    const duration = await chart
      .locator("rect")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration).toBe("0s");
    await expect(
      page.getByRole("table", { name: /daily focus minutes/i }),
    ).toBeVisible();
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("history, analytics, and settings pass axe incl empty + deleted rows", async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== "chromium",
    "axe asserted once (chromium)",
  );
  let seededId = "";
  let emptyId = "";
  try {
    seededId = (await signIn(page, "axe")).userId;
    const taskId = await createTask(page, "Write launch notes");
    await seedSession(seededId, { taskId, title: "Write launch notes" });
    await seedSession(seededId, { intervalType: "short_break", actualSeconds: 300 });
    await deleteTask(page, taskId);

    for (const path of ["/app/history", "/app/analytics", "/app/settings"]) {
      await page.goto(path);
      // Settle the client fetch before analyzing (else axe races loading).
      await expect(page.getByRole("heading").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      for (const viewport of [
        { width: 1280, height: 800 },
        { width: 360, height: 800 },
      ]) {
        await page.setViewportSize(viewport);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(results.violations).toEqual([]);
      }
    }

    // Empty states (fresh user, default viewport): no tables, only guidance.
    await page.setViewportSize({ width: 1280, height: 800 });
    emptyId = (await signIn(page, "axe-empty")).userId;
    for (const path of ["/app/history", "/app/analytics"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    }
  } finally {
    if (seededId) await db.user.delete({ where: { id: seededId } });
    if (emptyId) await db.user.delete({ where: { id: emptyId } }).catch(() => undefined);
  }
});

test("perf smoke: analytics summary under 2s on a personal-scale fixture", async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== "chromium",
    "perf smoke asserted once (chromium)",
  );
  let userId = "";
  try {
    userId = (await signIn(page, "perf")).userId;
    // A heavy personal account: ~400 finalized focus sessions across the
    // rolling week (an order above daily-driver volume).
    const now = Date.now();
    await db.timerSession.createMany({
      data: Array.from({ length: 400 }, (_, i) => {
        const startedAt = new Date(now - i * 25 * 60 * 1000);
        return {
          userId,
          taskTitleSnapshot: `Seeded task ${i % 12}`,
          categorySnapshot: i % 3 === 0 ? null : `Category ${i % 4}`,
          intervalType: "focus" as const,
          status: "completed" as const,
          plannedDurationSeconds: 1500,
          actualDurationSeconds: 1500,
          startedAt,
          expectedEndAt: new Date(startedAt.getTime() + 1500 * 1000),
          completedAt: startedAt,
        };
      }),
    });

    const startedAt = Date.now();
    const summary = await page.request.get(
      "/api/analytics/summary?period=7d",
    );
    expect(summary.status()).toBe(200);
    expect(Date.now() - startedAt).toBeLessThan(2000);

    await page.goto("/app/analytics");
    await expect(
      page.getByRole("table", { name: /daily focus minutes/i }),
    ).toBeVisible();
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});
