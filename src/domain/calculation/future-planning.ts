import type {
  CalculationResult,
  Course,
  ManualRecommendationOverride,
  ResultKind
} from '../course/course.types';
import { calculateResult } from './calculate';
import type { AppRuleSet } from '../rules/rule-set.types';

const SCORE_MIN = 0;
const SCORE_MAX = 100;
const DEFAULT_MAX_COURSES = 40;

export interface FutureCourseInput {
  id?: string;
  name?: string;
  credit: number;
  score: number;
  courseCategory?: string;
  courseNature?: string;
  publicElectiveCategory?: string;
  recommendationOverride?: ManualRecommendationOverride;
}

export interface FutureCourseTemplate {
  namePrefix?: string;
  courseCategory?: string;
  courseNature?: string;
  publicElectiveCategory?: string;
  recommendationOverride?: ManualRecommendationOverride;
}

export interface FuturePlanOptions {
  kind: ResultKind;
  target: number;
  creditPerCourse: number;
  scoreMin?: number;
  scoreMax?: number;
  maxCourses?: number;
  template?: FutureCourseTemplate;
}

export interface FuturePlanResult {
  feasible: boolean;
  reason?: 'already-reached' | 'unreachable' | 'invalid-input';
  kind: ResultKind;
  target: number;
  currentValue?: number;
  projectedValue?: number;
  futureCourses: FutureCourseInput[];
  futureCredits: number;
  futureCourseCount: number;
  averageScore?: number;
}

export interface FutureSensitivityRow {
  score: number;
  feasible: boolean;
  futureCredits: number;
  futureCourseCount: number;
  projectedValue?: number;
}

function isValidCredit(credit: number): boolean {
  return Number.isFinite(credit) && credit > 0;
}

function clampScore(score: number): number {
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(score)));
}

function currentValue(result: CalculationResult): number {
  return result.status === 'success' && result.value !== undefined ? result.value : 0;
}

function createFutureCourse(
  input: FutureCourseInput,
  index: number,
  template: FutureCourseTemplate = {}
): Course {
  const now = new Date().toISOString();
  const name = input.name?.trim() || `${template.namePrefix?.trim() || '规划课程'} ${index + 1}`;
  const id = input.id || `m6-future-${index + 1}`;
  return {
    id,
    identity: {
      code: `M6-FUTURE-${index + 1}`,
      name
    },
    term: { semester: 'unknown' },
    achievement: {
      grade: { kind: 'percentage', raw: clampScore(input.score) },
      credit: input.credit,
      passed: input.score >= 60
    },
    attributes: {
      courseCategory: input.courseCategory ?? template.courseCategory,
      courseNature: input.courseNature ?? template.courseNature,
      publicElectiveCategory: input.publicElectiveCategory ?? template.publicElectiveCategory
    },
    record: { isValid: true },
    control: {
      userIncluded: true,
      recommendationOverride:
        input.recommendationOverride ?? template.recommendationOverride ?? 'auto'
    },
    provenance: { source: 'manual' },
    audit: { createdAt: now, updatedAt: now }
  };
}

export function buildFutureCourses(
  inputs: FutureCourseInput[],
  template: FutureCourseTemplate = {}
): Course[] {
  return inputs.map((input, index) => createFutureCourse(input, index, template));
}

export function calculateFuturePlan(
  courses: Course[],
  rules: AppRuleSet,
  kind: ResultKind,
  futureCourses: FutureCourseInput[]
): CalculationResult {
  return calculateResult(courses.concat(buildFutureCourses(futureCourses)), kind, rules);
}

function makeUniformInputs(
  count: number,
  credit: number,
  score: number,
  template?: FutureCourseTemplate
): FutureCourseInput[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `${template?.namePrefix?.trim() || '规划课程'} ${index + 1}`,
    credit,
    score,
    courseCategory: template?.courseCategory,
    courseNature: template?.courseNature,
    publicElectiveCategory: template?.publicElectiveCategory,
    recommendationOverride: template?.recommendationOverride
  }));
}

function evaluateUniformPlan(
  courses: Course[],
  rules: AppRuleSet,
  options: FuturePlanOptions,
  count: number,
  score: number
): CalculationResult {
  return calculateFuturePlan(
    courses,
    rules,
    options.kind,
    makeUniformInputs(count, options.creditPerCourse, score, options.template)
  );
}

