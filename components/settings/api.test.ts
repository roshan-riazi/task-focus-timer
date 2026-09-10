import { afterEach, describe, expect, it, vi } from "vitest";
import { getSettings, SettingsApiError } from "./api";

/**
 * Seam 4 (unit, hermetic): typed settings client for issue 13 (spec §11.4,
 * issue 09 contract). Mirrors `components/tasks/api.ts` + timer client:
 * JSON envelopes in, `SettingsApiError` out. Never logs settings content
 * beyond the fetch itself — errors carry display strings only.
 *
 * The timer needs only the sound/notification slice, but the client returns
 * the full public settings so the settings page (issue 16) reuses it.
 */

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  globalThis.fetch = realFetch;
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

function sampleSettings(overrides: Record<string, unknown> = {}) {
  return {
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
      updatedAt: "2026-09-10T12:00:00.000Z",
      ...overrides,
    },
  };
}

describe("getSettings (issue 13)", () => {
  it("returns the public settings envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(sampleSettings(), 200)),
    );
    const settings = await getSettings();
    expect(settings.soundPreset).toBe("chime");
    expect(settings.soundVolume).toBe(80);
    expect(settings.soundEnabled).toBe(true);
  });

  it("throws SettingsApiError on failure envelopes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "REQUEST_FAILED", message: "Something went wrong." } },
          500,
        ),
      ),
    );
    const err = await getSettings().catch((e) => e);
    expect(err).toBeInstanceOf(SettingsApiError);
    expect((err as SettingsApiError).message).toMatch(/something went wrong/i);
  });

  it("throws NETWORK_ERROR when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const err = await getSettings().catch((e) => e);
    expect(err).toBeInstanceOf(SettingsApiError);
    expect((err as SettingsApiError).code).toBe("NETWORK_ERROR");
  });
});
