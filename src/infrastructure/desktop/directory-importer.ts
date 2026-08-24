//! 桌面端目录批量导入的 tauri 客户端封装。
//! 仅在 Tauri 运行时使用；Web 构建不会导入本模块（入口在 App.tsx 按 isDesktopRuntime 渲染）。
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type { SniffResult } from '../importers/sniffer';
import { sniffSpreadsheetBuffer } from '../importers/sniffer';

export interface CandidateFile {
  path: string;
  name: string;
  extension: string;
  size: number;
  modified?: number;
}

export const WATCH_NEW_FILE_EVENT = 'directory-watch-new-file';

export { sniffSpreadsheetBuffer };
export type { SniffResult };

/** 让用户在系统目录选择器中选择成绩表目录；取消时返回 undefined。 */
export async function pickImportDirectory(): Promise<string | undefined> {
  const path = await open({
    title: '选择成绩表目录',
    directory: true,
    multiple: false
  });
  return typeof path === 'string' ? path : undefined;
}

/** 扫描目录（可选递归）内的候选成绩文件，仅按扩展名过滤。 */
export function scanDirectory(dir: string, recursive: boolean): Promise<CandidateFile[]> {
  return invoke<CandidateFile[]>('scan_directory', { dir, recursive });
}

/** 计算文件 SHA-256 指纹（Rust 分块计算）。 */
export function fileSha256(path: string): Promise<string> {
  return invoke<string>('file_sha256', { path });
}

/** 读取文件全部字节（上限 10 MB）。 */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('read_file_bytes', { path });
  return Uint8Array.from(bytes);
}

/** 读取文件字节并做内容嗅探（格式/表头/置信度，不依赖文件名）。 */
export async function sniffFile(path: string, name: string): Promise<SniffResult> {
  return sniffSpreadsheetBuffer(await readFileBytes(path), name);
}

/** 启用/停用目录监听（M5.1：新文件自动进队）。 */
export function setDirectoryWatch(dir: string, enabled: boolean): Promise<void> {
  return invoke('watch_directory', { dir, enabled });
}

/** 订阅新文件事件，返回取消订阅函数。 */
export function onNewFileInDirectory(handler: (path: string) => void): Promise<UnlistenFn> {
  return listen<string>(WATCH_NEW_FILE_EVENT, (event) => handler(event.payload));
}
