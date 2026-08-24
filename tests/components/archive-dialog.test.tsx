import { App } from 'antd';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ArchiveSummary } from '../../src/infrastructure/persistence';
import { ArchiveDialog } from '../../src/ui/components/ArchiveDialog';

const archives: ArchiveSummary[] = [
  {
    id: 'default',
    name: '默认档案',
    createdAt: '2026-08-23 00:00:00',
    courseCount: 3
  },
  {
    id: 'second',
    name: '大二',
    createdAt: '2026-08-23 01:00:00',
    courseCount: 8
  }
];

function renderDialog(overrides: Partial<ComponentProps<typeof ArchiveDialog>> = {}) {
  const props: ComponentProps<typeof ArchiveDialog> = {
    open: true,
    archives,
    activeArchiveId: 'default',
    onClose: vi.fn(),
    onSwitch: vi.fn().mockResolvedValue(undefined),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onRename: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn(),
    ...overrides
  };
  render(
    <App>
      <ArchiveDialog {...props} />
    </App>
  );
  return props;
}

describe('ArchiveDialog', () => {
  it('shows the active archive and switches to another archive', async () => {
    const props = renderDialog();

    expect(screen.getByText('当前')).toBeInTheDocument();
    expect(screen.getByText(/3 门课程/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '切换' }));

    await waitFor(() => expect(props.onSwitch).toHaveBeenCalledWith('second'));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('creates, renames and requests deletion of an archive', async () => {
    const props = renderDialog();

    fireEvent.change(screen.getByPlaceholderText(/新档案名称/), {
      target: { value: '大三' }
    });
    fireEvent.click(screen.getByRole('button', { name: /新建/ }));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledWith('大三'));

    fireEvent.click(screen.getByRole('button', { name: '重命名 大二' }));
    fireEvent.change(screen.getByDisplayValue('大二'), { target: { value: '大二下' } });
    fireEvent.click(screen.getByRole('button', { name: '保存档案名称' }));
    await waitFor(() => expect(props.onRename).toHaveBeenCalledWith('second', '大二下'));

    fireEvent.click(screen.getByRole('button', { name: '删除 默认档案' }));
    expect(props.onDelete).toHaveBeenCalledWith(archives[0]);
  });
});
