import { createContext, useCallback, useContext, useEffect, useMemo, useReducer } from 'react';
import { calculateAllResults } from '../../domain/calculation/calculate';
import type { CalculationResult, Course, ResultKind } from '../../domain/course/course.types';
import { defaultRuleSet } from '../../domain/rules/recommendation.rules';
import { normalizeAppRuleSet } from '../../domain/rules/result-exclusion.rules';
import type { AppRuleSet } from '../../domain/rules/rule-set.types';
import { commitCourseImport } from '../../application/import-courses';
import type { ImportMergeMode, MergeResult } from '../../infrastructure/importers/import.types';
import {
  archiveManager,
  database,
  type ArchiveSummary,
  type PersistenceData
} from '../../infrastructure/persistence';

interface AppState {
  courses: Course[];
  rules: AppRuleSet;
  ruleSets: AppRuleSet[];
  ready: boolean;
  firstVisit: boolean;
  hasCalculated: boolean;
  selectedResultKind?: ResultKind;
  persistenceError?: string;
  archives: ArchiveSummary[];
  activeArchiveId: string;
}

type Action =
  | {
      type: 'HYDRATE';
      courses: Course[];
      rules: AppRuleSet;
      firstVisit: boolean;
      ruleSets?: AppRuleSet[];
      archives?: ArchiveSummary[];
      activeArchiveId?: string;
    }
  | { type: 'SET_LOADING' }
  | { type: 'SET_ARCHIVES'; archives: ArchiveSummary[]; activeArchiveId: string }
  | { type: 'SET_RULE_SETS'; ruleSets: AppRuleSet[] }
  | { type: 'SET_COURSES'; courses: Course[] }
  | { type: 'CLEAR_COURSES' }
  | { type: 'RESET' }
  | { type: 'SET_RULES'; rules: AppRuleSet }
  | { type: 'CALCULATE' }
  | { type: 'SELECT_RESULT'; kind?: ResultKind }
  | { type: 'SET_ERROR'; message?: string };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'HYDRATE':
      return {
        ...state,
        courses: action.courses,
        rules: action.rules,
        ruleSets: action.ruleSets ?? state.ruleSets,
        ready: true,
        firstVisit: action.firstVisit,
        hasCalculated: false,
        selectedResultKind: undefined,
        archives: action.archives ?? state.archives,
        activeArchiveId: action.activeArchiveId ?? state.activeArchiveId
      };
    case 'SET_LOADING':
      return {
        ...state,
        courses: [],
        rules: structuredClone(defaultRuleSet),
        ready: false,
        hasCalculated: false,
        selectedResultKind: undefined
      };
    case 'SET_ARCHIVES':
      return {
        ...state,
        archives: action.archives,
        activeArchiveId: action.activeArchiveId
      };
    case 'SET_RULE_SETS':
      return { ...state, ruleSets: action.ruleSets };
    case 'SET_COURSES':
      return { ...state, courses: action.courses };
    case 'CLEAR_COURSES':
      return {
        ...state,
        courses: [],
        hasCalculated: false,
        selectedResultKind: undefined
      };
    case 'RESET':
      return {
        ...state,
        courses: [],
        rules: structuredClone(defaultRuleSet),
        ruleSets: [],
        ready: true,
        firstVisit: false,
        hasCalculated: false,
        selectedResultKind: undefined
      };
    case 'SET_RULES':
      return { ...state, rules: action.rules };
    case 'CALCULATE':
      return { ...state, hasCalculated: true };
    case 'SELECT_RESULT':
      return { ...state, selectedResultKind: action.kind };
    case 'SET_ERROR':
      return { ...state, persistenceError: action.message };
  }
}

export interface AllResults {
  recommendationGpa: CalculationResult;
  weightedAverage: CalculationResult;
  arithmeticAverage: CalculationResult;
}

