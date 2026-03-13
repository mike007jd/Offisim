import { describe, it, expect } from 'vitest';
import {
  computeFloorPlan,
  computeRestAreaSeats,
  type ZoneBounds,
} from '../layout/zone-layout-engine.js';
import { RD_COMPANY_ZONES } from '../tokens/departments.js';

// ── Helpers ─────────────────────────────────────────────────────────

/** Check whether two axis-aligned rectangles overlap (strictly) */
function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

function isInsideZone(
  desk: { x: number; y: number },
  zone: ZoneBounds,
  deskW = 50,
  deskH = 30,
): boolean {
  const halfW = deskW / 2;
  const halfH = deskH / 2;
  return (
    desk.x - halfW >= zone.x - 1 // 1px tolerance for fp rounding
    && desk.x + halfW <= zone.x + zone.width + 1
    && desk.y - halfH >= zone.y - 1
    && desk.y + halfH <= zone.y + zone.height + 1
  );
}

// ── Tests ───────────────────────────────────────────────────────────

describe('zone-layout-engine', () => {
  describe('computeFloorPlan', () => {
    it('empty company (0 employees) — should have minimum slots per department', () => {
      const counts = new Map<string, number>();
      const plan = computeFloorPlan(RD_COMPANY_ZONES, counts);

      // Should still produce zones
      expect(plan.zones.length).toBeGreaterThanOrEqual(RD_COMPANY_ZONES.length);

      // Department zones should have at least minSlots workstations
      const deptZones = plan.zones.filter((z) => z.type === 'department');
      for (const dz of deptZones) {
        const config = RD_COMPANY_ZONES.find((c) => c.zoneId === dz.zoneId);
        expect(dz.workstations.length).toBeGreaterThanOrEqual(config?.minSlots ?? 0);
      }

      // Dimensions should be positive
      expect(plan.totalWidth).toBeGreaterThan(0);
      expect(plan.totalHeight).toBeGreaterThan(0);
    });

    it('small team (2 dev, 1 product, 1 art) — should fit in reasonable dimensions', () => {
      const counts = new Map([
        ['zone-dev', 2],
        ['zone-product', 1],
        ['zone-art', 1],
      ]);
      const plan = computeFloorPlan(RD_COMPANY_ZONES, counts);

      // Dev zone gets ceil(2 * 1.2) = 3 slots (>= minSlots=2)
      const devZone = plan.zones.find((z) => z.zoneId === 'zone-dev');
      expect(devZone).toBeDefined();
      expect(devZone!.workstations.length).toBe(3);

      // Product: ceil(1 * 1.2) = 2 (== minSlots)
      const prodZone = plan.zones.find((z) => z.zoneId === 'zone-product');
      expect(prodZone!.workstations.length).toBe(2);

      // Art: ceil(1 * 1.2) = 2 (== minSlots)
      const artZone = plan.zones.find((z) => z.zoneId === 'zone-art');
      expect(artZone!.workstations.length).toBe(2);

      // Should be within sane total dimensions
      expect(plan.totalWidth).toBeGreaterThanOrEqual(800);
      expect(plan.totalWidth).toBeLessThanOrEqual(2400);
      expect(plan.totalHeight).toBeGreaterThan(0);
    });

    it('large team (8 dev, 4 product, 4 art) — should scale up', () => {
      const counts = new Map([
        ['zone-dev', 8],
        ['zone-product', 4],
        ['zone-art', 4],
      ]);
      const plan = computeFloorPlan(RD_COMPANY_ZONES, counts);

      // Dev: ceil(8 * 1.2) = 10 slots
      const devZone = plan.zones.find((z) => z.zoneId === 'zone-dev');
      expect(devZone!.workstations.length).toBe(10);

      // Product: ceil(4 * 1.2) = 5
      const prodZone = plan.zones.find((z) => z.zoneId === 'zone-product');
      expect(prodZone!.workstations.length).toBe(5);

      // Art: ceil(4 * 1.2) = 5
      const artZone = plan.zones.find((z) => z.zoneId === 'zone-art');
      expect(artZone!.workstations.length).toBe(5);

      // Total dimensions should grow but stay within cap
      expect(plan.totalWidth).toBeLessThanOrEqual(2460); // 2400 + 2*margin
      expect(plan.totalHeight).toBeGreaterThan(200);
    });

    it('no overlapping zones — all zone bounds should not intersect', () => {
      const counts = new Map([
        ['zone-dev', 6],
        ['zone-product', 3],
        ['zone-art', 3],
      ]);
      const plan = computeFloorPlan(RD_COMPANY_ZONES, counts);

      const zones = plan.zones;
      for (let i = 0; i < zones.length; i++) {
        for (let j = i + 1; j < zones.length; j++) {
          const a = zones[i]!;
          const b = zones[j]!;
          expect(rectsOverlap(a, b)).toBe(false);
        }
      }
    });

    it('no overlapping workstations — all desk positions should be unique and within zone bounds', () => {
      const counts = new Map([
        ['zone-dev', 5],
        ['zone-product', 3],
        ['zone-art', 2],
      ]);
      const plan = computeFloorPlan(RD_COMPANY_ZONES, counts);

      // All workstation IDs must be unique
      const ids = new Set<string>();
      for (const zone of plan.zones) {
        for (const ws of zone.workstations) {
          expect(ids.has(ws.workstationId)).toBe(false);
          ids.add(ws.workstationId);
        }
      }

      // Each desk must be inside its zone bounds
      for (const zone of plan.zones) {
        for (const ws of zone.workstations) {
          expect(isInsideZone(ws, zone)).toBe(true);
        }
      }
    });

    it('all workstations in allWorkstations map — count matches sum of zone workstations', () => {
      const counts = new Map([
        ['zone-dev', 4],
        ['zone-product', 2],
        ['zone-art', 2],
      ]);
      const plan = computeFloorPlan(RD_COMPANY_ZONES, counts);

      // Sum workstations across zones
      const totalFromZones = plan.zones.reduce(
        (sum, z) => sum + z.workstations.length,
        0,
      );
      expect(plan.allWorkstations.size).toBe(totalFromZones);

      // Every zone workstation should be in the map
      for (const zone of plan.zones) {
        for (const ws of zone.workstations) {
          expect(plan.allWorkstations.has(ws.workstationId)).toBe(true);
          const mapped = plan.allWorkstations.get(ws.workstationId)!;
          expect(mapped.x).toBe(ws.x);
          expect(mapped.y).toBe(ws.y);
          expect(mapped.zoneId).toBe(ws.zoneId);
        }
      }
    });
  });

  describe('computeRestAreaSeats', () => {
    it('should generate valid positions within zone bounds', () => {
      // Create a floor plan first to get a real rest area zone
      const counts = new Map<string, number>();
      const plan = computeFloorPlan(RD_COMPANY_ZONES, counts);
      const restZone = plan.zones.find((z) => z.type === 'rest_area');
      expect(restZone).toBeDefined();

      const seats = computeRestAreaSeats(restZone!, 4);

      expect(seats.length).toBeGreaterThan(0);
      expect(seats.length).toBeLessThanOrEqual(4);

      for (const seat of seats) {
        expect(seat.zoneId).toBe(restZone!.zoneId);
        // Seats should be inside zone bounds (with generous tolerance for seat size)
        expect(seat.x).toBeGreaterThanOrEqual(restZone!.x);
        expect(seat.x).toBeLessThanOrEqual(restZone!.x + restZone!.width);
        expect(seat.y).toBeGreaterThanOrEqual(restZone!.y);
        expect(seat.y).toBeLessThanOrEqual(restZone!.y + restZone!.height);
      }

      // IDs should be unique
      const ids = new Set(seats.map((s) => s.workstationId));
      expect(ids.size).toBe(seats.length);
    });

    it('should return empty array for count <= 0', () => {
      const fakeZone: ZoneBounds = {
        zoneId: 'zone-rest',
        type: 'rest_area',
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        floorColor: 0x444444,
        label: 'Rest',
        labelEn: 'REST',
        workstations: [],
      };
      expect(computeRestAreaSeats(fakeZone, 0)).toEqual([]);
      expect(computeRestAreaSeats(fakeZone, -1)).toEqual([]);
    });
  });
});
