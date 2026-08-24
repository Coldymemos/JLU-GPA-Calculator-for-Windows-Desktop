import { describe, expect, it } from 'vitest';
import {
  buildFutureSensitivity,
  calculateFuturePlan,
  findMinimumFuturePlan
} from '../../src/domain/calculation/future-planning';
import type { Course } from '../../src/domain/course/course.types';
import { defaultRuleSet } from '../../src/domain/rules/recommendation.rules';
import { makeCourse } from './test-course';

function course(id: string, score: number, credit: number): Course {
  return makeCourse(id, score, credit);
}

describe('future-planning', () => {
  it('finds a minimum future course plan for weighted average', () => {
    const result = findMinimumFuturePlan([course('a', 80, 10)], defaultRuleSet, {
      kind: 'weighted-average',
      target: 85,
      creditPerCourse: 5,
      maxCourses: 10
    });

    expect(result.feasible).toBe(true);
    expect(result.futureCourseCount).toBe(1);
    expect(result.futureCredits).toBe(5);
    expect(result.averageScore).toBe(95);
    expect(result.projectedValue).toBeGreaterThanOrEqual(85);
  });

  it('supports already reached and unreachable goals', () => {
    const reached = findMinimumFuturePlan([course('a', 90, 3)], defaultRuleSet, {
      kind: 'weighted-average',
      target: 85,
      creditPerCourse: 3
    });
    expect(reached.reason).toBe('already-reached');
    expect(reached.futureCourses).toHaveLength(0);

    const unreachable = findMinimumFuturePlan([course('a', 50, 3)], defaultRuleSet, {
      kind: 'weighted-average',
      target: 100,
      creditPerCourse: 3,
      maxCourses: 2
    });
    expect(unreachable.feasible).toBe(false);
    expect(unreachable.reason).toBe('unreachable');
  });

  it('uses the existing grade-point mapping for recommendation GPA', () => {
    const result = calculateFuturePlan([course('a', 80, 3)], defaultRuleSet, 'recommendation-gpa', [
      { credit: 3, score: 90 }
    ]);
    expect(result.status).toBe('success');
    expect(result.value).toBeCloseTo(3.5, 5);
  });

  it('builds future-score sensitivity rows without changing saved courses', () => {
    const saved = [course('a', 80, 10)];
    const rows = buildFutureSensitivity(
      saved,
      defaultRuleSet,
      { kind: 'weighted-average', target: 85, creditPerCourse: 5, maxCourses: 10 },
      [80, 90, 100]
    );
    expect(rows.map((row) => row.feasible)).toEqual([false, true, true]);
    expect(rows[1].futureCredits).toBe(10);
    expect(saved).toHaveLength(1);
  });
});