interface AppContextValue extends AppState {
  results: AllResults;
  startCalculation: () => void;
  selectResultKind: (kind?: ResultKind) => void;
  saveCourse: (course: Course) => Promise<void>;
  deleteCourse: (id: string) => Promise<void>;
  clearCourses: () => Promise<void>;
  resetAllData: () => Promise<void>;
  acknowledgeWelcome: () => Promise<void>;
  importCourses: (incoming: Course[], mode: ImportMergeMode) => Promise<MergeResult>;
  saveRules: (rules: AppRuleSet) => Promise<void>;
  addRuleSet: (rules: AppRuleSet) => Promise<void>;
  exportData: () => Promise<PersistenceData>;
  restoreData: (data: PersistenceData) => Promise<void>;
  archiveSupported: boolean;
  switchArchive: (id: string) => Promise<void>;
  createArchive: (name: string) => Promise<void>;
  renameArchive: (id: string, name: string) => Promise<void>;
  deleteArchive: (id: string) => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

const initialState: AppState = {
  courses: [],
  rules: structuredClone(defaultRuleSet),
  ruleSets: [],
  ready: false,
  firstVisit: false,
  hasCalculated: false,
  archives: [],
  activeArchiveId: 'default'
};

async function loadArchiveSnapshot() {
  const [courses, savedRules, hasData, ruleSets] = await Promise.all([
    database.loadCourses(),
    database.loadSetting<AppRuleSet>('active-rule-set'),
    database.hasAnyData(),
    database.listRuleSets()
  ]);
  return {
    courses,
    rules: normalizeAppRuleSet(savedRules ?? structuredClone(defaultRuleSet)),
    hasData,
    ruleSets: ruleSets.map(normalizeAppRuleSet)
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let active = true;
    void (async () => {
      const activeArchiveId = archiveManager
        ? await archiveManager.getActiveArchiveId()
        : initialState.activeArchiveId;
      const archives = archiveManager ? await archiveManager.listArchives() : [];
      const snapshot = await loadArchiveSnapshot();
      return { activeArchiveId, archives, snapshot };
    })()
      .then(({ activeArchiveId, archives, snapshot }) => {
        if (active)
          dispatch({
            type: 'HYDRATE',
            courses: snapshot.courses,
            rules: snapshot.rules,
            ruleSets: snapshot.ruleSets,
            firstVisit: !snapshot.hasData,
            archives,
            activeArchiveId
          });
      })
      .catch((error: unknown) => {
        if (!active) return;
        dispatch({
          type: 'HYDRATE',
          courses: [],
          rules: structuredClone(defaultRuleSet),
          firstVisit: false
        });
        dispatch({
          type: 'SET_ERROR',
          message: error instanceof Error ? error.message : '无法读取浏览器本地数据'
        });
      });
    return () => {
      active = false;
    };
  }, []);

