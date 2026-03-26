import type { PrefabInstanceRow } from '@aics/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { PrefabInstanceRepository } from '../../repos/prefab-instance-repository.js';
import {
  MemoryOfficeLayoutRepository,
  MemorySopTemplateRepository,
  createMemoryRepositories,
} from '../../runtime/memory-repositories.js';
import { CompanyTemplateService } from '../../services/company-template-service.js';

const COMPANY_ID = 'co-test';
type TransactFn = <T>(fn: () => T) => T;

/** Minimal in-memory prefab instance repository for tests. */
class MemoryPrefabInstanceRepository implements PrefabInstanceRepository {
  readonly store: PrefabInstanceRow[] = [];

  async create(instance: PrefabInstanceRow): Promise<PrefabInstanceRow> {
    this.store.push(instance);
    return instance;
  }
  async findById(instanceId: string): Promise<PrefabInstanceRow | null> {
    return this.store.find((r) => r.instance_id === instanceId) ?? null;
  }
  async findByCompanyAndZone(companyId: string, zoneId: string): Promise<PrefabInstanceRow[]> {
    return this.store.filter((r) => r.company_id === companyId && r.zone_id === zoneId);
  }
  async findByCompany(companyId: string): Promise<PrefabInstanceRow[]> {
    return this.store.filter((r) => r.company_id === companyId);
  }
  async update(): Promise<void> {}
  async delete(instanceId: string): Promise<void> {
    const idx = this.store.findIndex((r) => r.instance_id === instanceId);
    if (idx !== -1) this.store.splice(idx, 1);
  }
  async deleteByCompany(companyId: string): Promise<void> {
    this.store.splice(
      0,
      this.store.length,
      ...this.store.filter((r) => r.company_id !== companyId),
    );
  }
}

function makeService(opts: { withPrefabRepo?: boolean; transact?: TransactFn } = {}) {
  const repos = createMemoryRepositories();
  const sopTemplateRepo = new MemorySopTemplateRepository();
  const officeLayoutRepo = new MemoryOfficeLayoutRepository();
  const eventBus = new InMemoryEventBus();
  const prefabRepo = opts.withPrefabRepo ? new MemoryPrefabInstanceRepository() : undefined;

  const service = new CompanyTemplateService(
    repos.employees,
    sopTemplateRepo,
    officeLayoutRepo,
    eventBus,
    prefabRepo,
    opts.transact,
  );

  return { service, repos, sopTemplateRepo, officeLayoutRepo, eventBus, prefabRepo };
}

describe('CompanyTemplateService.materializeTemplate', () => {
  it('throws on unknown templateId', async () => {
    const { service } = makeService();
    await expect(service.materializeTemplate('not-real', COMPANY_ID)).rejects.toThrow(
      'Template not found: not-real',
    );
  });

  it('creates employees, SOPs, and layout for agency-lite template', async () => {
    const { service, repos, sopTemplateRepo, officeLayoutRepo, eventBus } = makeService();

    const events: unknown[] = [];
    eventBus.on('employee.created', (e) => events.push(e));

    const result = await service.materializeTemplate('agency-lite', COMPANY_ID);

    // agency-lite has 5 employees
    expect(result.employeeIds).toHaveLength(5);

    // All employee IDs should be findable
    for (const eid of result.employeeIds) {
      const emp = await repos.employees.findById(eid);
      expect(emp).not.toBeNull();
      expect(emp?.company_id).toBe(COMPANY_ID);
    }

    // SOPs
    expect(result.sopTemplateIds.length).toBeGreaterThan(0);
    const sops = await sopTemplateRepo.findByCompany(COMPANY_ID);
    expect(sops).toHaveLength(result.sopTemplateIds.length);

    // Layout
    expect(result.layoutId).toBeTruthy();
    const layouts = await officeLayoutRepo.findByCompany(COMPANY_ID);
    expect(layouts).toHaveLength(1);
    expect(layouts[0]?.layout_id).toBe(result.layoutId);

    // Events
    expect(events).toHaveLength(5);
  });

  it('creates prefab instances when prefabRepo is provided', async () => {
    const { service, prefabRepo } = makeService({ withPrefabRepo: true });
    const result = await service.materializeTemplate('agency-lite', COMPANY_ID);

    expect(result.prefabInstanceIds.length).toBeGreaterThan(0);
    expect(prefabRepo).toBeDefined();
    if (!prefabRepo) throw new Error('Expected prefab repo');
    const instances = await prefabRepo.findByCompany(COMPANY_ID);
    expect(instances.length).toBeGreaterThan(0);
    expect(instances.length).toBe(result.prefabInstanceIds.length);
  });

  it('returns empty prefabInstanceIds when prefabRepo is not provided', async () => {
    const { service } = makeService({ withPrefabRepo: false });
    const result = await service.materializeTemplate('agency-lite', COMPANY_ID);
    expect(result.prefabInstanceIds).toHaveLength(0);
  });

  describe('with transact', () => {
    it('calls transact exactly once wrapping all DB writes', async () => {
      const transactCalls: number[] = [];
      type TransactMock = TransactFn & ReturnType<typeof vi.fn>;
      const mockTransact = vi.fn((fn: () => unknown) => {
        transactCalls.push(1);
        return fn();
      }) as unknown as TransactMock;

      const { service } = makeService({ transact: mockTransact });
      await service.materializeTemplate('agency-lite', COMPANY_ID);

      expect(mockTransact).toHaveBeenCalledOnce();
    });

    it('emits employee.created events after transaction commits', async () => {
      type TransactMock = TransactFn & ReturnType<typeof vi.fn>;
      const mockTransact = vi.fn((fn: () => unknown) => fn()) as unknown as TransactMock;
      const { service, eventBus } = makeService({ transact: mockTransact });

      const events: unknown[] = [];
      eventBus.on('employee.created', (e) => events.push(e));

      await service.materializeTemplate('agency-lite', COMPANY_ID);

      // agency-lite has 5 employees → 5 events
      expect(events).toHaveLength(5);
    });

    it('returns populated employeeIds even on the transact path', async () => {
      type TransactMock = TransactFn & ReturnType<typeof vi.fn>;
      const mockTransact = vi.fn((fn: () => unknown) => fn()) as unknown as TransactMock;
      const { service } = makeService({ transact: mockTransact });

      const result = await service.materializeTemplate('agency-lite', COMPANY_ID);
      expect(result.employeeIds).toHaveLength(5);
      for (const id of result.employeeIds) {
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      }
    });

    it('works normally without transact (async path)', async () => {
      const { service } = makeService();
      const result = await service.materializeTemplate('agency-lite', COMPANY_ID);
      expect(result.employeeIds).toHaveLength(5);
      expect(result.layoutId).toBeTruthy();
    });
  });
});

describe('CompanyTemplateService.listTemplates', () => {
  it('returns a non-empty list of built-in templates', () => {
    const { service } = makeService();
    const templates = service.listTemplates();
    expect(templates.length).toBeGreaterThan(0);
    const ids = templates.map((t) => t.id);
    expect(ids).toContain('agency-lite');
  });
});
