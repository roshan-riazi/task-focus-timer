import { createAnalyticsSummaryHandler } from "@/lib/analytics/handlers";
import { prodAnalyticsDeps } from "@/lib/analytics/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deps = prodAnalyticsDeps();

export const GET = createAnalyticsSummaryHandler(deps);
