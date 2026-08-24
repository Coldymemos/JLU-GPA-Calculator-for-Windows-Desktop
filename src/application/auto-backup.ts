//! M5 定时备份：设置模型与调度判定（纯逻辑，可单测）。
//! 实际执行（db_backup / backup_prune）在 desktop-backup.ts 的 tauri 封装中。

export type AutoBackupFrequency = 'daily' | 'weekly';

export interface AutoBackupSettings {
  enabled: boolean;
  frequency: AutoBackupFrequency;
  /** 备份目录内保留的备份份数上限 */
  keep: number;
  /** 备份目录（用户显式选择） */
  directory: string;
}

export const AUTO_BACKUP_SETTING_KEY = 'auto-backup-settings';
export const AUTO_BACKUP_LAST_RUN_KEY = 'auto-backup-last-run';

export function defaultAutoBackupSettings(): AutoBackupSettings {
  return { enabled: false, frequency: 'daily', keep: 7, directory: '' };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 依据上次备份时间判断本次是否应触发备份。 */
export function shouldRunAutoBackup(settings: AutoBackupSettings, lastBackupAt?: string): boolean {
  if (!settings.enabled || !settings.directory.trim()) return false;
  if (!lastBackupAt) return true;
  const last = new Date(lastBackupAt).getTime();
  if (!Number.isFinite(last)) return true;
  const now = Date.now();
  if (settings.frequency === 'daily') {
    return new Date(now).toDateString() !== new Date(last).toDateString();
  }
  return now - last >= 7 * DAY_MS;
}

/** 生成自动备份文件名（与 Rust prune_backups 的前缀约定一致）。 */
export function buildAutoBackupFileName(now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return `JLU-GPA-备份-${date}.sqlite3`;
}
