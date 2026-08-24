import { courseSchema } from '../../domain/course/course.schema';
import { normalizeAppRuleSet } from '../../domain/rules/result-exclusion.rules';
import type { AppRuleSet } from '../../domain/rules/rule-set.types';
import type { PersistenceData, SettingEntry } from './persistence-port';

const format = 'jlu-gpa-full-data';
const version = 1;
const maxBytes = 20 * 1024 * 1024;

interface FullDataFile extends PersistenceData {
  format: typeof format;
  version: typeof version;
  exportedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRuleSet(value: unknown): AppRuleSet {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !isRecord(value.gradePoint) ||
    !isRecord(value.recommendation) ||
    !isRecord(value.exclusions)
  ) {
    throw new Error('迁移文件中存在无效规则集');
  }
  return normalizeAppRuleSet(value as unknown as AppRuleSet);
}

function parseSetting(value: unknown): SettingEntry {
  if (!isRecord(value) || typeof value.key !== 'string' || !('value' in value)) {
    throw new Error('迁移文件中存在无效设置');
  }
  return { key: value.key, value: value.value };
}

export function serializeFullData(data: PersistenceData): string {
  const file: FullDataFile = {
    format,
    version,
    exportedAt: new Date().toISOString(),
    ...data
  };
  return JSON.stringify(file, null, 2);
}

export function parseFullDataText(text: string): PersistenceData {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('迁移文件不是有效的 JSON');
  }
  if (!isRecord(value) || value.format !== format) throw new Error('此文件不是全量迁移文件');
  if (value.version !== version) throw new Error(`不支持此迁移文件版本：${String(value.version)}`);
  if (
    !Array.isArray(value.courses) ||
    !Array.isArray(value.ruleSets) ||
    !Array.isArray(value.settings)
  ) {
    throw new Error('迁移文件的数据结构不完整');
  }
  return {
    courses: value.courses.map((course) => courseSchema.parse(course)),
    ruleSets: value.ruleSets.map(parseRuleSet),
    settings: value.settings.map(parseSetting)
  };
}

export async function parseFullDataFile(file: File): Promise<PersistenceData> {
  if (file.size > maxBytes) throw new Error('全量迁移文件不能超过 20 MB');
  if (!file.name.toLowerCase().endsWith('.json')) throw new Error('请选择 .json 迁移文件');
  return parseFullDataText(await file.text());
}

export function downloadFullData(data: PersistenceData): void {
  const blob = new Blob([serializeFullData(data)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `JLU-GPA-全量数据-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
