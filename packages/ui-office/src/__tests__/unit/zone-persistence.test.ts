import type { RuntimeRepositories } from '@offisim/core/browser';
import type { Zone } from '@offisim/shared-types';
import { getPresetsForArchetype } from '@offisim/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type PlacedInstance, useStudioStore } from '../../components/studio/StudioState';
import { saveZonesToDb } from '../../lib/zone-persistence';

function makeZone(overrides?: Partial<Zone>): Zone {
  return {
    zoneId: 'co-test::zone-workspace',
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
    zoneId: 'co-test::zone-workspace',
    ...overrides,
  };
}

interface MockRepos {
  repos: Pick<RuntimeRepositories, 'prefabInstances' | 'zones'>;
  zoneRows: Array<{ zone_id: string; company_id: string }>;
  prefabRows: Array<{ zone_id: string; company_id: string }>;
  deleteCalls: string[];
}

function makeRepos(): MockRepos {
  const zoneRows: MockRepos['zoneRows'] = [];
  const prefabRows: MockRepos['prefabRows'] = [];
  const deleteCalls: string[] = [];
  const repos = {
    prefabInstances: {
      deleteByCompany: vi.fn(async (companyId: string) => {
        deleteCalls.push(`prefab-delete:${companyId}`);
      }),
      create: vi.fn(async (row) => {
        prefabRows.push({ zone_id: row.zone_id, company_id: row.company_id });
        return row;
      }),
    },
    zones: {
      deleteByCompany: vi.fn(async (companyId: string) => {
        deleteCalls.push(`zone-delete:${companyId}`);
      }),
      create: vi.fn(async (row) => {
        zoneRows.push({ zone_id: row.zone_id, company_id: row.company_id });
        return { ...row, created_at: '', updated_at: '' };
      }),
    },
  } as Pick<RuntimeRepositories, 'prefabInstances' | 'zones'>;
  return { repos, zoneRows, prefabRows, deleteCalls };
}

describe('saveZonesToDb', () => {
  it('wipes and re-inserts zones and prefab instances, then emits refresh event', async () => {
    const { repos, zoneRows, prefabRows, deleteCalls } = makeRepos();
    const eventBus = { emit: vi.fn() };

    await saveZonesToDb(repos, 'co-test', [makeZone()], [makeInstance()], eventBus);

    expect(deleteCalls).toEqual(['prefab-delete:co-test', 'zone-delete:co-test']);
    expect(zoneRows).toEqual([{ zone_id: 'co-test::zone-workspace', company_id: 'co-test' }]);
    expect(prefabRows).toEqual([{ zone_id: 'co-test::zone-workspace', company_id: 'co-test' }]);
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });

  it('rewrites sentinel-prefixed zoneIds onto the real companyId at save time', async () => {
    const { repos, zoneRows, prefabRows } = makeRepos();
    const eventBus = { emit: vi.fn() };

    const sentinelZone = makeZone({
      zoneId: 'studio-preview::zone-workspace',
      companyId: 'studio-preview',
    });
    const sentinelInstance = makeInstance({ zoneId: 'studio-preview::zone-workspace' });

    await saveZonesToDb(repos, 'real-uuid-123', [sentinelZone], [sentinelInstance], eventBus);

    expect(zoneRows).toEqual([
      { zone_id: 'real-uuid-123::zone-workspace', company_id: 'real-uuid-123' },
    ]);
    expect(prefabRows).toEqual([
      { zone_id: 'real-uuid-123::zone-workspace', company_id: 'real-uuid-123' },
    ]);
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

    useStudioStore.getState().updateZonePosition('co-test::zone-workspace', 5, 7);

    expect(useStudioStore.getState().zones[0]?.cx).toBe(5);
    expect(useStudioStore.getState().zones[0]?.cz).toBe(7);
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
