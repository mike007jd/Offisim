import type { PrefabBinding } from '@aics/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../events/event-bus.js';
import { createMemoryPrefabRepository } from '../runtime/memory-prefab-repository.js';
import { PrefabService } from '../services/prefab-service.js';
import { assertDefined } from './helpers/fixtures.js';

describe('PrefabService', () => {
  let repo: ReturnType<typeof createMemoryPrefabRepository>;
  let eventBus: InMemoryEventBus;
  let service: PrefabService;

  beforeEach(() => {
    repo = createMemoryPrefabRepository();
    eventBus = new InMemoryEventBus();
    service = new PrefabService(repo, eventBus);
  });

  // ── createInstance ──────────────────────────────────────────

  it('createInstance() creates a row, emits event, returns row', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit');

    const result = await service.createInstance('co-1', 'workstation-standard', 'zone-dev');

    expect(result).toBeDefined();
    expect(result.company_id).toBe('co-1');
    expect(result.prefab_id).toBe('workstation-standard');
    expect(result.zone_id).toBe('zone-dev');
    expect(result.instance_id).toMatch(/^pi-/);
    expect(result.position_x).toBe(0);
    expect(result.position_y).toBe(0);
    expect(result.rotation).toBe(0);
    expect(result.enabled).toBe(1);
    expect(result.bindings_json).toBeNull();
    expect(result.config_json).toBeNull();

    // Verify the row is persisted
    const found = await repo.findById(result.instance_id);
    expect(found).not.toBeNull();
    expect(found?.prefab_id).toBe('workstation-standard');

    // Verify event emitted
    expect(emitSpy).toHaveBeenCalledOnce();
    const event = assertDefined(emitSpy.mock.calls[0]?.[0]);
    expect(event.type).toBe('prefab.state.changed');
    expect(event.entityId).toBe(result.instance_id);
    expect(event.entityType).toBe('prefab');
    expect(event.companyId).toBe('co-1');
    expect(event.payload.instanceId).toBe(result.instance_id);
    expect(event.payload.prefabId).toBe('workstation-standard');
    expect(event.payload.prev).toBe('');
    expect(event.payload.next).toBe('created');
  });

  it('createInstance() with custom options (position, rotation, bindings, config)', async () => {
    const bindings: PrefabBinding[] = [{ slotName: 'agent-context', resourceRef: 'emp-01' }];

    const result = await service.createInstance('co-1', 'workstation-standard', 'zone-dev', {
      instanceId: 'pi-custom',
      positionX: 200,
      positionY: 100,
      rotation: 90,
      bindings,
      configOverrides: { theme: 'dark' },
    });

    expect(result.instance_id).toBe('pi-custom');
    expect(result.position_x).toBe(200);
    expect(result.position_y).toBe(100);
    expect(result.rotation).toBe(90);
    expect(result.bindings_json).toBe(JSON.stringify(bindings));
    expect(result.config_json).toBe(JSON.stringify({ theme: 'dark' }));
  });

  // ── bindResource ───────────────────────────────────────────

  it('bindResource() adds a new binding to bindings_json', async () => {
    await service.createInstance('co-1', 'workstation-standard', 'zone-dev', {
      instanceId: 'pi-bind',
    });

    await service.bindResource('pi-bind', 'agent-context', 'emp-01', 'Frontend Dev');

    const row = await repo.findById('pi-bind');
    expect(row).not.toBeNull();

    const bindings = JSON.parse(assertDefined(row?.bindings_json)) as PrefabBinding[];
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.slotName).toBe('agent-context');
    expect(bindings[0]?.resourceRef).toBe('emp-01');
    expect(bindings[0]?.label).toBe('Frontend Dev');
  });

  it('bindResource() updates an existing binding for the same slot', async () => {
    await service.createInstance('co-1', 'workstation-standard', 'zone-dev', {
      instanceId: 'pi-rebind',
      bindings: [{ slotName: 'agent-context', resourceRef: 'emp-01' }],
    });

    await service.bindResource('pi-rebind', 'agent-context', 'emp-02', 'Backend Dev');

    const row = await repo.findById('pi-rebind');
    const bindings = JSON.parse(assertDefined(row?.bindings_json)) as PrefabBinding[];
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.resourceRef).toBe('emp-02');
    expect(bindings[0]?.label).toBe('Backend Dev');
  });

  it('bindResource() throws for nonexistent instance', async () => {
    await expect(service.bindResource('nonexistent', 'slot', 'ref')).rejects.toThrow(
      'Prefab instance not found: nonexistent',
    );
  });

  // ── unbindResource ─────────────────────────────────────────

  it('unbindResource() removes a binding by slotName', async () => {
    await service.createInstance('co-1', 'workstation-standard', 'zone-dev', {
      instanceId: 'pi-unbind',
      bindings: [
        { slotName: 'agent-context', resourceRef: 'emp-01' },
        { slotName: 'model-endpoint', resourceRef: 'gpt-4o' },
      ],
    });

    await service.unbindResource('pi-unbind', 'agent-context');

    const row = await repo.findById('pi-unbind');
    const bindings = JSON.parse(assertDefined(row?.bindings_json)) as PrefabBinding[];
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.slotName).toBe('model-endpoint');
  });

  it('unbindResource() sets bindings_json to null when last binding removed', async () => {
    await service.createInstance('co-1', 'workstation-standard', 'zone-dev', {
      instanceId: 'pi-empty',
      bindings: [{ slotName: 'agent-context', resourceRef: 'emp-01' }],
    });

    await service.unbindResource('pi-empty', 'agent-context');

    const row = await repo.findById('pi-empty');
    expect(row?.bindings_json).toBeNull();
  });

  it('unbindResource() throws for nonexistent instance', async () => {
    await expect(service.unbindResource('nonexistent', 'slot')).rejects.toThrow(
      'Prefab instance not found: nonexistent',
    );
  });

  // ── getInstancesByZone ─────────────────────────────────────

  it('getInstancesByZone() returns filtered list', async () => {
    await service.createInstance('co-1', 'workstation-standard', 'zone-dev', {
      instanceId: 'pi-1',
    });
    await service.createInstance('co-1', 'workstation-standard', 'zone-art', {
      instanceId: 'pi-2',
    });
    await service.createInstance('co-1', 'plant-small', 'zone-dev', { instanceId: 'pi-3' });

    const results = await service.getInstancesByZone('co-1', 'zone-dev');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.instance_id).sort()).toEqual(['pi-1', 'pi-3']);
  });

  it('getInstancesByZone() returns empty for unknown zone', async () => {
    const results = await service.getInstancesByZone('co-1', 'zone-none');
    expect(results).toHaveLength(0);
  });

  // ── getInstancesByCompany ──────────────────────────────────

  it('getInstancesByCompany() returns all for a company', async () => {
    await service.createInstance('co-1', 'workstation-standard', 'zone-dev', {
      instanceId: 'pi-1',
    });
    await service.createInstance('co-1', 'plant-small', 'zone-art', { instanceId: 'pi-2' });
    await service.createInstance('co-2', 'workstation-standard', 'zone-dev', {
      instanceId: 'pi-3',
    });

    const results = await service.getInstancesByCompany('co-1');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.instance_id).sort()).toEqual(['pi-1', 'pi-2']);
  });

  // ── deleteInstance ─────────────────────────────────────────

  it('deleteInstance() removes instance and emits event', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit');

    await service.createInstance('co-1', 'workstation-standard', 'zone-dev', {
      instanceId: 'pi-del',
    });
    emitSpy.mockClear();

    await service.deleteInstance('pi-del');

    expect(await repo.findById('pi-del')).toBeNull();

    expect(emitSpy).toHaveBeenCalledOnce();
    const event = assertDefined(emitSpy.mock.calls[0]?.[0]);
    expect(event.type).toBe('prefab.state.changed');
    expect(event.payload.prev).toBe('created');
    expect(event.payload.next).toBe('deleted');
  });

  it('deleteInstance() does not emit event for nonexistent instance', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit');
    await service.deleteInstance('nonexistent');
    expect(emitSpy).not.toHaveBeenCalled();
  });

  // ── materializeDefaultLayout ───────────────────────────────

  it('materializeDefaultLayout("department", 3) creates 4 instances (3 workstations + 1 plant)', async () => {
    const results = await service.materializeDefaultLayout('co-1', 'zone-dev', 'department', 3);

    expect(results).toHaveLength(4);

    const workstations = results.filter((r) => r.prefab_id === 'workstation-standard');
    const plants = results.filter((r) => r.prefab_id === 'plant-small');
    expect(workstations).toHaveLength(3);
    expect(plants).toHaveLength(1);

    // All belong to the correct company and zone
    for (const r of results) {
      expect(r.company_id).toBe('co-1');
      expect(r.zone_id).toBe('zone-dev');
    }

    // Positions should be sequentially spaced
    expect(results[0]?.position_x).toBe(0);
    expect(results[1]?.position_x).toBe(120);
    expect(results[2]?.position_x).toBe(240);
    expect(results[3]?.position_x).toBe(360);
  });

  it('materializeDefaultLayout("library") creates 5 instances', async () => {
    const results = await service.materializeDefaultLayout('co-1', 'zone-lib', 'library');

    expect(results).toHaveLength(5);

    const bookshelves = results.filter((r) => r.prefab_id === 'bookshelf-double');
    const tables = results.filter((r) => r.prefab_id === 'reading-table');
    const chairs = results.filter((r) => r.prefab_id === 'chair-standalone');
    const plants = results.filter((r) => r.prefab_id === 'plant-large');

    expect(bookshelves).toHaveLength(2);
    expect(tables).toHaveLength(1);
    expect(chairs).toHaveLength(1);
    expect(plants).toHaveLength(1);
  });

  it('materializeDefaultLayout("rest_area") creates 4 instances', async () => {
    const results = await service.materializeDefaultLayout('co-1', 'zone-rest', 'rest_area');

    expect(results).toHaveLength(4);

    const prefabIds = results.map((r) => r.prefab_id).sort();
    expect(prefabIds).toEqual(['coffee-table', 'plant-small', 'sofa-set', 'vending-machine']);
  });

  it('materializeDefaultLayout("meeting_room") selects meeting-table-4 for count<=4', async () => {
    const results = await service.materializeDefaultLayout('co-1', 'zone-mtg', 'meeting_room', 4);

    expect(results).toHaveLength(2);
    expect(results.some((r) => r.prefab_id === 'meeting-table-4')).toBe(true);
    expect(results.some((r) => r.prefab_id === 'whiteboard')).toBe(true);
  });

  it('materializeDefaultLayout("meeting_room") selects meeting-table-8 for count>4', async () => {
    const results = await service.materializeDefaultLayout('co-1', 'zone-mtg', 'meeting_room', 8);

    expect(results).toHaveLength(2);
    expect(results.some((r) => r.prefab_id === 'meeting-table-8')).toBe(true);
    expect(results.some((r) => r.prefab_id === 'whiteboard')).toBe(true);
  });

  it('materializeDefaultLayout("server_room", 2) creates 4 instances (2 racks + cable-tray + switch)', async () => {
    const results = await service.materializeDefaultLayout('co-1', 'zone-srv', 'server_room', 2);

    expect(results).toHaveLength(4);

    const racks = results.filter((r) => r.prefab_id === 'server-rack-2u');
    const cables = results.filter((r) => r.prefab_id === 'cable-tray');
    const switches = results.filter((r) => r.prefab_id === 'network-switch');

    expect(racks).toHaveLength(2);
    expect(cables).toHaveLength(1);
    expect(switches).toHaveLength(1);
  });

  it('materializeDefaultLayout() persists all instances to repo', async () => {
    await service.materializeDefaultLayout('co-1', 'zone-dev', 'department', 2);

    const all = await repo.findByCompanyAndZone('co-1', 'zone-dev');
    expect(all).toHaveLength(3); // 2 workstations + 1 plant
  });

  it('materializeDefaultLayout() emits events for each created instance', async () => {
    const emitSpy = vi.spyOn(eventBus, 'emit');

    await service.materializeDefaultLayout('co-1', 'zone-dev', 'department', 2);

    // 3 instances = 3 events
    expect(emitSpy).toHaveBeenCalledTimes(3);
    for (const call of emitSpy.mock.calls) {
      expect(call[0].type).toBe('prefab.state.changed');
    }
  });
});
