import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CompanyProvider } from '../../components/company/CompanyContext.js';
import { useInstallFlow } from '../../hooks/useInstallFlow.js';
import {
  OffisimRuntimeContext,
  type OffisimRuntimeValue,
} from '../../runtime/offisim-runtime-context.js';

const registryMocks = vi.hoisted(() => {
  class RegistryApiError extends Error {
    status: number;
    code: string;

    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  return {
    RegistryApiError,
    getListingDetail: vi.fn(),
    listListingVersions: vi.fn(),
    getArtifactDownloadInfo: vi.fn(),
  };
});

vi.mock('@offisim/registry-client', () => ({
  RegistryApiError: registryMocks.RegistryApiError,
  RegistryClient: vi.fn().mockImplementation(() => ({
    getListingDetail: registryMocks.getListingDetail,
    listListingVersions: registryMocks.listListingVersions,
    getArtifactDownloadInfo: registryMocks.getArtifactDownloadInfo,
  })),
}));

function createRuntimeValue(overrides: Partial<OffisimRuntimeValue> = {}): OffisimRuntimeValue {
  return {
    eventBus: {
      emit: vi.fn(),
      on: vi.fn(),
    } as unknown as OffisimRuntimeValue['eventBus'],
    isReady: true,
    isRunning: false,
    error: null,
    sendMessage: vi.fn(),
    retryLastMessage: vi.fn(),
    clearError: vi.fn(),
    reinitRuntime: vi.fn(),
    installService: null,
    repos: null,
    employeeVersionService: null,
    connectMcpServer: vi.fn(),
    disconnectMcpServer: vi.fn(),
    connectedMcpServers: new Set(),
    abortExecution: vi.fn(),
    unfinishedThreads: [],
    dismissUnfinishedThreads: vi.fn(),
    resumeThread: vi.fn(),
    ...overrides,
  };
}

function createWrapper(runtimeValue: OffisimRuntimeValue) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <OffisimRuntimeContext.Provider value={runtimeValue}>
        <CompanyProvider repos={null} activeCompanyId="company-1">
          {children}
        </CompanyProvider>
      </OffisimRuntimeContext.Provider>
    );
  };
}

describe('useInstallFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('uses package_version_id when requesting artifact download info for registry installs', async () => {
    registryMocks.getListingDetail.mockResolvedValue({
      slug: 'writer-pro',
    });
    registryMocks.listListingVersions.mockResolvedValue({
      versions: [
        {
          version: '1.2.0',
          package_id: 'pkg.writer-pro',
          package_version_id: 'ver-123',
        },
      ],
    });
    registryMocks.getArtifactDownloadInfo.mockResolvedValue({
      artifact_url: 'https://cdn.example.com/writer-pro.offisimpkg',
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['package-bytes']),
    } as Response);

    const { result } = renderHook(() => useInstallFlow(), {
      wrapper: createWrapper(createRuntimeValue()),
    });

    act(() => {
      result.current.startRegistryInstall('listing-1', '1.2.0');
    });

    await waitFor(() => {
      expect(registryMocks.getArtifactDownloadInfo).toHaveBeenCalled();
    });

    expect(registryMocks.getArtifactDownloadInfo).toHaveBeenCalledWith('ver-123');
  });

  it('enters error state when the registry returns no matching versions', async () => {
    registryMocks.getListingDetail.mockResolvedValue({
      slug: 'writer-pro',
    });
    registryMocks.listListingVersions.mockResolvedValue({
      versions: [],
    });

    const { result } = renderHook(() => useInstallFlow(), {
      wrapper: createWrapper(createRuntimeValue()),
    });

    act(() => {
      result.current.startRegistryInstall('listing-1', '9.9.9');
    });

    await waitFor(() => {
      expect(result.current.step).toBe('error');
    });

    expect(result.current.error).toContain('Version 9.9.9 not found');
  });

  it('clears mock import timers when cancel is called', async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useInstallFlow(), {
      wrapper: createWrapper(createRuntimeValue()),
    });

    const file = new File(['package'], 'example.offisimpkg', {
      type: 'application/octet-stream',
    });

    act(() => {
      result.current.startFileImport(file);
    });

    expect(result.current.step).toBe('loading');

    act(() => {
      result.current.cancel();
      vi.runAllTimers();
    });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.step).toBe('idle');
    expect(result.current.plan).toBeNull();
  });
});
