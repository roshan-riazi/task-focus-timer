import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { OUTBOX_FILENAME } from "../lib/email/outbox";

// First-use journey, keyboard-only (issue 04 validation): every in-page
// interaction uses Tab / typing / Enter — no pointer at any point.
// Navigation between pages uses goto (address-bar equivalent); emailed links
// arrive via the file-outbox mailer (EMAIL_PROVIDER=outbox, the Mailpit
// pattern without extra infrastructure).

test.skip(
  !process.env.DATABASE_URL,
  "auth journey needs DATABASE_URL (CI provides it)",
);

const OUTBOX_DIR =
  process.env.EMAIL_OUTBOX_DIR ?? join(tmpdir(), "focusflow-mail-outbox");

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
  return `e2e-${test.info().parallelIndex}-${crypto.randomUUID()}@example.com`;
}

/** Tab from the top of the page until the target control is focused. */
async function tabTo(page: Page, target: Locator, what: string): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`keyboard focus never reached ${what}`);
}

function emailField(page: Page): Locator {
  return page.getByRole("textbox", { name: /^email$/i });
}

function passwordField(page: Page, name: RegExp): Locator {
  // Role-scoped: getByLabel also matches labelled <section>s.
  return page.getByRole("textbox", { name });
}

/** Poll the file outbox for the latest mailed token link to an address. */
async function mailedToken(
  to: string,
  path: "/verify-email" | "/reset-password",
): Promise<string> {
  const file = join(OUTBOX_DIR, OUTBOX_FILENAME);
  const deadline = Date.now() + 15_000;
  for (;;) {
    let text = "";
    try {
      text = await readFile(file, "utf8");
    } catch {
      text = "";
    }
    const lines = text.split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const entry = JSON.parse(lines[i]) as { to?: string; text?: string };
      if (entry.to === to && entry.text?.includes(path)) {
        const match = entry.text.match(
          new RegExp(`${path}\\?token=([^\\s"']+)`),
        );
        if (match) return match[1];
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for a ${path} mail to ${to}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

test("register → use-before-verify → verify → login → reset, keyboard-only", async ({
  page,
}) => {
  const email = journeyEmail();
  const password = "s3cure-password";
  const newPassword = "brand-new-pass-2";
  let userId = "";

  try {
    // --- Register (keyboard only) ---
    await page.goto("/register");
    await expect(
      page.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
    await tabTo(page, emailField(page), "email field");
    await page.keyboard.type(email);
    await page.keyboard.press("Tab");
    await expect(passwordField(page, /password/i)).toBeFocused();
    await page.keyboard.type(password);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: /create account/i }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/login\?registered=1/);
    await expect(page.getByRole("status")).toContainText(/account created/i);

    const created = await db.user.findUnique({ where: { email } });
    expect(created).toBeTruthy();
    userId = created!.id;

    // --- Login (keyboard only) ---
    await tabTo(page, emailField(page), "email field");
    await page.keyboard.type(email);
    await page.keyboard.press("Tab");
    await page.keyboard.type(password);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: /^sign in$/i }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("http://127.0.0.1:3000/");

    // --- Use-before-verify: shell usable, nag visible ---
    await expect(
      page.getByRole("heading", { name: "Focus on one task at a time" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(/verify your email/i);

    // --- Follow the emailed verification link ---
    const verifyToken = await mailedToken(email, "/verify-email");
    await page.goto(`/verify-email?token=${verifyToken}`);
    // NOTE: asserted by text, not by role+name — Chromium exposes
    // role="status" live regions without a computed accessible name, so a
    // name-filtered role locator never matches (probed 2026-09-09). The
    // region itself is still announced on change (aria-live semantics).
    await expect(page.getByText(/email verified/i)).toContainText(
      /email verified/i,
    );

    // Re-clicking burns: single-use, explained keyboard-accessibly.
    await page.goto(`/verify-email?token=${verifyToken}`);
    await expect(page.getByText(/invalid or has expired/i)).toContainText(
      /invalid or has expired/i,
    );

    // --- Nag cleared after verification ---
    await page.goto("/");
    await expect(page.getByRole("status")).toHaveCount(0);

    // --- Logout (keyboard only) ---
    await tabTo(page, page.getByRole("button", { name: /sign out/i }), "sign out button");
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("link", { name: /create account/i }),
    ).toBeVisible();

    // --- Wrong password: associated error, still keyboard-only ---
    await page.goto("/login");
    await tabTo(page, emailField(page), "email field");
    await page.keyboard.type(email);
    await page.keyboard.press("Tab");
    await page.keyboard.type("wrong-pass-1");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    // Scoped to main: Next's route announcer shares role="alert".
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      /invalid email or password/i,
    );

    // --- Forgot password (keyboard only): no-enumeration confirmation ---
    await page.goto("/forgot-password");
    await tabTo(page, emailField(page), "email field");
    await page.keyboard.type(email);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText(/reset link is on/i);

    // --- Token-less links explain themselves (keyboard-readable errors) ---
    await page.goto("/reset-password");
    await expect(page.getByText(/missing its token/i)).toBeVisible();
    await page.goto("/verify-email");
    await expect(page.getByText(/missing its token/i)).toBeVisible();

    // --- Follow the emailed reset link, choose a new password ---
    const resetToken = await mailedToken(email, "/reset-password");
    await page.goto(`/reset-password?token=${resetToken}`);
    await tabTo(page, passwordField(page, /new password/i), "new password field");
    await page.keyboard.type(newPassword);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: /update password/i }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/login\?reset=1/);
    await expect(page.getByRole("status")).toContainText(/password updated/i);

    // --- New password signs in; the nag stays gone ---
    await tabTo(page, emailField(page), "email field");
    await page.keyboard.type(email);
    await page.keyboard.press("Tab");
    await page.keyboard.type(newPassword);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("http://127.0.0.1:3000/");
    await expect(page.getByRole("status")).toHaveCount(0);
  } finally {
    // Cascade removes sessions, tokens, and settings with the user.
    if (userId) await db.user.delete({ where: { id: userId } });
  }
});
