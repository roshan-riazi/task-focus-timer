import { describe, expect, it } from "vitest";
import { BACKUP_RETENTION_DAYS, selectExpiredBackups } from "./backup-retention";
import type { BackupFile } from "./backup-retention";

function file(name: string, mtimeIso: string): BackupFile {
  return { name, mtime: new Date(mtimeIso) };
}

describe("selectExpiredBackups (VPS pg_dump 30-day expiry)", () => {
  const now = new Date("2026-09-19T00:00:00.000Z");

  it("keeps the retention window at 30 days", () => {
    expect(BACKUP_RETENTION_DAYS).toBe(30);
  });

  it("expires backups strictly older than the retention window", () => {
    const files = [
      file("focusflow-2026-08-20.sql.gz", "2026-08-20T00:00:00.000Z"),
      file("focusflow-2026-08-19.sql.gz", "2026-08-19T00:00:00.000Z"),
    ];
    const expired = selectExpiredBackups(files, now, BACKUP_RETENTION_DAYS);
    expect(expired.map((f) => f.name)).toEqual([
      "focusflow-2026-08-19.sql.gz",
    ]);
  });

  it("keeps recent backups and returns them in input order", () => {
    const files = [
      file("focusflow-2026-09-18.sql.gz", "2026-09-18T12:00:00.000Z"),
      file("focusflow-2026-09-01.sql.gz", "2026-09-01T00:00:00.000Z"),
    ];
    expect(selectExpiredBackups(files, now, BACKUP_RETENTION_DAYS)).toEqual(
      [],
    );
  });

  it("expires nothing when the backup directory is empty", () => {
    expect(selectExpiredBackups([], now, BACKUP_RETENTION_DAYS)).toEqual([]);
  });
});
