import { z } from "zod";
import { flattenZodFields } from "../auth/validation";
import { updateSettingsSchema, type SoundPreset } from "./validation";

/**
 * Storage-shaped settings: one row per user. `timezone` lives on
 * `users.timezone` (spec §10.1) while the rest lives on `user_settings`
 * (spec §10.2); the service presents them as one object because the
 * settings page edits them together.
 */
export interface StoredSettings {
  userId: string;
  focusDurationSeconds: number;
  shortBreakSeconds: number;
  longBreakSeconds: number;
  intervalsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  soundEnabled: boolean;
  soundPreset: SoundPreset;
  soundVolume: number;
  notificationsEnabled: boolean;
  timezone: string;
  updatedAt: Date;
}

export interface PublicSettings {
  focusDurationSeconds: number;
  shortBreakSeconds: number;
  longBreakSeconds: number;
  intervalsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  soundEnabled: boolean;
  soundPreset: SoundPreset;
  soundVolume: number;
  notificationsEnabled: boolean;
  timezone: string;
  updatedAt: string;
}

export function toPublicSettings(row: StoredSettings): PublicSettings {
  return {
    focusDurationSeconds: row.focusDurationSeconds,
    shortBreakSeconds: row.shortBreakSeconds,
    longBreakSeconds: row.longBreakSeconds,
    intervalsBeforeLongBreak: row.intervalsBeforeLongBreak,
    autoStartBreaks: row.autoStartBreaks,
    autoStartFocus: row.autoStartFocus,
    soundEnabled: row.soundEnabled,
    soundPreset: row.soundPreset,
    soundVolume: row.soundVolume,
    notificationsEnabled: row.notificationsEnabled,
    timezone: row.timezone,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Spec §10.2 defaults (issue 04 writes them at registration via schema
 * defaults; they are repeated here as literals so the fake store and the
 * defensive bootstrap below never depend on Prisma client behavior).
 */
export const DEFAULT_SETTINGS = {
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
} as const satisfies Omit<
  StoredSettings,
  "userId" | "timezone" | "updatedAt"
>;

export type SettingsErrorCode = "VALIDATION_ERROR";

/**
 * Typed service failure. Routes map codes to HTTP status + envelope
 * (VALIDATION_ERROR → 400 with field map); anything else is a 500.
 * There is no NOT_FOUND: reads bootstrap the defaults row, so every
 * authenticated user always has settings.
 */
export class SettingsServiceError extends Error {
  readonly fields?: Record<string, string[]>;
  constructor(
    readonly code: SettingsErrorCode,
    message: string,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "SettingsServiceError";
    this.fields = fields;
  }
}

/**
 * System boundaries behind the settings service (health-route factory
 * pattern: callers inject the boundary; unit tests inject the in-memory
 * fake in service.test.ts; routes inject the Prisma store in
 * prisma-store.ts). Every method scopes by `userId` — identity always
 * arrives from the session via the handlers, never from client input
 * (spec §11.5).
 */
export interface SettingsStore {
  findSettings(userId: string): Promise<StoredSettings | null>;
  /**
   * Idempotent defaults bootstrap (spec §10.2): returns the existing row
   * when present, otherwise creates it. Issue 04 already creates the row
   * at registration; this covers pre-bootstrap rows and registration
   * races without ever 500ing a first read.
   */
  ensureSettings(userId: string): Promise<StoredSettings>;
  /**
   * One transaction: the `user_settings` patch and the `users.timezone`
   * write land atomically (spec §8.7 edits them on one screen).
   */
  updateSettings(
    userId: string,
    patch: {
      settings: Partial<
        Omit<StoredSettings, "userId" | "timezone" | "updatedAt">
      >;
      timezone?: string;
    },
  ): Promise<StoredSettings>;
}

export interface SettingsPorts {
  store: SettingsStore;
}

function validationError(error: z.ZodError): SettingsServiceError {
  return new SettingsServiceError(
    "VALIDATION_ERROR",
    "Check the highlighted fields and try again.",
    flattenZodFields(error),
  );
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

export function createSettingsService(ports: SettingsPorts) {
  return {
    async get(userId: string): Promise<PublicSettings> {
      // Steady-state reads stay reads: only the first GET for a row-less
      // user pays the bootstrap upsert (concurrent first-reads serialize
      // on the primary key inside `ensureSettings`).
      const existing = await ports.store.findSettings(userId);
      return toPublicSettings(existing ?? (await ports.store.ensureSettings(userId)));
    },

    async update(userId: string, input: unknown): Promise<PublicSettings> {
      const data = parse(updateSettingsSchema, input);
      const { timezone, ...settings } = data;
      return toPublicSettings(
        await ports.store.updateSettings(userId, {
          settings,
          ...(timezone !== undefined ? { timezone } : {}),
        }),
      );
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
