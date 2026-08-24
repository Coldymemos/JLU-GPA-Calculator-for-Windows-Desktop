import { App } from 'antd';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AboutDialog } from '../../src/ui/components/AboutDialog';

const repositoryUrl = 'https://github.com/Coldymemos/JLU-GPA-Calculator-for-Windows-Desktop';

function renderDialog() {
  render(
    <App>
      <AboutDialog
        open
        onClose={vi.fn()}
        onResetAll={vi.fn()}
        onExportData={vi.fn()}
        onImportData={vi.fn()}
      />
    </App>
  );
}

describe('AboutDialog', () => {
  it('shows the repository address as plain copyable text instead of a link', () => {
    renderDialog();

    expect(screen.getByText(repositoryUrl)).toBeInTheDocument();
    expect(document.querySelector(`a[href="${repositoryUrl}"]`)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制地址' })).toBeInTheDocument();
  });
});
