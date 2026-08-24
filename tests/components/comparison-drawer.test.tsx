import { App } from 'antd';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppRuleSet } from '../../src/domain/rules/rule-set.types';
import { defaultRuleSet } from '../../src/domain/rules/recommendation.rules';
import { ComparisonDrawer } from '../../src/ui/components/ComparisonDrawer';
import { makeCourse } from '../unit/test-course';

const courses = [makeCourse('1', 92, 3), makeCourse('2', 76, 2), makeCourse('3', 58, 1)];

/** 与默认预设不同的规则集：绩点按更高门槛映射 */
const strictRules: AppRuleSet = {
  ...structuredClone(defaultRuleSet),
  id: 'strict-2026',
  name: '严格 2026 规则',
  version: '2026.09',
  gradePoint: {
    ...structuredClone(defaultRuleSet.gradePoint),
    bands: [
      { minInclusive: 95, maxExclusive: 101, gradePoint: 4 },
      { minInclusive: 90, maxExclusive: 95, gradePoint: 3.5 },
      { minInclusive: 85, maxExclusive: 90, gradePoint: 3 },
      { minInclusive: 80, maxExclusive: 85, gradePoint: 2.5 },
      { minInclusive: 70, maxExclusive: 80, gradePoint: 2 },
      { minInclusive: 60, maxExclusive: 70, gradePoint: 1 },
      { minInclusive: 0, maxExclusive: 60, gradePoint: 0 }
    ]
  }
};

/** antd 6 下拉中的可见选项（无 role=option，需用类名定位） */
function dropdownOptions(): HTMLElement[] {
  const dropdown = document.querySelector('.ant-select-dropdown');
  return Array.from(dropdown?.querySelectorAll<HTMLElement>('.ant-select-item-option') ?? []);
}

function openDropdown(): HTMLElement {
  fireEvent.mouseDown(screen.getByRole('combobox'));
  const options = dropdownOptions();
  if (!options.length) throw new Error('下拉未打开');
  return options[0];
}

function renderDrawer(overrides: { activeRules?: AppRuleSet; ruleSets?: AppRuleSet[] } = {}) {
  render(
    <App>
      <ComparisonDrawer
        open
        courses={courses}
        activeRules={overrides.activeRules ?? defaultRuleSet}
        ruleSets={overrides.ruleSets ?? []}
        onClose={vi.fn()}
      />
    </App>
  );
}

describe('ComparisonDrawer（M4.3 多规则集并行对照）', () => {
  it('候选包含当前规则与默认预设，下拉默认全部选中', () => {
    renderDrawer({ ruleSets: [strictRules] });
    openDropdown();

    // 下拉菜单包含两套规则集
    const options = dropdownOptions();
    expect(options).toHaveLength(2);
    expect(options.some((option) => option.textContent?.includes('项目常用预设'))).toBe(true);
    expect(options.some((option) => option.textContent?.includes('严格 2026 规则'))).toBe(true);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

    // 默认全部选中：两套规则集都以选中标签渲染在选择框内
    const tags = Array.from(document.querySelectorAll('.ant-select-selection-item'));
    expect(tags).toHaveLength(2);
    expect(tags.some((tag) => tag.textContent?.includes('项目常用预设'))).toBe(true);
    expect(tags.some((tag) => tag.textContent?.includes('严格 2026 规则'))).toBe(true);
  });

  it('计算对照后展示各规则集结果并标记差异', async () => {
    renderDrawer({ ruleSets: [strictRules] });

    fireEvent.click(screen.getByRole('button', { name: '计算对照' }));

    await waitFor(() => expect(screen.getByText(/对照计算完成/)).toBeInTheDocument());
    // 默认规则下 GPA ≈ 2.77；严格规则下 ≈ 2.42，保研 GPA 应有差异标记
    expect(screen.getByText('2.77')).toBeInTheDocument();
    expect(screen.getByText('2.42')).toBeInTheDocument();
    expect(screen.getAllByText('差异').length).toBe(1);
    expect(screen.getAllByText('3 门课程').length).toBeGreaterThan(0);
  });

  it('取消选择某规则集后不再计算该列', async () => {
    renderDrawer({ ruleSets: [strictRules] });

    openDropdown();
    const strictOption = dropdownOptions().find((option) =>
      option.textContent?.includes('严格 2026 规则')
    )!;
    fireEvent.click(strictOption);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: '计算对照' }));

    await waitFor(() => expect(screen.getByText(/对照计算完成/)).toBeInTheDocument());
    expect(screen.queryByText('2.42')).not.toBeInTheDocument();
    expect(screen.queryByText('差异')).not.toBeInTheDocument();
  });
});
