import type {
  PrefabBinding,
  PrefabInstanceRow,
  PrefabStateChangedPayload,
  RuntimeEvent,
} from '@offisim/shared-types';
import { getSystemZoneDefaultPrefabs, parsePrefabBindings } from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';
import type { PrefabInstanceRepository } from '../repos/prefab-instance-repository.js';
import { generateId } from '../utils/generate-id.js';

// ── Default layout definitions per zone type ────────────────────
type ZoneType = 'department' | 'library' | 'rest_area' | 'meeting_room' | 'server_room';

interface DefaultPlacement {
  prefabId: string;
  offsetX: number;
  offsetZ: number;
  rotation?: 0 | 90 | 180 | 270;
}

function getDefaultPlacements(zoneType: ZoneType, count: number): DefaultPlacement[] {
  const zoneByType = {
    department: { slug: 'zone-dev', archetype: 'workspace' as const, deskSlots: count },
    library: { slug: 'zone-library', archetype: 'library' as const, deskSlots: 0 },
    rest_area: { slug: 'zone-rest', archetype: 'rest' as const, deskSlots: 0 },
    meeting_room: { slug: 'zone-meeting', archetype: 'meeting' as const, deskSlots: 0 },
    server_room: { slug: 'zone-server', archetype: 'server' as const, deskSlots: 0 },
  };
  return getSystemZoneDefaultPrefabs(zoneByType[zoneType], { occupiedSeats: count }).map(
    (prefab) => ({
      prefabId: prefab.prefabId,
      offsetX: prefab.offsetX,
      offsetZ: prefab.offsetZ,
      ...(prefab.rotation !== undefined ? { rotation: prefab.rotation } : {}),
    }),
  );
}

function generateInstanceId(): string {
  return generateId('pi');
}

function now(): string {
  return new Date().toISOString();
}

// ── PrefabService ───────────────────────────────────────────────

export class PrefabService {
  /**
   * @param transact Optional synchronous transaction wrapper (Drizzle/
   *   better-sqlite3 runtime). When provided, multi-row writes
   *   (materializeDefaultLayout) run inside a single SQLite transaction and
   *   events are emitted only after the transaction commits. Memory/test
   *   backends omit it.
   */
  constructor(
    private readonly repo: PrefabInstanceRepository,
    private readonly eventBus: EventBus,
    private readonly transact?: <T>(fn: () => T) => T,
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
    const row = this.buildInstanceRow(companyId, prefabId, zoneId, options);

    const created = await this.repo.create(row);

    this.eventBus.emit(this.buildStateEvent(row.instance_id, companyId, prefabId, '', 'created'));

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

    const bindings: PrefabBinding[] = parsePrefabBindings(row.bindings_json);

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
        existing >= 0 ? 'bound' : 'unbound',
        'bound',
      ),
    );
  }

  /** Unbind a resource from a prefab instance slot */
  async unbindResource(instanceId: string, slotName: string): Promise<void> {
    const row = await this.repo.findById(instanceId);
    if (!row) throw new Error(`Prefab instance not found: ${instanceId}`);

    const bindings: PrefabBinding[] = parsePrefabBindings(row.bindings_json);

    const filtered = bindings.filter((b) => b.slotName !== slotName);

    await this.repo.update(instanceId, {
      bindings_json: filtered.length > 0 ? JSON.stringify(filtered) : null,
    });

    this.eventBus.emit(
      this.buildStateEvent(instanceId, row.company_id, row.prefab_id, 'bound', 'unbound'),
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
        this.buildStateEvent(instanceId, row.company_id, row.prefab_id, 'created', 'deleted'),
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

    // Pre-build all rows so persistence and event emission are separable.
    const rows = placements.map((placement) =>
      this.buildInstanceRow(companyId, placement.prefabId, zoneId, {
        positionX: placement.offsetX,
        positionY: placement.offsetZ,
        rotation: placement.rotation ?? 0,
      }),
    );

    if (this.transact) {
      // ── Drizzle path: all instance inserts in one transaction ───────────
      // The sync transact callback contains writes only; events fire after
      // the transaction commits.
      this.transact(() => {
        for (const row of rows) {
          void this.repo.create(row);
        }
      });
    } else {
      // ── Async/memory-repos path ─────────────────────────────────────────
      for (const row of rows) {
        await this.repo.create(row);
      }
    }

    for (const row of rows) {
      this.eventBus.emit(
        this.buildStateEvent(row.instance_id, companyId, row.prefab_id, '', 'created'),
      );
    }

    return rows;
  }

  // ── Private helpers ─────────────────────────────────────────

  private buildInstanceRow(
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
  ): PrefabInstanceRow {
    const instanceId = options?.instanceId ?? generateInstanceId();
    const ts = now();

    return {
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
  }

  private buildStateEvent(
    instanceId: string,
    companyId: string,
    prefabId: string,
    prev: string,
    next: string,
  ): RuntimeEvent<PrefabStateChangedPayload> {
    return {
      type: 'prefab.state.changed',
      entityId: instanceId,
      entityType: 'prefab',
      companyId,
      timestamp: Date.now(),
      payload: { instanceId, prefabId, prev, next },
    };
  }
}
