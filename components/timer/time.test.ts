import { describe, expect, it } from "vitest";
import {
  formatRemaining,
  isExpired,
  progressPercent,
  remainingSeconds,
} from "./time";
import type { PublicSession } from "@/lib/timer/service";

function session(overrides: Partial<PublicSession> = {}): PublicSession {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    taskId: null,
    taskTitleSnapshot: null,
    categorySnapshot: null,
    intervalType: "focus",
    status: "running",
    plannedDurationSeconds: 1500,
    actualDurationSeconds: null,
    startedAt: "2026-09-10T12:00:00.000Z",
    expectedEndAt: "2026-09-10T12:25:00.000Z",
    pausedAt: null,
    accumulatedPauseSeconds: 0,
    completedAt: null,
    cancelledAt: null,
    createdAt: "2026-09-10T12:00:00.000Z",
    updatedAt: "2026-09-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("timestamp-derived timer display math (spec §8.4)", () => {
  it("derives remaining time from expected_end_at minus now", () => {
    const s = session();
    // 32s in: 1500 - 32 = 1468 remaining.
    expect(
      remainingSeconds(s, new Date("2026-09-10T12:00:32.000Z").getTime()),
    ).toBe(1468);
  });

  it("clamps remaining at zero past the expected end (no negative clock)", () => {
    const s = session();
    expect(
      remainingSeconds(s, new Date("2026-09-10T12:40:00.000Z").getTime()),
    ).toBe(0);
  });

  it("freezes remaining while paused (paused_at, not now)", () => {
    const s = session({
      status: "paused",
      pausedAt: "2026-09-10T12:10:00.000Z",
    });
    // Five minutes of wall-clock pass while paused: the display must not
    // move (spec §13.2 pause-travel rule).
    expect(
      remainingSeconds(s, new Date("2026-09-10T12:15:00.000Z").getTime()),
    ).toBe(900);
  });

  it("derives progress from the same timestamps (0 at start, 100 at end)", () => {
    const s = session();
    expect(
      progressPercent(s, new Date("2026-09-10T12:00:00.000Z").getTime()),
    ).toBe(0);
    expect(
      progressPercent(s, new Date("2026-09-10T12:12:30.000Z").getTime()),
    ).toBe(50);
    expect(
      progressPercent(s, new Date("2026-09-10T12:25:00.000Z").getTime()),
    ).toBe(100);
    expect(
      progressPercent(s, new Date("2026-09-10T13:25:00.000Z").getTime()),
    ).toBe(100);
  });

  it("formats the clock as m:ss, padding seconds", () => {
    expect(formatRemaining(0)).toBe("00:00");
    expect(formatRemaining(9)).toBe("00:09");
    expect(formatRemaining(1500)).toBe("25:00");
    expect(formatRemaining(872)).toBe("14:32");
  });

  it("formats hour-long plans as h:mm:ss", () => {
    expect(formatRemaining(3723)).toBe("1:02:03");
  });

  it("reports expiry only for running intervals (paused never expires)", () => {
    const running = session();
    expect(
      isExpired(running, new Date("2026-09-10T12:25:00.000Z").getTime()),
    ).toBe(true);
    expect(
      isExpired(running, new Date("2026-09-10T12:24:59.000Z").getTime()),
    ).toBe(false);
    const paused = session({
      status: "paused",
      pausedAt: "2026-09-10T12:10:00.000Z",
    });
    expect(
      isExpired(paused, new Date("2026-09-10T13:10:00.000Z").getTime()),
    ).toBe(false);
  });
});
