import { describe, expect, it } from 'vitest';
import {
  buildAutoBackupFileName,
  defaultAutoBackupSettings,
  shouldRunAutoBackup
} from '../../src/application/auto-backup';

const settings = { ...defaultAutoBackupSettings(), enabled: true, directory: 'D:\\备份' };

describe('auto-backup（M5 定时备份判定）', () => {
  it('未启用或未选目录时不触发', () => {
    expect(shouldRunAutoBackup({ ...settings, enabled: false }, undefined)).toBe(false);
    expect(shouldRunAutoBackup({ ...settings, directory: '' }, undefined)).toBe(false);
  });

  it('从未备份过则立即触发', () => {
    expect(shouldRunAutoBackup(settings, undefined)).toBe(true);
  });

  it('每日频率：同一天不触发，跨天触发', () => {
    const today = new Date().toISOString();
    expect(shouldRunAutoBackup(settings, today)).toBe(false);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(shouldRunAutoBackup(settings, yesterday)).toBe(true);
  });

  it('每周频率：不足 7 天不触发，满 7 天触发', () => {
    const weekly = { ...settings, frequency: 'weekly' as const };
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldRunAutoBackup(weekly, threeDaysAgo)).toBe(false);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(shouldRunAutoBackup(weekly, sevenDaysAgo)).toBe(true);
  });

  it('备份时间无效时按首次处理', () => {
    expect(shouldRunAutoBackup(settings, 'not-a-date')).toBe(true);
  });

  it('备份文件名包含日期且符合清理前缀', () => {
    const name = buildAutoBackupFileName(new Date('2026-08-23T10:00:00Z'));
    expect(name).toBe('JLU-GPA-备份-2026-08-23.sqlite3');
  });
});
