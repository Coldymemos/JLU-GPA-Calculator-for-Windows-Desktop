import { App } from 'antd';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FuturePlanningDrawer } from '../../src/ui/components/FuturePlanningDrawer';
import { defaultRuleSet } from '../../src/domain/rules/recommendation.rules';
import { makeCourse } from '../unit/test-course';

describe('FuturePlanningDrawer', () => {
  it('runs a future-course reverse plan without saving simulated courses', () => {
    render(
      <App>
        <FuturePlanningDrawer
          open
          courses={[makeCourse('current', 80, 10)]}
          rules={defaultRuleSet}
          onClose={() => undefined}
        />
      </App>
    );

    fireEvent.click(screen.getByRole('button', { name: /开始反推/ }));

    expect(screen.getByText('未来课程模拟表')).toBeInTheDocument();
    expect(screen.getByText('未来平均成绩敏感度')).toBeInTheDocument();
    expect(screen.getByText('3 学分')).toBeInTheDocument();
  });
});
