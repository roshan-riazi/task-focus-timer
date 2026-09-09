import { createReorderTasksHandler } from "@/lib/tasks/handlers";
import { prodTaskDeps } from "@/lib/tasks/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Static segment: App Router prefers this over `[id]` for the literal
 * path `/api/tasks/reorder`, so "reorder" never reaches the UUID check.
 */
export const POST = createReorderTasksHandler(prodTaskDeps());
