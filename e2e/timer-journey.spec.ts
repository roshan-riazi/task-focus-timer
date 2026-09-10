import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Timer journeys, keyboard-only (issue 12 validation): every in-page
// interaction uses Tab / arrows / typing / Enter — no pointer at any point.
// Auth setup goes through the API (its keyboard journey lives in
// auth-journey.spec.ts); everything timer-related is keyboard-driven.

test.skip(
  !process.env.DATABASE_URL,
  "timer journey needs DATABASE_URL (CI provides it)",
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
  return `e2e-timer-${tag}-${test.info().parallelIndex}-${crypto.randomUUID()}@example.com`;
}

const JOURNEY_PASSWORD = "s3cure-password";

/**
 * Tab from the current focus until the target control is focused.
 * Forward first, then backward (same Firefox/WebKit resume quirk as the
 * tasks journey — Shift+Tab is the keyboard-only continuation).
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

function timerRegion(page: Page): Locator {
  return page.getByRole("region", { name: /^focus/i });
}

function timerStatus(page: Page): Locator {
  return timerRegion(page).getByRole("status");
}

function timerClock(page: Page): Locator {
  // The ticking readout is aria-hidden (announcements live in the status
  // region instead) — locate it by CSS, never by accessible name.
  return timerRegion(page).locator("p[aria-hidden='true'].tabular-nums");
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

async function startInterval(
  page: Page,
  body: { intervalType: string; taskId?: string },
): Promise<{ expectedEndAt: string }> {
  const res = await page.request.post("/api/timer/start", {
    data: body,
    headers: { origin: APP_ORIGIN },
  });
  expect(res.status()).toBe(201);
  const { session } = (await res.json()) as {
    session: { expectedEndAt: string };
  };
  return { expectedEndAt: session.expectedEndAt };
}

/** Set the active interval's remaining time (DB clock travel). Positive
 * seconds keep it running; negative seconds push it past `expected_end_at`
 * (expiry travel without real waiting). */
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

function clockToSeconds(text: string | null): number {
  const parts = (text ?? "").trim().split(":").map(Number);
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  throw new Error(`unparseable clock text: ${text}`);
}

