import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD,
  ROOM_H,
  ROOM_W,
  SCALE,
  hitTestZone,
  screenToSvg,
  toSVG,
} from '../../components/scene/office-2d-geometry';

describe('office-2d-geometry', () => {
  describe('constants', () => {
    it('SCALE is 50', () => expect(SCALE).toBe(50));
    it('ROOM_W is 2000', () => expect(ROOM_W).toBe(2000));
    it('ROOM_H is 1500', () => expect(ROOM_H).toBe(1500));
    it('DRAG_THRESHOLD matches the shared 3D threshold (5)', () => expect(DRAG_THRESHOLD).toBe(5));
  });

  describe('toSVG', () => {
    it('maps 3D center (0, 0) with size 2x2 to SVG rect', () => {
      const r = toSVG(0, 0, 2, 2);
      // cx=0 → (0+20)*50 - (2*50)/2 = 1000 - 50 = 950
      // cz=0 → (0+15)*50 - (2*50)/2 = 750 - 50 = 700
      expect(r).toEqual({ x: 950, y: 700, w: 100, h: 100 });
    });

    it('maps negative 3D coords correctly', () => {
      const r = toSVG(-20, -15, 1, 1);
      // cx=-20 → (0)*50 - 25 = -25
      // cz=-15 → (0)*50 - 25 = -25
      expect(r).toEqual({ x: -25, y: -25, w: 50, h: 50 });
    });
  });

  describe('hitTestZone', () => {
    const bounds = [
      { zone: { zoneId: 'z1' } as any, x: 100, y: 100, w: 200, h: 150 },
      { zone: { zoneId: 'z2' } as any, x: 400, y: 400, w: 100, h: 100 },
    ];

    it('returns the zone when point is inside', () => {
      const hit = hitTestZone(150, 150, bounds);
      expect(hit?.zoneId).toBe('z1');
    });

    it('returns null when point is outside all zones', () => {
      expect(hitTestZone(350, 350, bounds)).toBeNull();
    });

    it('returns the first matching zone on boundary', () => {
      const hit = hitTestZone(100, 100, bounds);
      expect(hit?.zoneId).toBe('z1');
    });
  });

  describe('screenToSvg', () => {
    const rect = { left: 10, top: 20 } as DOMRect;
    const transform = { x: 0, y: 0, scale: 1 };

    it('converts screen coords to SVG coords with identity transform', () => {
      const result = screenToSvg(110, 120, rect, transform);
      expect(result).toEqual({ x: 100, y: 100 });
    });

    it('accounts for scale', () => {
      const result = screenToSvg(110, 120, rect, { x: 0, y: 0, scale: 2 });
      expect(result).toEqual({ x: 50, y: 50 });
    });

    it('accounts for pan offset', () => {
      const result = screenToSvg(110, 120, rect, { x: 50, y: 30, scale: 1 });
      expect(result).toEqual({ x: 50, y: 70 });
    });
  });
});
