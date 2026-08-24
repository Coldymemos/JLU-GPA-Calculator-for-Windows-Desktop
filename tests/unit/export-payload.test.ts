import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  adaptedCourseHeaders,
  exportAdaptedCourseWorkbook
} from '../../src/infrastructure/exporters/course-workbook-exporter';
import { dataUrlToBytes } from '../../src/infrastructure/exporters/result-exporter';
import { makeCourse } from './test-course';

describe('导出 payload（M5 导出直写的数据基础）', () => {
  it('适配表格返回可重新读取的 xlsx 字节', async () => {
    const payload = await exportAdaptedCourseWorkbook([makeCourse('1', 90, 3)], []);
    expect(payload.fileName).toMatch(/^JLU-GPA-适配课程-.*\.xlsx$/);
    expect(payload.bytes.length).toBeGreaterThan(100);

    const workbook = XLSX.read(payload.bytes, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
    expect(rows[0]).toEqual([...adaptedCourseHeaders]);
  });

  it('没有课程时拒绝导出', async () => {
    await expect(exportAdaptedCourseWorkbook([], [])).rejects.toThrow('没有可导出的课程');
  });

  it('dataUrlToBytes 将 base64 dataURL 还原为字节', () => {
    const dataUrl = 'data:image/png;base64,AAECAwQ=';
    expect(Array.from(dataUrlToBytes(dataUrl))).toEqual([0, 1, 2, 3, 4]);
  });
});
