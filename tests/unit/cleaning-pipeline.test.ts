import { describe, expect, it } from 'vitest';
import {
  cleanRawValue,
  defaultCleaningRules,
  describeCleaningRules
} from '../../src/domain/course/cleaning-pipeline';

describe('cleaning-pipeline（M4 清洗管道）', () => {
  it('去除成绩后的括号批注（半角与全角括号）', () => {
    expect(cleanRawValue('90(重修)')).toBe('90');
    expect(cleanRawValue('90（重修）')).toBe('90');
    expect(cleanRawValue('85.5（补考）')).toBe('85.5');
    expect(cleanRawValue('88 (缺考) 分')).toBe('88');
  });

  it('去除末尾“分”单位后缀', () => {
    expect(cleanRawValue('90.0分')).toBe('90.0');
    expect(cleanRawValue('90分')).toBe('90');
    expect(cleanRawValue('95.5 分')).toBe('95.5');
  });

  it('全角数字与全角字母经 NFKC 转为半角', () => {
    expect(cleanRawValue('９０')).toBe('90');
    expect(cleanRawValue('Ａ００１')).toBe('A001');
    expect(cleanRawValue('９０．５')).toBe('90.5');
  });

  it('合并多余空白并去除全角空格', () => {
    expect(cleanRawValue('  高等  数学  ')).toBe('高等 数学');
    expect(cleanRawValue('高等\u3000数学')).toBe('高等 数学');
    expect(cleanRawValue('  ')).toBe('');
  });

  it('空值与 null 返回空串', () => {
    expect(cleanRawValue(undefined)).toBe('');
    expect(cleanRawValue(null)).toBe('');
    expect(cleanRawValue('')).toBe('');
  });

  it('损坏的正则规则被跳过，不影响其余规则', () => {
    const broken = [{ name: 'bad', pattern: '[', replacement: 'x' }, ...defaultCleaningRules];
    expect(cleanRawValue('90(重修)', broken)).toBe('90');
  });

  it('describeCleaningRules 输出可读说明', () => {
    const descriptions = describeCleaningRules();
    expect(descriptions.length).toBeGreaterThanOrEqual(3);
    expect(descriptions.some((text) => text.includes('90(重修)'))).toBe(true);
  });
});
