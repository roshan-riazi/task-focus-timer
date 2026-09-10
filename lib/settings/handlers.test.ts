import { describe, expect, it } from "vitest";
import type { AppSession } from "../auth/session";
import {
  SettingsServiceError,
  type PublicSettings,
  type SettingsService,
} from "./service";
import {
  createGetSettingsHandler,
  createUpdateSettingsHandler,
  type SettingsHandlerDeps,
} from "./handlers";

/**
 * Seam 3 (unit, hermetic): HTTP status codes, envelopes, and session
 * scoping at the settings-route boundary. Handlers run against a stub
 * service and a stub session reader — no Prisma, no Next.js. Live-DB
 * coverage of the same handlers lands in
 * app/api/settings/settings.integration.test.ts (CI + local Postgres).
 */
const APP_URL = "http://localhost:3000";

const appSession: AppSession = {
  user: {
    id: "user-1",
    email: "alice@example.com",
    emailVerified: null,
    timezone: "UTC",
  },
  expires: new Date("2026-10-09T12:00:00.000Z").toISOString(),
};

const publicSettings: PublicSettings = {
  focusDurationSeconds: 1500,
  shortBreakSeconds: 300,
  longBreakSeconds: 900,
  intervalsBeforeLongBreak: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  soundEnabled: true,
  soundPreset: "chime",
  soundVolume: 80,
  notificationsEnabled: false,
  timezone: "UTC",
  updatedAt: "2026-09-10T12:00:00.000Z",
};

function stubService(overrides: Partial<SettingsService> = {}): SettingsService {
  const notImplemented = async (): Promise<never> => {
    throw new Error("not implemented in stub");
  };
  return {
    get: notImplemented,
    update: notImplemented,
    ...overrides,
  } as SettingsService;
}

function deps(overrides: Partial<SettingsHandlerDeps> = {}): SettingsHandlerDeps {
  return {
    getService: async () => stubService({ get: async () => publicSettings }),
    getSession: async () => appSession,
    appUrl: APP_URL,
    ...overrides,
  };
}

function get(handlerDeps: SettingsHandlerDeps): Promise<Response> {
  return createGetSettingsHandler(handlerDeps)(
    new Request(`${APP_URL}/api/settings`, { method: "GET" }),
  );
}

function patch(handlerDeps: SettingsHandlerDeps, body: unknown): Promise<Response> {
  return createUpdateSettingsHandler(handlerDeps)(
    new Request(`${APP_URL}/api/settings`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: APP_URL },
      body: JSON.stringify(body),
    }),
  );
}

describe("settings handlers", () => {
  it("GET returns the service settings under the settings key", async () => {
    const response = await get(deps());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      settings: publicSettings,
    });
  });

  it("GET derives identity from the session, never from client input", async () => {
    let seenUserId: string | null = null;
    const response = await createGetSettingsHandler(
      deps({
        getService: async () =>
          stubService({
            get: async (userId: string) => {
              seenUserId = userId;
              return publicSettings;
            },
          }),
      }),
    )(new Request(`${APP_URL}/api/settings`, { method: "GET" }));
    expect(response.status).toBe(200);
    expect(seenUserId).toBe("user-1");
  });

  it("GET without a session is 401", async () => {
    const response = await get(deps({ getSession: async () => null }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHENTICATED", message: "Sign in to continue." },
    });
  });

  it("PATCH persists through the service scoped to the session user", async () => {
    let seen: { userId: string; input: unknown } | null = null;
    const updated: PublicSettings = {
      ...publicSettings,
      soundVolume: 42,
      timezone: "Europe/Berlin",
    };
    const response = await patch(
      deps({
        getService: async () =>
          stubService({
            update: async (userId: string, input: unknown) => {
              seen = { userId, input };
              return updated;
            },
          }),
      }),
      { soundVolume: 42, timezone: "Europe/Berlin" },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ settings: updated });
    expect(seen).toEqual({
      userId: "user-1",
      input: { soundVolume: 42, timezone: "Europe/Berlin" },
    });
  });

  it("PATCH maps service validation failures to 400 with field map", async () => {
    const response = await patch(
      deps({
        getService: async () =>
          stubService({
            update: async () => {
              throw new SettingsServiceError(
                "VALIDATION_ERROR",
                "Check the highlighted fields and try again.",
                { soundVolume: ["Must be at most 100."] },
              );
            },
          }),
      }),
      { soundVolume: 101 },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Check the highlighted fields and try again.",
        fields: { soundVolume: ["Must be at most 100."] },
      },
    });
  });

  it("PATCH without a session is 401 and never reaches the service", async () => {
    let reached = false;
    const response = await patch(
      deps({
        getSession: async () => null,
        getService: async () =>
          stubService({
            update: async () => {
              reached = true;
              return publicSettings;
            },
          }),
      }),
      { soundVolume: 42 },
    );
    expect(response.status).toBe(401);
    expect(reached).toBe(false);
  });

  it("PATCH from a foreign origin is 403 without reaching the service", async () => {
    let reached = false;
    const response = await createUpdateSettingsHandler(
      deps({
        getService: async () =>
          stubService({
            update: async () => {
              reached = true;
              return publicSettings;
            },
          }),
      }),
    )(
      new Request(`${APP_URL}/api/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ soundVolume: 42 }),
      }),
    );
    expect(response.status).toBe(403);
    expect(reached).toBe(false);
  });

  it("PATCH with an unparsable body is a 400, never a parser 500", async () => {
    // Real service (not a stub): the null from the failed parse must die
    // in Zod validation as a 400, never as a parser 500.
    const { createSettingsService, DEFAULT_SETTINGS } = await import(
      "./service"
    );
    const response = await createUpdateSettingsHandler(
      deps({
        getService: async () =>
          createSettingsService({
            store: {
              findSettings: async () => null,
              ensureSettings: async (userId: string) => ({
                userId,
                ...DEFAULT_SETTINGS,
                timezone: "UTC",
                updatedAt: new Date("2026-09-10T12:00:00.000Z"),
              }),
              updateSettings: async () => {
                throw new Error("must not reach the store");
              },
            },
          }),
      }),
    )(
      new Request(`${APP_URL}/api/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: APP_URL },
        body: "{not-json",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("unexpected service failures are 500 INTERNAL_ERROR", async () => {
    const response = await patch(
      deps({
        getService: async () =>
          stubService({
            update: async () => {
              throw new Error("db exploded");
            },
          }),
      }),
      { soundVolume: 42 },
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
    });
  });
});
