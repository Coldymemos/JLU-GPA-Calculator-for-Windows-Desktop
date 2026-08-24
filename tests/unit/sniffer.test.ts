import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { sniffSpreadsheetBuffer } from '../../src/infrastructure/importers/sniffer';

/** "课程号,课程名,总成绩,学分" 的 GBK 字节（经 TextDecoder('gb18030') 校验） */
const GBK_HEADER = Uint8Array.from([
  0xbf, 0xce, 0xb3, 0xcc, 0xba, 0xc5, 0x2c, 0xbf, 0xce, 0xb3, 0xcc, 0xc3, 0xfb, 0x2c, 0xd7, 0xdc,
  0xb3, 0xc9, 0xbc, 0xa8, 0x2c, 0xd1, 0xa7, 0xb7, 0xd6
]);

function buildXlsx(rows: unknown[][], sheetName = '成绩'): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
}

describe('sniffSpreadsheetBuffer（内容嗅探，不依赖文件名）', () => {
  it('通过魔数识别 xlsx 并匹配吉林大学常见表头', () => {
    const buffer = buildXlsx([
      ['学年学期', '课程号', '课程名', '总成绩', '学分'],
      ['2025-2026-1', 'A001', '高等数学', 90, 3]
    ]);
    const result = sniffSpreadsheetBuffer(buffer, '乱码文件名.bin');
    expect(result.format).toBe('xlsx');
    expect(result.sheetNames).toEqual(['成绩']);
    expect(result.header).toContain('课程号');
    expect(result.matchedFields).toEqual(
      expect.arrayContaining(['courseCode', 'courseName', 'rawGrade', 'credit'])
    );
    expect(result.confidence).toBe(1);
    expect(result.verdict).toBe('importable');
  });

  it('识别 UTF-8 CSV 的吉林大学表头', () => {
    const bytes = new TextEncoder().encode('课程号,课程名,总成绩,学分\nA001,高数,90,3');
    const result = sniffSpreadsheetBuffer(bytes, '成绩.csv');
    expect(result.format).toBe('csv');
    expect(result.encoding).toBe('utf-8');
    expect(result.verdict).toBe('importable');
    expect(result.sampleRows[0]).toEqual(['A001', '高数', '90', '3']);
  });

  it('识别 GBK 编码的 CSV（教务常见导出编码）', () => {
    const bytes = new Uint8Array([...GBK_HEADER, ...new TextEncoder().encode('\nA001,高数,90,3')]);
    const result = sniffSpreadsheetBuffer(bytes, '成绩.csv');
    expect(result.format).toBe('csv');
    expect(result.encoding).toBe('gb18030');
    expect(result.verdict).toBe('importable');
  });

  it('部分匹配表头时判为需确认', () => {
    const bytes = new TextEncoder().encode('姓名,科目,分数,学分\n张三,数学,85,2');
    const result = sniffSpreadsheetBuffer(bytes, 'generic.csv');
    expect(result.format).toBe('csv');
    expect(result.verdict).toBe('needs-confirmation');
    expect(result.confidence).toBeLessThan(1);
  });

  it('二进制垃圾内容判为非成绩表且不抛异常', () => {
    const junk = new Uint8Array(256).map((_, index) => (index % 7 === 0 ? 0 : index % 251));
    const result = sniffSpreadsheetBuffer(junk, '未知.bin');
    expect(result.format).toBe('unknown');
    expect(result.verdict).toBe('not-a-grade-sheet');
  });

  it('魔数匹配但内容损坏时按无法识别处理', () => {
    const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]);
    const result = sniffSpreadsheetBuffer(corrupt, '假xlsx.xlsx');
    expect(result.format).toBe('xlsx');
    expect(result.verdict).toBe('not-a-grade-sheet');
  });

  it('多工作表 xlsx 返回全部工作表名', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['课程号', '课程名']]), '表一');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['课程号', '课程名']]), '表二');
    const result = sniffSpreadsheetBuffer(
      XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }),
      'multi.xlsx'
    );
    expect(result.sheetNames).toEqual(['表一', '表二']);
  });
});
