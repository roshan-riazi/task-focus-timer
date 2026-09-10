import type { PrismaClient } from "@prisma/client";
import type { SoundPreset } from "./validation";
import type { SettingsStore, StoredSettings } from "./service";

function toStored(
  settings: {
    userId: string;
    focusDurationSeconds: number;
    shortBreakSeconds: number;
    longBreakSeconds: number;
    intervalsBeforeLongBreak: number;
    autoStartBreaks: boolean;
    autoStartFocus: boolean;
    soundEnabled: boolean;
    soundPreset: string;
    soundVolume: number;
    notificationsEnabled: boolean;
    updatedAt: Date;
  },
  timezone: string,
): StoredSettings {
  return {
    ...settings,
    // Writes always pass the Zod allow-list, so every stored preset is a
    // known key; the cast only bridges Prisma's `String` column type.
    soundPreset: settings.soundPreset as SoundPreset,
    timezone,
  };
}

/**
 * Production store: SettingsStore over Prisma (the only data-access path
 * per SYSTEM_DESIGN §1). Every method scopes by `userId` — identity always
 * arrives from the session via the service, never from client input
 * (spec §11.5). Thin mapping only; all domain rules live in service.ts and
 * are covered hermetically there. Live-DB coverage lands in
 * app/api/settings/settings.integration.test.ts.
 */
export function createPrismaSettingsStore(db: PrismaClient): SettingsStore {
  async function read(userId: string): Promise<StoredSettings | null> {
    const user = await db.user.findUnique({
      where: { id: userId },
      include: { settings: true },
    });
    if (!user || !user.settings) return null;
    return toStored(user.settings, user.timezone);
  }

  return {
    async findSettings(userId) {
      return read(userId);
    },

    async ensureSettings(userId) {
      // Idempotent bootstrap (spec §10.2): the `update: {}` no-op keeps
      // concurrent first-reads from racing into a unique violation —
      // upsert serializes on the primary key instead.
      await db.userSettings.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      const row = await read(userId);
      if (!row) throw new Error("settings.ensureSettings: missing scoped row");
      return row;
    },

    async updateSettings(userId, patch) {
      // One transaction (spec §8.7: one screen edits both tables): the
      // `user_settings` patch and the `users.timezone` write land
      // together, and the upsert also bootstraps pre-registration rows.
      // Both writes key on the session's `userId` primary key, so they can
      // only ever touch the caller's rows (spec §10.6); a user deleted
      // mid-flight aborts the transaction via the FK/P2025 error.
      await db.$transaction([
        db.userSettings.upsert({
          where: { userId },
          create: { userId, ...patch.settings },
          update: { ...patch.settings },
        }),
        ...(patch.timezone !== undefined
          ? [db.user.update({ where: { id: userId }, data: { timezone: patch.timezone } })]
          : []),
      ]);
      const row = await read(userId);
      if (!row) throw new Error("settings.updateSettings: missing scoped row");
      return row;
    },
  };
}
