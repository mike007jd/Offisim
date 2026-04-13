import { InMemoryEventBus } from '@offisim/core/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runVaultDevSmoke } from './vault-dev-smoke';

type VaultDevSmokeParams = Parameters<typeof runVaultDevSmoke>[0];

describe('runVaultDevSmoke', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flushes the active vault service before checking files', async () => {
    const files = new Map<string, string>();
    const root = '/tmp/offisim-smoke/vault';
    const employeePathPrefix =
      '/tmp/offisim-smoke/vault/companies/company-1/employees/vault-smoke-dev-employee';

    const flush = vi.fn(async () => {
      files.set(`${employeePathPrefix}/employee.md`, '# employee');
      files.set(`${employeePathPrefix}/soul.md`, '# soul');
      files.set(`${employeePathPrefix}/memory.md`, '# memory');
      files.set(`${employeePathPrefix}/relationships.md`, '# relationships');
    });

    const result = await runVaultDevSmoke({
      companyId: 'company-1',
      eventBus: new InMemoryEventBus(),
      runtime: {
        repos: {
          employees: {
            create: vi.fn(async () => ({ employee_id: 'dev-employee' })),
            findById: vi.fn(async () => ({
              employee_id: 'dev-employee',
              company_id: 'company-1',
              name: 'Vault Smoke 123',
              role_slug: 'engineer',
            })),
          },
        },
        vaultActivation: {
          service: { flush },
        },
      } as unknown as VaultDevSmokeParams['runtime'],
      deps: {
        appDataDir: async () => '/tmp/offisim-smoke',
        fsMod: {
          mkdir: vi.fn(async () => {}),
          exists: vi.fn(async (filePath: string) => files.has(filePath)),
          readTextFile: vi.fn(async (filePath: string) => files.get(filePath) ?? ''),
        },
        employeeIdFactory: () => 'dev-employee',
        now: () => 123,
        slugFactory: () => 'vault-smoke-dev-employee',
        sleep: async () => {},
      },
    } as unknown as VaultDevSmokeParams);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      root,
      base: employeePathPrefix,
    });
  });

  it('uses the repository-returned employee id for the emitted event and vault slug', async () => {
    const emittedIds: string[] = [];
    const eventBus = new InMemoryEventBus();
    eventBus.on('employee.created', (event) => {
      emittedIds.push(String(event.payload.employeeId));
    });

    const result = await runVaultDevSmoke({
      companyId: 'company-1',
      eventBus,
      runtime: {
        repos: {
          employees: {
            create: vi.fn(async () => ({ employee_id: 'persisted-employee-id' })),
            findById: vi.fn(async () => ({
              employee_id: 'persisted-employee-id',
              company_id: 'company-1',
              name: 'Vault Smoke 123',
              role_slug: 'engineer',
            })),
          },
        },
        vaultActivation: {
          service: { flush: vi.fn(async () => {}) },
        },
      } as unknown as VaultDevSmokeParams['runtime'],
      deps: {
        appDataDir: async () => '/tmp/offisim-smoke',
        fsMod: {
          mkdir: vi.fn(async () => {}),
          exists: vi.fn(async () => false),
          readTextFile: vi.fn(async () => ''),
        },
        employeeIdFactory: () => 'requested-employee-id',
        slugFactory: (_name: string, employeeId: string) => `slug-${employeeId}`,
      },
    } as unknown as VaultDevSmokeParams);

    expect(emittedIds).toEqual(['persisted-employee-id']);
    expect(result).toMatchObject({
      employeeId: 'persisted-employee-id',
      slug: 'slug-persisted-employee-id',
      base: '/tmp/offisim-smoke/vault/companies/company-1/employees/slug-persisted-employee-id',
    });
  });
});
