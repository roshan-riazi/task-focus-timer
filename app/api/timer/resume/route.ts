import { createResumeTimerHandler } from "@/lib/timer/handlers";
import { prodTimerDeps } from "@/lib/timer/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deps = prodTimerDeps();

export const POST = createResumeTimerHandler(deps);
