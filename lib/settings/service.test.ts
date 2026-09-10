import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SettingsServiceError,
  createSettingsService,
  type SettingsPorts,
  type StoredSettings,
} from "./service";

/**
 * Seam 2 (unit, hermetic): settings domain logic over an in-memory fake
 * store. No Prisma, no HTTP — behavior proven through the service
 * interface. Per-user scoping is structural here (the fake keys every row
 * by userId, as the Prisma store's `where: { userId }` predicates do);
 * cross-user denial at the HTTP level lands in
 * app/api/settings/settings.integration.test.ts (both directions).
 */
function fakePorts(): SettingsPorts & { rows: Map<string, StoredSettings> } {
  const rows = new Map<string, StoredSettings>();
  const updatedAt = new Date("2026-09-10T12:00:00.000Z");
  return {
    rows,
    store: {
      async findSettings(userId) {
        return rows.get(userId) ?? null;
      },
      async ensureSettings(userId) {
        const existing = rows.get(userId);
        if (existing) return existing;
        const row: StoredSettings = {
          userId,
          ...DEFAULT_SETTINGS,
          timezone: "UTC",
          updatedAt,
        };
        rows.set(userId, row);
        return row;
      },
      async updateSettings(userId, patch) {
        const current = rows.get(userId) ?? {
          userId,
          ...DEFAULT_SETTINGS,
          timezone: "UTC",
          updatedAt,
        };
        const next: StoredSettings = {
          ...current,
          ...patch.settings,
          ...(patch.timezone !== undefined
            ? { timezone: patch.timezone }
            : {}),
          updatedAt,
        };
        rows.set(userId, next);
        return next;
      },
    },
  };
}

describe("settings service", () => {
  it("bootstraps spec defaults on first read", async () => {
    const ports = fakePorts();
    const service = createSettingsService(ports);
    await expect(service.get("user-1")).resolves.toEqual({
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
    });
  });

  it("persists a valid patch and returns it on the next read", async () => {
    const ports = fakePorts();
    const service = createSettingsService(ports);
    await service.update("user-1", {
      focusDurationSeconds: 3000,
      soundPreset: "gong",
      soundVolume: 42,
      timezone: "Europe/Berlin",
    });
    await expect(service.get("user-1")).resolves.toMatchObject({
      focusDurationSeconds: 3000,
      soundPreset: "gong",
      soundVolume: 42,
      timezone: "Europe/Berlin",
    });
  });

  it("applies partial patches without touching other fields", async () => {
    const ports = fakePorts();
    const service = createSettingsService(ports);
    await service.update("user-1", { soundVolume: 10 });
    await expect(service.get("user-1")).resolves.toMatchObject({
      soundVolume: 10,
      soundPreset: "chime",
      focusDurationSeconds: 1500,
      timezone: "UTC",
    });
  });

  it("updates timezone without touching timer fields and vice versa", async () => {
    const ports = fakePorts();
    const service = createSettingsService(ports);
    await service.update("user-1", { timezone: "Pacific/Kiritimati" });
    await expect(service.get("user-1")).resolves.toMatchObject({
      timezone: "Pacific/Kiritimati",
      focusDurationSeconds: 1500,
    });
    await service.update("user-1", { autoStartBreaks: true });
    await expect(service.get("user-1")).resolves.toMatchObject({
      timezone: "Pacific/Kiritimati",
      autoStartBreaks: true,
    });
  });

  it("keeps users isolated: one user's patch never leaks into another's read", async () => {
    const ports = fakePorts();
    const service = createSettingsService(ports);
    await service.update("user-1", { soundVolume: 5, timezone: "UTC" });
    await expect(service.get("user-2")).resolves.toMatchObject({
      soundVolume: 80,
      timezone: "UTC",
    });
  });

  it("rejects an empty patch with a field-level 400", async () => {
    const ports = fakePorts();
    const service = createSettingsService(ports);
    const error = await service.update("user-1", {}).catch((e) => e);
    expect(error).toBeInstanceOf(SettingsServiceError);
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid preset, volume, and timezone with field maps", async () => {
    const ports = fakePorts();
    const service = createSettingsService(ports);
    for (const patch of [
      { soundPreset: "synthwave" },
      { soundVolume: 101 },
      { soundVolume: -1 },
      { timezone: "Mars/Olympus" },
      { focusDurationSeconds: 59 },
      { focusDurationSeconds: 7201 },
      { shortBreakSeconds: 3601 },
      { longBreakSeconds: 59 },
      { intervalsBeforeLongBreak: 0 },
      { intervalsBeforeLongBreak: 11 },
    ]) {
      const error = await service.update("user-1", patch).catch((e) => e);
      expect(error).toBeInstanceOf(SettingsServiceError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(Object.keys(error.fields ?? {}).length).toBeGreaterThan(0);
    }
    // Nothing persisted from the rejected patches.
    await expect(service.get("user-1")).resolves.toMatchObject({
      soundPreset: "chime",
      soundVolume: 80,
      timezone: "UTC",
      focusDurationSeconds: 1500,
    });
  });
});
