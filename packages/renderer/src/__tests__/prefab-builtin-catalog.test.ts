import type { SemanticCategory } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import {
  getAllBuiltinPrefabs,
  getBuiltinPrefab,
  getBuiltinPrefabsByCategory,
} from '../prefab/builtin-catalog.js';
import { getDefaultZoneLayout } from '../prefab/default-zone-layouts.js';

// ── Catalog size & completeness ─────────────────────────────────

describe('builtin-catalog completeness', () => {
  it('contains at least 25 built-in prefabs', () => {
    const all = getAllBuiltinPrefabs();
    expect(all.length).toBeGreaterThanOrEqual(25);
  });

  it('every prefab has a unique prefabId', () => {
    const all = getAllBuiltinPrefabs();
    const ids = all.map((p) => p.prefabId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every category has at least one prefab', () => {
    const categories: SemanticCategory[] = [
      'workspace',
      'compute',
      'knowledge',
      'collaboration',
      'infrastructure',
      'decorative',
    ];
    for (const cat of categories) {
      const inCat = getBuiltinPrefabsByCategory(cat);
      expect(
        inCat.length,
        `category "${cat}" should have at least one prefab`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── Specific prefab assertions ──────────────────────────────────

function requireBuiltinPrefab(prefabId: string) {
  const prefab = getBuiltinPrefab(prefabId);
  expect(prefab, `missing builtin prefab "${prefabId}"`).toBeDefined();
  if (!prefab) {
    throw new Error(`missing builtin prefab "${prefabId}"`);
  }

  return prefab;
}

describe('workstation-standard', () => {
  const ws = requireBuiltinPrefab('workstation-standard');

  it('exists', () => {
    expect(ws).toBeDefined();
  });

  it('is composite with 3 children', () => {
    expect(ws?.composite).toBe(true);
    expect(ws?.children).toHaveLength(3);
  });

  it('has category workspace', () => {
    expect(ws?.category).toBe('workspace');
  });

  it('has agent-context binding slot (required)', () => {
    expect(ws?.bindingSlots).toHaveLength(1);
    expect(ws?.bindingSlots[0]?.type).toBe('agent-context');
    expect(ws?.bindingSlots[0]?.required).toBe(true);
  });

  it('children reference desk, monitor, and chair templates', () => {
    const templates = ws?.children?.map((c) => c.render2D.template);
    expect(templates).toContain('desk');
    expect(templates).toContain('monitor');
    expect(templates).toContain('chair');
  });
});

describe('server-rack-2u', () => {
  const sr = requireBuiltinPrefab('server-rack-2u');

  it('exists', () => {
    expect(sr).toBeDefined();
  });

  it('is atomic (not composite) with render2D', () => {
    expect(sr?.composite).toBe(false);
    expect(sr?.render2D).toBeDefined();
    expect(sr?.children).toBeUndefined();
  });

  it('has rack-provider binding (required)', () => {
    expect(sr?.bindingSlots).toHaveLength(1);
    expect(sr?.bindingSlots[0]?.type).toBe('rack-provider');
    expect(sr?.bindingSlots[0]?.required).toBe(true);
  });

  it('has category compute', () => {
    expect(sr?.category).toBe('compute');
  });
});

describe('plant-small', () => {
  const plant = requireBuiltinPrefab('plant-small');

  it('exists', () => {
    expect(plant).toBeDefined();
  });

  it('is decorative with no bindings', () => {
    expect(plant?.category).toBe('decorative');
    expect(plant?.bindingSlots).toHaveLength(0);
  });

  it('is atomic with render2D', () => {
    expect(plant?.composite).toBe(false);
    expect(plant?.render2D).toBeDefined();
  });

  it('has gridSize [1,1]', () => {
    expect(plant?.gridSize).toEqual([1, 1]);
  });
});

// ── Composite vs atomic invariant ───────────────────────────────

describe('composite/atomic invariant', () => {
  it('composite prefabs have children but no render2D', () => {
    const composites = getAllBuiltinPrefabs().filter((p) => p.composite);
    expect(composites.length).toBeGreaterThan(0);
    for (const p of composites) {
      expect(p.children, `composite prefab "${p.prefabId}" must have children`).toBeDefined();
      expect(
        p.children?.length,
        `composite prefab "${p.prefabId}" must have at least one child`,
      ).toBeGreaterThan(0);
      expect(p.render2D, `composite prefab "${p.prefabId}" must not have render2D`).toBeUndefined();
    }
  });

  it('atomic prefabs have render2D but no children', () => {
    const atomics = getAllBuiltinPrefabs().filter((p) => !p.composite);
    expect(atomics.length).toBeGreaterThan(0);
    for (const p of atomics) {
      expect(p.render2D, `atomic prefab "${p.prefabId}" must have render2D`).toBeDefined();
      expect(p.children, `atomic prefab "${p.prefabId}" must not have children`).toBeUndefined();
    }
  });
});

// ── Lookup API ──────────────────────────────────────────────────

describe('getBuiltinPrefab', () => {
  it('returns undefined for unknown id', () => {
    expect(getBuiltinPrefab('nonexistent-widget-xyz')).toBeUndefined();
  });

  it('returns the same object reference for repeated calls', () => {
    const a = getBuiltinPrefab('workstation-standard');
    const b = getBuiltinPrefab('workstation-standard');
    expect(a).toBe(b);
  });
});

describe('getBuiltinPrefabsByCategory', () => {
  it('returns only prefabs of the requested category', () => {
    const compute = getBuiltinPrefabsByCategory('compute');
    for (const p of compute) {
      expect(p.category).toBe('compute');
    }
  });

  it('workspace category has exactly 3 prefabs', () => {
    expect(getBuiltinPrefabsByCategory('workspace')).toHaveLength(3);
  });

  it('decorative category has exactly 8 prefabs', () => {
    expect(getBuiltinPrefabsByCategory('decorative')).toHaveLength(8);
  });
});

// ── Immutability ────────────────────────────────────────────────

describe('immutability', () => {
  it('prefab objects are frozen', () => {
    const ws = requireBuiltinPrefab('workstation-standard');
    expect(Object.isFrozen(ws)).toBe(true);
  });

  it('gridSize tuple is frozen', () => {
    const ws = requireBuiltinPrefab('workstation-standard');
    expect(Object.isFrozen(ws.gridSize)).toBe(true);
  });

  it('bindingSlots array is frozen', () => {
    const ws = requireBuiltinPrefab('workstation-standard');
    expect(Object.isFrozen(ws.bindingSlots)).toBe(true);
  });
});

// ── Default zone layouts ────────────────────────────────────────

describe('getDefaultZoneLayout', () => {
  describe('department', () => {
    it('returns N workstations + 1 plant for count=N', () => {
      const layout = getDefaultZoneLayout('department', 5);
      const workstations = layout.filter((p) => p.prefabId === 'workstation-standard');
      const plants = layout.filter((p) => p.prefabId === 'plant-small');
      expect(workstations).toHaveLength(5);
      expect(plants).toHaveLength(1);
    });

    it('defaults to 3 workstations when count is omitted', () => {
      const layout = getDefaultZoneLayout('department');
      const workstations = layout.filter((p) => p.prefabId === 'workstation-standard');
      expect(workstations).toHaveLength(3);
    });

    it('clamps count to at least 1', () => {
      const layout = getDefaultZoneLayout('department', 0);
      const workstations = layout.filter((p) => p.prefabId === 'workstation-standard');
      expect(workstations).toHaveLength(1);
    });
  });

  describe('library', () => {
    it('includes bookshelves', () => {
      const layout = getDefaultZoneLayout('library');
      const bookshelves = layout.filter((p) => p.prefabId.startsWith('bookshelf'));
      expect(bookshelves.length).toBeGreaterThanOrEqual(1);
    });

    it('includes reading-table and chair', () => {
      const layout = getDefaultZoneLayout('library');
      const ids = layout.map((p) => p.prefabId);
      expect(ids).toContain('reading-table');
      expect(ids).toContain('chair-standalone');
    });

    it('includes a large plant', () => {
      const layout = getDefaultZoneLayout('library');
      const ids = layout.map((p) => p.prefabId);
      expect(ids).toContain('plant-large');
    });
  });

  describe('rest_area', () => {
    it('includes sofa-set, coffee-table, vending-machine, and plant', () => {
      const layout = getDefaultZoneLayout('rest_area');
      const ids = layout.map((p) => p.prefabId);
      expect(ids).toContain('sofa-set');
      expect(ids).toContain('coffee-table');
      expect(ids).toContain('vending-machine');
      expect(ids).toContain('plant-small');
    });
  });

  describe('meeting_room', () => {
    it('uses meeting-table-4 when count <= 4', () => {
      const layout = getDefaultZoneLayout('meeting_room', 3);
      const ids = layout.map((p) => p.prefabId);
      expect(ids).toContain('meeting-table-4');
      expect(ids).not.toContain('meeting-table-8');
    });

    it('uses meeting-table-8 when count > 4', () => {
      const layout = getDefaultZoneLayout('meeting_room', 6);
      const ids = layout.map((p) => p.prefabId);
      expect(ids).toContain('meeting-table-8');
      expect(ids).not.toContain('meeting-table-4');
    });

    it('includes a whiteboard', () => {
      const layout = getDefaultZoneLayout('meeting_room');
      const ids = layout.map((p) => p.prefabId);
      expect(ids).toContain('whiteboard');
    });
  });

  describe('server_room', () => {
    it('returns N server-rack-2u for count=N', () => {
      const layout = getDefaultZoneLayout('server_room', 4);
      const racks = layout.filter((p) => p.prefabId === 'server-rack-2u');
      expect(racks).toHaveLength(4);
    });

    it('includes cable-tray and network-switch', () => {
      const layout = getDefaultZoneLayout('server_room', 2);
      const ids = layout.map((p) => p.prefabId);
      expect(ids).toContain('cable-tray');
      expect(ids).toContain('network-switch');
    });

    it('defaults to 2 racks when count is omitted', () => {
      const layout = getDefaultZoneLayout('server_room');
      const racks = layout.filter((p) => p.prefabId === 'server-rack-2u');
      expect(racks).toHaveLength(2);
    });
  });

  describe('all placements reference valid catalog prefabs', () => {
    const zoneTypes: Array<[string, number | undefined]> = [
      ['department', 3],
      ['library', undefined],
      ['rest_area', undefined],
      ['meeting_room', 4],
      ['meeting_room', 8],
      ['server_room', 2],
    ];

    it.each(zoneTypes)('zone "%s" (count=%s) only references catalog ids', (type, count) => {
      const layout = getDefaultZoneLayout(
        type as Parameters<typeof getDefaultZoneLayout>[0],
        count,
      );
      for (const placement of layout) {
        expect(
          getBuiltinPrefab(placement.prefabId),
          `placement references unknown prefabId "${placement.prefabId}"`,
        ).toBeDefined();
      }
    });
  });
});
