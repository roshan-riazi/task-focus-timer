import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schemaPath = join(__dirname, "schema.prisma");
const schema = () => readFileSync(schemaPath, "utf8");

describe("prisma schema (spec §10)", () => {
  it("defines the datasource on Postgres via DATABASE_URL (prisma.config.ts)", () => {
    const text = schema();
    expect(text).toMatch(/provider\s*=\s*"postgresql"/);
    expect(text).not.toMatch(/url\s*=\s*env\("DATABASE_URL"\)/);
    const config = readFileSync(join(__dirname, "..", "prisma.config.ts"), "utf8");
    expect(config).toContain("DATABASE_URL");
  });

  it("defines all five models", () => {
    const text = schema();
    for (const model of [
      "model User {",
      "model UserSettings {",
      "model Task {",
      "model TimerSession {",
      "model FocusCycleState {",
    ]) {
      expect(text).toContain(model);
    }
  });

  it("maps models to spec table names", () => {
    const text = schema();
    for (const table of [
      '"users"',
      '"user_settings"',
      '"tasks"',
      '"timer_sessions"',
      '"focus_cycle_state"',
    ]) {
      expect(text).toContain(table);
    }
  });

  it("defines task/session enums with spec values", () => {
    const text = schema();
    expect(text).toMatch(/enum TaskStatus[\s\S]*?active[\s\S]*?completed[\s\S]*?archived/);
    expect(text).toMatch(/enum IntervalType[\s\S]*?focus[\s\S]*?short_break[\s\S]*?long_break/);
    expect(text).toMatch(/enum SessionStatus[\s\S]*?running[\s\S]*?paused[\s\S]*?completed[\s\S]*?cancelled/);
  });

  it("stores user identity fields per §10.1", () => {
    const text = schema();
    expect(text).toMatch(/model User \{[\s\S]*?email[\s\S]*?@unique/);
    expect(text).toMatch(/model User \{[\s\S]*?timezone/);
  });

  it("stores settings incl. sound_preset default chime + sound_volume default 80", () => {
    const text = schema();
    expect(text).toMatch(/model UserSettings \{[\s\S]*?soundPreset[\s\S]*?@default\("chime"\)/);
    expect(text).toMatch(/model UserSettings \{[\s\S]*?soundVolume[\s\S]*?@default\(80\)/);
    expect(text).toMatch(/model UserSettings \{[\s\S]*?focusDurationSeconds[\s\S]*?@default\(1500\)/);
    expect(text).toMatch(/model UserSettings \{[\s\S]*?shortBreakSeconds[\s\S]*?@default\(300\)/);
    expect(text).toMatch(/model UserSettings \{[\s\S]*?longBreakSeconds[\s\S]*?@default\(900\)/);
    expect(text).toMatch(/model UserSettings \{[\s\S]*?intervalsBeforeLongBreak[\s\S]*?@default\(4\)/);
  });

  it("stores task snapshots on timer sessions", () => {
    const text = schema();
    expect(text).toMatch(/model TimerSession \{[\s\S]*?taskTitleSnapshot/);
    expect(text).toMatch(/model TimerSession \{[\s\S]*?categorySnapshot/);
  });

  it("stores server-authoritative timer stamps", () => {
    const text = schema();
    const session = text.slice(text.indexOf("model TimerSession {"));
    for (const field of [
      "plannedDurationSeconds",
      "actualDurationSeconds",
      "startedAt",
      "expectedEndAt",
      "pausedAt",
      "accumulatedPauseSeconds",
      "completedAt",
      "cancelledAt",
    ]) {
      expect(session).toContain(field);
    }
  });

  it("enforces one active session per user via partial unique index", () => {
    const text = schema();
    expect(text).toMatch(/@@unique\(\[userId\][\s\S]*?where[\s\S]*?running[\s\S]*?paused/);
  });

  it("indexes sessions by (user_id, started_at) and tasks by (user_id, status, position)", () => {
    const text = schema();
    expect(text).toMatch(/model TimerSession \{[\s\S]*?@@index\(\[userId,\s*startedAt\]/);
    expect(text).toMatch(/model Task \{[\s\S]*?@@index\(\[userId,\s*status,\s*position\]/);
  });

  it("stores timestamps as timestamptz (UTC)", () => {
    const text = schema();
    expect(text).toMatch(/Timestamptz/);
  });
});
