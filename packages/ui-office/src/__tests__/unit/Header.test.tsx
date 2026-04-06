import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Header } from '../../components/layout/Header.js';

vi.mock('../../components/install/FileImportTrigger.js', () => ({
  FileImportTrigger: () => <button type="button">Import</button>,
}));

describe('Header', () => {
  it('renders primary workspace navigation separately from header utilities', async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi.fn();

    render(
      <Header
        companyName="Acme"
        onOpenSettings={vi.fn()}
        onFileImport={vi.fn()}
        onSelectWorkspace={onSelectWorkspace}
        notificationSlot={<button type="button">Notifications</button>}
        marketSlot={<button type="button">Market</button>}
      />,
    );

    expect(screen.getByRole('button', { name: 'Office' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SOPs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Market' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'SOPs' }));

    expect(onSelectWorkspace).toHaveBeenCalledWith('sops');
  });
});
