import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationsDir = join(__dirname, "migrations");

function migrationSql(): string {
  const entries = readdirSync(migrationsDir, { withFileTypes: true });
  const sqlFiles = entries
    .filter((e) => e.isDirectory())
    .map((d) => join(migrationsDir, d.name, "migration.sql"))
    .map((p) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  return sqlFiles.join("\n");
}

describe("prisma migration SQL", () => {
  it("exists and creates all five tables", () => {
    const sql = migrationSql();
    expect(sql.length).toBeGreaterThan(0);
    for (const table of [
      '"users"',
      '"user_settings"',
      '"tasks"',
      '"timer_sessions"',
      '"focus_cycle_state"',
    ]) {
      expect(sql).toContain(table);
    }
  });

  it("creates a partial unique index for one active session per user", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*?timer_sessions[\s\S]*?WHERE[\s\S]*?running[\s\S]*?paused/i);
  });

  it("creates (user_id, started_at) and (user_id, status, position) indexes", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/\(\s*"user_id"\s*,\s*"started_at"\s*\)/);
    expect(sql).toMatch(/\(\s*"user_id"\s*,\s*"status"\s*,\s*"position"\s*\)/);
  });

  it("protects duration ranges with CHECK constraints", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/CHECK[\s\S]*?sound_volume/i);
    expect(sql).toMatch(/CHECK[\s\S]*?focus_duration_seconds/i);
    expect(sql).toMatch(/CHECK[\s\S]*?planned_duration_seconds/i);
  });

  it("protects timer state coherence with CHECK constraints", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/CHECK[\s\S]*?expected_end_at/i);
    expect(sql).toMatch(/CHECK[\s\S]*?completed_at[\s\S]*?cancelled_at/i);
  });

  it("stores timestamps as timestamptz", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/TIMESTAMPTZ/i);
  });

  it("creates Auth.js adapter tables for DB sessions (issue 04)", () => {
    const sql = migrationSql();
    for (const table of [
      '"accounts"',
      '"auth_sessions"',
      '"auth_verification_tokens"',
      '"email_verification_tokens"',
      '"password_reset_tokens"',
    ]) {
      expect(sql).toContain(table);
    }
  });

  it("enforces normalized emails at the DB level (issue 04, spec §8.1)", () => {
    const sql = migrationSql();
    expect(sql).toMatch(/CHECK[\s\S]*?"email"[\s\S]*?LOWER\("email"\)/i);
  });
});
