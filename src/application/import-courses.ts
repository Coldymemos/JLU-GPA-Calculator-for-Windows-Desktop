import type { Course } from '../domain/course/course.types';
import type { PersistencePort } from '../infrastructure/persistence';
import type { ImportMergeMode, MergeResult } from '../infrastructure/importers/import.types';
import { mergeCourses } from './merge-courses';

export async function commitCourseImport(
  database: PersistencePort,
  existing: Course[],
  incoming: Course[],
  mode: ImportMergeMode
): Promise<MergeResult> {
  const result = mergeCourses(existing, incoming, mode);
  await database.replaceCourses(result.courses);
  return result;
}
