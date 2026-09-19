/**
 * VPS backup retention (issue 19): `pg_dump` artifacts expire after
 * {@link BACKUP_RETENTION_DAYS} days. Pure selector so the shell wrapper
 * (`scripts/vps-backup.sh`) stays thin and the expiry rule is unit-covered.
 */
export const BACKUP_RETENTION_DAYS = 30;

export interface BackupFile {
  name: string;
  mtime: Date;
}

export function selectExpiredBackups(
  files: BackupFile[],
  now: Date,
  retentionDays: number,
): BackupFile[] {
  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return files.filter((file) => file.mtime.getTime() < cutoffMs);
}
