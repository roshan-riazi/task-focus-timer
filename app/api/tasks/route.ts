import {
  createCreateTaskHandler,
  createListTasksHandler,
} from "@/lib/tasks/handlers";
import { prodTaskDeps } from "@/lib/tasks/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deps = prodTaskDeps();

export const GET = createListTasksHandler(deps);
export const POST = createCreateTaskHandler(deps);
