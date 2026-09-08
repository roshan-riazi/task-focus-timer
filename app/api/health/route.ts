import { createGetHealth } from "@/lib/health";

export const runtime = "nodejs";

const DB_CHECK_TIMEOUT_MS = 3000;

/**
 * Live DB reachability probe: one `SELECT 1` round-trip against the shared
 * Prisma client (`@/lib/db`). Lazy import keeps route module-load hermetic;
 * any failure (unreachable DB, missing DATABASE_URL, client misconfigured)
 * surfaces as a rejection the handler maps to a leak-free 503.
 */
async function checkDatabase(): Promise<void> {
  const { db } = await import("@/lib/db");
  await Promise.race([
    db.$queryRawUnsafe("SELECT 1"),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("DB health check timed out")),
        DB_CHECK_TIMEOUT_MS,
      ),
    ),
  ]);
}

export const GET = createGetHealth(checkDatabase);
