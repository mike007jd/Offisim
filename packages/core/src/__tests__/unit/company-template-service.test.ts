import { REQUIRED_ARCHETYPES } from '@offisim/shared-types';
import type { PrefabInstanceRow } from '@offisim/shared-types';
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
    repos.zones,
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
    expect(instances.every((instance) => instance.zone_id.startsWith(`${COMPANY_ID}::`))).toBe(
      true,
    );
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

  it('assigns Content Studio content roles to real workspace zones', async () => {
    const { service, prefabRepo, repos } = makeService({ withPrefabRepo: true });
    await service.materializeTemplate('content-studio', COMPANY_ID);

    if (!prefabRepo) throw new Error('Expected prefab repo');
    const prefabs = await prefabRepo.findByCompany(COMPANY_ID);
    const zones = await repos.zones.findByCompany(COMPANY_ID);
    const zoneIds = new Set(zones.map((zone) => zone.zone_id));

    expect(zoneIds.has(`${COMPANY_ID}::zone-content`)).toBe(false);
    expect(zoneIds.has(`${COMPANY_ID}::zone-dev`)).toBe(true);
    expect(zoneIds.has(`${COMPANY_ID}::zone-product`)).toBe(true);

    const workstations = prefabs.filter((prefab) => prefab.prefab_id === 'workstation-standard');
    const zoneCounts = new Map<string, number>();
    for (const prefab of workstations) {
      zoneCounts.set(prefab.zone_id, (zoneCounts.get(prefab.zone_id) ?? 0) + 1);
    }

    expect(zoneCounts.get(`${COMPANY_ID}::zone-dev`)).toBe(2);
    expect(zoneCounts.get(`${COMPANY_ID}::zone-product`)).toBe(3);
    expect(zoneCounts.has(`${COMPANY_ID}::zone-content`)).toBe(false);
  });

  it('creates only prefab zone ids that exist in the seeded company zones for every template', async () => {
    const templateIds = [
      'rd-company',
      'content-studio',
      'product-team',
      'agency-lite',
      'ai-startup',
    ];

    for (const templateId of templateIds) {
      const companyId = `${COMPANY_ID}-${templateId}`;
      const { service, prefabRepo, repos } = makeService({ withPrefabRepo: true });
      await service.materializeTemplate(templateId, companyId);

      if (!prefabRepo) throw new Error('Expected prefab repo');
      const prefabs = await prefabRepo.findByCompany(companyId);
      const zones = await repos.zones.findByCompany(companyId);
      const zoneIds = new Set(zones.map((zone) => zone.zone_id));

      expect(zones.length).toBeGreaterThan(0);
      expect(prefabs.length).toBeGreaterThan(0);
      expect(prefabs.every((prefab) => zoneIds.has(prefab.zone_id))).toBe(true);
      expect(prefabs.every((prefab) => prefab.zone_id.startsWith(`${companyId}::`))).toBe(true);
    }
  });

  it('creates ai-startup GPU cluster default prefabs with the expected composition', async () => {
    const companyId = `${COMPANY_ID}-ai-default-prefabs`;
    const { service, prefabRepo } = makeService({ withPrefabRepo: true });
    await service.materializeTemplate('ai-startup', companyId);

    if (!prefabRepo) throw new Error('Expected prefab repo');
    const prefabs = await prefabRepo.findByCompany(companyId);
    const gpuClusterPrefabs = prefabs.filter(
      (prefab) => prefab.zone_id === `${companyId}::zone-server`,
    );

    expect(gpuClusterPrefabs).toHaveLength(5);

    const counts = new Map<string, number>();
    for (const prefab of gpuClusterPrefabs) {
      counts.set(prefab.prefab_id, (counts.get(prefab.prefab_id) ?? 0) + 1);
    }

    expect(counts.get('server-rack-2u')).toBe(3);
    expect(counts.get('network-switch')).toBe(1);
    expect(counts.get('cable-tray')).toBe(1);
  });

  it('gives every custom-zoned template required archetypes and workspace coverage', () => {
    const { service } = makeService();
    const templates = service.listTemplates().filter((template) => template.zones);

    for (const template of templates) {
      const zones = template.zones ?? [];
      const workspaceRoleToZone = new Map<string, string>();

      for (const requiredArchetype of REQUIRED_ARCHETYPES) {
        expect(zones.some((zone) => zone.archetype === requiredArchetype)).toBe(true);
      }

      for (const zone of zones.filter((candidate) => candidate.archetype === 'workspace')) {
        for (const role of zone.targetRoles) {
          expect(workspaceRoleToZone.has(role)).toBe(false);
          workspaceRoleToZone.set(role, zone.slug);
        }
      }

      for (const employee of template.employees) {
        expect(workspaceRoleToZone.has(employee.role_slug)).toBe(true);
      }
    }
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
