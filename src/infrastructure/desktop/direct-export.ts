//! M5 导出直写路径：桌面端把导出文件直接写入用户指定目录并记忆上次路径；
//! Web 端保持浏览器下载。两个入口共用同一套导出 payload。
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { ExportPayload } from '../exporters/course-workbook-exporter';

export const LAST_EXPORT_DIRECTORY_SETTING = 'last-export-directory';

export type { ExportPayload };

/** 让用户选择导出目录；取消时返回 undefined。 */
export async function pickExportDirectory(): Promise<string | undefined> {
  const path = await open({
    title: '选择导出目录',
    directory: true,
    multiple: false
  });
  return typeof path === 'string' ? path : undefined;
}

/** 桌面端：将导出 payload 直写到目录（自动创建父目录）。 */
export async function writeExportFile(directory: string, payload: ExportPayload): Promise<string> {
  const fullPath = `${directory.replace(/[\\/]+$/, '')}\\${payload.fileName}`;
  await invoke('fs_write_bytes', { path: fullPath, bytes: Array.from(payload.bytes) });
  return fullPath;
}

/** Web 端：浏览器下载导出文件。 */
export function downloadExport(payload: ExportPayload): void {
  const { buffer, byteOffset, byteLength } = payload.bytes;
  const blob = new Blob([buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = payload.fileName;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}
