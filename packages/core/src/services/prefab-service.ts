import type {
  PrefabBinding,
  PrefabInstanceRow,
  PrefabStateChangedPayload,
  RuntimeEvent,
  SemanticCategory,
} from '@aics/shared-types';
import type { EventBus } from '../events/event-bus.js';
import type { PrefabInstanceRepository } from '../repos/prefab-instance-repository.js';

// ── Default layout definitions per zone type ────────────────────
type ZoneType = 'department' | 'library' | 'rest_area' | 'meeting_room' | 'server_room';

interface DefaultPlacement {
  prefabId: string;
  category: SemanticCategory;
  count: number | 'input';
}

function getDefaultPlacements(
  zoneType: ZoneType,
  count: number,
): Array<{ prefabId: string; category: SemanticCategory; quantity: number }> {
  const defs: Record<ZoneType, DefaultPlacement[]> = {
    department: [
      { prefabId: 'workstation-standard', category: 'workspace', count: 'input' },
      { prefabId: 'plant-small', category: 'decorative', count: 1 },
    ],
    library: [
      { prefabId: 'bookshelf-double', category: 'knowledge', count: 2 },
      { prefabId: 'reading-table', category: 'knowledge', count: 1 },
      { prefabId: 'chair-standalone', category: 'workspace', count: 1 },
      { prefabId: 'plant-large', category: 'decorative', count: 1 },
    ],
    rest_area: [
      { prefabId: 'sofa-set', category: 'decorative', count: 1 },
      { prefabId: 'coffee-table', category: 'decorative', count: 1 },
      { prefabId: 'vending-machine', category: 'infrastructure', count: 1 },
      { prefabId: 'plant-small', category: 'decorative', count: 1 },
    ],
    meeting_room: [
      {
        prefabId: count > 4 ? 'meeting-table-8' : 'meeting-table-4',
        category: 'collaboration',
        count: 1,
      },
      { prefabId: 'whiteboard', category: 'collaboration', count: 1 },
    ],
    server_room: [
      { prefabId: 'server-rack-2u', category: 'compute', count: 'input' },
      { prefabId: 'cable-tray', category: 'infrastructure', count: 1 },
      { prefabId: 'network-switch', category: 'infrastructure', count: 1 },
    ],
  };

  return defs[zoneType].map((d) => ({
    prefabId: d.prefabId,
    category: d.category,
    quantity: d.count === 'input' ? count : d.count,
  }));
}

function generateInstanceId(): string {
  return `pi-${Math.random().toString(36).slice(2, 10)}`;
}

function now(): string {
  return new Date().toISOString();
}

// ── PrefabService ───────────────────────────────────────────────

export class PrefabService {
  constructor(
    private readonly repo: PrefabInstanceRepository,
    private readonly eventBus: EventBus,
  ) {}

  /** Create a new prefab instance */
  async createInstance(
    companyId: string,
    prefabId: string,
    zoneId: string,
    options?: {
      instanceId?: string;
      positionX?: number;
      positionY?: number;
      rotation?: 0 | 90 | 180 | 270;
      bindings?: PrefabBinding[];
      configOverrides?: Record<string, unknown>;
    },
  ): Promise<PrefabInstanceRow> {
    const instanceId = options?.instanceId ?? generateInstanceId();
    const ts = now();

    const row: PrefabInstanceRow = {
      instance_id: instanceId,
      company_id: companyId,
      prefab_id: prefabId,
      zone_id: zoneId,
      position_x: options?.positionX ?? 0,
      position_y: options?.positionY ?? 0,
      rotation: options?.rotation ?? 0,
      bindings_json: options?.bindings ? JSON.stringify(options.bindings) : null,
      config_json: options?.configOverrides ? JSON.stringify(options.configOverrides) : null,
      enabled: 1,
      created_at: ts,
      updated_at: ts,
    };

    const created = await this.repo.create(row);

    this.eventBus.emit(
      this.buildStateEvent(instanceId, companyId, prefabId, 'workspace', '', 'created'),
    );

    return created;
  }

