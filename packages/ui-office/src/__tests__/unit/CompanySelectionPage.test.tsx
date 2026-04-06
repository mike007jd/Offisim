import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CompanySelectionPage } from '../../components/company/CompanySelectionPage';

vi.mock('../../components/company/CompanyContext', () => ({
  useCompany: () => ({
    companies: [
      {
        company_id: 'co-1',
        name: 'Orbit Labs',
        status: 'active',
        template_label: null,
        updated_at: '2026-04-06T00:00:00.000Z',
      },
    ],
    activeCompanyId: 'co-1',
  }),
}));

vi.mock('../../runtime/offisim-runtime-context.js', () => ({
  useOffisimRuntime: () => ({
    repos: null,
  }),
}));

vi.mock('../../hooks/useCompanyPreview.js', () => ({
  useCompanyPreview: () => ({
    data: { zones: [], prefabs: [] },
    loading: false,
  }),
}));

describe('CompanySelectionPage', () => {
  it('requires a second click before archiving the selected company', () => {
    const onArchiveCompany = vi.fn();

    render(
      <CompanySelectionPage
        previewCompanyId="co-1"
        onPreviewCompany={vi.fn()}
        onEnterCompany={vi.fn()}
        onCreateNew={vi.fn()}
        onArchiveCompany={onArchiveCompany}
      />,
    );

    const archiveButton = screen.getByRole('button', { name: 'Archive Company' });
    fireEvent.click(archiveButton);

    expect(onArchiveCompany).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm Archive' })).toBeInTheDocument();
    expect(screen.getByText(/Archive Orbit Labs/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Archive' }));

    expect(onArchiveCompany).toHaveBeenCalledWith('co-1');
  });
});
