import { appBaseUrl } from "../auth/request";
import { getSession } from "../auth/session";
import type { SettingsHandlerDeps } from "./handlers";
import { createPrismaSettingsStore } from "./prisma-store";
import { createSettingsService } from "./service";

/**
 * Production handler wiring (mirrors `lib/tasks/request.ts prodTaskDeps`).
 * Everything stateful resolves per request: the lazy `db` import keeps
 * route module-load hermetic (health-route pattern), and the single
 * `getSession` entry point keeps identity session-derived on every route
 * (spec §11.5). No rate-limit bucket: settings mutations are cookie-authed
 * writes behind the CSRF gate, not anonymous abuse targets like
 * login/register (issue 05 scope).
 */
export function prodSettingsDeps(): SettingsHandlerDeps {
  return {
    getService: async () => {
      const { db } = await import("@/lib/db");
      return createSettingsService({
        store: createPrismaSettingsStore(db),
      });
    },
    getSession,
    appUrl: appBaseUrl(),
  };
}
