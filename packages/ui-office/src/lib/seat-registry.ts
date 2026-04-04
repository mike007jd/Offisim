import type { PrefabInstanceRow, Zone } from '@offisim/shared-types';
import { SEAT_OFFSETS } from './seat-offsets';
import { getSpatialSpec, toWorldAnchor } from './prefab-spatial';

export interface SeatEntry {
  readonly position: [number, number, number];
  readonly facing: number;
  readonly instanceId: string | null;
  readonly isFallback: boolean;
}

export class SeatRegistry {
  private readonly seats: ReadonlyMap<string, readonly SeatEntry[]>;

  private constructor(seats: Map<string, SeatEntry[]>) {
    this.seats = seats;
  }

  static build(
    instances: readonly PrefabInstanceRow[],
    zones: readonly Zone[],
  ): SeatRegistry {
    const seats = new Map<string, SeatEntry[]>();
    const zonesWithPrefabSeats = new Set<string>();

    // Phase 1: collect seats from prefab instances
    for (const inst of instances) {
      if (!inst.enabled) continue;

      const spec = getSpatialSpec(inst.prefab_id);
      if (!spec || spec.capacity === 0) continue;

      const workAnchor = spec.anchors.work;
      const worldOrigin: readonly [number, number] = [
        inst.position_x,
        inst.position_y,
      ];

      if (!seats.has(inst.zone_id)) {
        seats.set(inst.zone_id, []);
      }
      const zoneSeats = seats.get(inst.zone_id)!;

      if (spec.capacity === 1) {
        const world = toWorldAnchor(workAnchor, worldOrigin, inst.rotation);
        zoneSeats.push({
          position: world.position,
          facing: world.facing,
          instanceId: inst.instance_id,
          isFallback: false,
        });
      } else {
        // Multi-capacity: spread seats around the work anchor
        const base = toWorldAnchor(workAnchor, worldOrigin, inst.rotation);
        for (let i = 0; i < spec.capacity; i++) {
          const offset = (i - (spec.capacity - 1) / 2) * 0.8;
          zoneSeats.push({
            position: [
              base.position[0] + offset,
              base.position[1],
              base.position[2],
            ],
            facing: base.facing,
            instanceId: inst.instance_id,
            isFallback: false,
          });
        }
      }

      zonesWithPrefabSeats.add(inst.zone_id);
    }

    // Phase 2: fallback seats for zones without prefab-based seats
    for (const zone of zones) {
      if (zonesWithPrefabSeats.has(zone.zoneId)) continue;
      if (zone.deskSlots <= 0) continue;

      const zoneSeats: SeatEntry[] = [];
      for (let i = 0; i < zone.deskSlots; i++) {
        const offsetIdx = i % SEAT_OFFSETS.length;
        const rowShift = Math.floor(i / SEAT_OFFSETS.length) * 2;
        const off = SEAT_OFFSETS[offsetIdx]!;
        zoneSeats.push({
          position: [zone.cx + off[0], 0, zone.cz + off[2] + rowShift],
          facing: Math.PI,
          instanceId: null,
          isFallback: true,
        });
      }
      seats.set(zone.zoneId, zoneSeats);
    }

    return new SeatRegistry(seats);
  }

  getSeat(zoneId: string, slotIndex: number): SeatEntry | null {
    const zoneSeats = this.seats.get(zoneId);
    if (!zoneSeats || zoneSeats.length === 0) return null;
    return zoneSeats[slotIndex % zoneSeats.length]!;
  }

  getZoneSeats(zoneId: string): readonly SeatEntry[] {
    return this.seats.get(zoneId) ?? [];
  }

  getRestSeat(
    zones: readonly Zone[],
    slotIndex: number,
  ): [number, number, number] {
    const restZone = zones.find((z) => z.archetype === 'rest');
    const cx = restZone?.cx ?? 0;
    const cz = restZone?.cz ?? 0;

    const totalSlots = Math.max(slotIndex + 1, 6);
    const angle = (slotIndex / totalSlots) * Math.PI * 1.5 + 0.3;
    const radius = 1.2 + (slotIndex % 3) * 0.8;
    return [
      cx + Math.cos(angle) * radius,
      0,
      cz + Math.sin(angle) * radius,
    ];
  }
}
