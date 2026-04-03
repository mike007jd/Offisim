import type { CompanyTemplate } from '@offisim/core/browser';
import { render } from '@testing-library/react';
import { CompanyCreationWizard } from '../components/onboarding/CompanyCreationWizard.js';
import { useCompanyCreation } from '../hooks/useCompanyCreation.js';

vi.mock('../hooks/useCompanyCreation.js', () => ({
  useCompanyCreation: vi.fn(),
}));

const mockedUseCompanyCreation = vi.mocked(useCompanyCreation);

const TEMPLATE: CompanyTemplate = {
  id: 'rd-company',
  name: 'R&D Company',
  description: 'Dev + PM + Design team',
  icon: '🏢',
  employees: [
    {
      name: 'Kai Nakamura',
      role_slug: 'developer',
      persona_json: '{}',
      config_json: '{}',
    },
    { name: 'Ryan Torres', role_slug: 'product_manager', persona_json: '{}', config_json: '{}' },
    { name: 'Jamie Reeves', role_slug: 'ux_designer', persona_json: '{}', config_json: '{}' },
  ],
  sops: [],
  layoutPreset: 'rd-office',
};

describe('CompanyCreationWizard', () => {
  beforeEach(() => {
    mockedUseCompanyCreation.mockReturnValue({
      step: 'first-run',
      templates: [TEMPLATE],
      selectedTemplateId: TEMPLATE.id,
      companyName: 'My AI Company',
      setSelectedTemplateId: vi.fn(),
      setCompanyName: vi.fn(),
      create: vi.fn(),
      createCustomCompany: vi.fn(),
      error: null,
      runtimeReady: true,
    });
  });

  it('keeps bob animation off the translated SVG group so employee placement stays stable', () => {
    const { container } = render(<CompanyCreationWizard />);

    const animatedGroups = Array.from(container.querySelectorAll('svg g')).filter((group) =>
      group.getAttribute('style')?.includes('wiz-idle-bob'),
    );

    expect(animatedGroups).toHaveLength(TEMPLATE.employees.length);

    for (const group of animatedGroups) {
      expect(group.getAttribute('transform')).toBeNull();
      expect(group.parentElement?.getAttribute('transform')).toMatch(/^translate\(/);
    }
  });
});
