//! 目录批量导入的队列编排（应用层）。
//!
//! 规则（对应 M3 验收口径）：
//! - 串行处理，单个文件失败不中断其余文件；
//! - 文件内容 SHA-256 指纹去重，重复文件自动跳过；
//! - 内容嗅探不依赖文件名；低置信度文件不进入队列，交由人工确认；
//! - 课程级去重沿用「同一课程号保留最高有效成绩」的现有合并逻辑（append 模式）。
import type { Course } from '../domain/course/course.types';
import type { ImportMergeMode, MergeResult } from '../infrastructure/importers/import.types';
import {
  SheetSelectionRequiredError,
  parseSpreadsheetBuffer
} from '../infrastructure/importers/sheetjs-importer';
import type { SniffResult } from '../infrastructure/importers/sniffer';

export interface QueueFile {
  path: string;
  name: string;
  extension: string;
  size: number;
  modified?: number;
}

export type FileOutcome = 'imported' | 'skipped-duplicate' | 'skipped' | 'needs-sheet' | 'failed';

export interface FileImportReport {
  path: string;
  name: string;
  outcome: FileOutcome;
  /** 本文件新增课程数（imported 时有效） */
  importedCount: number;
  /** 本文件被现有课程完全重复而跳过的记录数（imported 时有效） */
  duplicateCount: number;
  message?: string;
  sheetNames?: string[];
}

export type ParseOutcome =
  | { ok: true; courses: Course[]; importableCount: number; sheetNames: string[] }
  | { ok: false; needsSheet: true; sheetNames: string[] }
  | { ok: false; message: string };

export interface QueueSummary {
  imported: number;
  skipped: number;
  failed: number;
  duplicate: number;
}

export interface ImportFileSpec {
  file: QueueFile;
  sheet?: string;
  /**
   * M5 冲突处理：遇到内容重复文件时的策略。
   * 缺省（skip）→ 自动跳过；'append' → 忽略去重、按追加合并重新导入；'replace' → 忽略去重、按覆盖合并重新导入。
   */
  mode?: 'append' | 'replace';
}

export interface ImportQueueOptions {
  /** 会话内已导入的文件内容指纹（跨批次去重） */
  seenHashes: Set<string>;
  readBytes: (path: string) => Promise<Uint8Array>;
  sha256: (bytes: Uint8Array) => Promise<string>;
  sniff: (bytes: Uint8Array, name: string) => SniffResult | Promise<SniffResult>;
  parse: (bytes: Uint8Array, name: string, sheet?: string) => Promise<ParseOutcome>;
  commit: (courses: Course[], mode: ImportMergeMode) => Promise<MergeResult>;
  onFile: (report: FileImportReport) => void;
}

/** 用 Web Crypto 计算字节的 SHA-256 十六进制指纹（与 Rust file_sha256 同算法同结果）。 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 默认解析适配器：复用 SheetJS 解析链路，把异常规范化为 ParseOutcome。 */
export async function parseSpreadsheet(
  bytes: Uint8Array,
  name: string,
  sheet?: string
): Promise<ParseOutcome> {
  try {
    const preview = parseSpreadsheetBuffer(bytes, name, sheet);
    return {
      ok: true,
      courses: preview.courses,
      importableCount: preview.importableCount,
      sheetNames: preview.sheetNames
    };
  } catch (error) {
    if (error instanceof SheetSelectionRequiredError && Array.isArray(error.sheetNames)) {
      return { ok: false, needsSheet: true, sheetNames: error.sheetNames };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : '无法解析成绩表'
    };
  }
}

const mergeMode: ImportMergeMode = 'append';

/**
 * 串行执行导入队列。每个文件：读字节 → 指纹去重（可按文件覆盖/追加绕过）→ 内容嗅探 → 解析 → 合并入库，
 * 逐文件产出报告；任一环节失败只影响该文件。
 */
export async function runFileImportQueue(
  specs: ImportFileSpec[],
  options: ImportQueueOptions
): Promise<QueueSummary> {
  const summary: QueueSummary = { imported: 0, skipped: 0, failed: 0, duplicate: 0 };
  for (const spec of specs) {
    const base = {
      path: spec.file.path,
      name: spec.file.name,
      importedCount: 0,
      duplicateCount: 0
    };
    let bytes: Uint8Array;
    try {
      bytes = await options.readBytes(spec.file.path);
    } catch (error) {
      summary.failed += 1;
      options.onFile({
        ...base,
        outcome: 'failed',
        message: error instanceof Error ? error.message : '读取文件失败'
      });
      continue;
    }

    try {
      const hash = await options.sha256(bytes);
      // M5 冲突处理：默认对内容重复文件自动跳过；spec.mode 为 append/replace 时绕过去重重新导入
      if (options.seenHashes.has(hash) && !spec.mode) {
        summary.duplicate += 1;
        options.onFile({
          ...base,
          outcome: 'skipped-duplicate',
          message: '文件内容与本次已导入文件重复，自动跳过'
        });
        continue;
      }

      const sniff = await options.sniff(bytes, spec.file.name);
      if (sniff.verdict === 'not-a-grade-sheet') {
        summary.skipped += 1;
        options.onFile({
          ...base,
          outcome: 'skipped',
          message: `未识别为成绩表（格式 ${sniff.format}，无匹配表头）`
        });
        continue;
      }
      if (sniff.verdict === 'needs-confirmation') {
        summary.skipped += 1;
        options.onFile({
          ...base,
          outcome: 'skipped',
          message: '表头置信度低，需人工确认后单独导入'
        });
        continue;
      }

      const parsed = await options.parse(bytes, spec.file.name, spec.sheet);
      if (!parsed.ok) {
        if ('needsSheet' in parsed) {
          summary.skipped += 1;
          options.onFile({
            ...base,
            outcome: 'needs-sheet',
            sheetNames: parsed.sheetNames,
            message: '工作簿包含多个工作表，请选择工作表后重试'
          });
          continue;
        }
        summary.failed += 1;
        options.onFile({ ...base, outcome: 'failed', message: parsed.message });
        continue;
      }
      if (parsed.importableCount === 0) {
        summary.failed += 1;
        options.onFile({ ...base, outcome: 'failed', message: '没有可导入的课程行' });
        continue;
      }

      const result = await options.commit(parsed.courses, spec.mode ?? mergeMode);
      // 成功入库后才记录指纹，保证失败/待选工作表的文件可重试
      options.seenHashes.add(hash);
      summary.imported += 1;
      options.onFile({
        ...base,
        outcome: 'imported',
        importedCount: result.addedCount,
        duplicateCount: result.exactDuplicateCount,
        message: `新增 ${result.addedCount} 门，跳过完全重复 ${result.exactDuplicateCount} 门`
      });
    } catch (error) {
      summary.failed += 1;
      options.onFile({
        ...base,
        outcome: 'failed',
        message: error instanceof Error ? error.message : '导入失败'
      });
    }
  }
  return summary;
}

export { mergeMode };
