import { App as AntApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { Course, ResultKind } from '../domain/course/course.types';
import { exportAdaptedCourseWorkbook } from '../infrastructure/exporters/course-workbook-exporter';
import { exportResultPdf, exportResultPng } from '../infrastructure/exporters/result-exporter';
import { downloadFilterConfig, parseFilterConfigFile } from '../infrastructure/filter-config';
import { downloadFullData, parseFullDataFile } from '../infrastructure/persistence/data-transfer';
import {
  backupDesktopDatabase,
  isDesktopRuntime,
  restoreDesktopDatabase,
  selectDesktopBackup,
  validateDesktopBackup
} from '../infrastructure/persistence/desktop-backup';
import { AboutDialog } from './components/AboutDialog';
import { AppShell } from './components/AppShell';
import { ArchiveDialog } from './components/ArchiveDialog';
import { ComparisonDrawer } from './components/ComparisonDrawer';
import { CourseDrawer } from './components/CourseDrawer';
import { CourseWorkspace } from './components/CourseWorkspace';
import { ExportDrawer } from './components/ExportDrawer';
import { ImportDrawer } from './components/ImportDialog';
import { ResultExportCard } from './components/ResultExportCard';
import {
  ResultExclusionDrawer,
  type ExclusionRuleUpdates
} from './components/ResultExclusionDrawer';
import { RulesDrawer } from './components/SettingsDialog';
import { Sidebar, type PanelKind } from './components/Sidebar';
import { AppProvider, useAppState } from './state/app-context';

// 目录批量导入仅在桌面端使用；懒加载避免 Web 基线主包静态引入 SheetJS 解析链路
const DirectoryImportDrawer = lazy(() =>
  import('./components/DirectoryImportDrawer').then((module) => ({
    default: module.DirectoryImportDrawer
  }))
);

function Workbench() {
  const app = AntApp.useApp();
  const {
    courses,
    rules,
    ruleSets,
    ready,
    firstVisit,
    hasCalculated,
    selectedResultKind,
    persistenceError,
    results,
    startCalculation,
    selectResultKind,
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
    archives,
    activeArchiveId,
    archiveSupported,
    switchArchive,
    createArchive,
    renameArchive,
    deleteArchive
  } = useAppState();
  const [activePanel, setActivePanel] = useState<PanelKind>();
  const [importOpen, setImportOpen] = useState(false);
  const [batchImportOpen, setBatchImportOpen] = useState(false);
  const [exclusionKind, setExclusionKind] = useState<ResultKind>();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course>();
  const [exporting, setExporting] = useState(false);
  const [generatedAt, setGeneratedAt] = useState(() => new Date());
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (persistenceError) app.message.error(persistenceError);
  }, [app.message, persistenceError]);

  const resultByKind = useMemo(
    () => ({
      'recommendation-gpa': results.recommendationGpa,
      'weighted-average': results.weightedAverage,
      'arithmetic-average': results.arithmeticAverage
    }),
    [results]
  );

  const selectedResult = selectedResultKind ? resultByKind[selectedResultKind] : undefined;
  const displayedArchives = useMemo(
    () =>
      archives.map((archive) =>
        archive.id === activeArchiveId ? { ...archive, courseCount: courses.length } : archive
      ),
    [activeArchiveId, archives, courses.length]
  );

  const edit = (course?: Course) => {
    setActivePanel(undefined);
    setImportOpen(false);
    setBatchImportOpen(false);
    setEditingCourse(course);
    setEditorOpen(true);
  };

  const exportResult = async (format: 'png' | 'pdf' | 'xlsx') => {
    if (format !== 'xlsx' && !exportRef.current) return;
    setExporting(true);
    setGeneratedAt(new Date());
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    try {
      if (format === 'xlsx') {
        await exportAdaptedCourseWorkbook(courses, [
          results.recommendationGpa,
          results.weightedAverage,
          results.arithmeticAverage
        ]);
      } else if (format === 'png') await exportResultPng(exportRef.current!);
      else await exportResultPdf(exportRef.current!);
      app.message.success(format === 'xlsx' ? '已导出适配表格' : `已导出 ${format.toUpperCase()}`);
    } catch (error) {
      app.message.error(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const recommendationIncluded = editingCourse
    ? editingCourse.control.recommendationOverride === 'include'
      ? true
      : editingCourse.control.recommendationOverride === 'exclude'
        ? false
        : (results.recommendationGpa.evaluations.find(
            (evaluation) => evaluation.courseId === editingCourse.id
          )?.included ?? true)
    : true;

  const setRecommendation = async (course: Course, included: boolean) => {
    try {
      await saveCourse({
        ...course,
        control: {
          ...course.control,
          recommendationOverride: included ? 'include' : 'exclude'
        },
        audit: { ...course.audit, updatedAt: new Date().toISOString() }
      });
    } catch {
      app.message.error('保研课程设置保存失败');
    }
  };

  const confirmClearCourses = () => {
    app.modal.confirm({
      title: '清空全部课程？',
      content: `将删除当前保存的 ${courses.length} 门课程，并重置全部计算结果。此操作无法撤销。`,
      okText: '确认清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await clearCourses();
          setActivePanel(undefined);
          setImportOpen(false);
          setBatchImportOpen(false);
          setEditorOpen(false);
          setEditingCourse(undefined);
          setWorkspaceVersion((version) => version + 1);
          app.message.success('课程和计算结果已清空');
        } catch (error) {
          app.message.error(error instanceof Error ? error.message : '清空课程失败');
          throw error;
        }
      }
    });
  };

  const confirmResetAll = () => {
    app.modal.confirm({
      title: '清空当前档案的全部数据？',
      content: `将删除当前保存的 ${courses.length} 门课程、全部排除规则与设置，并恢复为初始状态。此操作无法撤销。`,
      okText: '确认清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await resetAllData();
          setActivePanel(undefined);
          setImportOpen(false);
          setBatchImportOpen(false);
          setEditorOpen(false);
          setEditingCourse(undefined);
          setExclusionKind(undefined);
          selectResultKind(undefined);
          setWorkspaceVersion((version) => version + 1);
          setAboutOpen(false);
          app.message.success('已清空当前档案并恢复初始状态');
        } catch (error) {
          app.message.error(error instanceof Error ? error.message : '清空数据失败');
          throw error;
        }
      }
    });
  };

  return (
    <AppShell
      sidebar={
        <Sidebar
          activePanel={activePanel}
          activeExclusionKind={exclusionKind}
          selectedResultKind={selectedResultKind}
          hasCalculated={hasCalculated}
          courseCount={courses.length}
          results={results}
          exclusions={rules.exclusions}
          onCourses={() => {
            setActivePanel(undefined);
            setImportOpen(false);
            setBatchImportOpen(false);
            setExclusionKind(undefined);
            selectResultKind(undefined);
          }}
          onPanel={(panel) => {
            setExclusionKind(undefined);
            setImportOpen(false);
            setBatchImportOpen(false);
            setActivePanel(panel);
          }}
          onCalculate={startCalculation}
          onResult={(kind: ResultKind) => {
            setActivePanel(undefined);
            setImportOpen(false);
            setBatchImportOpen(false);
            setExclusionKind(undefined);
            selectResultKind(kind);
          }}
          onExclusionRules={(kind) => {
            setActivePanel(undefined);
            setImportOpen(false);
            setBatchImportOpen(false);
            setExclusionKind(kind);
          }}
          onExportFilterConfig={() => {
            try {
              downloadFilterConfig(rules.exclusions);
              app.message.success('过滤配置已导出');
            } catch (error) {
              app.message.error(error instanceof Error ? error.message : '过滤配置导出失败');
            }
          }}
          onImportFilterConfig={async (file) => {
            try {
              const exclusions = await parseFilterConfigFile(file);
              await saveRules({ ...rules, exclusions });
              app.message.success('过滤配置已导入并应用');
            } catch (error) {
              app.message.error(error instanceof Error ? error.message : '过滤配置导入失败');
            }
          }}
          currentArchiveName={archives.find((archive) => archive.id === activeArchiveId)?.name}
          onArchives={archiveSupported ? () => setArchiveOpen(true) : undefined}
          onAbout={() => setAboutOpen(true)}
        />
      }
    >
      <CourseWorkspace
        key={workspaceVersion}
        courses={courses}
        rules={rules}
        ready={ready}
        selectedResultKind={selectedResultKind}
        selectedResult={selectedResult}
        recommendationResult={results.recommendationGpa}
        onAdd={() => edit()}
        onClear={confirmClearCourses}
        onEdit={edit}
        onDelete={async (course) => {
          try {
            await deleteCourse(course.id);
            app.message.success('课程已删除');
          } catch {
            app.message.error('课程删除失败');
          }
        }}
        onRecommendationChange={setRecommendation}
      />

      {importOpen && (
        <ImportDrawer
          open
          existingCourses={courses}
          onCancel={() => setImportOpen(false)}
          onCommit={async (incoming, mode) => {
            const merged = await importCourses(incoming, mode);
            app.message.success(
              `已导入，当前共 ${merged.courses.length} 门课程${merged.restoredExclusionCount ? `，恢复 ${merged.restoredExclusionCount} 门排除状态` : ''}`
            );
            return merged;
          }}
        />
      )}
      {batchImportOpen && (
        <Suspense fallback={null}>
          <DirectoryImportDrawer
            open
            onCancel={() => setBatchImportOpen(false)}
            onCommit={async (incoming, mode) => {
              const merged = await importCourses(incoming, mode);
              app.message.success(
                `批量导入完成，当前共 ${merged.courses.length} 门课程${merged.restoredExclusionCount ? `，恢复 ${merged.restoredExclusionCount} 门排除状态` : ''}`
              );
              return merged;
            }}
          />
        </Suspense>
      )}
      {activePanel === 'rules' && (
        <RulesDrawer
          open
          rules={rules}
          onCancel={() => setActivePanel(undefined)}
          onSave={async (nextRules) => {
            await saveRules(nextRules);
            app.message.success('计算规则已保存');
          }}
          onSaveAs={async (nextRules) => {
            await addRuleSet(nextRules);
            app.message.success(`新规则集“${nextRules.name}”已保存，可在“规则对照”中并行计算`);
          }}
        />
      )}
      {activePanel === 'compare' && (
        <ComparisonDrawer
          open
          courses={courses}
          activeRules={rules}
          ruleSets={ruleSets}
          onClose={() => setActivePanel(undefined)}
        />
      )}
      {activePanel === 'export' && (
        <ExportDrawer
          open
          results={results}
          calculated={hasCalculated}
          courseCount={courses.length}
          exporting={exporting}
          onClose={() => setActivePanel(undefined)}
          onExport={exportResult}
        />
      )}
      {exclusionKind && (
        <ResultExclusionDrawer
          key={exclusionKind}
          open
          kind={exclusionKind}
          rule={rules.exclusions[exclusionKind]}
          onClose={() => setExclusionKind(undefined)}
          onSave={async (updates: ExclusionRuleUpdates) => {
            await saveRules({
              ...rules,
              exclusions: { ...rules.exclusions, ...updates }
            });
            const targets = Object.keys(updates) as ResultKind[];
            app.message.success(targets.length > 1 ? '排除规则已保存并同步' : '排除规则已保存');
          }}
        />
      )}
      <CourseDrawer
        open={editorOpen}
        course={editingCourse}
        recommendationIncluded={recommendationIncluded}
        onClose={() => {
          setEditorOpen(false);
          setEditingCourse(undefined);
        }}
        onImport={() => {
          setEditorOpen(false);
          setEditingCourse(undefined);
          setImportOpen(true);
          setBatchImportOpen(false);
        }}
        onBatchImport={
          isDesktopRuntime
            ? () => {
                setEditorOpen(false);
                setEditingCourse(undefined);
                setBatchImportOpen(true);
              }
            : undefined
        }
        onSave={saveCourse}
      />
      <AboutDialog
        open={aboutOpen || (firstVisit && !welcomeDismissed)}
        onClose={() => {
          setAboutOpen(false);
          if (firstVisit && !welcomeDismissed) {
            setWelcomeDismissed(true);
            void acknowledgeWelcome();
          }
        }}
        onResetAll={confirmResetAll}
        onExportData={() => {
          void exportData()
            .then((data) => {
              downloadFullData(data);
              app.message.success('当前档案迁移文件已导出');
            })
            .catch((error: unknown) => {
              app.message.error(error instanceof Error ? error.message : '全量数据导出失败');
            });
        }}
        onImportData={(file) => {
          void parseFullDataFile(file)
            .then((data) => {
              app.modal.confirm({
                title: '导入并替换当前档案？',
                content: `文件包含 ${data.courses.length} 门课程。导入后将替换当前档案的课程、规则和设置，其他档案不受影响。`,
                okText: '确认导入',
                okButtonProps: { danger: true },
                cancelText: '取消',
                onOk: async () => {
                  await restoreData(data);
                  setWorkspaceVersion((version) => version + 1);
                  setAboutOpen(false);
                  app.message.success('当前档案数据已导入');
                }
              });
            })
            .catch((error: unknown) => {
              app.message.error(error instanceof Error ? error.message : '迁移文件导入失败');
            });
        }}
        onBackupDatabase={
          isDesktopRuntime
            ? () => {
                void backupDesktopDatabase()
                  .then((report) => report && app.message.success('数据库与校验和已备份'))
                  .catch((error: unknown) => app.message.error(String(error)));
              }
            : undefined
        }
        onRestoreDatabase={
          isDesktopRuntime
            ? () => {
                void selectDesktopBackup()
                  .then(async (path) => {
                    if (!path) return;
                    const report = await validateDesktopBackup(path);
                    app.modal.confirm({
                      title: '恢复并替换当前数据库？',
                      content: `备份已通过完整性、版本和校验和检查（${report.checksum.slice(0, 12)}…）。继续后将替换当前数据库，并自动保留恢复前副本。`,
                      okText: '确认恢复',
                      okButtonProps: { danger: true },
                      cancelText: '取消',
                      onOk: async () => {
                        await restoreDesktopDatabase(path);
                        app.message.success('数据库已恢复，应用即将重新载入');
                        window.location.reload();
                      }
                    });
                  })
                  .catch((error: unknown) => app.message.error(String(error)));
              }
            : undefined
        }
      />
      {archiveSupported && (
        <ArchiveDialog
          open={archiveOpen}
          archives={displayedArchives}
          activeArchiveId={activeArchiveId}
          onClose={() => setArchiveOpen(false)}
          onSwitch={async (id) => {
            await switchArchive(id);
            setActivePanel(undefined);
            setImportOpen(false);
            setBatchImportOpen(false);
            setEditorOpen(false);
            setEditingCourse(undefined);
            setExclusionKind(undefined);
            selectResultKind(undefined);
            setWorkspaceVersion((version) => version + 1);
            app.message.success('已切换成绩档案');
          }}
          onCreate={async (name) => {
            await createArchive(name);
            setActivePanel(undefined);
            setImportOpen(false);
            setBatchImportOpen(false);
            setEditorOpen(false);
            setEditingCourse(undefined);
            setExclusionKind(undefined);
            selectResultKind(undefined);
            setWorkspaceVersion((version) => version + 1);
            app.message.success(`已创建并切换到“${name}”`);
          }}
          onRename={async (id, name) => {
            await renameArchive(id, name);
            app.message.success('档案名称已更新');
          }}
          onDelete={(archive) => {
            app.modal.confirm({
              title: `删除档案“${archive.name}”？`,
              content: `将永久删除其中的 ${archive.courseCount} 门课程、规则和设置。数据库备份不会被删除。`,
              okText: '确认删除',
              okButtonProps: { danger: true },
              cancelText: '取消',
              onOk: async () => {
                await deleteArchive(archive.id);
                setActivePanel(undefined);
                setImportOpen(false);
                setBatchImportOpen(false);
                setEditorOpen(false);
                setEditingCourse(undefined);
                setExclusionKind(undefined);
                selectResultKind(undefined);
                setWorkspaceVersion((version) => version + 1);
                app.message.success('档案已删除');
              }
            });
          }}
        />
      )}
      <div className="export-host" aria-hidden="true">
        <ResultExportCard
          ref={exportRef}
          results={results}
          rules={rules}
          generatedAt={generatedAt}
        />
      </div>
    </AppShell>
  );
}

export default function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#8F2C3E',
          colorText: '#1D232B',
          colorTextSecondary: '#707986',
          colorBorder: '#DFE3E8',
          borderRadius: 5,
          fontFamily: '"Microsoft YaHei", "Segoe UI", system-ui, sans-serif'
        },
        components: {
          Button: { controlHeight: 36 },
          Table: { headerBg: '#F5F6F7', headerColor: '#4B5563', rowHoverBg: '#F8F9FA' }
        }
      }}
    >
      <AntApp>
        <AppProvider>
          <Workbench />
        </AppProvider>
      </AntApp>
    </ConfigProvider>
  );
}
