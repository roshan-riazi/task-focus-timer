import { createDeleteAccountHandler } from "@/lib/auth/handlers";
import { prodDeps } from "@/lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = createDeleteAccountHandler(
  prodDeps({ rateLimitBucket: "account:delete" }),
);