  const withPersistenceError = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    try {
      const result = await operation();
      dispatch({ type: 'SET_ERROR', message: undefined });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '本地保存失败';
      dispatch({ type: 'SET_ERROR', message });
      throw error;
    }
  }, []);

  const saveCourse = useCallback(
    async (course: Course) =>
      withPersistenceError(async () => {
        await database.saveCourse(course);
        const courses = state.courses.some((item) => item.id === course.id)
          ? state.courses.map((item) => (item.id === course.id ? course : item))
          : [...state.courses, course];
        dispatch({ type: 'SET_COURSES', courses });
      }),
    [state.courses, withPersistenceError]
  );

  const deleteCourse = useCallback(
    async (id: string) =>
      withPersistenceError(async () => {
        await database.removeCourse(id);
        dispatch({
          type: 'SET_COURSES',
          courses: state.courses.filter((course) => course.id !== id)
        });
      }),
    [state.courses, withPersistenceError]
  );

  const clearCourses = useCallback(
    async () =>
      withPersistenceError(async () => {
        await database.clearCourses();
        dispatch({ type: 'CLEAR_COURSES' });
      }),
    [withPersistenceError]
  );

  const resetAllData = useCallback(
    async () =>
      withPersistenceError(async () => {
        await database.clearAllData();
        dispatch({ type: 'RESET' });
      }),
    [withPersistenceError]
  );

  const acknowledgeWelcome = useCallback(
    async () =>
      withPersistenceError(async () => {
        await database.saveSetting('welcome-about-shown', true);
      }),
    [withPersistenceError]
  );

  const importCourses = useCallback(
    async (incoming: Course[], mode: ImportMergeMode) =>
      withPersistenceError(async () => {
        const result = await commitCourseImport(database, state.courses, incoming, mode);
        dispatch({ type: 'SET_COURSES', courses: result.courses });
        return result;
      }),
    [state.courses, withPersistenceError]
  );

  const saveRules = useCallback(
    async (rules: AppRuleSet) =>
      withPersistenceError(async () => {
        const normalizedRules = normalizeAppRuleSet(rules);
        await database.saveRuleSet(normalizedRules);
        await database.saveSetting('active-rule-set', normalizedRules);
        dispatch({ type: 'SET_RULES', rules: normalizedRules });
        dispatch({ type: 'SET_RULE_SETS', ruleSets: await database.listRuleSets() });
      }),
    [withPersistenceError]
  );

  const addRuleSet = useCallback(
    async (rules: AppRuleSet) =>
      withPersistenceError(async () => {
        const normalizedRules = normalizeAppRuleSet(rules);
        await database.saveRuleSet(normalizedRules);
        dispatch({ type: 'SET_RULE_SETS', ruleSets: await database.listRuleSets() });
      }),
    [withPersistenceError]
  );

  const exportData = useCallback(
    () => withPersistenceError(() => database.exportData()),
    [withPersistenceError]
  );

  const restoreData = useCallback(
    (data: PersistenceData) =>
      withPersistenceError(async () => {
        await database.importData(data);
        const savedRules = data.settings.find((setting) => setting.key === 'active-rule-set')
          ?.value as AppRuleSet | undefined;
        dispatch({
          type: 'HYDRATE',
          courses: data.courses,
          rules: normalizeAppRuleSet(
            savedRules ?? data.ruleSets[0] ?? structuredClone(defaultRuleSet)
          ),
          ruleSets: data.ruleSets.map(normalizeAppRuleSet),
          firstVisit: false
        });
      }),
    [withPersistenceError]
  );

  const switchArchive = useCallback(
    async (id: string) => {
      if (!archiveManager || id === state.activeArchiveId) return;
      const manager = archiveManager;
      dispatch({ type: 'SET_LOADING' });
      try {
        await withPersistenceError(async () => {
          await manager.setActiveArchive(id);
          const [snapshot, archives] = await Promise.all([
            loadArchiveSnapshot(),
            manager.listArchives()
          ]);
          dispatch({
            type: 'HYDRATE',
            courses: snapshot.courses,
            rules: snapshot.rules,
            ruleSets: snapshot.ruleSets,
            firstVisit: false,
            archives,
            activeArchiveId: id
          });
        });
      } catch (error) {
        await manager.setActiveArchive(state.activeArchiveId).catch(() => undefined);
        dispatch({
          type: 'HYDRATE',
          courses: state.courses,
          rules: state.rules,
          firstVisit: state.firstVisit,
          archives: state.archives,
          activeArchiveId: state.activeArchiveId
        });
        throw error;
      }
    },
    [
      state.activeArchiveId,
      state.archives,
      state.courses,
      state.firstVisit,
      state.rules,
      withPersistenceError
    ]
  );

  const createArchive = useCallback(
    async (name: string) => {
      if (!archiveManager) return;
      const manager = archiveManager;
      dispatch({ type: 'SET_LOADING' });
      try {
        await withPersistenceError(async () => {
          const archive = await manager.createArchive(name);
          await manager.setActiveArchive(archive.id);
          const archives = await manager.listArchives();
          dispatch({
            type: 'HYDRATE',
            courses: [],
            rules: structuredClone(defaultRuleSet),
            ruleSets: [],
            firstVisit: false,
            archives,
            activeArchiveId: archive.id
          });
        });
      } catch (error) {
        await manager.setActiveArchive(state.activeArchiveId).catch(() => undefined);
        dispatch({
          type: 'HYDRATE',
          courses: state.courses,
          rules: state.rules,
          firstVisit: state.firstVisit,
          archives: await manager.listArchives().catch(() => state.archives),
          activeArchiveId: state.activeArchiveId
        });
        throw error;
      }
    },
    [
      state.activeArchiveId,
      state.archives,
      state.courses,
      state.firstVisit,
      state.rules,
      withPersistenceError
    ]
  );

  const renameArchive = useCallback(
    async (id: string, name: string) => {
      if (!archiveManager) return;
      const manager = archiveManager;
      await withPersistenceError(async () => {
        await manager.renameArchive(id, name);
        dispatch({
          type: 'SET_ARCHIVES',
          archives: await manager.listArchives(),
          activeArchiveId: state.activeArchiveId
        });
      });
    },
    [state.activeArchiveId, withPersistenceError]
  );

  const deleteArchive = useCallback(
    async (id: string) => {
      if (!archiveManager) return;
      const manager = archiveManager;
      const deletingActiveArchive = id === state.activeArchiveId;
      if (deletingActiveArchive) dispatch({ type: 'SET_LOADING' });
      await withPersistenceError(async () => {
        const activeArchiveId = await manager.deleteArchive(id);
        const archives = await manager.listArchives();
        if (deletingActiveArchive) {
          const snapshot = await loadArchiveSnapshot();
          dispatch({
            type: 'HYDRATE',
            courses: snapshot.courses,
            rules: snapshot.rules,
            ruleSets: snapshot.ruleSets,
            firstVisit: false,
            archives,
            activeArchiveId
          });
        } else {
          dispatch({ type: 'SET_ARCHIVES', archives, activeArchiveId });
        }
      });
    },
    [state.activeArchiveId, withPersistenceError]
  );

  const results = useMemo(
    () => calculateAllResults(state.courses, state.rules),
    [state.courses, state.rules]
  );

  const value = useMemo<AppContextValue>(
    () => ({
      ...state,
      results,
      startCalculation: () => dispatch({ type: 'CALCULATE' }),
      selectResultKind: (kind) => dispatch({ type: 'SELECT_RESULT', kind }),
      saveCourse,
      deleteCourse,
      clearCourses,
      resetAllData,
      acknowledgeWelcome,
      importCourses,
      saveRules,
      addRuleSet,
      exportData,
      restoreData,
      archiveSupported: Boolean(archiveManager),
      switchArchive,
      createArchive,
      renameArchive,
      deleteArchive
    }),
    [
      state,
      results,
      saveCourse,
      deleteCourse,
      clearCourses,
      resetAllData,
      acknowledgeWelcome,
      importCourses,
      saveRules,
      addRuleSet,
      exportData,
      restoreData,
      switchArchive,
      createArchive,
      renameArchive,
      deleteArchive
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// The provider and its hook intentionally share this small module.
// eslint-disable-next-line react-refresh/only-export-components
export function useAppState(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppState 必须在 AppProvider 中使用');
  return context;
}
