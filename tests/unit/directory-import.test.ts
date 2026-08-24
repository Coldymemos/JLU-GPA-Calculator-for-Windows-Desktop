import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import {
  parseSpreadsheet,
  runFileImportQueue,
  type FileImportReport,
  type ImportQueueOptions,
  type QueueFile
} from '../../src/application/directory-import';
import type { Course } from '../../src/domain/course/course.types';
import type { MergeResult } from '../../src/infrastructure/importers/import.types';
import { sniffSpreadsheetBuffer } from '../../src/infrastructure/importers/sniffer';

function xlsxBytes(rows: unknown[][], sheetName = '成绩'): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
}

const headerRows = [
  ['学年学期', '课程号', '课程名', '总成绩', '学分'],
  ['2025-2026-1', 'A001', '高数', 90, 3]
];

function makeOptions(overrides: Partial<ImportQueueOptions> = {}) {
  const files = new Map<string, Uint8Array>();
  const commit = vi.fn(async (courses: Course[], _mode?: string): Promise<MergeResult> => {
    void _mode;
    return {
      courses,
      addedCount: courses.length,
      replacedCount: 0,
      exactDuplicateCount: 0,
      restoredExclusionCount: 0
    };
  });
  const onFile = vi.fn();
  const options: ImportQueueOptions = {
    seenHashes: new Set<string>(),
    readBytes: vi.fn(async (path: string) => files.get(path) ?? new Uint8Array()),
    sha256: vi.fn(async (bytes: Uint8Array) => `hash-${bytes.byteLength}`),
    sniff: sniffSpreadsheetBuffer,
    parse: parseSpreadsheet,
    commit,
    onFile,
    ...overrides
  };
  return { files, commit, onFile, options };
}

const goodFile: QueueFile = {
  path: '/dir/成绩.xlsx',
  name: '成绩.xlsx',
  extension: 'xlsx',
  size: 100
};

