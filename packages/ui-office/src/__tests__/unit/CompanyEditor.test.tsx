import { render, screen } from '@testing-library/react';

vi.mock('../../hooks/useCompanyZones.js', () => ({
  useCompanyZones: () => ({
    zones: [
      {
        zoneId: 'zone-1',
        label: 'Rest Area',
        archetype: 'rest_area',
        accentColor: '#f59e0b',
        deskSlots: 4,
      },
    ],
  }),
}));

vi.mock('../../hooks/useOfficeLayout.js', () => ({
  useOfficeLayout: () => ({
    activeLayout: {
      layout_json: JSON.stringify({
        zoneProps: {
          'zone-1': {
            displayName: 'Rest Area',
            accentColor: '#f59e0b',
            enabled: true,
            workstationCount: 4,
          },
        },
      }),
    },
  }),
}));

import { CompanyEditor } from '../../components/company/CompanyEditor.js';

describe('CompanyEditor', () => {
  it('uses the new studio settings surface instead of the legacy gray modal framing', () => {
    render(
      <CompanyEditor
        company={{ name: 'Offisim Demo', description: 'An AI-native workspace.' }}
        policy={{ defaultModel: 'MiniMax-M1', defaultTemperature: 0.7, defaultMaxTokens: 4096 }}
        isDirty={false}
        isSaving={false}
        isOpen
        updateCompanyName={vi.fn()}
        updateCompanyDescription={vi.fn()}
        updatePolicy={vi.fn()}
        save={vi.fn()}
        close={vi.fn()}
        onOpenOfficeEditor={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Studio Profile' })).toBeInTheDocument();
    expect(screen.getByText('Layout & Defaults')).toBeInTheDocument();
    expect(screen.getAllByText('Zone Layout').length).toBeGreaterThan(0);
    expect(screen.queryByText('Company Settings')).toBeNull();
  });
});
