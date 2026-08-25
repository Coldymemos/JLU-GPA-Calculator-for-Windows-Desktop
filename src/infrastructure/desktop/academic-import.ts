//! 桌面端教务系统导入桥接：打开 Rust WebView，并接收其捕获的导出文件。
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export const ACADEMIC_DOWNLOAD_FINISHED_EVENT = 'academic-import-download-finished';

export interface AcademicDownloadPayload {
  path: string;
  name: string;
}

export function openAcademicImportWindow(): Promise<void> {
  return invoke('open_academic_import_window');
}

export async function readAcademicImportFile(path: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('read_file_bytes', { path });
  return Uint8Array.from(bytes);
}

export function onAcademicImportFile(
  handler: (payload: AcademicDownloadPayload) => void
): Promise<UnlistenFn> {
  return listen<AcademicDownloadPayload>(ACADEMIC_DOWNLOAD_FINISHED_EVENT, (event) => {
    handler(event.payload);
  });
}

export function removeAcademicImportFile(path: string): Promise<void> {
  return invoke('remove_academic_import_file', { path });
}
