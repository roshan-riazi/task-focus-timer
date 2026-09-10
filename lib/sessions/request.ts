import { getSession } from "../auth/session";
import type { HistoryHandlerDeps } from "./handlers";
import { createPrismaHistoryStore } from "./prisma-store";
import { createHistoryService } from "./service";

/**
 * Production handler wiring (mirrors `lib/tasks/request.ts prodTaskDeps`).
 * Everything stateful resolves per request: the lazy `db` import keeps
 * route module-load hermetic (health-route pattern), and the single
 * `getSession` entry point keeps identity session-derived on every route
 * (spec §11.5). No rate-limit bucket: history reads are cookie-authed
 * safe-method requests behind the session gate, not anonymous abuse
 * targets like login/register (issue 05 scope). No CSRF gate either —
 * GET is a safe method (same contract as the task/timer read paths).
 */
export function prodHistoryDeps(): HistoryHandlerDeps {
  return {
    getService: async () => {
      const { db } = await import("@/lib/db");
      return createHistoryService({
        now: () => new Date(),
        store: createPrismaHistoryStore(db),
      });
    },
    getSession,
  };
}
