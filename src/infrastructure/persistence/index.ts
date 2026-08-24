import { isTauri } from '@tauri-apps/api/core';
import { JluGpaDatabase } from './dexie-db';
import type { PersistencePort } from './persistence-port';
import { TauriSqlitePersistence } from './tauri-sqlite';

const tauriDatabase = isTauri() ? new TauriSqlitePersistence() : undefined;

export const database: PersistencePort = tauriDatabase ?? new JluGpaDatabase();
export const archiveManager = tauriDatabase;

export type {
  ArchivePort,
  ArchiveSummary,
  PersistenceData,
  PersistencePort,
  SettingEntry
} from './persistence-port';
