import { createResetPasswordHandler } from "@/lib/auth/handlers";
import { prodDeps } from "@/lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createResetPasswordHandler(
  prodDeps({ rateLimitBucket: "auth:reset-password" }),
);
