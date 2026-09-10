import { z } from "zod";

/**
 * Zod input boundary for the Settings API (issue 09, spec §8.7 + §10.2).
 *
 * Units are seconds — the storage unit in `user_settings` — so validated
 * values reach the store unchanged. The spec's minute ranges convert once
 * here: focus 1–120 min → 60–7200 s, short/long breaks 1–60 min →
 * 60–3600 s, cycle count 1–10, volume 0–100.
 */

/**
 * Built-in WebAudio-synthesized alarm presets (decision ticket
 * `10-decide-alarm-sound-options`, prototype `settings.html` select:
 * Chime/Bell/Pulse/Gong, default `chime`). Exported so issue 13's
 * preset→pattern mapping reuses the same allow-list instead of forking it.
 */
export const SOUND_PRESETS = ["chime", "bell", "pulse", "gong"] as const;

export type SoundPreset = (typeof SOUND_PRESETS)[number];

const durationSchema = (minSeconds: number, maxSeconds: number) =>
  z
    .number()
    .int("Enter a whole number of seconds.")
    .min(minSeconds, `Must be at least ${minSeconds} seconds.`)
    .max(maxSeconds, `Must be at most ${maxSeconds} seconds.`);

/**
 * IANA timezone check — same contract as registration
 * (`lib/auth/validation.ts` `timezoneSchema`): ICU-recognized zone names
 * pass, anything else fails. Parity matters because registration already
 * accepts these values into `users.timezone`; the settings route must not
 * reject what signup allowed. Length mirrors `users.timezone VARCHAR(64)`.
 */
const timezoneFieldSchema = z
  .string()
  .max(64, "Timezone is too long.")
  .refine(
    (value) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Enter a valid IANA timezone." },
  );

/**
 * PATCH body: every field optional (partial update), at least one present.
 * The non-empty refine mirrors `updateTaskSchema` ("Nothing to update.",
 * surfaced under `_form` by the shared field-flattener) so both PATCH
 * routes reject no-op bodies with the same 400 envelope.
 */
export const updateSettingsSchema = z
  .object({
    focusDurationSeconds: durationSchema(60, 7200).optional(),
    shortBreakSeconds: durationSchema(60, 3600).optional(),
    longBreakSeconds: durationSchema(60, 3600).optional(),
    intervalsBeforeLongBreak: z
      .number()
      .int("Enter a whole number.")
      .min(1, "Must be at least 1.")
      .max(10, "Must be at most 10.")
      .optional(),
    autoStartBreaks: z.boolean().optional(),
    autoStartFocus: z.boolean().optional(),
    soundEnabled: z.boolean().optional(),
    soundPreset: z.enum(SOUND_PRESETS).optional(),
    soundVolume: z
      .number()
      .int("Enter a whole number from 0 to 100.")
      .min(0, "Must be at least 0.")
      .max(100, "Must be at most 100.")
      .optional(),
    notificationsEnabled: z.boolean().optional(),
    timezone: timezoneFieldSchema.optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Nothing to update.",
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