  /** Bind a resource to a prefab instance slot */
  async bindResource(
    instanceId: string,
    slotName: string,
    resourceRef: string,
    label?: string,
  ): Promise<void> {
    const row = await this.repo.findById(instanceId);
    if (!row) throw new Error(`Prefab instance not found: ${instanceId}`);

    const bindings: PrefabBinding[] = row.bindings_json
      ? (JSON.parse(row.bindings_json) as PrefabBinding[])
      : [];

    const existing = bindings.findIndex((b) => b.slotName === slotName);
    const newBinding: PrefabBinding = {
      slotName,
      resourceRef,
      ...(label != null ? { label } : {}),
    };

    if (existing >= 0) {
      bindings[existing] = newBinding;
    } else {
      bindings.push(newBinding);
    }

    await this.repo.update(instanceId, { bindings_json: JSON.stringify(bindings) });

    this.eventBus.emit(
      this.buildStateEvent(
        instanceId,
        row.company_id,
        row.prefab_id,
        'workspace',
        'unbound',
        'bound',
      ),
    );
  }

  /** Unbind a resource from a prefab instance slot */
  async unbindResource(instanceId: string, slotName: string): Promise<void> {
    const row = await this.repo.findById(instanceId);
    if (!row) throw new Error(`Prefab instance not found: ${instanceId}`);

    const bindings: PrefabBinding[] = row.bindings_json
      ? (JSON.parse(row.bindings_json) as PrefabBinding[])
      : [];

    const filtered = bindings.filter((b) => b.slotName !== slotName);

    await this.repo.update(instanceId, {
      bindings_json: filtered.length > 0 ? JSON.stringify(filtered) : null,
    });

    this.eventBus.emit(
      this.buildStateEvent(
        instanceId,
        row.company_id,
        row.prefab_id,
        'workspace',
        'bound',
        'unbound',
      ),
    );
  }

  /** Get all instances in a zone */
  async getInstancesByZone(companyId: string, zoneId: string): Promise<PrefabInstanceRow[]> {
    return this.repo.findByCompanyAndZone(companyId, zoneId);
  }

  /** Get all instances for a company */
  async getInstancesByCompany(companyId: string): Promise<PrefabInstanceRow[]> {
    return this.repo.findByCompany(companyId);
  }

  /** Delete a prefab instance */
  async deleteInstance(instanceId: string): Promise<void> {
    const row = await this.repo.findById(instanceId);
    await this.repo.delete(instanceId);

    if (row) {
      this.eventBus.emit(
        this.buildStateEvent(
          instanceId,
          row.company_id,
          row.prefab_id,
          'workspace',
          'created',
          'deleted',
        ),
      );
    }
  }

  /** Create default prefab layout for a zone */
  async materializeDefaultLayout(
    companyId: string,
    zoneId: string,
    zoneType: ZoneType,
    count?: number,
  ): Promise<PrefabInstanceRow[]> {
    const effectiveCount = count ?? 1;
    const placements = getDefaultPlacements(zoneType, effectiveCount);

    const created: PrefabInstanceRow[] = [];
    let posIdx = 0;

    for (const placement of placements) {
      for (let i = 0; i < placement.quantity; i++) {
        const instance = await this.createInstance(companyId, placement.prefabId, zoneId, {
          positionX: posIdx * 120,
          positionY: 0,
        });
        created.push(instance);
        posIdx++;
      }
    }

    return created;
  }

  // ── Private helpers ─────────────────────────────────────────

  private buildStateEvent(
    instanceId: string,
    companyId: string,
    prefabId: string,
    category: string,
    prev: string,
    next: string,
  ): RuntimeEvent<PrefabStateChangedPayload> {
    return {
      type: 'prefab.state.changed',
      entityId: instanceId,
      entityType: 'prefab',
      companyId,
      timestamp: Date.now(),
      payload: { instanceId, prefabId, category, prev, next },
    };
  }
}
