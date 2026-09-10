import { appBaseUrl } from "../auth/request";
import { getSession } from "../auth/session";
import type { TaskHandlerDeps } from "./handlers";
import { createPrismaTaskStore } from "./prisma-store";
import { createTaskService } from "./service";

/**
 * Production handler wiring (mirrors `lib/auth/request.ts prodDeps`).
 * Everything stateful resolves per request: the lazy `db` import keeps
 * route module-load hermetic (health-route pattern), and the single
 * `getSession` entry point keeps identity session-derived on every route
 * (spec §11.5). No rate-limit bucket: task mutations are cookie-authed
 * writes behind the CSRF gate, not anonymous abuse targets like
 * login/register (issue 05 scope).
 */
export function prodTaskDeps(): TaskHandlerDeps {
  return {
    getService: async () => {
      const { db } = await import("@/lib/db");
      return createTaskService({
        now: () => new Date(),
        store: createPrismaTaskStore(db),
      });
    },
    getSession,
    appUrl: appBaseUrl(),
  };
}
