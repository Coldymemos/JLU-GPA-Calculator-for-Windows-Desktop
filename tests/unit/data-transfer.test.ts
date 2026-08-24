import { describe, expect, it } from 'vitest';
import { defaultRuleSet } from '../../src/domain/rules/recommendation.rules';
import {
  parseFullDataText,
  serializeFullData
} from '../../src/infrastructure/persistence/data-transfer';
import { makeCourse } from './test-course';

describe('full data transfer', () => {
  it('round-trips courses, rule sets and settings without dropping course attributes', () => {
    const course = makeCourse('1', 95, 2, {
      attributes: { publicElectiveCategory: '人文类' }
    });
    const data = {
      courses: [course],
      ruleSets: [structuredClone(defaultRuleSet)],
      settings: [{ key: 'active-rule-set', value: structuredClone(defaultRuleSet) }]
    };

    expect(parseFullDataText(serializeFullData(data))).toEqual(data);
  });

  it('rejects unrelated files and invalid course payloads before import', () => {
    expect(() => parseFullDataText('{"format":"other"}')).toThrow('不是全量迁移文件');
    expect(() =>
      parseFullDataText(
        JSON.stringify({
          format: 'jlu-gpa-full-data',
          version: 1,
          courses: [{ id: 'broken' }],
          ruleSets: [],
          settings: []
        })
      )
    ).toThrow();
  });
});
