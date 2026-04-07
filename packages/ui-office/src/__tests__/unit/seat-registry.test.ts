import type { PrefabInstanceRow, Zone } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import { SeatRegistry } from '../../lib/seat-registry';

function planarDistance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) {
  const dx = a[0] - b[0];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dz * dz);
}

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
    // footprint depth edge is z=9.5, so seat should be nudged just outside it.
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
    if (!seat) {
      throw new Error('expected workstation seat');
    }
    expect(seat.instanceId).toBe('ws1');
    expect(seat.isFallback).toBe(false);
    expect(seat.position[0]).toBeCloseTo(5, 5);
    expect(seat.position[1]).toBeCloseTo(0, 5);
    expect(seat.position[2]).toBeCloseTo(9.85, 5);
    expect(seat.approachPosition[2]).toBeGreaterThan(seat.position[2]);
    expect(planarDistance(seat.position, seat.approachPosition)).toBeCloseTo(0.35, 5);
  });

  it('handles rotation=90 correctly', () => {
    // workstation-standard: work anchor [0, 1.4]
    // rotated footprint extends to x=6.5, so seat should be nudged just outside it.
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
    if (!seat) {
      throw new Error('expected rotated workstation seat');
    }
    expect(seat.position[0]).toBeCloseTo(6.85, 5);
    expect(seat.approachPosition[0]).toBeGreaterThan(seat.position[0]);
    expect(planarDistance(seat.position, seat.approachPosition)).toBeCloseTo(0.35, 5);
    expect(seat.position[1]).toBeCloseTo(0, 5);
    expect(seat.position[2]).toBeCloseTo(8, 5);
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
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(seats[0]!.position[0]).toBeCloseTo(10 - 0.8, 5);
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(seats[0]!.position[2]).toBeCloseTo(20 - 1.6, 5);
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(seats[1]!.position[0]).toBeCloseTo(10 + 0.8, 5);
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(seats[1]!.position[2]).toBeCloseTo(20 - 1.6, 5);
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(seats[2]!.position[0]).toBeCloseTo(10 - 0.8, 5);
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(seats[2]!.position[2]).toBeCloseTo(20 + 1.6, 5);
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(seats[3]!.position[0]).toBeCloseTo(10 + 0.8, 5);
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
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
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
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
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(seats[0]!.isFallback).toBe(false);
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(seats[0]!.instanceId).toBe('ws1');

    // Remaining 3 are fallback
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(seats[1]!.isFallback).toBe(true);
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(seats[2]!.isFallback).toBe(true);
    // biome-ignore lint/style/noNonNullAssertion: test assertion — value verified by preceding check
    expect(seats[3]!.isFallback).toBe(true);

    // All 4 positions must be distinct (no stacking)
    const positions = seats.map((s) => `${s.position[0]},${s.position[2]}`);
    expect(new Set(positions).size).toBe(4);
  });

  it('returns separate seats for multi-capacity prefabs (sofa-set, 3 seats)', () => {
    // sofa-set: capacity=3, work anchor is nudged outside the footprint before lateral spread.
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
      expect(s.approachPosition[2]).toBeGreaterThan(s.position[2]);
      expect(planarDistance(s.position, s.approachPosition)).toBeCloseTo(0.35, 5);
    }

    // Positions should differ in X
    const xs = seats.map((s) => s.position[0]);
    expect(new Set(xs).size).toBe(3);
    expect(seats.every((seat) => seat.position[2] > 5.3)).toBe(true);
  });

  it('uses anchored rest seats from rest-zone prefabs before circular fallback', () => {
    const restZone = makeZone({
      zoneId: 'rest1',
      archetype: 'rest',
      cx: 20,
      cz: 30,
      deskSlots: 0,
    });
    const sofa = makeInstance({
      instance_id: 'rest-sofa',
      prefab_id: 'sofa-set',
      zone_id: 'rest1',
      position_x: 20,
      position_y: 30,
    });
    const reg = SeatRegistry.build([sofa], [restZone]);

    const pos0 = reg.getRestSeat([restZone], 0);
    const pos1 = reg.getRestSeat([restZone], 1);
    const pos2 = reg.getRestSeat([restZone], 2);

    expect(pos0[2]).toBeCloseTo(31.65, 5);
    expect(pos1[2]).toBeCloseTo(31.65, 5);
    expect(pos2[2]).toBeCloseTo(31.65, 5);
    expect(pos0[0]).toBeCloseTo(19.2, 5);
    expect(pos1[0]).toBeCloseTo(20, 5);
    expect(pos2[0]).toBeCloseTo(20.8, 5);
    expect(reg.getRestSeat([restZone], 0)).toEqual(pos0);
    expect(pos0).not.toEqual(pos1);
    expect(pos1).not.toEqual(pos2);
  });
});
