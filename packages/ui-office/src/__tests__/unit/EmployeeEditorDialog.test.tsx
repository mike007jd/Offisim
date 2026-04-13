import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmployeeEditorDialog } from '../../components/employees/EmployeeEditorDialog';
import type { EmployeeFormData } from '../../hooks/useEmployeeEditor';

vi.mock('@offisim/renderer', () => ({
  computeFloorPlan: () => ({
    totalWidth: 0,
    totalHeight: 0,
    zones: [],
    allWorkstations: new Map(),
  }),
}));

vi.mock('../../components/company/CompanyContext.js', () => ({
  useCompany: () => ({
    activeCompanyId: 'co-test',
  }),
}));

vi.mock('../../hooks/useCompanyZones.js', () => ({
  useCompanyZones: () => ({
    zones: [
      {
        zoneId: undefined,
        label: 'Broken Zone',
      },
    ],
    loading: false,
    isFallback: false,
    refresh: vi.fn(),
  }),
}));

vi.mock('../../components/employees/AvatarCustomizer', () => ({
  AvatarCustomizer: () => <div data-testid="avatar-customizer" />,
}));

const formData: EmployeeFormData = {
  name: '',
  role_slug: 'developer',
  enabled: true,
  workstation_id: null,
  expertise: '',
  style: '',
  customInstructions: '',
  modelPreference: '',
  temperature: 0.7,
  maxTokens: 4096,
  runtimeSkill: null,
  skillEnabled: false,
  toolPermissionPolicy: null,
  communicationFrequency: 'medium',
  riskPreference: 'balanced',
  decisionStyle: 'collaborative',
  appearance: {
    skinColor: 0xfdbcb4,
    hairColor: 0x1a1a1a,
    hairStyle: 'short',
    clothingColor: 0x4a90d9,
    clothingAccent: 0xffffff,
    bodyType: 'normal',
    gender: 'neutral',
  },
};

describe('EmployeeEditorDialog', () => {
  it('does not crash when company zones contain a malformed zoneId', () => {
    expect(() =>
      render(
        <EmployeeEditorDialog
          isOpen={false}
          employeeId={null}
          formData={formData}
          isDirty={false}
          isSaving={false}
          isConfirmingDelete={false}
          deleteError={null}
          updateField={vi.fn()}
          save={vi.fn()}
          requestDelete={vi.fn()}
          cancelDelete={vi.fn()}
          confirmDelete={vi.fn()}
          close={vi.fn()}
          sourceAssetId={null}
          sourcePackageId={null}
          setFormData={vi.fn()}
          openForEdit={vi.fn()}
          openForCreate={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });
});
