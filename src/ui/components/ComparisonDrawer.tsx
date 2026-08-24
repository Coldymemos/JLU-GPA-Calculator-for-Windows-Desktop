import { Alert, Button, Drawer, Select, Space, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { calculateAllResults } from '../../domain/calculation/calculate';
import type { CalculationResult, Course, ResultKind } from '../../domain/course/course.types';
import { defaultRuleSet } from '../../domain/rules/recommendation.rules';
import type { AppRuleSet } from '../../domain/rules/rule-set.types';
import type { AllResults } from '../state/app-context';

const resultKinds: { kind: ResultKind; label: string }[] = [
  { kind: 'recommendation-gpa', label: '保研 GPA' },
  { kind: 'weighted-average', label: '加权平均分' },
  { kind: 'arithmetic-average', label: '算术平均分' }
];

interface Props {
  open: boolean;
  courses: Course[];
  activeRules: AppRuleSet;
  ruleSets: AppRuleSet[];
  onClose: () => void;
}

function renderCell(
  result: CalculationResult | undefined,
  reference: CalculationResult | undefined
) {
  if (!result) return <Typography.Text type="secondary">未计算</Typography.Text>;
  if (result.status === 'empty')
    return <Typography.Text type="secondary">0 门课程</Typography.Text>;
  if (result.status !== 'success') return <Typography.Text type="secondary">—</Typography.Text>;

  let differs = false;
  if (result.value !== undefined && reference?.value !== undefined) {
    differs = Math.abs(result.value - reference.value) > Number.EPSILON;
  }
  return (
    <Space orientation="vertical" size={0}>
      <Space size={6}>
        <span className={differs ? 'compare-diff' : undefined}>{result.formattedValue}</span>
        {differs && <Tag color="orange">差异</Tag>}
      </Space>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {result.courseCount} 门课程
      </Typography.Text>
    </Space>
  );
}

const resultKeyByKind: Record<ResultKind, keyof AllResults> = {
  'recommendation-gpa': 'recommendationGpa',
  'weighted-average': 'weightedAverage',
  'arithmetic-average': 'arithmeticAverage'
};

export function ComparisonDrawer({ open, courses, activeRules, ruleSets, onClose }: Props) {
  const candidates = useMemo(() => {
    const byId = new Map<string, AppRuleSet>();
    // 当前规则 + 默认预设 + 已保存规则集，按 id 去重
    for (const rules of [activeRules, defaultRuleSet, ...ruleSets]) byId.set(rules.id, rules);
    return [...byId.values()];
  }, [activeRules, ruleSets]);

  const [selectedIds, setSelectedIds] = useState<string[]>(() => candidates.map((item) => item.id));
  const [results, setResults] = useState<Record<string, AllResults>>({});
  const [comparing, setComparing] = useState(false);

  const selected = useMemo(
    () => candidates.filter((item) => selectedIds.includes(item.id)),
    [candidates, selectedIds]
  );

  const run = async () => {
    if (!courses.length || selected.length === 0) return;
    setComparing(true);
    const next: Record<string, AllResults> = {};
    for (const rules of selected) {
      next[rules.id] = calculateAllResults(courses, rules);
    }
    setResults(next);
    setComparing(false);
  };

  return (
    <Drawer
      open={open}
      title="多规则集并行对照"
      size={900}
      className="functional-drawer comparison-drawer"
      onClose={onClose}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button
            type="primary"
            loading={comparing}
            disabled={courses.length === 0 || selected.length === 0}
            onClick={() => void run()}
          >
            计算对照
          </Button>
        </Space>
      }
    >
      <Space orientation="vertical" size="middle" className="full-width">
        <Alert
          type="info"
          showIcon
          title="同一份课程数据按多套规则集并行计算"
          description="下拉选择要对照的规则集后点击“计算对照”。标有“差异”的结果与当前规则计算结果不同，便于对比不同年份/学院/专业的规则口径。"
        />
        <div>
          <Typography.Text strong>选择规则集</Typography.Text>
          <Select
            mode="multiple"
            style={{ width: '100%' }}
            placeholder="选择要对照的规则集"
            maxTagCount={4}
            allowClear
            value={selectedIds}
            onChange={(values) => setSelectedIds(values as string[])}
            options={candidates.map((item) => ({
              label: `${item.name}（${item.version}）`,
              value: item.id
            }))}
          />
        </div>
        {courses.length === 0 && (
          <Alert type="warning" showIcon title="当前没有课程，请先导入成绩后再进行规则对照。" />
        )}
        {selected.length > 0 && (
          <Table
            size="small"
            rowKey="kind"
            pagination={false}
            dataSource={resultKinds}
            columns={[
              {
                title: '结果',
                key: 'kind',
                width: 140,
                render: (_: unknown, row: { kind: ResultKind; label: string }) => row.label
              },
              ...selected.map((rules) => ({
                title: rules.name,
                key: rules.id,
                render: (_: unknown, row: { kind: ResultKind }) =>
                  renderCell(
                    results[rules.id]?.[resultKeyByKind[row.kind]],
                    results[activeRules.id]?.[resultKeyByKind[row.kind]]
                  )
              }))
            ]}
          />
        )}
        {Object.keys(results).length > 0 && (
          <Alert
            type="success"
            showIcon
            title="对照计算完成：结果基于当前已保存课程，不改变任何已保存数据。"
          />
        )}
      </Space>
    </Drawer>
  );
}
