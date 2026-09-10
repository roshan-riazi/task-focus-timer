import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createGetSettingsHandler,
  createUpdateSettingsHandler,
  type SettingsHandlerDeps,
} from "@/lib/settings/handlers";
import { createPrismaSettingsStore } from "@/lib/settings/prisma-store";
import { createSettingsService, type SettingsService } from "@/lib/settings/service";
import type { AppSession } from "@/lib/auth/session";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabaseUrl ? describe : describe.skip;

const APP_URL = "http://localhost:3000";

/**
 * Issue 09 acceptance against live Postgres (TEST_STRATEGY §2, API level):
 *
 * - Defaults bootstrap: a user with no `user_settings` row (pre-04 shape)
 *   gets spec §10.2 defaults on first GET; a registration-bootstrapped row
 *   (issue 04: `userSettings.create` at register) reads back identically.
 * - Valid PATCH persists every field incl. timezone and reads back on GET.
 * - Validation matrix: invalid preset/volume/timezone/durations/cycle
 *   count are 400s with field maps and persist nothing.
 * - Scoping, both directions: one user's PATCH never leaks into the
 *   other's GET, and unauthenticated reads/writes are 401.
 */
describeIfDb(
  "settings API (live Postgres)",
  () => {
    let db: PrismaClient;
    let service: SettingsService;
    const createdUserIds: string[] = [];

    async function setup(): Promise<void> {
      const mod = await import("@/lib/db");
      db = mod.db;
      service = createSettingsService({
        store: createPrismaSettingsStore(db),
      });
    }

    function email(prefix: string): string {
      return `${prefix}-${crypto.randomUUID()}@example.com`;
    }

    async function makeUser(
      prefix: string,
      withSettingsRow = false,
    ): Promise<{ id: string; email: string }> {
      const address = email(prefix);
      const user = await db.user.create({ data: { email: address } });
      if (withSettingsRow) {
        // Registration path (issue 04): the settings row is created with
        // schema defaults alongside the user.
        await db.userSettings.create({ data: { userId: user.id } });
      }
      createdUserIds.push(user.id);
      return { id: user.id, email: address };
    }

    function depsFor(userId: string, userEmail: string): SettingsHandlerDeps {
      const session: AppSession = {
        user: { id: userId, email: userEmail, emailVerified: null, timezone: "UTC" },
        expires: new Date("2026-10-09T12:00:00.000Z").toISOString(),
      };
      return {
        getService: async () => service,
        getSession: async () => session,
        appUrl: APP_URL,
      };
    }

    function get(deps: SettingsHandlerDeps): Promise<Response> {
      return createGetSettingsHandler(deps)(
        new Request(`${APP_URL}/api/settings`, { method: "GET" }),
      );
    }

    function patch(deps: SettingsHandlerDeps, body: unknown): Promise<Response> {
      return createUpdateSettingsHandler(deps)(
        new Request(`${APP_URL}/api/settings`, {
          method: "PATCH",
          headers: { "content-type": "application/json", origin: APP_URL },
          body: JSON.stringify(body),
        }),
      );
    }

    // Lazily initialized: vitest collects before DATABASE_URL-dependent
    // imports resolve, so the first test pays the setup cost.
    let ready: Promise<void> | null = null;
    async function ensureReady(): Promise<void> {
      ready ??= setup();
      await ready;
    }

    afterEach(async () => {
      if (db) {
        // Users cascade to settings, tasks, sessions, and cycle state.
        await db.user.deleteMany({
          where: { id: { in: createdUserIds.splice(0) } },
        });
      }
    });

    it("bootstraps spec defaults on first GET for a row-less user", async () => {
      await ensureReady();
      const user = await makeUser("settings-bootstrap");
      const response = await get(depsFor(user.id, user.email));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        settings: {
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
          updatedAt: expect.any(String),
        },
      });
    });

    it("reads back a registration-bootstrapped row unchanged", async () => {
      await ensureReady();
      const user = await makeUser("settings-registered", true);
      const response = await get(depsFor(user.id, user.email));
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        settings: Record<string, unknown>;
      };
      expect(body.settings).toMatchObject({
        focusDurationSeconds: 1500,
        soundPreset: "chime",
        soundVolume: 80,
        timezone: "UTC",
      });
    });

    it("persists a full valid patch and returns it on GET", async () => {
      await ensureReady();
      const user = await makeUser("settings-patch");
      const userDeps = depsFor(user.id, user.email);
      const patchResponse = await patch(userDeps, {
        focusDurationSeconds: 3000,
        shortBreakSeconds: 600,
        longBreakSeconds: 1800,
        intervalsBeforeLongBreak: 6,
        autoStartBreaks: true,
        autoStartFocus: true,
        soundEnabled: false,
        soundPreset: "gong",
        soundVolume: 42,
        notificationsEnabled: true,
        timezone: "Europe/Berlin",
      });
      expect(patchResponse.status).toBe(200);
      const patched = (await patchResponse.json()) as {
        settings: Record<string, unknown>;
      };
      expect(patched.settings).toMatchObject({
        focusDurationSeconds: 3000,
        shortBreakSeconds: 600,
        longBreakSeconds: 1800,
        intervalsBeforeLongBreak: 6,
        autoStartBreaks: true,
        autoStartFocus: true,
        soundEnabled: false,
        soundPreset: "gong",
        soundVolume: 42,
        notificationsEnabled: true,
        timezone: "Europe/Berlin",
      });

      const reread = await get(userDeps);
      expect(reread.status).toBe(200);
      const rereadBody = (await reread.json()) as {
        settings: Record<string, unknown>;
      };
      expect(rereadBody.settings).toMatchObject(patched.settings);
    });

    it("writes timezone to users.timezone transactionally with settings", async () => {
      await ensureReady();
      const user = await makeUser("settings-timezone");
      const userDeps = depsFor(user.id, user.email);
      const response = await patch(userDeps, {
        timezone: "Pacific/Kiritimati",
        soundVolume: 10,
      });
      expect(response.status).toBe(200);
      await expect(
        db.user.findUnique({ where: { id: user.id } }),
      ).resolves.toMatchObject({ timezone: "Pacific/Kiritimati" });
      await expect(
        db.userSettings.findUnique({ where: { userId: user.id } }),
      ).resolves.toMatchObject({ soundVolume: 10 });
    });

    it("rejects the validation matrix and persists nothing", async () => {
      await ensureReady();
      const user = await makeUser("settings-matrix");
      const userDeps = depsFor(user.id, user.email);
      const badPatches: Array<{ body: unknown; field: string }> = [
        { body: { soundPreset: "synthwave" }, field: "soundPreset" },
        { body: { soundPreset: "CHIME" }, field: "soundPreset" },
        { body: { soundVolume: -1 }, field: "soundVolume" },
        { body: { soundVolume: 101 }, field: "soundVolume" },
        { body: { soundVolume: 80.5 }, field: "soundVolume" },
        { body: { timezone: "Mars/Olympus" }, field: "timezone" },
        { body: { timezone: "" }, field: "timezone" },
        { body: { focusDurationSeconds: 59 }, field: "focusDurationSeconds" },
        { body: { focusDurationSeconds: 7201 }, field: "focusDurationSeconds" },
        { body: { shortBreakSeconds: 59 }, field: "shortBreakSeconds" },
        { body: { shortBreakSeconds: 3601 }, field: "shortBreakSeconds" },
        { body: { longBreakSeconds: 59 }, field: "longBreakSeconds" },
        { body: { longBreakSeconds: 3601 }, field: "longBreakSeconds" },
        { body: { intervalsBeforeLongBreak: 0 }, field: "intervalsBeforeLongBreak" },
        { body: { intervalsBeforeLongBreak: 11 }, field: "intervalsBeforeLongBreak" },
        { body: {}, field: "_form" },
      ];
      for (const { body, field } of badPatches) {
        const response = await patch(userDeps, body);
        expect(response.status).toBe(400);
        const payload = (await response.json()) as {
          error: { code: string; fields: Record<string, string[]> };
        };
        expect(payload.error.code).toBe("VALIDATION_ERROR");
        expect(Object.keys(payload.error.fields)).toContain(field);
      }
      const reread = (await (await get(userDeps)).json()) as {
        settings: Record<string, unknown>;
      };
      expect(reread.settings).toMatchObject({
        focusDurationSeconds: 1500,
        shortBreakSeconds: 300,
        longBreakSeconds: 900,
        intervalsBeforeLongBreak: 4,
        soundPreset: "chime",
        soundVolume: 80,
        timezone: "UTC",
      });
    });

    it("accepts boundary values on every ranged field", async () => {
      await ensureReady();
      const user = await makeUser("settings-boundaries");
      const userDeps = depsFor(user.id, user.email);
      const response = await patch(userDeps, {
        focusDurationSeconds: 60,
        shortBreakSeconds: 3600,
        longBreakSeconds: 60,
        intervalsBeforeLongBreak: 1,
        soundVolume: 0,
      });
      expect(response.status).toBe(200);
      const second = await patch(userDeps, {
        focusDurationSeconds: 7200,
        shortBreakSeconds: 60,
        longBreakSeconds: 3600,
        intervalsBeforeLongBreak: 10,
        soundVolume: 100,
      });
      expect(second.status).toBe(200);
      const body = (await second.json()) as {
        settings: Record<string, unknown>;
      };
      expect(body.settings).toMatchObject({
        focusDurationSeconds: 7200,
        intervalsBeforeLongBreak: 10,
        soundVolume: 100,
      });
    });

    it("isolates users in both directions", async () => {
      await ensureReady();
      const alice = await makeUser("settings-alice");
      const bob = await makeUser("settings-bob");
      const aliceDeps = depsFor(alice.id, alice.email);
      const bobDeps = depsFor(bob.id, bob.email);

      await expect(await patch(aliceDeps, { soundVolume: 5 })).toHaveProperty(
        "status",
        200,
      );
      // Bob → Alice direction: Bob's read is unaffected by Alice's patch.
      const bobRead = (await (await get(bobDeps)).json()) as {
        settings: Record<string, unknown>;
      };
      expect(bobRead.settings).toMatchObject({ soundVolume: 80 });

      await expect(
        await patch(bobDeps, { soundVolume: 95, timezone: "Europe/Berlin" }),
      ).toHaveProperty("status", 200);
      // Alice → Bob direction: Alice's read is unaffected by Bob's patch.
      const aliceRead = (await (await get(aliceDeps)).json()) as {
        settings: Record<string, unknown>;
      };
      expect(aliceRead.settings).toMatchObject({
        soundVolume: 5,
        timezone: "UTC",
      });
    });

    it("rejects unauthenticated reads and writes", async () => {
      await ensureReady();
      const anon: SettingsHandlerDeps = {
        getService: async () => service,
        getSession: async () => null,
        appUrl: APP_URL,
      };
      await expect(await get(anon)).toHaveProperty("status", 401);
      await expect(await patch(anon, { soundVolume: 1 })).toHaveProperty(
        "status",
        401,
      );
    });
  },
);
