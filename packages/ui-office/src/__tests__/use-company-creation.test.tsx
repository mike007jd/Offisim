import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCompanyCreation } from '../hooks/useCompanyCreation.js';

const { materializeTemplate, listTemplatesMock, useCompanyMock, useOffisimRuntimeMock } =
  vi.hoisted(() => ({
    materializeTemplate: vi.fn(),
    listTemplatesMock: vi.fn(),
    useCompanyMock: vi.fn(),
    useOffisimRuntimeMock: vi.fn(),
  }));

vi.mock('@offisim/core/browser', () => ({
  CompanyTemplateService: vi.fn().mockImplementation(() => ({
    materializeTemplate,
  })),
  listTemplates: listTemplatesMock,
}));

vi.mock('../components/company/CompanyContext.js', () => ({
  useCompany: useCompanyMock,
}));

vi.mock('../runtime/offisim-runtime-context.js', () => ({
  useOffisimRuntime: useOffisimRuntimeMock,
}));

describe('useCompanyCreation', () => {
  it('falls back to creating a new company when no active company exists', async () => {
    listTemplatesMock.mockReturnValue([
      {
        id: 'ai-startup',
        name: 'AI Startup',
        employees: [],
        sops: [],
        layoutPreset: 'startup',
      },
    ]);

    const createCompany = vi.fn(async (row) => row);
    const updateCompany = vi.fn();
    const findEmployees = vi.fn().mockResolvedValue([]);

    useCompanyMock.mockReturnValue({ activeCompanyId: null });
    useOffisimRuntimeMock.mockReturnValue({
      repos: {
        companies: { create: createCompany, update: updateCompany },
        employees: { findByCompany: findEmployees },
        sopTemplates: {},
        officeLayouts: {},
        prefabInstances: {},
        transact: undefined,
        zones: {},
      },
      eventBus: {},
    });
    materializeTemplate.mockResolvedValue({
      employeeIds: [],
      sopTemplateIds: [],
      layoutId: null,
      prefabInstanceIds: [],
    });

    const { result } = renderHook(() => useCompanyCreation({ mode: 'populate-existing' }));

    await act(async () => {
      result.current.setSelectedTemplateId('ai-startup');
    });

    let companyId: string | null = null;
    await act(async () => {
      companyId = await result.current.create();
    });

    expect(companyId).toBeTruthy();
    expect(createCompany).toHaveBeenCalledTimes(1);
    expect(findEmployees).not.toHaveBeenCalled();
    expect(updateCompany).not.toHaveBeenCalled();
    expect(materializeTemplate).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });
});
