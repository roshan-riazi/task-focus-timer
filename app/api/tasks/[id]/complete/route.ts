import { createCompleteTaskHandler } from "@/lib/tasks/handlers";
import { prodTaskDeps } from "@/lib/tasks/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createCompleteTaskHandler(prodTaskDeps());
