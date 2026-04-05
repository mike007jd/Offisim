import type { PrefabInstanceRow, Zone } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import { SeatRegistry } from '../../lib/seat-registry';

function makeInstance(
  overrides: Partial<PrefabInstanceRow> & {
    instance_id: string;
    prefab_id: string;
    zone_id: string;
  },
): PrefabInstanceRow {
  return {
    company_id: 'co1',
    position_x: 0,
    position_y: 0,
    rotation: 0,
    bindings_json: null,
    config_json: null,
    enabled: 1,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function makeZone(overrides: Partial<Zone> & { zoneId: string }): Zone {
  return {
    companyId: 'co1',
    kind: 'system',
    label: 'Test',
    archetype: 'workspace',
    accentColor: '#60a5fa',
    floorColor: 0x666666,
    deskSlots: 4,
    targetRoles: [],
    allowedCategories: [],
    activityTypes: [],
    sortOrder: 0,
    cx: 0,
    cz: 0,
    w: 10,
    d: 10,
    ...overrides,
  };
}

describe('SeatRegistry', () => {
  it('assigns seats from workstation-standard with correct world positions', () => {
    // workstation-standard: work anchor [0, 1.4], capacity 1
    // instance at position_x=5, position_y=8, rotation=0
    // toWorldAnchor([0, 1.4], [5, 8], 0) → position [5, 0, 9.4]
    const instance = makeInstance({
      instance_id: 'ws1',
      prefab_id: 'workstation-standard',
      zone_id: 'z1',
      position_x: 5,
      position_y: 8,
    });
    const zone = makeZone({ zoneId: 'z1', deskSlots: 1 });
    const reg = SeatRegistry.build([instance], [zone]);

    const seat = reg.getSeat('z1', 0);
    expect(seat).not.toBeNull();
    expect(seat!.instanceId).toBe('ws1');
    expect(seat!.isFallback).toBe(false);
    expect(seat!.position[0]).toBeCloseTo(5, 5);
    expect(seat!.position[1]).toBeCloseTo(0, 5);
    expect(seat!.position[2]).toBeCloseTo(9.4, 5);
  });

  it('handles rotation=90 correctly', () => {
    // workstation-standard: work anchor [0, 1.4]
    // rotateLocalPoint([0, 1.4], 90) → [1.4, 0]
    // instance at [5, 8] → world [5 + 1.4, 0, 8 + 0] = [6.4, 0, 8]
    const instance = makeInstance({
      instance_id: 'ws2',
      prefab_id: 'workstation-standard',
      zone_id: 'z1',
      position_x: 5,
      position_y: 8,
      rotation: 90,
    });
    const zone = makeZone({ zoneId: 'z1', deskSlots: 1 });
    const reg = SeatRegistry.build([instance], [zone]);

    const seat = reg.getSeat('z1', 0);
    expect(seat).not.toBeNull();
    expect(seat!.position[0]).toBeCloseTo(6.4, 5);
    expect(seat!.position[1]).toBeCloseTo(0, 5);
    expect(seat!.position[2]).toBeCloseTo(8, 5);
  });

  it('falls back to zone-center + SEAT_OFFSETS when no instances exist', () => {
    const zone = makeZone({ zoneId: 'z1', cx: 10, cz: 20, deskSlots: 4 });
    const reg = SeatRegistry.build([], [zone]);

    const seats = reg.getZoneSeats('z1');
    expect(seats.length).toBe(4);
    for (const s of seats) {
      expect(s.isFallback).toBe(true);
      expect(s.instanceId).toBeNull();
    }

    // SEAT_OFFSETS = [[-0.8,0,-1.6],[0.8,0,-1.6],[-0.8,0,1.6],[0.8,0,1.6]]
    expect(seats[0]!.position[0]).toBeCloseTo(10 - 0.8, 5);
    expect(seats[0]!.position[2]).toBeCloseTo(20 - 1.6, 5);
    expect(seats[1]!.position[0]).toBeCloseTo(10 + 0.8, 5);
    expect(seats[1]!.position[2]).toBeCloseTo(20 - 1.6, 5);
    expect(seats[2]!.position[0]).toBeCloseTo(10 - 0.8, 5);
    expect(seats[2]!.position[2]).toBeCloseTo(20 + 1.6, 5);
    expect(seats[3]!.position[0]).toBeCloseTo(10 + 0.8, 5);
    expect(seats[3]!.position[2]).toBeCloseTo(20 + 1.6, 5);
  });

  it('returns valid seat when slot index exceeds capacity (wraps around)', () => {
    const instance = makeInstance({
      instance_id: 'ws1',
      prefab_id: 'workstation-standard',
      zone_id: 'z1',
      position_x: 5,
      position_y: 8,
    });
    const zone = makeZone({ zoneId: 'z1', deskSlots: 4 });
    const reg = SeatRegistry.build([instance], [zone]);

    // Zone has 4 deskSlots, 1 prefab seat + 3 fallback seats = 4 total
    const allSeats = reg.getZoneSeats('z1');
    expect(allSeats.length).toBe(4);

    const seat0 = reg.getSeat('z1', 0);
    const seat5 = reg.getSeat('z1', 5);
    expect(seat0).not.toBeNull();
    expect(seat5).not.toBeNull();
    // index 5 % 4 === 1 → second seat (a fallback)
    expect(seat5!.position).toEqual(allSeats[1]!.position);
  });

  it('fills fallback seats for partially-furnished zones', () => {
    // Zone has deskSlots=4 but only 1 workstation prefab → should get 1 real + 3 fallback
    const instance = makeInstance({
      instance_id: 'ws1',
      prefab_id: 'workstation-standard',
      zone_id: 'z1',
      position_x: 5,
      position_y: 8,
    });
    const zone = makeZone({ zoneId: 'z1', cx: 10, cz: 20, deskSlots: 4 });
    const reg = SeatRegistry.build([instance], [zone]);

    const seats = reg.getZoneSeats('z1');
    expect(seats.length).toBe(4);

    // First seat is the real prefab seat
    expect(seats[0]!.isFallback).toBe(false);
    expect(seats[0]!.instanceId).toBe('ws1');

    // Remaining 3 are fallback
    expect(seats[1]!.isFallback).toBe(true);
    expect(seats[2]!.isFallback).toBe(true);
    expect(seats[3]!.isFallback).toBe(true);

    // All 4 positions must be distinct (no stacking)
    const positions = seats.map((s) => `${s.position[0]},${s.position[2]}`);
    expect(new Set(positions).size).toBe(4);
  });

  it('returns separate seats for multi-capacity prefabs (sofa-set, 3 seats)', () => {
    // sofa-set: capacity=3, work anchor [0, 1.0]
    // Seats spread: offset = (i - (3-1)/2) * 0.8 = (i - 1) * 0.8
    // i=0 → -0.8, i=1 → 0, i=2 → +0.8
    const instance = makeInstance({
      instance_id: 'sofa1',
      prefab_id: 'sofa-set',
      zone_id: 'z1',
      position_x: 3,
      position_y: 4,
    });
    const zone = makeZone({ zoneId: 'z1', deskSlots: 3 });
    const reg = SeatRegistry.build([instance], [zone]);

    const seats = reg.getZoneSeats('z1');
    expect(seats.length).toBe(3);

    // All seats should be non-fallback
    for (const s of seats) {
      expect(s.isFallback).toBe(false);
      expect(s.instanceId).toBe('sofa1');
    }

    // Positions should differ in X
    const xs = seats.map((s) => s.position[0]);
    expect(new Set(xs).size).toBe(3);
  });

  it('getRestSeat returns deterministic position near rest zone center', () => {
    const restZone = makeZone({
      zoneId: 'rest1',
      archetype: 'rest',
      cx: 20,
      cz: 30,
    });
    const reg = SeatRegistry.build([], [restZone]);

    const pos0 = reg.getRestSeat([restZone], 0);
    const pos1 = reg.getRestSeat([restZone], 1);

    // Should be [number, number, number]
    expect(pos0).toHaveLength(3);
    expect(pos1).toHaveLength(3);

    // Deterministic — same input same output
    expect(reg.getRestSeat([restZone], 0)).toEqual(pos0);

    // Different slot indices yield different positions
    expect(pos0).not.toEqual(pos1);

    // Y is always 0
    expect(pos0[1]).toBe(0);
    expect(pos1[1]).toBe(0);
  });
});
