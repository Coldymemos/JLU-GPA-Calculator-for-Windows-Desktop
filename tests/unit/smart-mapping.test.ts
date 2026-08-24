import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseSpreadsheetBuffer } from '../../src/infrastructure/importers/sheetjs-importer';
import { sniffSpreadsheetBuffer } from '../../src/infrastructure/importers/sniffer';

function buffer(rows: unknown[][]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '成绩');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
}

describe('表头智能映射（M4.1）', () => {
  it('清洗管道作用于导入数据：去括号批注与单位后缀', () => {
    const preview = parseSpreadsheetBuffer(
      buffer([
        ['学年学期', '课程号', '课程名', '总成绩', '学分'],
        ['2025-2026-1', 'A001', '高等数学', '90(重修)', '3分']
      ]),
      '成绩.xlsx'
    );
    expect(preview.importableCount).toBe(1);
    const course = preview.courses[0];
    expect(course.achievement.grade).toEqual({ kind: 'percentage', raw: 90 });
    expect(course.achievement.credit).toBe(3);
  });

  it('同义词扩展：课程代码/最终成绩/绩点学分均可识别', () => {
    const preview = parseSpreadsheetBuffer(
      buffer([
        ['学年学期', '课程代码', '课程名称', '最终成绩', '绩点学分'],
        ['2025-2026-1', 'A001', '大学英语', 92, 2.5]
      ]),
      '成绩.xlsx'
    );
    expect(preview.importableCount).toBe(1);
    expect(preview.courses[0].identity.code).toBe('A001');
    expect(preview.courses[0].achievement.credit).toBe(2.5);
  });

  it('包含式表头（含必填标记）可自动映射', () => {
    const preview = parseSpreadsheetBuffer(
      buffer([
        ['学期', '课程号（必填）', '课程名', '总成绩', '学分'],
        ['1', 'A001', '线性代数', 88, 3]
      ]),
      '成绩.xlsx'
    );
    expect(preview.headerMapping.courseCode).toBe('课程号（必填）');
    expect(preview.importableCount).toBe(1);
  });

  it('异体字/繁体表头不自动映射（低置信度交给人工确认）', () => {
    // “课程編号”与同义词“课程编号”仅差 1 个字符，为避免误报不自动映射
    const preview = parseSpreadsheetBuffer(
      buffer([
        ['学期', '课程編号', '课程名', '分数', '学分'],
        ['1', 'A001', '线性代数', 88, 3]
      ]),
      '成绩.xlsx'
    );
    expect(preview.importableCount).toBe(0);
    expect(preview.availableColumns).toContain('课程編号');
    expect(preview.headerMapping.courseCode).toBeUndefined();
  });

  it('缺少必要字段时暴露列清单并支持手动映射覆盖', () => {
    const data = buffer([
      ['课程代码', '课程名称', '分数', '备注'],
      ['A001', '高等数学', 90, 3]
    ]);
    const withoutCredit = parseSpreadsheetBuffer(data, '成绩.xlsx');
    expect(withoutCredit.importableCount).toBe(0);
    expect(withoutCredit.availableColumns).toEqual(['课程代码', '课程名称', '分数', '备注']);
    expect(withoutCredit.headerMapping.credit).toBeUndefined();

    const withOverride = parseSpreadsheetBuffer(data, '成绩.xlsx', undefined, {
      credit: '备注'
    });
    expect(withOverride.importableCount).toBe(1);
    expect(withOverride.courses[0].achievement.credit).toBe(3);
  });

  it('嗅探与解析共享同义词口径（含清洗后的成绩）', () => {
    const bytes = new Uint8Array(
      new TextEncoder().encode('课程号,课程名,总成绩,学分\nA001,高数,90(重修),3')
    );
    const sniff = sniffSpreadsheetBuffer(bytes, '成绩.csv');
    expect(sniff.verdict).toBe('importable');
    const preview = parseSpreadsheetBuffer(bytes, '成绩.csv');
    expect(preview.courses[0].achievement.grade.raw).toBe(90);
  });
});
