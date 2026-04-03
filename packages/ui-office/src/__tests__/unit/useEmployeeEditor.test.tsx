import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CompanyProvider } from '../../components/company/CompanyContext';
import { useEmployeeEditor } from '../../hooks/useEmployeeEditor';
import {
  OffisimRuntimeContext,
  type OffisimRuntimeValue,
} from '../../runtime/offisim-runtime-context';

function createRuntimeValue(
  deleteImpl: () => Promise<void>,
): OffisimRuntimeValue {
  return {
    eventBus: {
      emit: vi.fn(),
      on: vi.fn(() => () => {}),
    } as unknown as OffisimRuntimeValue['eventBus'],
    isReady: true,
    isRunning: false,
    error: null,
    sendMessage: vi.fn(),
    retryLastMessage: vi.fn(),
    clearError: vi.fn(),
    reinitRuntime: vi.fn(),
    installService: null,
    repos: {
      companies: {
        findAll: vi.fn().mockResolvedValue([]),
      },
      employees: {
        findById: vi.fn().mockResolvedValue({
          employee_id: 'emp-1',
          company_id: 'co-1',
          source_asset_id: null,
          source_package_id: null,
          name: 'Avery Stone',
          role_slug: 'developer',
          workstation_id: null,
          persona_json: null,
          config_json: null,
          enabled: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        delete: vi.fn(deleteImpl),
      },
    } as unknown as NonNullable<OffisimRuntimeValue['repos']>,
    employeeVersionService: null,
    connectMcpServer: vi.fn(),
    disconnectMcpServer: vi.fn(),
    connectedMcpServers: new Set(),
    abortExecution: vi.fn(),
    unfinishedThreads: [],
    dismissUnfinishedThreads: vi.fn(),
    resumeThread: vi.fn(),
    bootstrapState: null,
  };
}

describe('useEmployeeEditor', () => {
  it('keeps delete confirmation open and exposes an error when deletion fails', async () => {
    const runtimeValue = createRuntimeValue(async () => {
      throw new Error('Delete failed');
    });

    const wrapper = ({ children }: PropsWithChildren) => (
      <OffisimRuntimeContext.Provider value={runtimeValue}>
        <CompanyProvider repos={runtimeValue.repos} activeCompanyId="co-1">
          {children}
        </CompanyProvider>
      </OffisimRuntimeContext.Provider>
    );

    const { result } = renderHook(() => useEmployeeEditor(), { wrapper });

    await act(async () => {
      await result.current.openForEdit('emp-1');
    });

    act(() => {
      result.current.requestDelete();
    });

    await act(async () => {
      await result.current.confirmDelete();
    });

    await waitFor(() => {
      expect(result.current.isSaving).toBe(false);
      expect(result.current.isConfirmingDelete).toBe(true);
      expect(result.current.deleteError).toBe('Delete failed');
    });
  });
});
