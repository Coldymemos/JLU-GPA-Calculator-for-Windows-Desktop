//! 内容嗅探：不依赖文件名，仅依据文件内容判断格式、表头类型与置信度。
//!
//! 设计要点（对应《本地化功能规划.md》「文件名不可靠原则」）：
//! - 扩展名不作为解析依据，格式通过魔数（magic bytes）判断；
//! - 表头匹配复用 `sheetjs-importer` 的同义表头表，保证嗅探口径与真实解析一致；
//! - 低置信度返回 `needs-confirmation`，由前端人工确认，绝不静默导入。
import * as XLSX from 'xlsx';
import { normalizeText } from '../../domain/course/course.normalizer';
import type { ImportField } from './import.types';
import { requiredFields } from './import.types';
import { fieldAliases } from './sheetjs-importer';

export type SpreadsheetFormat = 'xlsx' | 'xls' | 'csv' | 'unknown';

export type CsvEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030';

export type SniffVerdict = 'importable' | 'needs-confirmation' | 'not-a-grade-sheet';

export interface SniffResult {
  fileName: string;
  format: SpreadsheetFormat;
  encoding?: CsvEncoding;
  sheetNames: string[];
  /** 表头行（已去除空白单元格） */
  header: string[];
  /** 前若干行数据样例，用于人工确认界面 */
  sampleRows: string[][];
  /** 命中的导入字段（同义表头匹配） */
  matchedFields: ImportField[];
  /** 0..1；必需字段（课程号/课程名/成绩/学分）命中比例 */
  confidence: number;
  verdict: SniffVerdict;
}

function detectFormat(bytes: Uint8Array): SpreadsheetFormat {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  ) {
    return 'xlsx';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  ) {
    return 'xls';
  }
  // 其余按文本候选处理；用 NUL/0xFF 与控制字符比例判断二进制。
  // 注意：不能用「非 ASCII 即二进制」——GBK/GB18030 编码的 CSV 首字节多为 0x80~0xFE。
  const sampleLength = Math.min(bytes.length, 4096);
  let nullOrHigh = 0;
  let control = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    const value = bytes[index];
    if (value === 0x00 || value === 0xff) {
      nullOrHigh += 1;
    } else if (value < 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0d) {
      control += 1;
    }
  }
  const ratio = (nullOrHigh + control) / sampleLength;
  if (sampleLength > 0 && ratio > 0.05) return 'unknown';
  return 'csv';
}

function decodeCsv(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    // 教务导出常见 GBK/GB18030，作为 UTF-8 严格解码失败的兜底
    return { text: new TextDecoder('gb18030').decode(bytes), encoding: 'gb18030' };
  }
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function detectDelimiter(firstLine: string): string {
  let best = ',';
  let bestCount = 0;
  for (const delimiter of [',', '\t', ';']) {
    let count = 0;
    for (const char of firstLine) {
      if (char === delimiter) count += 1;
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

function matchHeader(headers: string[]): { matchedFields: ImportField[] } {
  const normalized = headers.map((header) => normalizeText(header));
  const matchedFields: ImportField[] = [];
  for (const [field, aliases] of Object.entries(fieldAliases) as [ImportField, string[]][]) {
    if (aliases.some((alias) => normalized.includes(normalizeText(alias)))) {
      matchedFields.push(field);
    }
  }
  return { matchedFields };
}

function buildResult(
  fileName: string,
  format: SpreadsheetFormat,
  header: string[],
  sampleRows: string[][],
  sheetNames: string[],
  matchedFields: ImportField[],
  encoding?: CsvEncoding
): SniffResult {
  const matchedRequired = matchedFields.filter((field) => requiredFields.includes(field)).length;
  const confidence = requiredFields.length === 0 ? 0 : matchedRequired / requiredFields.length;
  const verdict: SniffVerdict =
    format === 'unknown' || confidence === 0
      ? 'not-a-grade-sheet'
      : confidence >= 1
        ? 'importable'
        : 'needs-confirmation';
  return {
    fileName,
    format,
    encoding,
    sheetNames,
    header,
    sampleRows,
    matchedFields,
    confidence,
    verdict
  };
}

/** 嗅探 xls / xlsx：用 SheetJS 读取首个非空工作表的前几行 */
function sniffWorkbook(bytes: Uint8Array, fileName: string, format: 'xls' | 'xlsx'): SniffResult {
  const workbook = XLSX.read(bytes, { type: 'array' });
  const sheetNames = workbook.SheetNames;
  const sheetName = sheetNames[0];
  if (!sheetName) {
    return buildResult(fileName, format, [], [], [], [], undefined);
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    blankrows: false
  });
  const header = (rows[0] ?? [])
    .map((cell) => normalizeText(cell))
    .filter((cell) => cell.length > 0);
  const sampleRows = rows.slice(1, 5).map((row) => row.map((cell) => normalizeText(cell)));
  const { matchedFields } = matchHeader(header);
  return buildResult(fileName, format, header, sampleRows, sheetNames, matchedFields, undefined);
}

/** 嗅探 csv：编码探测 + 分隔符识别 + 表头匹配 */
function sniffCsv(bytes: Uint8Array, fileName: string): SniffResult {
  const { text, encoding } = decodeCsv(bytes);
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const firstLine = lines[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  const rows = lines.slice(0, 5).map((line) => splitCsvLine(line, delimiter));
  const header = (rows[0] ?? [])
    .map((cell) => normalizeText(cell))
    .filter((cell) => cell.length > 0);
  const sampleRows = rows.slice(1);
  const { matchedFields } = matchHeader(header);
  return buildResult(fileName, 'csv', header, sampleRows, [], matchedFields, encoding);
}

/**
 * 内容嗅探：依据文件内容判断格式、表头与置信度，不依赖文件名。
 * 该函数不会抛出异常——解析层面的错误由后续 parseSpreadsheetBuffer 负责。
 */
export function sniffSpreadsheetBuffer(
  bytes: ArrayBuffer | Uint8Array,
  fileName: string
): SniffResult {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const format = detectFormat(data);
  try {
    if (format === 'xls' || format === 'xlsx') return sniffWorkbook(data, fileName, format);
    if (format === 'csv') return sniffCsv(data, fileName);
    return buildResult(fileName, 'unknown', [], [], [], [], undefined);
  } catch {
    // 魔数匹配但内容损坏（如假 .xlsx）：按无法识别处理，绝不静默导入
    return buildResult(fileName, format, [], [], [], [], undefined);
  }
}
