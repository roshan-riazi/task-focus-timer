import {
  createDeleteTaskHandler,
  createGetTaskHandler,
  createPatchTaskHandler,
} from "@/lib/tasks/handlers";
import { prodTaskDeps } from "@/lib/tasks/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deps = prodTaskDeps();

export const GET = createGetTaskHandler(deps);
export const PATCH = createPatchTaskHandler(deps);
export const DELETE = createDeleteTaskHandler(deps);
