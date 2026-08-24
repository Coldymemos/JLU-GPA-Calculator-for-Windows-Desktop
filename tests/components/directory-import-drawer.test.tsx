import { App } from 'antd';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course } from '../../src/domain/course/course.types';
import type { MergeResult } from '../../src/infrastructure/importers/import.types';
import {
  pickImportDirectory,
  readFileBytes,
  scanDirectory
} from '../../src/infrastructure/desktop/directory-importer';
import { database } from '../../src/infrastructure/persistence';
import { DirectoryImportDrawer } from '../../src/ui/components/DirectoryImportDrawer';

vi.mock('../../src/infrastructure/desktop/directory-importer', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../src/infrastructure/desktop/directory-importer')>();
  return {
    ...original,
    pickImportDirectory: vi.fn(),
    scanDirectory: vi.fn(),
    readFileBytes: vi.fn()
  };
});

vi.mock('../../src/application/directory-import', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/application/directory-import')>();
  return {
    ...original,
    sha256Hex: vi.fn().mockResolvedValue('fixed-hash')
  };
});

vi.mock('../../src/infrastructure/persistence', () => ({
  database: {
    loadSetting: vi.fn(),
    saveSetting: vi.fn()
  }
}));

const headerRows = [
  ['学年学期', '课程号', '课程名', '总成绩', '学分'],
  ['2025-2026-1', 'A001', '高等数学', 90, 3]
];

function xlsxBytes(rows: unknown[][]): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '成绩');
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }));
}

const commit = vi.fn(async (courses: Course[]): Promise<MergeResult> => ({
  courses,
  addedCount: courses.length,
  replacedCount: 0,
  exactDuplicateCount: 0,
  restoredExclusionCount: 0
}));

function renderDrawer() {
  render(
    <App>
      <DirectoryImportDrawer open onCancel={vi.fn()} onCommit={commit} />
    </App>
  );
}

describe('DirectoryImportDrawer（M3 目录批量导入 UI）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commit.mockResolvedValue({
      courses: [],
      addedCount: 1,
      replacedCount: 0,
      exactDuplicateCount: 0,
      restoredExclusionCount: 0
    });
    vi.mocked(database.loadSetting).mockResolvedValue(undefined);
    vi.mocked(database.saveSetting).mockResolvedValue(undefined);
  });

  it('选择目录后扫描、嗅探并批量导入全部候选文件', async () => {
    const bytes = xlsxBytes(headerRows);
    vi.mocked(pickImportDirectory).mockResolvedValue('C:\\成绩目录');
    vi.mocked(scanDirectory).mockResolvedValue([
      { path: 'C:\\成绩目录\\成绩.xlsx', name: '成绩.xlsx', extension: 'xlsx', size: bytes.length }
    ]);
    vi.mocked(readFileBytes).mockResolvedValue(bytes);
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: /选择目录/ }));
    await screen.findByText('成绩.xlsx');
    await waitFor(() => expect(screen.getByRole('button', { name: /导入全部/ })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: /导入全部/ }));

    await waitFor(() => expect(commit).toHaveBeenCalled());
    expect(commit.mock.calls[0][0][0].identity.code).toBe('A001');
    expect(vi.mocked(database.saveSetting)).toHaveBeenCalledWith(
      'last-import-directory',
      'C:\\成绩目录'
    );
    await screen.findByText('已导入');
    await screen.findByText(/本次导入：成功 1 个文件/);
  });

  it('恢复上次目录并自动扫描', async () => {
    const bytes = xlsxBytes(headerRows);
    vi.mocked(database.loadSetting).mockResolvedValue('C:\\上次目录');
    vi.mocked(scanDirectory).mockResolvedValue([
      { path: 'C:\\上次目录\\高数.xlsx', name: '高数.xlsx', extension: 'xlsx', size: bytes.length }
    ]);
    vi.mocked(readFileBytes).mockResolvedValue(bytes);
    renderDrawer();

    await screen.findByText('高数.xlsx');
    expect(scanDirectory).toHaveBeenCalledWith('C:\\上次目录', true);
  });
});
