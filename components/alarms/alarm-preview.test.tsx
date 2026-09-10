import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AlarmPreviewButton } from "./alarm-preview";
import * as player from "@/lib/alarms/player";

/**
 * Seam 4 (unit, Testing Library): in-settings preview for issue 13
 * (spec §8.7 alarm preset with in-settings preview, prototype
 * `settings.html` Preview button).
 *
 * Keyboard-accessible native button; plays the selected preset at the set
 * volume via the shared player (gesture unlock included). Never receives
 * task content — only preset + volume.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<AlarmPreviewButton /> (issue 13)", () => {
  it("renders a labelled preview button", () => {
    render(<AlarmPreviewButton preset="chime" volume={80} />);
    expect(
      screen.getByRole("button", { name: /preview chime/i }),
    ).toBeInTheDocument();
  });

  it("plays the selected preset at the set volume on click", async () => {
    const user = userEvent.setup();
    const playSpy = vi
      .spyOn(player, "playAlarm")
      .mockResolvedValue({ played: true, reason: "played" });
    const unlockSpy = vi
      .spyOn(player, "ensureAudioUnlocked")
      .mockResolvedValue(undefined);
    render(<AlarmPreviewButton preset="bell" volume={42} moment="break-end" />);
    await user.click(screen.getByRole("button", { name: /preview bell/i }));
    expect(unlockSpy).toHaveBeenCalledTimes(1);
    expect(playSpy).toHaveBeenCalledWith({
      preset: "bell",
      moment: "break-end",
      volume: 42,
      soundEnabled: true,
    });
  });

  it("announces when preview is silent without throwing", async () => {
    const user = userEvent.setup();
    vi.spyOn(player, "ensureAudioUnlocked").mockResolvedValue(undefined);
    vi.spyOn(player, "playAlarm").mockResolvedValue({
      played: false,
      reason: "unsupported",
    });
    render(<AlarmPreviewButton preset="gong" volume={80} />);
    await user.click(screen.getByRole("button", { name: /preview gong/i }));
    expect(await screen.findByRole("status")).toHaveTextContent(/silent/i);
  });
});
