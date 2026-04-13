import type { CompanyRow, RuntimeRepositories } from '@offisim/core/browser';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CompanyProvider } from '../../components/company/CompanyContext';
import { CompanySelectionPage } from '../../components/company/CompanySelectionPage';
import type { OffisimRuntimeValue } from '../../runtime/offisim-runtime-context';
import { OffisimRuntimeContext } from '../../runtime/offisim-runtime-context';

const MOCK_COMPANY: CompanyRow = {
  company_id: 'co-1',
  name: 'Orbit Labs',
  status: 'active',
  template_label: null,
  updated_at: '2026-04-06T00:00:00.000Z',
  workspace_root: null,
  default_model_policy_json: null,
};

/** Minimal repos stub — only findAll() is called by CompanyProvider on mount. */
function makeRepos(): RuntimeRepositories {
  return {
    companies: {
      findAll: vi.fn().mockResolvedValue([MOCK_COMPANY]),
      findById: vi.fn().mockResolvedValue(null),
    },
    employees: { findByCompany: vi.fn().mockResolvedValue([]) },
    projects: { findByCompany: vi.fn().mockResolvedValue([]) },
    zones: { findByCompany: vi.fn().mockResolvedValue([]) },
    prefabInstances: { findByCompany: vi.fn().mockResolvedValue([]) },
  } as unknown as RuntimeRepositories;
}

class StubEventBus {
  on() {
    return () => {};
  }
}

function makeRuntime(repos: RuntimeRepositories): OffisimRuntimeValue {
  return {
    eventBus: new StubEventBus() as unknown as OffisimRuntimeValue['eventBus'],
    isReady: true,
    isRunning: false,
    error: null,
    sendMessage: vi.fn(),
    retryLastMessage: vi.fn(),
    clearError: vi.fn(),
    reinitRuntime: vi.fn(),
    installService: null,
    repos,
    employeeVersionService: null,
    toolTelemetryService: null,
    connectMcpServer: vi.fn(),
    disconnectMcpServer: vi.fn(),
    connectedMcpServers: new Set(),
    abortExecution: vi.fn(),
    unfinishedThreads: [],
    dismissUnfinishedThreads: vi.fn(),
    resumeThread: vi.fn(),
  };
}

function Wrapper({ children }: { children: ReactNode }) {
  const repos = makeRepos();
  return (
    <OffisimRuntimeContext.Provider value={makeRuntime(repos)}>
      <CompanyProvider repos={repos} activeCompanyId="co-1">
        {children}
      </CompanyProvider>
    </OffisimRuntimeContext.Provider>
  );
}

describe('CompanySelectionPage', () => {
  it('requires a second click before archiving the selected company', async () => {
    const onArchiveCompany = vi.fn();

    render(
      <CompanySelectionPage
        previewCompanyId="co-1"
        onPreviewCompany={vi.fn()}
        onEnterCompany={vi.fn()}
        onCreateNew={vi.fn()}
        onArchiveCompany={onArchiveCompany}
      />,
      { wrapper: Wrapper },
    );

    // Wait for company list to load from async repos.companies.findAll()
    const archiveButton = await screen.findByRole('button', { name: /archive company/i });
    fireEvent.click(archiveButton);

    expect(onArchiveCompany).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /confirm archive/i })).toBeInTheDocument();
    expect(screen.getByText(/Archive Orbit Labs/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm archive/i }));

    expect(onArchiveCompany).toHaveBeenCalledWith('co-1');
  });

  it('does not emit React key warnings when preview data is missing ids', async () => {
    const malformedCompany = {
      ...MOCK_COMPANY,
      company_id: '',
      name: 'Broken Co',
    } as CompanyRow;
    const repos = {
      ...makeRepos(),
      companies: {
        findAll: vi.fn().mockResolvedValue([malformedCompany]),
        findById: vi.fn().mockResolvedValue(malformedCompany),
      },
      zones: {
        findByCompany: vi.fn().mockResolvedValue([
          {
            zone_id: '',
            company_id: '',
            kind: 'system',
            archetype: 'workspace',
            label: 'DEV',
            accent_color: '#3b82f6',
            floor_color: 0x2a3a5c,
            cx: 0,
            cz: 0,
            w: 10,
            d: 8,
            target_roles_json: null,
            allowed_categories_json: null,
            activity_types_json: null,
            desk_slots: 4,
            sort_order: 0,
            created_at: '2026-04-06T00:00:00.000Z',
            updated_at: '2026-04-06T00:00:00.000Z',
          },
        ]),
      },
      prefabInstances: {
        findByCompany: vi.fn().mockResolvedValue([
          {
            instance_id: '',
            company_id: '',
            prefab_id: 'workstation-standard',
            zone_id: '',
            position_x: 0,
            position_y: 0,
            rotation: 0,
            bindings_json: null,
            config_json: null,
            enabled: 1,
            created_at: '2026-04-06T00:00:00.000Z',
            updated_at: '2026-04-06T00:00:00.000Z',
          },
        ]),
      },
    } as RuntimeRepositories;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const BrokenWrapper = ({ children }: { children: ReactNode }) => (
      <OffisimRuntimeContext.Provider value={makeRuntime(repos)}>
        <CompanyProvider repos={repos} activeCompanyId="">
          {children}
        </CompanyProvider>
      </OffisimRuntimeContext.Provider>
    );

    render(
      <CompanySelectionPage
        previewCompanyId=""
        onPreviewCompany={vi.fn()}
        onEnterCompany={vi.fn()}
        onCreateNew={vi.fn()}
        onArchiveCompany={vi.fn()}
      />,
      { wrapper: BrokenWrapper },
    );

    await screen.findByRole('button', { name: /enter company/i });
    expect(
      consoleError.mock.calls.some((call) =>
        String(call[0]).includes('Each child in a list should have a unique "key" prop'),
      ),
    ).toBe(false);

    consoleError.mockRestore();
  });
});
