import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { buildAutoBackupFileName, type AutoBackupSettings } from '../../application/auto-backup';

export interface BackupReport {
  path: string;
  checksum: string;
  dryRun: boolean;
}

export const isDesktopRuntime = isTauri();

export async function backupDesktopDatabase(): Promise<BackupReport | undefined> {
  const path = await save({
    title: '备份 JLU GPA 数据库',
    defaultPath: `JLU-GPA-备份-${new Date().toISOString().slice(0, 10)}.sqlite3`,
    filters: [{ name: 'SQLite 数据库', extensions: ['sqlite3'] }]
  });
  return path ? invoke<BackupReport>('db_backup', { path }) : undefined;
}

export async function selectDesktopBackup(): Promise<string | undefined> {
  const path = await open({
    title: '选择 JLU GPA 数据库备份',
    multiple: false,
    directory: false,
    filters: [{ name: 'SQLite 数据库', extensions: ['sqlite3'] }]
  });
  return typeof path === 'string' ? path : undefined;
}

export function validateDesktopBackup(path: string): Promise<BackupReport> {
  return invoke<BackupReport>('db_restore', { path, dryRun: true });
}

export function restoreDesktopDatabase(path: string): Promise<BackupReport> {
  return invoke<BackupReport>('db_restore', { path, dryRun: false });
}

/** 选择自动备份目录（M5 定时备份）。 */
export async function pickBackupDirectory(): Promise<string | undefined> {
  const path = await open({
    title: '选择自动备份目录',
    directory: true,
    multiple: false
  });
  return typeof path === 'string' ? path : undefined;
}

/** 执行一次自动备份：写入带日期的备份文件，然后按保留份数清理旧备份。 */
export async function runAutoBackup(settings: AutoBackupSettings): Promise<string> {
  const fullPath = `${settings.directory.replace(/[\\/]+$/, '')}\\${buildAutoBackupFileName()}`;
  const report = await invoke<BackupReport>('db_backup', { path: fullPath });
  await invoke<string[]>('backup_prune', {
    dir: settings.directory,
    keep: Math.max(settings.keep, 1)
  }).catch(() => []);
  return report.path;
}