describe('runFileImportQueue（M3 批量导入队列）', () => {
  it('串行导入单个文件并产出报告', async () => {
    const { files, commit, onFile, options } = makeOptions();
    files.set(goodFile.path, xlsxBytes(headerRows));

    const summary = await runFileImportQueue([{ file: goodFile }], options);

    expect(summary).toEqual({ imported: 1, skipped: 0, failed: 0, duplicate: 0 });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0][0].identity.code).toBe('A001');
    const report = onFile.mock.calls[0][0] as FileImportReport;
    expect(report.outcome).toBe('imported');
    expect(report.importedCount).toBe(1);
  });

  it('内容指纹相同的重复文件自动跳过，不影响其他文件', async () => {
    const { files, commit, onFile, options } = makeOptions();
    const bytes = xlsxBytes(headerRows);
    files.set('/dir/一.xlsx', bytes);
    files.set('/dir/二.xlsx', bytes);

    const summary = await runFileImportQueue(
      [
        { file: { ...goodFile, path: '/dir/一.xlsx', name: '一.xlsx' } },
        { file: { ...goodFile, path: '/dir/二.xlsx', name: '二.xlsx' } }
      ],
      options
    );

    expect(summary).toEqual({ imported: 1, skipped: 0, failed: 0, duplicate: 1 });
    expect(commit).toHaveBeenCalledTimes(1);
    const reports = onFile.mock.calls.map((call) => call[0] as FileImportReport);
    expect(reports[1].outcome).toBe('skipped-duplicate');
  });

  it('坏文件失败不中断其余文件', async () => {
    const { files, onFile, options } = makeOptions();
    const badFile: QueueFile = { path: '/dir/坏.txt', name: '坏.txt', extension: 'txt', size: 5 };
    files.set('/dir/成绩.xlsx', xlsxBytes(headerRows));
    files.set('/dir/坏.txt', new Uint8Array([1, 2, 3, 4, 5]));
    options.readBytes = vi.fn(async (path: string) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error('读取文件失败');
      return bytes;
    });

    const summary = await runFileImportQueue(
      [{ file: { ...goodFile, path: '/dir/成绩.xlsx', name: '成绩.xlsx' } }, { file: badFile }],
      options
    );

    expect(summary).toEqual({ imported: 1, skipped: 1, failed: 0, duplicate: 0 });
    const reports = onFile.mock.calls.map((call) => call[0] as FileImportReport);
    expect(reports[1].outcome).toBe('skipped');
    expect(reports[1].message).toContain('未识别为成绩表');
  });

  it('读取失败的文件单独计为失败', async () => {
    const { options, onFile } = makeOptions();
    options.readBytes = vi.fn(async () => {
      throw new Error('无法打开文件');
    });

    const summary = await runFileImportQueue([{ file: goodFile }], options);

    expect(summary).toEqual({ imported: 0, skipped: 0, failed: 1, duplicate: 0 });
    expect((onFile.mock.calls[0][0] as FileImportReport).message).toBe('无法打开文件');
  });

  it('多工作表文件产出待选工作表报告，选择工作表后重试成功', async () => {
    const { files, onFile, options } = makeOptions();
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(headerRows), '秋季');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(headerRows), '春季');
    files.set(
      goodFile.path,
      new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))
    );

    const first = await runFileImportQueue([{ file: goodFile }], options);
    expect(first).toEqual({ imported: 0, skipped: 1, failed: 0, duplicate: 0 });
    const report = onFile.mock.calls[0][0] as FileImportReport;
    expect(report.outcome).toBe('needs-sheet');
    expect(report.sheetNames).toEqual(['秋季', '春季']);

    onFile.mockClear();
    const retry = await runFileImportQueue([{ file: goodFile, sheet: '秋季' }], options);
    expect(retry).toEqual({ imported: 1, skipped: 0, failed: 0, duplicate: 0 });
  });

  it('提交失败记为失败且文件可重试（指纹仅成功后记录）', async () => {
    const { files, commit, options } = makeOptions();
    files.set(goodFile.path, xlsxBytes(headerRows));
    commit.mockRejectedValueOnce(new Error('数据库写入失败'));

    const first = await runFileImportQueue([{ file: goodFile }], options);
    expect(first).toEqual({ imported: 0, skipped: 0, failed: 1, duplicate: 0 });
    expect(options.seenHashes.size).toBe(0);

    const retry = await runFileImportQueue([{ file: goodFile }], options);
    expect(retry).toEqual({ imported: 1, skipped: 0, failed: 0, duplicate: 0 });
    expect(options.seenHashes.size).toBe(1);
  });

  it('M5 冲突处理：重复文件可按追加/覆盖模式绕过去重重新导入', async () => {
    const { files, commit, onFile, options } = makeOptions();
    const bytes = xlsxBytes(headerRows);
    files.set('/dir/一.xlsx', bytes);
    files.set('/dir/二.xlsx', bytes);
    const first = await runFileImportQueue(
      [
        { file: { ...goodFile, path: '/dir/一.xlsx', name: '一.xlsx' } },
        { file: { ...goodFile, path: '/dir/二.xlsx', name: '二.xlsx' } }
      ],
      options
    );
    expect(first).toEqual({ imported: 1, skipped: 0, failed: 0, duplicate: 1 });

    const replaced = await runFileImportQueue(
      [{ file: { ...goodFile, path: '/dir/二.xlsx', name: '二.xlsx' }, mode: 'replace' }],
      options
    );
    expect(replaced).toEqual({ imported: 1, skipped: 0, failed: 0, duplicate: 0 });
    expect(commit).toHaveBeenLastCalledWith(expect.any(Array), 'replace');

    const appended = await runFileImportQueue(
      [{ file: { ...goodFile, path: '/dir/二.xlsx', name: '二.xlsx' }, mode: 'append' }],
      options
    );
    expect(appended).toEqual({ imported: 1, skipped: 0, failed: 0, duplicate: 0 });
    expect(commit).toHaveBeenLastCalledWith(expect.any(Array), 'append');
    expect(onFile.mock.calls.at(-1)?.[0]).toMatchObject({ outcome: 'imported' });
  });
});
