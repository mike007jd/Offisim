import type { RuntimeRepositories } from '@offisim/core/browser';
import type { Zone } from '@offisim/shared-types';
import { getPresetsForArchetype } from '@offisim/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type PlacedInstance, useStudioStore } from '../../components/studio/StudioState';
import { saveZonesToDb } from '../../lib/zone-persistence';

function makeZone(overrides?: Partial<Zone>): Zone {
  return {
    zoneId: 'zone-workspace',
    companyId: 'co-test',
    kind: 'system',
    archetype: 'workspace',
    label: 'Workspace',
    accentColor: '#3b82f6',
    floorColor: 0x334155,
    cx: 0,
    cz: 0,
    w: 10,
    d: 8,
    targetRoles: ['developer'],
    allowedCategories: ['workspace'],
    activityTypes: ['work'],
    deskSlots: 4,
    sortOrder: 0,
    ...overrides,
  };
}

function makeInstance(overrides?: Partial<PlacedInstance>): PlacedInstance {
  return {
    id: 'sp-temp-instance',
    prefabId: 'desk_corner',
    position: [1, 0, 2],
    rotation: 0,
    zoneId: 'zone-workspace',
    ...overrides,
  };
}

describe('saveZonesToDb', () => {
  it('wipes and re-inserts zones and prefab instances, then emits refresh event', async () => {
    const calls: string[] = [];
    const repos = {
      prefabInstances: {
        deleteByCompany: vi.fn(async (companyId: string) => {
          calls.push(`prefab-delete:${companyId}`);
        }),
        create: vi.fn(async (row) => {
          calls.push(`prefab-create:${row.zone_id}`);
          return row;
        }),
      },
      zones: {
        deleteByCompany: vi.fn(async (companyId: string) => {
          calls.push(`zone-delete:${companyId}`);
        }),
        create: vi.fn(async (row) => {
          calls.push(`zone-create:${row.zone_id}`);
          return { ...row, created_at: '', updated_at: '' };
        }),
      },
    } as Pick<RuntimeRepositories, 'prefabInstances' | 'zones'>;
    const eventBus = { emit: vi.fn() };

    await saveZonesToDb(repos, 'co-test', [makeZone()], [makeInstance()], eventBus);

    expect(calls).toEqual([
      'prefab-delete:co-test',
      'zone-delete:co-test',
      'zone-create:co-test::zone-workspace',
      'prefab-create:co-test::zone-workspace',
    ]);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });
});

describe('useStudioStore zone actions', () => {
  beforeEach(() => {
    useStudioStore.getState().resetForCompany('co-test');
    useStudioStore.setState({
      zones: [],
      instances: [],
      dirty: false,
      selectedZoneId: null,
    });
  });

  it('loadZonesFromDb hydrates zones without dirtying the store', () => {
    useStudioStore.getState().loadZonesFromDb([makeZone()]);

    expect(useStudioStore.getState().zones).toHaveLength(1);
    expect(useStudioStore.getState().dirty).toBe(false);
  });

  it('updateZonePosition moves the zone and its instances together', () => {
    useStudioStore.setState({
      zones: [makeZone()],
      instances: [makeInstance()],
    });

    useStudioStore.getState().updateZonePosition('zone-workspace', 5, 7);

    expect(useStudioStore.getState().zones[0]?.cx).toBe(5);
    expect(useStudioStore.getState().zones[0]?.cz).toBe(7);
    expect(useStudioStore.getState().instances[0]?.position).toEqual([6, 0, 9]);
  });

  it('updateZonePosition handles companyId-prefixed zoneId from DB', () => {
    const prefixedId = 'company-abc::workspace-1';
    useStudioStore.setState({
      zones: [makeZone({ zoneId: prefixedId, companyId: 'company-abc' })],
      instances: [makeInstance({ zoneId: prefixedId })],
    });

    useStudioStore.getState().updateZonePosition(prefixedId, 5, 7);

    expect(useStudioStore.getState().zones[0]?.cx).toBe(5);
    expect(useStudioStore.getState().zones[0]?.cz).toBe(7);
    expect(useStudioStore.getState().instances[0]?.position).toEqual([6, 0, 9]);
  });

  it('updateZonePosition handles slug-only zoneId from local state', () => {
    const slugId = 'workspace-1';
    useStudioStore.setState({
      zones: [makeZone({ zoneId: slugId })],
      instances: [makeInstance({ zoneId: slugId })],
    });

    useStudioStore.getState().updateZonePosition(slugId, 5, 7);

    expect(useStudioStore.getState().zones[0]?.cx).toBe(5);
    expect(useStudioStore.getState().zones[0]?.cz).toBe(7);
    expect(useStudioStore.getState().instances[0]?.position).toEqual([6, 0, 9]);
  });

  it('updateZonePosition does not lose instances when zone and instance zoneId formats diverge', () => {
    // Suspected B3 real failure mode: zones loaded with normalized DB id
    // 'company-abc::workspace-1' but instances still carry slug-only
    // 'workspace-1' (or vice versa). Move should still carry instances.
    useStudioStore.setState({
      zones: [makeZone({ zoneId: 'company-abc::workspace-1', companyId: 'company-abc' })],
      instances: [makeInstance({ zoneId: 'workspace-1' })],
    });

    useStudioStore.getState().updateZonePosition('company-abc::workspace-1', 5, 7);

    expect(useStudioStore.getState().zones[0]?.cx).toBe(5);
    expect(useStudioStore.getState().zones[0]?.cz).toBe(7);
    // Instance should have moved with its zone, regardless of id format drift.
    expect(useStudioStore.getState().instances[0]?.position).toEqual([6, 0, 9]);
  });

  it('addZoneFromPreset and removeZone add editable zones but keep required zones protected', () => {
    const preset = getPresetsForArchetype('workspace')[0];
    if (!preset) {
      throw new Error('Expected a workspace preset for StudioState test');
    }

    useStudioStore.getState().addZoneFromPreset(preset, [3, 0, 4]);

    const addedZone = useStudioStore.getState().zones.at(-1);
    expect(addedZone?.cx).toBe(3);
    expect(addedZone?.cz).toBe(4);
    expect(useStudioStore.getState().instances.length).toBeGreaterThan(0);

    useStudioStore.setState({
      zones: [
        makeZone({ zoneId: 'required-rest', archetype: 'rest' }),
        ...(addedZone ? [addedZone] : []),
      ],
    });

    useStudioStore.getState().removeZone('required-rest');
    expect(useStudioStore.getState().zones.some((zone) => zone.zoneId === 'required-rest')).toBe(
      true,
    );

    if (addedZone) {
      useStudioStore.getState().removeZone(addedZone.zoneId);
      expect(useStudioStore.getState().zones.some((zone) => zone.zoneId === addedZone.zoneId)).toBe(
        false,
      );
    }
  });
});