test("full loop keyboard-only: start → pause → resume → complete → break → skip", async ({
  page,
}) => {
  let userId = "";
  try {
    userId = (await signIn(page, "loop")).userId;
    await page.goto("/app");
    await expect(
      page.getByRole("heading", { name: /^focus$/i }),
    ).toBeVisible();

    // Idle: the interval picker defaults to focus, Start is keyboard-bound.
    await expect(
      timerRegion(page).getByRole("radio", { name: /^focus$/i }),
    ).toBeChecked();
    await tabTo(page, timerRegion(page).getByRole("button", { name: /start focus/i }), "start focus");
    await page.keyboard.press("Enter");
    await expect(timerStatus(page)).toContainText(/started|running/i);
    await expect(
      timerRegion(page).getByRole("button", { name: /^pause$/i }),
    ).toBeVisible();
    await expect(
      timerRegion(page).getByRole("progressbar", { name: /focus progress/i }),
    ).toBeVisible();
    await expect(timerClock(page)).toContainText(/^\d{2}:\d{2}$/);

    // Pause freezes the clock; resume restarts it — keyboard only.
    await tabTo(page, timerRegion(page).getByRole("button", { name: /^pause$/i }), "pause");
    await page.keyboard.press("Enter");
    await expect(
      timerRegion(page).getByRole("button", { name: /^resume$/i }),
    ).toBeFocused();
    await expect(timerStatus(page)).toContainText(/paused/i);
    const frozen = await timerClock(page).textContent();
    await page.keyboard.press("Enter");
    await expect(
      timerRegion(page).getByRole("button", { name: /^pause$/i }),
    ).toBeVisible();
    await expect(timerStatus(page)).toContainText(/resumed/i);

    // Complete early proposes the short break (spec §8.5).
    await tabTo(
      page,
      timerRegion(page).getByRole("button", { name: /complete early/i }),
      "complete early",
    );
    await page.keyboard.press("Enter");
    await expect(timerStatus(page)).toContainText(/completed.*short break/i);
    await expect(
      timerRegion(page).getByRole("button", { name: /start short break/i }),
    ).toBeVisible();
    expect(frozen).toBeTruthy();

    // Run the proposed break, then skip it back to focus.
    await tabTo(
      page,
      timerRegion(page).getByRole("button", { name: /start short break/i }),
      "start short break",
    );
    await page.keyboard.press("Enter");
    await expect(
      timerRegion(page).getByRole("button", { name: /skip break/i }),
    ).toBeVisible();
    await tabTo(
      page,
      timerRegion(page).getByRole("button", { name: /skip break/i }),
      "skip break",
    );
    await page.keyboard.press("Enter");
    await expect(timerStatus(page)).toContainText(/skipped/i);
    await expect(
      timerRegion(page).getByRole("button", { name: /start focus/i }),
    ).toBeVisible();
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("refresh restores the running interval from server timestamps", async ({
  page,
}) => {
  let userId = "";
  try {
    userId = (await signIn(page, "restore")).userId;
    await startInterval(page, { intervalType: "focus" });
    await page.goto("/app");
    await expect(
      timerRegion(page).getByRole("button", { name: /^pause$/i }),
    ).toBeVisible();
    const before = clockToSeconds(await timerClock(page).textContent());

    await page.reload();
    await expect(
      timerRegion(page).getByRole("button", { name: /^pause$/i }),
    ).toBeVisible();
    const after = clockToSeconds(await timerClock(page).textContent());
    // Same interval, derived from the same stamps: time moved forward a
    // little (reload round-trip), never reset to the full plan.
    expect(after).toBeLessThanOrEqual(before);
    expect(before - after).toBeLessThanOrEqual(15);
    expect(after).toBeGreaterThan(1400);
    await expect(timerStatus(page)).toContainText(/running/i);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("hidden-tab return reconciles the display within one second", async ({
  page,
}) => {
  let userId = "";
  try {
    userId = (await signIn(page, "reconcile")).userId;
    await startInterval(page, { intervalType: "focus" });
    await page.goto("/app");
    await expect(
      timerRegion(page).getByRole("button", { name: /^pause$/i }),
    ).toBeVisible();

    // Two minutes pass while the tab is hidden (DB clock travel): the
    // active interval keeps ~115s of its 25 minutes.
    await setSecondsRemaining(userId, 115);

    const t0 = Date.now();
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    // Wait for the reconciled value itself (~115s left) — not merely a
    // changed reading, which the 1s repaint tick could also produce.
    await expect(async () => {
      const secs = clockToSeconds(await timerClock(page).textContent());
      expect(secs).toBeLessThanOrEqual(120);
      expect(secs).toBeGreaterThanOrEqual(90);
    }).toPass({ timeout: 2000 });
    expect(Date.now() - t0).toBeLessThan(1000);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("expiry within the grace window auto-reconciles on return", async ({
  page,
}) => {
  let userId = "";
  try {
    userId = (await signIn(page, "grace")).userId;
    await startInterval(page, { intervalType: "focus" });
    // Expired 5 minutes ago: inside the 60-minute grace window.
    await setSecondsRemaining(userId, -300);
    await page.goto("/app");
    // No dialog — the server finalized exactly once (issue 11); the UI
    // reports the reconciled completion and proposes the break.
    await expect(timerStatus(page)).toContainText(/reconciled/i);
    await expect(
      timerRegion(page).getByText(/counted once in history/i),
    ).toBeVisible();
    await expect(
      timerRegion(page).getByRole("button", { name: /start short break/i }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("expiry beyond the grace window: Complete counts, Discard drops — keyboard-only", async ({
  page,
}) => {
  let userId = "";
  try {
    userId = (await signIn(page, "confirm")).userId;
    await startInterval(page, { intervalType: "focus" });
    // Expired 2 hours ago: the client must confirm (spec §8.4).
    await setSecondsRemaining(userId, -7200);
    await page.goto("/app");

    const dialog = page.getByRole("dialog", {
      name: /finish the expired interval/i,
    });
    await expect(dialog).toBeVisible();
    // Focus is moved inside the dialog; Complete is the initial focus.
    const complete = dialog.getByRole("button", { name: /complete.*count 25 min/i });
    await expect(complete).toBeFocused();
    await expect(
      dialog.getByRole("button", { name: /^discard$/i }),
    ).toBeVisible();

    // Choice 1 (keyboard): Enter on Complete finalizes as completed and
    // proposes the short break.
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(timerStatus(page)).toContainText(/completed/i);
    await expect(
      timerRegion(page).getByRole("button", { name: /start short break/i }),
    ).toBeVisible();

    // Choice 2: expire another interval, then Tab to Discard + Enter.
    await tabTo(
      page,
      timerRegion(page).getByRole("button", { name: /start short break/i }),
      "start short break",
    );
    await page.keyboard.press("Enter");
    await expect(
      timerRegion(page).getByRole("button", { name: /skip break/i }),
    ).toBeVisible();
    await setSecondsRemaining(userId, -7200);
    await page.reload();
    await expect(dialog).toBeVisible();
    // The second expiry is the 5-minute short break started above.
    const completeBreak = dialog.getByRole("button", {
      name: /complete.*count 5 min/i,
    });
    await expect(completeBreak).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: /^discard$/i }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(timerStatus(page)).toContainText(/discard/i);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("reduced-motion: the ring disables its sweep transition and the timer still works", async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== "chromium",
    "reduced-motion geometry asserted once (chromium)",
  );
  let userId = "";
  try {
    userId = (await signIn(page, "motion")).userId;
    await startInterval(page, { intervalType: "focus" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/app");
    await expect(
      timerRegion(page).getByRole("button", { name: /^pause$/i }),
    ).toBeVisible();

    const transitionProperty = await timerRegion(page)
      .getByRole("progressbar", { name: /progress/i })
      .locator("circle[data-ring-progress]")
      .evaluate((el) => getComputedStyle(el).transitionProperty);
    // `motion-reduce:transition-none` collapses the 1s sweep (prototype
    // rule, spec §12.3) — the ring jumps between values under reduce.
    expect(transitionProperty).toBe("none");
    await expect(timerClock(page)).toContainText(/^\d{2}:\d{2}$/);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});

test("timer views pass axe and stay within 320px (WCAG 2.1 AA)", async ({
  page,
}) => {
  test.skip(
    test.info().project.name !== "chromium",
    "axe asserted once (chromium)",
  );
  let userId = "";
  try {
    userId = (await signIn(page, "axe")).userId;
    await startInterval(page, { intervalType: "focus" });
    await page.goto("/app");
    await expect(
      timerRegion(page).getByRole("button", { name: /^pause$/i }),
    ).toBeVisible();

    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 320, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(results.violations).toEqual([]);
    }
    await page.setViewportSize({ width: 320, height: 800 });
    const overflow = await page.evaluate(
      () => document.scrollingElement?.scrollWidth ?? 0,
    );
    expect(overflow).toBeLessThanOrEqual(320);
  } finally {
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});
