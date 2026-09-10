import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const realFetch = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
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
      timezone: "Europe/Berlin",
      updatedAt: "2026-09-10T12:00:00.000Z",
      ...overrides,
    },
  };
}

import { SettingsForm } from "./settings-form";

/**
 * Seam: `<SettingsForm />` over stubbed `fetch` (spec §8.7, prototype
 * `settings.html`). Behavior only — minute/second conversion, preset
 * preview + volume wiring, timezone editing, field errors, the
 * new-intervals-only notice — never internals.
 */
describe("<SettingsForm /> (spec §8.7)", () => {
  it("loads current settings into minute inputs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(sampleSettings(), 200)),
    );
    render(<SettingsForm />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading settings/i);
    expect(
      await screen.findByRole("button", { name: /save settings/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Focus duration (minutes)")).toHaveValue(25);
    expect(screen.getByLabelText("Short break (minutes)")).toHaveValue(5);
    expect(screen.getByLabelText("Long break (minutes)")).toHaveValue(15);
    expect(
      screen.getByLabelText("Focus intervals before long break"),
    ).toHaveValue(4);
    expect(screen.getByLabelText("Volume")).toHaveValue("80");
    expect(screen.getByLabelText("Timezone")).toHaveValue("Europe/Berlin");
  });

  it("saves minutes as seconds and announces new-intervals-only", async () => {
    const user = userEvent.setup();
    const calls: Array<[string, RequestInit | undefined]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([url, init]);
        if (init?.method === "PATCH") {
          return jsonResponse(
            sampleSettings({ focusDurationSeconds: 3600 }),
            200,
          );
        }
        return jsonResponse(sampleSettings(), 200);
      }),
    );
    render(<SettingsForm />);
    await screen.findByRole("button", { name: /save settings/i });

    const focus = screen.getByLabelText("Focus duration (minutes)");
    await user.clear(focus);
    await user.type(focus, "60");
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    const patch = calls.find(([, init]) => init?.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(String(patch![1]?.body)).toContain('"focusDurationSeconds":3600');
    // The volume <output> carries an implicit status role, so assert the
    // notice text directly instead of the role.
    expect(await screen.findByText(/new intervals only/i)).toBeInTheDocument();
  });

  it("associates server field errors with their inputs", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          // HTML-valid input (native max/min pass) that the server still
          // rejects — e.g. a stricter limit after deploy — so the field
          // mapping, not native validation, is under test.
          return jsonResponse(
            {
              error: {
                code: "VALIDATION_ERROR",
                message: "Check the highlighted fields and try again.",
                fields: {
                  focusDurationSeconds: ["Must be at most 7200 seconds."],
                },
              },
            },
            400,
          );
        }
        return jsonResponse(sampleSettings(), 200);
      }),
    );
    render(<SettingsForm />);
    await screen.findByRole("button", { name: /save settings/i });

    const focus = screen.getByLabelText("Focus duration (minutes)");
    await user.clear(focus);
    await user.type(focus, "60");
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/at most 7200/);
    expect(focus).toHaveAttribute("aria-invalid", "true");
    expect(focus.getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("associates toggle field errors with their checkboxes (WCAG 3.3.1)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return jsonResponse(
            {
              error: {
                code: "VALIDATION_ERROR",
                message: "Check the highlighted fields and try again.",
                fields: {
                  autoStartBreaks: ["Automatic breaks need a valid cycle."],
                },
              },
            },
            400,
          );
        }
        return jsonResponse(sampleSettings(), 200);
      }),
    );
    render(<SettingsForm />);
    await screen.findByRole("button", { name: /save settings/i });
    await user.click(screen.getByRole("button", { name: /save settings/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/automatic breaks/i);
    const box = screen.getByLabelText(/start breaks automatically/i);
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box.getAttribute("aria-describedby")).toContain(alert.id);
  });

  it("announces the volume with its percent unit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(sampleSettings(), 200)),
    );
    render(<SettingsForm />);
    await screen.findByRole("button", { name: /save settings/i });
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("previews the selected preset at the set volume", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(sampleSettings(), 200)),
    );
    render(<SettingsForm />);
    await screen.findByRole("button", { name: /save settings/i });

    expect(
      screen.getByRole("button", { name: /preview chime/i }),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Alarm sound"), "gong");
    expect(
      screen.getByRole("button", { name: /preview gong/i }),
    ).toBeInTheDocument();
  });

  it("retries a failed load", async () => {
    const user = userEvent.setup();
    let failNext = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (failNext) {
          failNext = false;
          return jsonResponse(
            { error: { code: "REQUEST_FAILED", message: "Something went wrong." } },
            500,
          );
        }
        return jsonResponse(sampleSettings(), 200);
      }),
    );
    render(<SettingsForm />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /something went wrong/i,
    );
    await user.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(
      await screen.findByRole("button", { name: /save settings/i }),
    ).toBeInTheDocument();
  });
});
