import { BulbOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  InputNumber,
  Select,
  Space,
  Table,
  Tag,
  Typography
} from 'antd';
import { useMemo, useState } from 'react';
import type { Course, ResultKind } from '../../domain/course/course.types';
import {
  buildFutureSensitivity,
  calculateFuturePlan,
  findMinimumFuturePlan,
  type FutureCourseInput,
  type FuturePlanResult
} from '../../domain/calculation/future-planning';
import { calculateResult } from '../../domain/calculation/calculate';
import type { AppRuleSet } from '../../domain/rules/rule-set.types';

const kindOptions: { label: string; value: ResultKind }[] = [
  { label: '保研 GPA', value: 'recommendation-gpa' },
  { label: '加权平均分', value: 'weighted-average' },
  { label: '算术平均分', value: 'arithmetic-average' }
];

function valueOf(result: ReturnType<typeof calculateResult>): number {
  return result.status === 'success' && result.value !== undefined ? result.value : 0;
}

function formatValue(value: number | undefined): string {
  return value === undefined ? '—' : value.toFixed(2);
}

function defaultTarget(kind: ResultKind, current: number): number {
  if (kind === 'recommendation-gpa') return Number((current + 0.1).toFixed(2));
  return Math.ceil(current + 5);
}

interface Props {
  open: boolean;
  courses: Course[];
  rules: AppRuleSet;
  onClose: () => void;
}

