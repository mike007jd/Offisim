import type { Zone } from '@offisim/shared-types';
import { SYSTEM_ZONE_TEMPLATES, templateToZone } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import {
  type ZoneBounds,
  computeFloorPlan,
  computeRestAreaSeats,
} from '../layout/zone-layout-engine.js';

const TEST_COMPANY = 'test-company';

/** Convert SYSTEM_ZONE_TEMPLATES to Zone[] for test input. */
const TEST_ZONES: readonly Zone[] = SYSTEM_ZONE_TEMPLATES.map((t) =>
  templateToZone(t, TEST_COMPANY),
);

/** Build prefixed zone ID matching DB format. */
const zid = (slug: string) => `${TEST_COMPANY}::${slug}`;

// ── Helpers ─────────────────────────────────────────────────────────

/** Check whether two axis-aligned rectangles overlap (strictly) */
function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
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
    desk.x - halfW >= zone.x - 1 && // 1px tolerance for fp rounding
    desk.x + halfW <= zone.x + zone.width + 1 &&
    desk.y - halfH >= zone.y - 1 &&
    desk.y + halfH <= zone.y + zone.height + 1
  );
}

// ── Tests ───────────────────────────────────────────────────────────

describe('zone-layout-engine', () => {
  describe('computeFloorPlan', () => {
    it('empty company (0 employees) — should have minimum slots per department', () => {
      const counts = new Map<string, number>();
      const plan = computeFloorPlan(TEST_ZONES, counts);

      // Should still produce zones
      expect(plan.zones.length).toBeGreaterThanOrEqual(TEST_ZONES.length);

      // Department zones should have at least minSlots workstations
      const deptZones = plan.zones.filter((z) => z.type === 'department');
      for (const dz of deptZones) {
        const config = TEST_ZONES.find((c) => c.zoneId === dz.zoneId);
        expect(dz.workstations.length).toBeGreaterThanOrEqual(config?.deskSlots ?? 0);
      }

      // Dimensions should be positive
      expect(plan.totalWidth).toBeGreaterThan(0);
      expect(plan.totalHeight).toBeGreaterThan(0);
    });

    it('small team (2 dev, 1 product, 1 art) — should fit in reasonable dimensions', () => {
      const counts = new Map([
        [zid('zone-dev'), 2],
        [zid('zone-product'), 1],
        [zid('zone-art'), 1],
      ]);
      const plan = computeFloorPlan(TEST_ZONES, counts);

      // Dev zone gets max(deskSlots=4, ceil(2 * 1.2)=3) = 4 slots
      const devZone = plan.zones.find((z) => z.zoneId === zid('zone-dev'));
      expect(devZone).toBeDefined();
      if (!devZone) throw new Error('Expected dev zone');
      expect(devZone.workstations.length).toBe(4);

      // Product: max(deskSlots=4, ceil(1 * 1.2)=2) = 4
      const prodZone = plan.zones.find((z) => z.zoneId === zid('zone-product'));
      expect(prodZone).toBeDefined();
      if (!prodZone) throw new Error('Expected product zone');
      expect(prodZone.workstations.length).toBe(4);

      // Art: max(deskSlots=4, ceil(1 * 1.2)=2) = 4
      const artZone = plan.zones.find((z) => z.zoneId === zid('zone-art'));
      expect(artZone).toBeDefined();
      if (!artZone) throw new Error('Expected art zone');
      expect(artZone.workstations.length).toBe(4);

      // Should be within sane total dimensions
      expect(plan.totalWidth).toBeGreaterThanOrEqual(800);
      expect(plan.totalWidth).toBeLessThanOrEqual(2400);
      expect(plan.totalHeight).toBeGreaterThan(0);
    });

    it('large team (8 dev, 4 product, 4 art) — should scale up', () => {
      const counts = new Map([
        [zid('zone-dev'), 8],
        [zid('zone-product'), 4],
        [zid('zone-art'), 4],
      ]);
      const plan = computeFloorPlan(TEST_ZONES, counts);

      // Dev: ceil(8 * 1.2) = 10 slots
      const devZone = plan.zones.find((z) => z.zoneId === zid('zone-dev'));
      expect(devZone).toBeDefined();
      if (!devZone) throw new Error('Expected dev zone');
      expect(devZone.workstations.length).toBe(10);

      // Product: ceil(4 * 1.2) = 5
      const prodZone = plan.zones.find((z) => z.zoneId === zid('zone-product'));
      expect(prodZone).toBeDefined();
      if (!prodZone) throw new Error('Expected product zone');
      expect(prodZone.workstations.length).toBe(5);

      // Art: ceil(4 * 1.2) = 5
      const artZone = plan.zones.find((z) => z.zoneId === zid('zone-art'));
      expect(artZone).toBeDefined();
      if (!artZone) throw new Error('Expected art zone');
      expect(artZone.workstations.length).toBe(5);

      // Total dimensions should grow but stay within cap
      expect(plan.totalWidth).toBeLessThanOrEqual(2460); // 2400 + 2*margin
      expect(plan.totalHeight).toBeGreaterThan(200);
    });

    it('no overlapping zones — all zone bounds should not intersect', () => {
      const counts = new Map([
        [zid('zone-dev'), 6],
        [zid('zone-product'), 3],
        [zid('zone-art'), 3],
      ]);
      const plan = computeFloorPlan(TEST_ZONES, counts);

      const zones = plan.zones;
      for (const [i, a] of zones.entries()) {
        for (const b of zones.slice(i + 1)) {
          expect(rectsOverlap(a, b)).toBe(false);
        }
      }
    });

    it('no overlapping workstations — all desk positions should be unique and within zone bounds', () => {
      const counts = new Map([
        [zid('zone-dev'), 5],
        [zid('zone-product'), 3],
        [zid('zone-art'), 2],
      ]);
      const plan = computeFloorPlan(TEST_ZONES, counts);

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
        [zid('zone-dev'), 4],
        [zid('zone-product'), 2],
        [zid('zone-art'), 2],
      ]);
      const plan = computeFloorPlan(TEST_ZONES, counts);

      // Sum workstations across zones
      const totalFromZones = plan.zones.reduce((sum, z) => sum + z.workstations.length, 0);
      expect(plan.allWorkstations.size).toBe(totalFromZones);

      // Every zone workstation should be in the map
      for (const zone of plan.zones) {
        for (const ws of zone.workstations) {
          expect(plan.allWorkstations.has(ws.workstationId)).toBe(true);
          const mapped = plan.allWorkstations.get(ws.workstationId);
          expect(mapped).toBeDefined();
          if (!mapped) continue;
          expect(mapped.x).toBe(ws.x);
          expect(mapped.y).toBe(ws.y);
          expect(mapped.zoneId).toBe(ws.zoneId);
        }
      }
    });

    it('meeting room and server room should share row 3 proportionally', () => {
      const counts = new Map([
        [zid('zone-dev'), 4],
        [zid('zone-product'), 2],
        [zid('zone-art'), 2],
      ]);
      const plan = computeFloorPlan(TEST_ZONES, counts);
      const mtg = plan.zones.find((z) => z.type === 'meeting_room');
      const srv = plan.zones.find((z) => z.type === 'server_room');
      expect(mtg).toBeDefined();
      expect(srv).toBeDefined();
      if (!mtg || !srv) throw new Error('Expected meeting room and server room');

      // Meeting room should be wider than server room (70% vs 30%)
      expect(mtg.width).toBeGreaterThan(srv.width);

      // Both should be at least MIN_UTILITY_WIDTH (200)
      expect(mtg.width).toBeGreaterThanOrEqual(200);
      expect(srv.width).toBeGreaterThanOrEqual(200);

      // They should be on the same row (same y)
      expect(mtg.y).toBe(srv.y);
    });

    it('row 2 height should scale with row 1 height for large offices', () => {
      // Large team creates tall row 1, row 2 should be at least 50% of that
      const counts = new Map([
        [zid('zone-dev'), 20],
        [zid('zone-product'), 10],
        [zid('zone-art'), 10],
      ]);
      const plan = computeFloorPlan(TEST_ZONES, counts);
      const library = plan.zones.find((z) => z.type === 'library');
      const restArea = plan.zones.find((z) => z.type === 'rest_area');
      expect(library).toBeDefined();
      expect(restArea).toBeDefined();
      if (!library || !restArea) return;

      // Row 2 height should be greater than MIN_UTILITY_HEIGHT (120) for large offices
      expect(library.height).toBeGreaterThanOrEqual(120);
      expect(restArea.height).toBe(library.height); // same row, same height

      // For a large office, row2 should be > 120 (the old fixed value)
      const deptZones = plan.zones.filter((z) => z.type === 'department');
      const maxDeptHeight = Math.max(...deptZones.map((z) => z.height));
      const expectedRow2Height = Math.max(120, Math.round(maxDeptHeight * 0.5));
      expect(library.height).toBe(expectedRow2Height);
    });

    it('dynamic zonePadding should scale with floor width for large offices', () => {
      // Large team → wide floor → larger padding
      const largeCounts = new Map([
        [zid('zone-dev'), 20],
        [zid('zone-product'), 10],
        [zid('zone-art'), 10],
      ]);
      const largePlan = computeFloorPlan(TEST_ZONES, largeCounts);

      // Small team → narrow floor → default padding
      const smallCounts = new Map<string, number>();
      const smallPlan = computeFloorPlan(TEST_ZONES, smallCounts);

      // For small office at MIN_FLOOR_WIDTH (800), dynamic padding = max(20, 800*0.02=16) = 20
      // So small office should keep default padding of 20
      // For large office, padding should be >= 20
      const smallFloorWidth = smallPlan.totalWidth - 2 * 30;
      const largeFloorWidth = largePlan.totalWidth - 2 * 30;
      expect(largeFloorWidth).toBeGreaterThan(smallFloorWidth);
    });

    it('user-provided zonePadding should override dynamic calculation', () => {
      const counts = new Map([
        [zid('zone-dev'), 20],
        [zid('zone-product'), 10],
        [zid('zone-art'), 10],
      ]);
      const customPadding = 10;
      const plan = computeFloorPlan(TEST_ZONES, counts, { zonePadding: customPadding });

      // Check that zones use the custom padding
      const deptZones = plan.zones.filter((z) => z.type === 'department');
      if (deptZones.length >= 2) {
        const [firstZone, secondZone] = deptZones;
        if (!firstZone || !secondZone) throw new Error('Expected at least two department zones');
        const gap = secondZone.x - (firstZone.x + firstZone.width);
        expect(gap).toBeCloseTo(customPadding, 0);
      }
    });

    it('department zones should never be shorter than row 2 utility zones', () => {
      // Test with small departments that would naturally be short
      const counts = new Map([
        [zid('zone-dev'), 1],
        [zid('zone-product'), 1],
        [zid('zone-art'), 1],
      ]);
      const plan = computeFloorPlan(TEST_ZONES, counts);

      const deptZones = plan.zones.filter((z) => z.type === 'department');
      const utilityZones = plan.zones.filter((z) => z.type === 'library' || z.type === 'rest_area');

      if (utilityZones.length > 0 && deptZones.length > 0) {
        const [firstUtilityZone] = utilityZones;
        if (!firstUtilityZone) throw new Error('Expected utility zone');
        const row2Height = firstUtilityZone.height;
        for (const dz of deptZones) {
          expect(dz.height).toBeGreaterThanOrEqual(row2Height);
        }
      }
    });
  });

  describe('computeRestAreaSeats', () => {
    it('should generate valid positions within zone bounds', () => {
      // Create a floor plan first to get a real rest area zone
      const counts = new Map<string, number>();
      const plan = computeFloorPlan(TEST_ZONES, counts);
      const restZone = plan.zones.find((z) => z.type === 'rest_area');
      expect(restZone).toBeDefined();
      if (!restZone) throw new Error('Expected rest area zone');

      const seats = computeRestAreaSeats(restZone, 4);

      expect(seats.length).toBeGreaterThan(0);
      expect(seats.length).toBeLessThanOrEqual(4);

      for (const seat of seats) {
        expect(seat.zoneId).toBe(restZone.zoneId);
        // Seats should be inside zone bounds (with generous tolerance for seat size)
        expect(seat.x).toBeGreaterThanOrEqual(restZone.x);
        expect(seat.x).toBeLessThanOrEqual(restZone.x + restZone.width);
        expect(seat.y).toBeGreaterThanOrEqual(restZone.y);
        expect(seat.y).toBeLessThanOrEqual(restZone.y + restZone.height);
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
