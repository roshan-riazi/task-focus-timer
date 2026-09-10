import { createListSessionsHandler } from "@/lib/sessions/handlers";
import { prodHistoryDeps } from "@/lib/sessions/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deps = prodHistoryDeps();

export const GET = createListSessionsHandler(deps);