export function FuturePlanningDrawer({ open, courses, rules, onClose }: Props) {
  const [kind, setKind] = useState<ResultKind>('recommendation-gpa');
  const [target, setTarget] = useState<number>(3.5);
  const [creditPerCourse, setCreditPerCourse] = useState(3);
  const [plan, setPlan] = useState<FutureCourseInput[]>([]);
  const [result, setResult] = useState<FuturePlanResult>();
  const currentResult = useMemo(
    () => calculateResult(courses, kind, rules),
    [courses, kind, rules]
  );
  const sensitivity = useMemo(
    () =>
      result
        ? buildFutureSensitivity(courses, rules, {
            kind,
            target,
            creditPerCourse,
            maxCourses: 40
          })
        : [],
    [courses, creditPerCourse, kind, result, rules, target]
  );

  const runReverse = () => {
    const next = findMinimumFuturePlan(courses, rules, {
      kind,
      target,
      creditPerCourse,
      scoreMin: 60,
      scoreMax: 100,
      maxCourses: 40
    });
    setResult(next);
    setPlan(next.futureCourses);
  };

  const changeKind = (nextKind: ResultKind) => {
    setKind(nextKind);
    setTarget(defaultTarget(nextKind, valueOf(calculateResult(courses, nextKind, rules))));
    setResult(undefined);
    setPlan([]);
  };

  const recalculatePlan = () => {
    if (!result) return;
    const projected = calculateFuturePlan(courses, rules, kind, plan);
    setResult({
      ...result,
      projectedValue: projected.value,
      futureCourses: plan,
      futureCredits: plan.reduce((sum, item) => sum + item.credit, 0),
      futureCourseCount: plan.length,
      averageScore:
        plan.length > 0
          ? plan.reduce((sum, item) => sum + item.score * item.credit, 0) /
            plan.reduce((sum, item) => sum + item.credit, 0)
          : undefined
    });
  };

  const updatePlan = (index: number, patch: Partial<FutureCourseInput>) => {
    setPlan((previous) =>
      previous.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    );
  };

  return (
    <Drawer
      open={open}
      title="目标规划与敏感度"
      size={900}
      className="functional-drawer future-planning-drawer"
      onClose={onClose}
      destroyOnHidden
      extra={<Button onClick={onClose}>关闭</Button>}
    >
      <Space orientation="vertical" size="middle" className="full-width">
        <Alert
          type="info"
          showIcon
          icon={<BulbOutlined />}
          title="只模拟未来课程，不修改当前档案"
          description="已修课程视为固定成绩。规划课程只存在于本次模拟中，不会保存到课程库。"
        />

        <div className="future-planning-controls">
          <div>
            <Typography.Text strong>目标指标</Typography.Text>
            <Select
              className="full-width"
              value={kind}
              options={kindOptions}
              onChange={changeKind}
            />
          </div>
          <div>
            <Typography.Text strong>目标值</Typography.Text>
            <InputNumber
              className="full-width"
              min={0}
              max={kind === 'recommendation-gpa' ? 4 : 100}
              step={kind === 'recommendation-gpa' ? 0.01 : 0.1}
              value={target}
              onChange={(value) => {
                setTarget(value ?? 0);
                setResult(undefined);
                setPlan([]);
              }}
            />
          </div>
          <div>
            <Typography.Text strong>每门模拟课学分</Typography.Text>
            <Select
              className="full-width"
              value={creditPerCourse}
              options={[0.5, 1, 2, 3, 4, 5, 6].map((value) => ({
                label: `${value} 学分`,
                value
              }))}
              onChange={(value) => {
                setCreditPerCourse(value);
                setResult(undefined);
                setPlan([]);
              }}
            />
          </div>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={runReverse}
            disabled={!Number.isFinite(target) || target < 0}
          >
            开始反推
          </Button>
        </div>

        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="当前值">{formatValue(currentResult.value)}</Descriptions.Item>
          <Descriptions.Item label="目标值">{formatValue(target)}</Descriptions.Item>
          <Descriptions.Item label="当前课程">{currentResult.courseCount} 门</Descriptions.Item>
          <Descriptions.Item label="当前学分">
            {currentResult.creditSum === undefined
              ? '按课程数计算'
              : `${currentResult.creditSum} 学分`}
          </Descriptions.Item>
        </Descriptions>

        {result && !result.feasible && (
          <Alert
            type="warning"
            showIcon
            title="按当前条件无法达到目标"
            description="已按每门课程最高 100 分、最多 40 门模拟课程搜索。可以降低目标、提高每门课学分，或扩大课程数量上限。"
          />
        )}
        {result?.reason === 'already-reached' && (
          <Alert type="success" showIcon title="当前结果已经达到目标，不需要额外课程。" />
        )}
        {result?.feasible && result.reason !== 'already-reached' && (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="最少未来课程">
              {result.futureCourseCount} 门
            </Descriptions.Item>
            <Descriptions.Item label="最少未来学分">{result.futureCredits} 学分</Descriptions.Item>
            <Descriptions.Item label="未来最低平均成绩">
              {formatValue(result.averageScore)}
            </Descriptions.Item>
            <Descriptions.Item label="模拟后结果">
              <Tag color="green">{formatValue(result.projectedValue)}</Tag>
            </Descriptions.Item>
          </Descriptions>
        )}

        {result?.feasible && result.futureCourses.length > 0 && (
          <>
            <div className="section-heading">
              <div>
                <Typography.Title level={4}>未来课程模拟表</Typography.Title>
                <Typography.Text type="secondary">
                  可以直接调整学分和成绩，再点击“重新计算”查看这组具体计划。
                </Typography.Text>
              </div>
              <Button icon={<ReloadOutlined />} onClick={recalculatePlan}>
                重新计算
              </Button>
            </div>
            <Table
              size="small"
              pagination={false}
              rowKey={(_row, index) => String(index)}
              dataSource={plan}
              columns={[
                {
                  title: '课程',
                  render: (_: unknown, _row: FutureCourseInput, index: number) =>
                    `规划课程 ${index + 1}`
                },
                {
                  title: '学分',
                  render: (_: unknown, row: FutureCourseInput, index: number) => (
                    <InputNumber
                      min={0.5}
                      max={20}
                      step={0.5}
                      value={row.credit}
                      onChange={(value) => updatePlan(index, { credit: value ?? row.credit })}
                    />
                  )
                },
                {
                  title: '模拟成绩',
                  render: (_: unknown, row: FutureCourseInput, index: number) => (
                    <InputNumber
                      min={0}
                      max={100}
                      value={row.score}
                      onChange={(value) => updatePlan(index, { score: value ?? row.score })}
                    />
                  )
                }
              ]}
            />
          </>
        )}

        {result && (
          <>
            <Typography.Title level={4}>未来平均成绩敏感度</Typography.Title>
            <Typography.Text type="secondary">
              在每门模拟课程学分固定为 {creditPerCourse} 时，不同未来平均成绩对应的最低课程需求。
            </Typography.Text>
            <Table
              size="small"
              pagination={false}
              rowKey="score"
              dataSource={sensitivity}
              columns={[
                {
                  title: '未来平均成绩',
                  dataIndex: 'score',
                  render: (value: number) => `${value} 分`
                },
                {
                  title: '最低未来学分',
                  dataIndex: 'futureCredits',
                  render: (value: number, row) => (row.feasible ? `${value} 学分` : '不可达')
                },
                {
                  title: '最低课程数',
                  dataIndex: 'futureCourseCount',
                  render: (value: number, row) => (row.feasible ? `${value} 门` : '—')
                },
                {
                  title: '模拟后结果',
                  dataIndex: 'projectedValue',
                  render: (value: number | undefined, row) =>
                    row.feasible ? formatValue(value) : '—'
                }
              ]}
            />
          </>
        )}
      </Space>
    </Drawer>
  );
}
