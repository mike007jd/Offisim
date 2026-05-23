import type { ZoneRow } from '@offisim/shared-types';
import type { NewZone, ZoneRepository } from '../../../repos/zone-repository.js';
import { createMemoryPrefabRepository } from '../../memory-prefab-repository.js';
export { MemoryPrefabInstanceRepository } from '../../memory-prefab-repository.js';
import type { MemoryPrefabInstanceRepository } from '../../memory-prefab-repository.js';
import type {
  CompanyTemplateAssetRepository,
  CompanyTemplateAssetRow,
  NewCompanyTemplateAsset,
  NewOfficeLayout,
  NewSopTemplate,
  OfficeLayoutRepository,
  OfficeLayoutRow,
  SopTemplateRepository,
  SopTemplateRow,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';

function now(): string {
  return new Date().toISOString();
}

function cloneRows<T extends object>(rows: Iterable<T>): T[] {
  return [...rows].map((row) => ({ ...row }));
}

export class MemorySopTemplateRepository implements SopTemplateRepository {
  private readonly store = new Map<string, SopTemplateRow>();

  constructor(initialRows?: Iterable<SopTemplateRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.sop_template_id, { ...row });
    }
  }

  async create(template: NewSopTemplate): Promise<SopTemplateRow> {
    const row: SopTemplateRow = {
      ...template,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.set(row.sop_template_id, row);
    return row;
  }

  async findById(sopTemplateId: string): Promise<SopTemplateRow | null> {
    return this.store.get(sopTemplateId) ?? null;
  }

  async findByCompany(companyId: string): Promise<SopTemplateRow[]> {
    return [...this.store.values()].filter((r) => r.company_id === companyId);
  }

  async update(
    sopTemplateId: string,
    patch: import('../../repositories.js').SopTemplateUpdate,
  ): Promise<void> {
    const existing = this.store.get(sopTemplateId);
    if (!existing) return;
    this.store.set(sopTemplateId, {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    });
  }

  async delete(sopTemplateId: string): Promise<void> {
    this.store.delete(sopTemplateId);
  }

  snapshot(): SopTemplateRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryOfficeLayoutRepository implements OfficeLayoutRepository {
  private readonly store = new Map<string, OfficeLayoutRow>();

  constructor(initialRows?: Iterable<OfficeLayoutRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.layout_id, { ...row });
    }
  }

  async create(layout: NewOfficeLayout): Promise<OfficeLayoutRow> {
    const row: OfficeLayoutRow = {
      ...layout,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.set(row.layout_id, row);
    return row;
  }
  async findById(layoutId: string): Promise<OfficeLayoutRow | null> {
    return this.store.get(layoutId) ?? null;
  }
  async findByCompany(companyId: string): Promise<OfficeLayoutRow[]> {
    return [...this.store.values()].filter((l) => l.company_id === companyId);
  }
  async findActive(companyId: string): Promise<OfficeLayoutRow | null> {
    return (
      [...this.store.values()].find((l) => l.company_id === companyId && l.is_active === 1) ?? null
    );
  }
  async setActive(companyId: string, layoutId: string): Promise<void> {
    for (const [id, row] of this.store.entries()) {
      if (row.company_id === companyId) {
        this.store.set(id, {
          ...row,
          is_active: id === layoutId ? 1 : 0,
          updated_at: new Date().toISOString(),
        });
      }
    }
  }
  async update(
    layoutId: string,
    patch: Partial<Pick<OfficeLayoutRow, 'name' | 'layout_json'>>,
  ): Promise<void> {
    const row = this.store.get(layoutId);
    if (row) this.store.set(layoutId, { ...row, ...patch, updated_at: new Date().toISOString() });
  }
  async delete(layoutId: string): Promise<void> {
    this.store.delete(layoutId);
  }

  snapshot(): OfficeLayoutRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryCompanyTemplateAssetRepository implements CompanyTemplateAssetRepository {
  private readonly store = new Map<string, CompanyTemplateAssetRow>();

  constructor(initialRows?: Iterable<CompanyTemplateAssetRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.company_template_asset_id, { ...row });
    }
  }

  async create(template: NewCompanyTemplateAsset): Promise<CompanyTemplateAssetRow> {
    const row: CompanyTemplateAssetRow = {
      ...template,
      created_at: now(),
      updated_at: now(),
    };
    this.store.set(row.company_template_asset_id, row);
    return row;
  }

  async findById(companyTemplateAssetId: string): Promise<CompanyTemplateAssetRow | null> {
    return this.store.get(companyTemplateAssetId) ?? null;
  }

  async findByCompany(companyId: string): Promise<CompanyTemplateAssetRow[]> {
    return [...this.store.values()].filter((row) => row.company_id === companyId);
  }

  async delete(companyTemplateAssetId: string): Promise<void> {
    this.store.delete(companyTemplateAssetId);
  }

  snapshot(): CompanyTemplateAssetRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryZoneRepository implements ZoneRepository {
  private readonly store = new Map<string, ZoneRow>();

  constructor(initialRows?: Iterable<ZoneRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.zone_id, { ...row });
    }
  }

  async create(zone: NewZone): Promise<ZoneRow> {
    const row: ZoneRow = { ...zone, created_at: now(), updated_at: now() };
    this.store.set(row.zone_id, row);
    return row;
  }
  async findById(zoneId: string): Promise<ZoneRow | null> {
    return this.store.get(zoneId) ?? null;
  }
  async findByCompany(companyId: string): Promise<ZoneRow[]> {
    return [...this.store.values()].filter((z) => z.company_id === companyId);
  }
  async update(
    zoneId: string,
    fields: Partial<
      Pick<
        ZoneRow,
        | 'label'
        | 'accent_color'
        | 'floor_color'
        | 'cx'
        | 'cz'
        | 'w'
        | 'd'
        | 'target_roles_json'
        | 'allowed_categories_json'
        | 'activity_types_json'
        | 'desk_slots'
        | 'sort_order'
        | 'archetype'
      >
    >,
  ): Promise<void> {
    const row = this.store.get(zoneId);
    if (row) this.store.set(zoneId, { ...row, ...fields, updated_at: now() });
  }
  async delete(zoneId: string): Promise<void> {
    this.store.delete(zoneId);
  }
  async deleteByCompany(companyId: string): Promise<void> {
    for (const [id, row] of this.store.entries()) {
      if (row.company_id === companyId) this.store.delete(id);
    }
  }

  snapshot(): ZoneRow[] {
    return cloneRows(this.store.values());
  }
}

export interface WorkspaceMemoryRepos {
  sopTemplates: MemorySopTemplateRepository;
  companyTemplates: MemoryCompanyTemplateAssetRepository;
  officeLayouts: MemoryOfficeLayoutRepository;
  prefabInstances: MemoryPrefabInstanceRepository;
  zones: MemoryZoneRepository;
}

export function createWorkspaceMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): WorkspaceMemoryRepos {
  const sopTemplates = new MemorySopTemplateRepository(snapshot?.sopTemplates);
  const companyTemplates = new MemoryCompanyTemplateAssetRepository(snapshot?.companyTemplates);
  const officeLayouts = new MemoryOfficeLayoutRepository(snapshot?.officeLayouts);
  const prefabInstances = createMemoryPrefabRepository(snapshot?.prefabInstances);
  const zones = new MemoryZoneRepository(snapshot?.zones);
  return { sopTemplates, companyTemplates, officeLayouts, prefabInstances, zones };
}
