import { FolderOpenOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Drawer,
  Modal,
  Progress,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseSpreadsheet,
  runFileImportQueue,
  sha256Hex,
  type FileImportReport,
  type QueueSummary
} from '../../application/directory-import';
import type { Course } from '../../domain/course/course.types';
import type { ImportMergeMode, MergeResult } from '../../infrastructure/importers/import.types';
import type {
  SniffResult,
  SpreadsheetFormat,
  SniffVerdict
} from '../../infrastructure/importers/sniffer';
import {
  type CandidateFile,
  pickImportDirectory,
  readFileBytes,
  scanDirectory,
  sniffSpreadsheetBuffer
} from '../../infrastructure/desktop/directory-importer';
import { database } from '../../infrastructure/persistence';

const LAST_DIRECTORY_SETTING = 'last-import-directory';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCommit: (courses: Course[], mode: ImportMergeMode) => Promise<MergeResult>;
}

const verdictMeta: Record<SniffVerdict, { label: string; color: string }> = {
  importable: { label: '可自动导入', color: 'success' },
  'needs-confirmation': { label: '需确认', color: 'warning' },
  'not-a-grade-sheet': { label: '非成绩表', color: 'error' }
};

const formatLabels: Record<SpreadsheetFormat, string> = {
  xlsx: 'XLSX',
  xls: 'XLS',
  csv: 'CSV',
  unknown: '未知'
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const outcomeMeta: Record<FileImportReport['outcome'], { label: string; color: string }> = {
  imported: { label: '已导入', color: 'success' },
  'skipped-duplicate': { label: '跳过（内容重复）', color: 'default' },
  skipped: { label: '跳过', color: 'default' },
  'needs-sheet': { label: '待选工作表', color: 'warning' },
  failed: { label: '失败', color: 'error' }
};

export function DirectoryImportDrawer({ open, onCancel, onCommit }: Props) {
  const app = App.useApp();
  const [dir, setDir] = useState<string>();
  const [recursive, setRecursive] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [sniffing, setSniffing] = useState(false);
  const [sniffProgress, setSniffProgress] = useState(0);
  const [files, setFiles] = useState<CandidateFile[]>([]);
  const [sniffs, setSniffs] = useState<Record<string, SniffResult>>({});
  const [decisions, setDecisions] = useState<Record<string, 'import' | 'skip'>>({});
  const [reports, setReports] = useState<FileImportReport[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<QueueSummary>();
  const [confirming, setConfirming] = useState<{ file: CandidateFile; sniff: SniffResult }>();
  const [sheetRetry, setSheetRetry] = useState<Record<string, string>>({});
  const seenHashes = useRef(new Set<string>());

  const scan = async (target: string, useRecursive: boolean) => {
    setScanning(true);
    setSniffs({});
    setReports([]);
    setSummary(undefined);
    try {
      const found = await scanDirectory(target, useRecursive);
      setFiles(found);
      await sniffAll(found);
    } catch (error) {
      setFiles([]);
      app.message.error(error instanceof Error ? error.message : '扫描目录失败');
    } finally {
      setScanning(false);
    }
  };

  const pickDir = async () => {
    const picked = await pickImportDirectory();
    if (!picked) return;
    setDir(picked);
    void database.saveSetting(LAST_DIRECTORY_SETTING, picked).catch(() => undefined);
    void scan(picked, recursive);
  };

  const sniffAll = async (targets = files) => {
    if (!targets.length) return;
    setSniffing(true);
    setSniffProgress(0);
    let done = 0;
    for (const file of targets) {
      try {
        const sniff = await sniffSpreadsheetBuffer(await readFileBytes(file.path), file.name);
        setSniffs((previous) => ({ ...previous, [file.path]: sniff }));
      } catch {
        // 读取/解析失败按无法识别处理，不中断其余文件
        setSniffs((previous) => ({
          ...previous,
          [file.path]: {
            fileName: file.name,
            format: 'unknown',
            sheetNames: [],
            header: [],
            sampleRows: [],
            matchedFields: [],
            confidence: 0,
            verdict: 'not-a-grade-sheet'
          }
        }));
      }
      done += 1;
      setSniffProgress(done / targets.length);
    }
    setSniffing(false);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // 组件每次打开都会重新挂载，状态天然为初始值，这里只恢复上次目录并自动扫描
    void database
      .loadSetting<string>(LAST_DIRECTORY_SETTING)
      .then((saved) => {
        if (!cancelled && saved) {
          setDir(saved);
          void scan(saved, recursive);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const eligibleCount = useMemo(
    () =>
      files.filter((file) => {
        const sniff = sniffs[file.path];
        if (!sniff) return false;
        if (sniff.verdict === 'needs-confirmation') return decisions[file.path] === 'import';
        return sniff.verdict === 'importable';
      }).length,
    [decisions, files, sniffs]
  );

  // 在事件处理器内构建（访问 seenHashes ref 不能发生在渲染期）
  const createQueueDeps = () => ({
    seenHashes: seenHashes.current,
    readBytes: readFileBytes,
    sha256: sha256Hex,
    sniff: sniffSpreadsheetBuffer,
    parse: parseSpreadsheet,
    commit: async (courses: Course[]) => onCommit(courses, 'append'),
    onFile: (report: FileImportReport) => setReports((previous) => [...previous, report])
  });

  const runAll = async () => {
    const eligible = files.filter((file) => {
      const sniff = sniffs[file.path];
      if (!sniff) return false;
      if (sniff.verdict === 'needs-confirmation') return decisions[file.path] === 'import';
      return sniff.verdict === 'importable';
    });
    if (!eligible.length) {
      app.message.info('没有可自动导入的文件，请先确认标记为“需确认”的文件');
      return;
    }
    setRunning(true);
    setReports([]);
    setSummary(undefined);
    try {
      const result = await runFileImportQueue(
        eligible.map((file) => ({ file, sheet: sheetRetry[file.path] })),
        createQueueDeps()
      );
      setSummary(result);
      if (result.imported > 0) {
        app.message.success(`批量导入完成：${result.imported} 个文件成功导入`);
      } else {
        app.message.info('本次没有文件成功导入');
      }
    } catch (error) {
      app.message.error(error instanceof Error ? error.message : '批量导入失败');
    } finally {
      setRunning(false);
    }
  };

  const retryFile = async (path: string) => {
    const file = files.find((candidate) => candidate.path === path);
    if (!file) return;
    setRunning(true);
    try {
      await runFileImportQueue([{ file, sheet: sheetRetry[path] }], createQueueDeps());
    } catch (error) {
      app.message.error(error instanceof Error ? error.message : '导入失败');
    } finally {
      setRunning(false);
    }
  };

  const busy = scanning || sniffing || running;
  const reportByPath = useMemo(
    () => new Map(reports.map((report) => [report.path, report])),
    [reports]
  );

  const columns = [
    {
      title: '文件',
      key: 'name',
      render: (_: unknown, file: CandidateFile) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text>{file.name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {formatSize(file.size)}
            {file.extension === 'csv' ? ' · CSV' : ''}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: '内容识别',
      key: 'sniff',
      width: 190,
      render: (_: unknown, file: CandidateFile) => {
        const sniff = sniffs[file.path];
        if (!sniff) return <Typography.Text type="secondary">嗅探中…</Typography.Text>;
        const meta = verdictMeta[sniff.verdict];
        return (
          <Space orientation="vertical" size={2}>
            <Space size={6}>
              <Tag color={meta.color}>{meta.label}</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {formatLabels[sniff.format]}
                {sniff.encoding && sniff.encoding !== 'utf-8' ? ` · ${sniff.encoding}` : ''}
              </Typography.Text>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              置信度 {Math.round(sniff.confidence * 100)}%
            </Typography.Text>
          </Space>
        );
      }
    },
    {
      title: '导入结果',
      key: 'report',
      width: 220,
      render: (_: unknown, file: CandidateFile) => {
        const report = reportByPath.get(file.path);
        if (!report) return <Typography.Text type="secondary">未处理</Typography.Text>;
        const meta = outcomeMeta[report.outcome];
        return (
          <Space orientation="vertical" size={2}>
            <Tag color={meta.color}>{meta.label}</Tag>
            {report.message && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {report.message}
              </Typography.Text>
            )}
          </Space>
        );
      }
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_: unknown, file: CandidateFile) => {
        const sniff = sniffs[file.path];
        const report = reportByPath.get(file.path);
        if (sniff?.verdict === 'needs-confirmation') {
          return decisions[file.path] === 'import' ? (
            <Typography.Text type="secondary">已确认导入</Typography.Text>
          ) : (
            <Button size="small" onClick={() => setConfirming({ file, sniff })}>
              查看并确认
            </Button>
          );
        }
        if (report?.outcome === 'needs-sheet' && report.sheetNames) {
          return (
            <Space size={4}>
              <Select
                size="small"
                style={{ minWidth: 120 }}
                placeholder="选择工作表"
                value={sheetRetry[file.path]}
                options={report.sheetNames.map((name) => ({ label: name, value: name }))}
                onChange={(name) =>
                  setSheetRetry((previous) => ({ ...previous, [file.path]: name }))
                }
              />
              <Button
                size="small"
                type="primary"
                disabled={!sheetRetry[file.path] || running}
                onClick={() => void retryFile(file.path)}
              >
                重试
              </Button>
            </Space>
          );
        }
        if (report?.outcome === 'failed' || report?.outcome === 'skipped') {
          return (
            <Button size="small" disabled={running} onClick={() => void retryFile(file.path)}>
              重试
            </Button>
          );
        }
        return null;
      }
    }
  ];

  const confirmDecision = (decision: 'import' | 'skip') => {
    if (!confirming) return;
    if (decision === 'import') {
      setDecisions((previous) => ({ ...previous, [confirming.file.path]: 'import' }));
      app.message.info(`${confirming.file.name} 已标记为导入`);
    } else {
      setDecisions((previous) => ({ ...previous, [confirming.file.path]: 'skip' }));
    }
    setConfirming(undefined);
  };

  const confirmSniff = confirming?.sniff;
  const confirmHeader = confirmSniff?.header ?? [];

  return (
    <Drawer
      open={open}
      title="批量导入成绩表目录"
      size={860}
      className="functional-drawer directory-import-drawer"
      onClose={onCancel}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onCancel} disabled={busy}>
            关闭
          </Button>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={running}
            disabled={busy || eligibleCount === 0}
            onClick={() => void runAll()}
          >
            导入全部{eligibleCount > 0 ? `（${eligibleCount}）` : ''}
          </Button>
        </Space>
      }
    >
      <Space orientation="vertical" size="middle" className="full-width">
        <Alert
          type="info"
          showIcon
          title="按文件内容识别，文件名仅供参考"
          description="将扫描目录内 .xls / .xlsx / .csv 候选文件（内容不匹配时跳过）；内容重复的文件自动去重；低置信度文件需人工确认后才会导入。"
        />
        <Space wrap>
          <Button icon={<FolderOpenOutlined />} onClick={() => void pickDir()} disabled={busy}>
            选择目录
          </Button>
          {dir && (
            <Tooltip title={dir}>
              <Typography.Text type="secondary" style={{ maxWidth: 380 }} ellipsis>
                {dir}
              </Typography.Text>
            </Tooltip>
          )}
          <Space size={6}>
            <Switch
              checked={recursive}
              disabled={busy}
              onChange={(checked) => {
                setRecursive(checked);
                if (dir) void scan(dir, checked);
              }}
            />
            <Typography.Text type="secondary">包含子目录</Typography.Text>
          </Space>
          {dir && (
            <Button
              icon={<ReloadOutlined />}
              disabled={busy}
              onClick={() => dir && void scan(dir, recursive)}
            >
              重新扫描
            </Button>
          )}
        </Space>
        {(sniffing || running) && (
          <Progress
            percent={Math.round(
              (sniffing ? sniffProgress : reports.length / Math.max(eligibleCount, 1)) * 100
            )}
            status={running ? 'active' : undefined}
          />
        )}
        {files.length === 0 && !scanning && (
          <Typography.Text type="secondary">尚未选择目录，或目录中没有候选文件。</Typography.Text>
        )}
        {files.length > 0 && (
          <Table
            size="small"
            rowKey="path"
            dataSource={files}
            columns={columns}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
          />
        )}
        {summary && (
          <Alert
            type={summary.failed > 0 ? 'warning' : 'success'}
            showIcon
            title={`本次导入：成功 ${summary.imported} 个文件；内容重复跳过 ${summary.duplicate} 个；其余跳过 ${summary.skipped} 个；失败 ${summary.failed} 个。`}
          />
        )}
      </Space>

      <Modal
        open={Boolean(confirming)}
        title="确认导入此文件？"
        width={640}
        okText="导入此文件"
        cancelText="跳过"
        onOk={() => confirmDecision('import')}
        onCancel={() => confirmDecision('skip')}
      >
        {confirming && confirmSniff && (
          <Space orientation="vertical" size="middle" className="full-width">
            <Descriptions size="small" bordered column={1}>
              <Descriptions.Item label="文件名">{confirming.file.name}</Descriptions.Item>
              <Descriptions.Item label="识别格式">
                {formatLabels[confirmSniff.format]}
                {confirmSniff.encoding && confirmSniff.encoding !== 'utf-8'
                  ? `（${confirmSniff.encoding}）`
                  : ''}
              </Descriptions.Item>
              <Descriptions.Item label="表头">
                {confirmHeader.length > 0 ? confirmHeader.join(' / ') : '未识别到表头'}
              </Descriptions.Item>
              <Descriptions.Item label="命中字段">
                {confirmSniff.matchedFields.length > 0
                  ? confirmSniff.matchedFields.join('、')
                  : '无'}
              </Descriptions.Item>
            </Descriptions>
            {confirmHeader.length > 0 && (
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                dataSource={confirmSniff.sampleRows.map((row, index) => ({ key: index, row }))}
                columns={confirmHeader.slice(0, 8).map((header, index) => ({
                  title: header,
                  key: String(index),
                  ellipsis: true,
                  render: (_: unknown, record: { row: string[] }) => record.row[index] ?? ''
                }))}
              />
            )}
          </Space>
        )}
      </Modal>
    </Drawer>
  );
}
