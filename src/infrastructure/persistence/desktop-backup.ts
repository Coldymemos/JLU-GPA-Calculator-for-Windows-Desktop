import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

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
