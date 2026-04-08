import type { Zone } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import { SeatRegistry } from '../../lib/seat-registry';
import { buildZoneDeskEmployeeSvgPositions } from '../../components/scene/office-2d-layout';

const zone: Zone = {
  zoneId: 'dev',
  companyId: 'c-1',
  kind: 'system',
  archetype: 'workspace',
  label: 'Dev',
  accentColor: '#60a5fa',
  floorColor: 0,
  cx: 12,
  cz: 8,
  w: 8,
  d: 8,
  targetRoles: ['developer'],
  allowedCategories: [],
  activityTypes: ['work'],
  deskSlots: 5,
  sortOrder: 1,
};

describe('office 2d layout helpers', () => {
  it('returns distinct desk positions for more than four employees in the same workspace zone', () => {
    const seatRegistry = SeatRegistry.build([], [zone]);
    const positions = buildZoneDeskEmployeeSvgPositions(zone, 5, seatRegistry);

    expect(positions).toHaveLength(5);
    expect(new Set(positions.map((position) => `${position.x}:${position.y}`)).size).toBe(5);
  });
});
