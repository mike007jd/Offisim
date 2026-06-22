import type { PrefabInstanceRow, ZoneRow } from '@offisim/shared-types';
import type { PrefabInstanceRepository } from '../../../repos/prefab-instance-repository.js';
import type { NewZone, ZoneRepository } from '../../../repos/zone-repository.js';
import type {
  CompanyTemplateAssetRepository,
  CompanyTemplateAssetRow,
  NewCompanyTemplateAsset,
  NewOfficeLayout,
  NewWorkstation,
  OfficeLayoutRepository,
  OfficeLayoutRow,
  WorkstationRepository,
  WorkstationRow,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';
import { cloneRows, now } from '../memory-utils.js';

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

export class MemoryPrefabInstanceRepository implements PrefabInstanceRepository {
  private store = new Map<string, PrefabInstanceRow>();

  constructor(initialRows?: Iterable<PrefabInstanceRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.instance_id, { ...row });
    }
  }

  async create(instance: PrefabInstanceRow): Promise<PrefabInstanceRow> {
    this.store.set(instance.instance_id, { ...instance });
    return { ...instance };
  }

  async findById(instanceId: string): Promise<PrefabInstanceRow | null> {
    const row = this.store.get(instanceId);
    return row ? { ...row } : null;
  }

  async findByCompanyAndZone(companyId: string, zoneId: string): Promise<PrefabInstanceRow[]> {
    return [...this.store.values()].filter(
      (r) => r.company_id === companyId && r.zone_id === zoneId,
    );
  }

  async findByCompany(companyId: string): Promise<PrefabInstanceRow[]> {
    return [...this.store.values()].filter((r) => r.company_id === companyId);
  }

  async update(
    instanceId: string,
    fields: Partial<
      Pick<
        PrefabInstanceRow,
        'position_x' | 'position_y' | 'rotation' | 'bindings_json' | 'config_json' | 'enabled'
      >
    >,
  ): Promise<void> {
    const row = this.store.get(instanceId);
    if (row) {
      this.store.set(instanceId, { ...row, ...fields, updated_at: now() });
    }
  }

  async delete(instanceId: string): Promise<void> {
    this.store.delete(instanceId);
  }

  async deleteByCompany(companyId: string): Promise<void> {
    for (const [id, row] of this.store) {
      if (row.company_id === companyId) {
        this.store.delete(id);
      }
    }
  }

  snapshot(): PrefabInstanceRow[] {
    return [...this.store.values()].map((row) => ({ ...row }));
  }
}

export function createMemoryPrefabRepository(
  snapshot?: Iterable<PrefabInstanceRow>,
): MemoryPrefabInstanceRepository {
  return new MemoryPrefabInstanceRepository(snapshot);
}

export class MemoryWorkstationRepository implements WorkstationRepository {
  private readonly store = new Map<string, WorkstationRow>();

  constructor(initialRows?: Iterable<WorkstationRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.workstation_id, { ...row });
    }
  }

  async upsert(workstation: NewWorkstation): Promise<WorkstationRow> {
    const existing = this.store.get(workstation.workstation_id);
    const row: WorkstationRow = {
      ...workstation,
      // On conflict, DB backends keep the original company_id + created_at and
      // only refresh the mutable fields; mirror that so test fidelity matches.
      company_id: existing?.company_id ?? workstation.company_id,
      created_at: existing?.created_at ?? workstation.created_at ?? now(),
      updated_at: now(),
    };
    this.store.set(row.workstation_id, row);
    return { ...row };
  }
  async findById(workstationId: string): Promise<WorkstationRow | null> {
    const row = this.store.get(workstationId);
    return row ? { ...row } : null;
  }
  async findByCompany(companyId: string): Promise<WorkstationRow[]> {
    return [...this.store.values()].filter((w) => w.company_id === companyId);
  }

  snapshot(): WorkstationRow[] {
    return cloneRows(this.store.values());
  }
}

export interface WorkspaceMemoryRepos {
  companyTemplates: MemoryCompanyTemplateAssetRepository;
  officeLayouts: MemoryOfficeLayoutRepository;
  prefabInstances: MemoryPrefabInstanceRepository;
  zones: MemoryZoneRepository;
  workstations: MemoryWorkstationRepository;
}

export function createWorkspaceMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): WorkspaceMemoryRepos {
  const companyTemplates = new MemoryCompanyTemplateAssetRepository(snapshot?.companyTemplates);
  const officeLayouts = new MemoryOfficeLayoutRepository(snapshot?.officeLayouts);
  const prefabInstances = createMemoryPrefabRepository(snapshot?.prefabInstances);
  const zones = new MemoryZoneRepository(snapshot?.zones);
  const workstations = new MemoryWorkstationRepository(snapshot?.workstations);
  return { companyTemplates, officeLayouts, prefabInstances, zones, workstations };
}
