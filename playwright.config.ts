import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// E2E backbone for issue 02 (CI gates). The smoke spec exercises only the
// public HTTP seam (`/` shell + `/api/health`); journey coverage lands with
// the feature issues per TEST_STRATEGY §1. Browser matrix per §4: latest
// Chromium + Firefox + WebKit on every run.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
    // E2E mail capture (issue 04): the file-outbox provider lets the
    // keyboard-only auth journey follow emailed verify/reset links with no
    // extra infrastructure and no CI-secret wiring. `env` extends
    // process.env, so DATABASE_URL/AUTH_SECRET still come from the
    // environment; the spec resolves the same default outbox dir.
    env: {
      EMAIL_PROVIDER: "outbox",
      EMAIL_OUTBOX_DIR: join(tmpdir(), "focusflow-mail-outbox"),
      // The CSRF origin gate (issue 05) expects browser Origins to match
      // APP_URL; E2E serves 127.0.0.1, so pin it explicitly (localhost
      // would mismatch and every mutation would 403).
      APP_URL: "http://127.0.0.1:3000",
    },
  },
});
