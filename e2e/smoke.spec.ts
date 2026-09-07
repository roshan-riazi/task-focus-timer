import { expect, test } from "@playwright/test";

// Smoke over the public HTTP seam. Full journeys (first-use, task↔timer
// loop, refresh restore, expiry confirm) land with the feature issues per
// TEST_STRATEGY §1; this spec exists so the CI e2e gate has a green,
// fail-closed signal from issue 02 onward.
test("shell renders the welcome heading", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Focus on one task at a time" }),
  ).toBeVisible();
});

test("health endpoint reports ok with DB up", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  await expect(res.json()).resolves.toEqual({
    status: "ok",
    checks: { db: "up" },
  });
});
