import {
  createGetSettingsHandler,
  createUpdateSettingsHandler,
} from "@/lib/settings/handlers";
import { prodSettingsDeps } from "@/lib/settings/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deps = prodSettingsDeps();

export const GET = createGetSettingsHandler(deps);
export const PATCH = createUpdateSettingsHandler(deps);
