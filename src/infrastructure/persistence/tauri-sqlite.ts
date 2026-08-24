import { invoke } from '@tauri-apps/api/core';
import type { Course } from '../../domain/course/course.types';
import type { AppRuleSet } from '../../domain/rules/rule-set.types';
import {
  defaultArchiveId,
  type ArchivePort,
  type ArchiveSummary,
  type PersistenceData,
  type PersistencePort
} from './persistence-port';

export class TauriSqlitePersistence implements PersistencePort, ArchivePort {
  constructor(private archive = defaultArchiveId) {}

  listArchives(): Promise<ArchiveSummary[]> {
    return invoke<ArchiveSummary[]>('archives_list');
  }

  async getActiveArchiveId(): Promise<string> {
    this.archive = await invoke<string>('archive_active');
    return this.archive;
  }

  async createArchive(name: string): Promise<ArchiveSummary> {
    const id = crypto.randomUUID();
    await invoke('archive_create', { id, name });
    const archive = (await this.listArchives()).find((item) => item.id === id);
    if (!archive) throw new Error('档案创建后无法读取');
    return archive;
  }

  renameArchive(id: string, name: string): Promise<void> {
    return invoke('archive_rename', { id, name });
  }

  async deleteArchive(id: string): Promise<string> {
    this.archive = await invoke<string>('archive_delete', { id });
    return this.archive;
  }

  async setActiveArchive(id: string): Promise<void> {
    await invoke('archive_set_active', { id });
    this.archive = id;
  }

  replaceCourses(courses: Course[]): Promise<void> {
    return invoke('courses_replace', { archive: this.archive, courses });
  }

  appendCourses(courses: Course[]): Promise<void> {
    return invoke('courses_append', { archive: this.archive, courses });
  }

  saveCourse(course: Course): Promise<void> {
    return invoke('course_save', { archive: this.archive, course });
  }

  removeCourse(id: string): Promise<void> {
    return invoke('course_remove', { archive: this.archive, id });
  }

  clearCourses(): Promise<void> {
    return invoke('courses_clear', { archive: this.archive });
  }

  clearAllData(): Promise<void> {
    return invoke('db_clear_all', { archive: this.archive });
  }

  hasAnyData(): Promise<boolean> {
    return invoke('db_has_any_data', { archive: this.archive });
  }

  loadCourses(): Promise<Course[]> {
    return invoke<Course[]>('courses_load', { archive: this.archive });
  }

  async loadRuleSet(id: string): Promise<AppRuleSet | undefined> {
    return (
      (await invoke<AppRuleSet | null>('rule_set_load', {
        archive: this.archive,
        id
      })) ?? undefined
    );
  }

  listRuleSets(): Promise<AppRuleSet[]> {
    return invoke<AppRuleSet[]>('rule_sets_list', { archive: this.archive });
  }

  saveRuleSet(ruleSet: AppRuleSet): Promise<void> {
    return invoke('rule_set_save', { archive: this.archive, ruleSet });
  }

  async loadSetting<T>(key: string): Promise<T | undefined> {
    return (
      (await invoke<T | null>('setting_load', {
        archive: this.archive,
        key
      })) ?? undefined
    );
  }

  saveSetting(key: string, value: unknown): Promise<void> {
    return invoke('setting_save', { archive: this.archive, key, value });
  }

  exportData(): Promise<PersistenceData> {
    return invoke('data_export', { archive: this.archive });
  }

  importData(data: PersistenceData): Promise<void> {
    return invoke('data_import', { archive: this.archive, data });
  }
}
