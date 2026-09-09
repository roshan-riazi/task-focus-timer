import { createVerifyEmailHandler } from "@/lib/auth/handlers";
import { prodDeps } from "@/lib/auth/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = createVerifyEmailHandler(prodDeps());
