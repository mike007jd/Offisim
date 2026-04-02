import type { Zone } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import { buildZoneRouteWaypoints, findZoneNavPath, zonesAreNavAdjacent } from '../../lib/scene-nav';

const zones: readonly Zone[] = [
  {
    zoneId: 'meeting',
    companyId: 'c-1',
    kind: 'system',
    archetype: 'meeting',
    label: 'Meeting',
    accentColor: '#a855f7',
    floorColor: 0,
    cx: 0,
    cz: 0,
    w: 6,
    d: 6,
    targetRoles: [],
    allowedCategories: [],
    activityTypes: ['meet'],
    deskSlots: 0,
    sortOrder: 1,
  },
  {
    zoneId: 'library',
    companyId: 'c-1',
    kind: 'system',
    archetype: 'library',
    label: 'Library',
    accentColor: '#38bdf8',
    floorColor: 0,
    cx: 10,
    cz: 0,
    w: 6,
    d: 6,
    targetRoles: [],
    allowedCategories: [],
    activityTypes: ['learn'],
    deskSlots: 0,
    sortOrder: 2,
  },
  {
    zoneId: 'dev',
    companyId: 'c-1',
    kind: 'system',
    archetype: 'workspace',
    label: 'Dev',
    accentColor: '#60a5fa',
    floorColor: 0,
    cx: 20,
    cz: 0,
    w: 8,
    d: 8,
    targetRoles: ['developer'],
    allowedCategories: [],
    activityTypes: ['work'],
    deskSlots: 4,
    sortOrder: 3,
  },
  {
    zoneId: 'rest',
    companyId: 'c-1',
    kind: 'system',
    archetype: 'rest',
    label: 'Rest',
    accentColor: '#34d399',
    floorColor: 0,
    cx: 20,
    cz: 12,
    w: 8,
    d: 8,
    targetRoles: [],
    allowedCategories: [],
    activityTypes: ['rest'],
    deskSlots: 0,
    sortOrder: 4,
  },
];

describe('scene-nav', () => {
  it('treats nearby axis-aligned zones as adjacent and rejects distant diagonal jumps', () => {
    expect(zonesAreNavAdjacent(zones[0], zones[1])).toBe(true);
    expect(zonesAreNavAdjacent(zones[1], zones[2])).toBe(true);
    expect(zonesAreNavAdjacent(zones[0], zones[3])).toBe(false);
  });

  it('finds a believable zone path through intermediate rooms', () => {
    expect(findZoneNavPath(zones, 'meeting', 'dev')).toEqual(['meeting', 'library', 'dev']);
    expect(findZoneNavPath(zones, 'meeting', 'rest')).toEqual([
      'meeting',
      'library',
      'dev',
      'rest',
    ]);
  });

  it('builds route waypoints from intermediate zone centers only', () => {
    expect(buildZoneRouteWaypoints(zones, 'meeting', 'rest')).toEqual([
      [10, 0, 0],
      [20, 0, 0],
    ]);
  });
});
