import { getSession } from "../auth/session";
import type { AnalyticsHandlerDeps } from "./handlers";
import { createPrismaAnalyticsStore } from "./prisma-store";
import { createAnalyticsService } from "./service";

/**
 * Production handler wiring (mirrors `lib/sessions/request.ts`
 * prodHistoryDeps). Everything stateful resolves per request: the lazy
 * `db` import keeps route module-load hermetic (health-route pattern),
 * and the single `getSession` entry point keeps identity session-derived
 * on every route (spec §11.5). No rate-limit bucket: analytics reads are
 * cookie-authed safe-method requests behind the session gate, not
 * anonymous abuse targets like login/register (issue 05 scope). No CSRF
 * gate either — GET is a safe method (same contract as the
 * task/timer/history read paths).
 */
export function prodAnalyticsDeps(): AnalyticsHandlerDeps {
  return {
    getService: async () => {
      const { db } = await import("@/lib/db");
      return createAnalyticsService({
        now: () => new Date(),
        store: createPrismaAnalyticsStore(db),
      });
    },
    getSession,
  };
}
