import type { Course } from '../../domain/course/course.types';
import type { AppRuleSet } from '../../domain/rules/rule-set.types';

export const defaultArchiveId = 'default';

export interface SettingEntry {
  key: string;
  value: unknown;
}

export interface PersistenceData {
  courses: Course[];
  ruleSets: AppRuleSet[];
  settings: SettingEntry[];
}

export interface ArchiveSummary {
  id: string;
  name: string;
  createdAt: string;
  courseCount: number;
}

export interface ArchivePort {
  listArchives(): Promise<ArchiveSummary[]>;
  getActiveArchiveId(): Promise<string>;
  createArchive(name: string): Promise<ArchiveSummary>;
  renameArchive(id: string, name: string): Promise<void>;
  deleteArchive(id: string): Promise<string>;
  setActiveArchive(id: string): Promise<void>;
}

export interface PersistencePort {
  replaceCourses(courses: Course[]): Promise<void>;
  appendCourses(courses: Course[]): Promise<void>;
  saveCourse(course: Course): Promise<void>;
  removeCourse(id: string): Promise<void>;
  clearCourses(): Promise<void>;
  clearAllData(): Promise<void>;
  hasAnyData(): Promise<boolean>;
  loadCourses(): Promise<Course[]>;
  loadRuleSet(id: string): Promise<AppRuleSet | undefined>;
  listRuleSets(): Promise<AppRuleSet[]>;
  saveRuleSet(ruleSet: AppRuleSet): Promise<void>;
  loadSetting<T>(key: string): Promise<T | undefined>;
  saveSetting(key: string, value: unknown): Promise<void>;
  exportData(): Promise<PersistenceData>;
  importData(data: PersistenceData): Promise<void>;
}