function fixedScorePlan(
  courses: Course[],
  rules: AppRuleSet,
  options: FuturePlanOptions,
  score: number
): FuturePlanResult {
  const current = calculateResult(courses, options.kind, rules);
  const baseline = currentValue(current);
  if (options.target <= baseline) {
    return {
      feasible: true,
      reason: 'already-reached',
      kind: options.kind,
      target: options.target,
      currentValue: current.value,
      projectedValue: current.value,
      futureCourses: [],
      futureCredits: 0,
      futureCourseCount: 0,
      averageScore: score
    };
  }

  const maxCourses = Math.max(1, Math.floor(options.maxCourses ?? DEFAULT_MAX_COURSES));
  let best: FuturePlanResult | undefined;
  for (let count = 1; count <= maxCourses; count += 1) {
    const projected = evaluateUniformPlan(courses, rules, options, count, score);
    if (projected.status !== 'success' || projected.value === undefined) continue;
    if (projected.value < options.target) continue;
    const futureCredits = count * options.creditPerCourse;
    const candidate: FuturePlanResult = {
      feasible: true,
      kind: options.kind,
      target: options.target,
      currentValue: current.value,
      projectedValue: projected.value,
      futureCourses: makeUniformInputs(count, options.creditPerCourse, score, options.template),
      futureCredits,
      futureCourseCount: count,
      averageScore: score
    };
    if (
      !best ||
      candidate.futureCredits < best.futureCredits ||
      (candidate.futureCredits === best.futureCredits &&
        candidate.futureCourseCount < best.futureCourseCount)
    ) {
      best = candidate;
    }
  }
  return (
    best ?? {
      feasible: false,
      reason: 'unreachable',
      kind: options.kind,
      target: options.target,
      currentValue: current.value,
      futureCourses: [],
      futureCredits: 0,
      futureCourseCount: 0,
      averageScore: score
    }
  );
}

export function findMinimumFuturePlan(
  courses: Course[],
  rules: AppRuleSet,
  options: FuturePlanOptions
): FuturePlanResult {
  if (!isValidCredit(options.creditPerCourse) || !Number.isFinite(options.target)) {
    return {
      feasible: false,
      reason: 'invalid-input',
      kind: options.kind,
      target: options.target,
      futureCourses: [],
      futureCredits: 0,
      futureCourseCount: 0
    };
  }

  const scoreMin = clampScore(options.scoreMin ?? 60);
  const scoreMax = clampScore(options.scoreMax ?? SCORE_MAX);
  if (scoreMin > scoreMax) {
    return {
      feasible: false,
      reason: 'invalid-input',
      kind: options.kind,
      target: options.target,
      futureCourses: [],
      futureCredits: 0,
      futureCourseCount: 0
    };
  }

  const current = calculateResult(courses, options.kind, rules);
  const baseline = currentValue(current);
  if (options.target <= baseline) {
    return {
      feasible: true,
      reason: 'already-reached',
      kind: options.kind,
      target: options.target,
      currentValue: current.value,
      projectedValue: current.value,
      futureCourses: [],
      futureCredits: 0,
      futureCourseCount: 0
    };
  }

  const maxCourses = Math.max(1, Math.floor(options.maxCourses ?? DEFAULT_MAX_COURSES));
  for (let count = 1; count <= maxCourses; count += 1) {
    const atMax = evaluateUniformPlan(courses, rules, options, count, scoreMax);
    if (atMax.status !== 'success' || atMax.value === undefined || atMax.value < options.target) {
      continue;
    }

    let low = scoreMin;
    let high = scoreMax;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const result = evaluateUniformPlan(courses, rules, options, count, middle);
      if (
        result.status === 'success' &&
        result.value !== undefined &&
        result.value >= options.target
      ) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    const projected = evaluateUniformPlan(courses, rules, options, count, low);
    return {
      feasible: true,
      kind: options.kind,
      target: options.target,
      currentValue: current.value,
      projectedValue: projected.value,
      futureCourses: makeUniformInputs(count, options.creditPerCourse, low, options.template),
      futureCredits: count * options.creditPerCourse,
      futureCourseCount: count,
      averageScore: low
    };
  }

  return {
    feasible: false,
    reason: 'unreachable',
    kind: options.kind,
    target: options.target,
    currentValue: current.value,
    futureCourses: [],
    futureCredits: 0,
    futureCourseCount: 0
  };
}

export function buildFutureSensitivity(
  courses: Course[],
  rules: AppRuleSet,
  options: FuturePlanOptions,
  scores = [75, 80, 85, 90, 95, 100]
): FutureSensitivityRow[] {
  return scores.map((score) => {
    const result = fixedScorePlan(courses, rules, options, score);
    return {
      score,
      feasible: result.feasible,
      futureCredits: result.futureCredits,
      futureCourseCount: result.futureCourseCount,
      projectedValue: result.projectedValue
    };
  });
}
