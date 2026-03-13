import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from 'pixi.js';

// Mock gsap before importing CameraController
vi.mock('gsap', () => {
  const mockTween = {
    kill: vi.fn(),
    isActive: vi.fn(() => false),
  };
  return {
    default: {
      to: vi.fn((_target, vars) => {
        // Immediately invoke onUpdate + onComplete for synchronous testing
        // First apply final values to target
        for (const key of Object.keys(vars)) {
          if (key !== 'duration' && key !== 'ease' && key !== 'onUpdate' && key !== 'onComplete') {
            (_target as Record<string, unknown>)[key] = vars[key];
          }
        }
        vars.onUpdate?.();
        vars.onComplete?.();
        return mockTween;
      }),
    },
  };
});

import { CameraController } from '../interaction/camera-controller.js';

const mockContainer = (): Container =>
  ({
    scale: { set: vi.fn() },
    position: { set: vi.fn() },
  }) as unknown as Container;

describe('CameraController', () => {
  let container: Container;
  let cam: CameraController;

  const FLOOR_W = 800;
  const FLOOR_H = 600;
  const VP_W = 1280;
  const VP_H = 800;

  beforeEach(() => {
    vi.clearAllMocks();
    container = mockContainer();
    cam = new CameraController({
      stage: container,
      world: container,
      floorWidth: FLOOR_W,
      floorHeight: FLOOR_H,
    });
  });

  // -------------------------------------------------------------------------
  // Constructor & properties
  // -------------------------------------------------------------------------

  describe('constructor and initial state', () => {
    it('should initialize with scale=1 and pan=0,0', () => {
      expect(cam.scale).toBe(1);
      expect(cam.panX).toBe(0);
      expect(cam.panY).toBe(0);
    });

    it('should report isAnimating=false initially', () => {
      expect(cam.isAnimating).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // fitToView
  // -------------------------------------------------------------------------

  describe('fitToView', () => {
    it('should compute correct scale and center the floor', () => {
      cam.fitToView(VP_W, VP_H);

      // padding = 40 each side
      // scaleX = (1280 - 80) / 800 = 1.5
      // scaleY = (800 - 80) / 600  = 1.2
      // scale = min(1.5, 1.2) = 1.2
      expect(cam.scale).toBeCloseTo(1.2, 5);

      // panX = (1280 - 800*1.2) / 2 = (1280 - 960) / 2 = 160
      expect(cam.panX).toBeCloseTo(160, 5);
      // panY = (800 - 600*1.2) / 2 = (800 - 720) / 2 = 40
      expect(cam.panY).toBeCloseTo(40, 5);

      // Container should have been updated
      expect(container.scale.set).toHaveBeenCalledWith(cam.scale);
      expect(container.position.set).toHaveBeenCalledWith(cam.panX, cam.panY);
    });

    it('should clamp scale to maxZoom when viewport is very large', () => {
      cam.fitToView(10000, 10000);
      // scale would be huge, but clamped to 2.0
      expect(cam.scale).toBe(2.0);
    });

    it('should clamp scale to minZoom when viewport is very small', () => {
      cam.fitToView(100, 100);
      // scale would be tiny, but clamped to 0.3
      expect(cam.scale).toBe(0.3);
    });
  });

  // -------------------------------------------------------------------------
  // focusEmployee
  // -------------------------------------------------------------------------

  describe('focusEmployee', () => {
    it('should center the camera on the employee position', () => {
      const pos = { x: 400, y: 300 };
      cam.focusEmployee(pos, VP_W, VP_H, 0);

      // targetScale = max(1.2, 1) = 1.2
      // panX = 1280/2 - 400*1.2 = 640 - 480 = 160
      // panY = 800/2 - 300*1.2 = 400 - 360 = 40
      expect(cam.scale).toBeCloseTo(1.2, 5);
      expect(cam.panX).toBeCloseTo(160, 5);
      expect(cam.panY).toBeCloseTo(40, 5);
    });

    it('should keep current scale if already > 1.2', () => {
      // First zoom in manually via onWheel
      // Set scale to 1.5 by calling zoomTo
      cam.zoomTo(1.5, 400, 300, VP_W, VP_H, 0);
      expect(cam.scale).toBeCloseTo(1.5, 5);

      const pos = { x: 200, y: 150 };
      cam.focusEmployee(pos, VP_W, VP_H, 0);

      // targetScale = max(1.2, 1.5) = 1.5
      expect(cam.scale).toBeCloseTo(1.5, 5);
      // panX = 640 - 200*1.5 = 640 - 300 = 340
      expect(cam.panX).toBeCloseTo(340, 5);
    });

    it('should use default duration of 0.4 when not specified', async () => {
      const gsapModule = vi.mocked(await import('gsap'));
      cam.focusEmployee({ x: 100, y: 100 }, VP_W, VP_H);
      expect(gsapModule.default.to).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ duration: 0.4 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // fitAllEmployees
  // -------------------------------------------------------------------------

  describe('fitAllEmployees', () => {
    it('should fit bounding box of all positions with 60px padding', () => {
      const positions = [
        { x: 100, y: 100 },
        { x: 500, y: 400 },
      ];
      cam.fitAllEmployees(positions, VP_W, VP_H, 0);

      // bbox: minX=100, maxX=500, minY=100, maxY=400
      // with padding=60: bboxW = 400 + 120 = 520, bboxH = 300 + 120 = 420
      // scaleX = 1280/520 ≈ 2.46, scaleY = 800/420 ≈ 1.905
      // scale = min(2.46, 1.905) = 1.905, clamped to 1.905
      const expectedScale = Math.min(2.0, Math.min(1280 / 520, 800 / 420));
      expect(cam.scale).toBeCloseTo(expectedScale, 3);

      // center = (300, 250)
      const centerX = (100 + 500) / 2;
      const centerY = (100 + 400) / 2;
      expect(cam.panX).toBeCloseTo(VP_W / 2 - centerX * cam.scale, 3);
      expect(cam.panY).toBeCloseTo(VP_H / 2 - centerY * cam.scale, 3);
    });

    it('should handle a single position', () => {
      const positions = [{ x: 300, y: 200 }];
      cam.fitAllEmployees(positions, VP_W, VP_H, 0);

      // bbox: 0 width/height + padding*2 = 120x120
      // scale = min(1280/120, 800/120) = min(10.67, 6.67) => clamped to 2.0
      expect(cam.scale).toBe(2.0);
      // center = (300, 200)
      expect(cam.panX).toBeCloseTo(VP_W / 2 - 300 * 2.0, 3);
      expect(cam.panY).toBeCloseTo(VP_H / 2 - 200 * 2.0, 3);
    });

    it('should fallback to floor fitToView when positions is empty', () => {
      cam.fitAllEmployees([], VP_W, VP_H, 0);

      // Same as fitToView: scale 1.2
      expect(cam.scale).toBeCloseTo(1.2, 5);
    });
  });

  // -------------------------------------------------------------------------
  // resetView
  // -------------------------------------------------------------------------

  describe('resetView', () => {
    it('should restore to the same state as fitToView', () => {
      // First zoom in
      cam.zoomTo(1.8, 200, 150, VP_W, VP_H, 0);
      expect(cam.scale).toBeCloseTo(1.8, 5);

      // Reset
      cam.resetView(VP_W, VP_H, 0);

      // Should match fitToView
      expect(cam.scale).toBeCloseTo(1.2, 5);
      expect(cam.panX).toBeCloseTo(160, 5);
      expect(cam.panY).toBeCloseTo(40, 5);
    });
  });

  // -------------------------------------------------------------------------
  // zoomTo
  // -------------------------------------------------------------------------

  describe('zoomTo', () => {
    it('should zoom to target scale centered on world point', () => {
      cam.zoomTo(1.5, 400, 300, VP_W, VP_H, 0);

      expect(cam.scale).toBeCloseTo(1.5, 5);
      // panX = 640 - 400*1.5 = 640 - 600 = 40
      expect(cam.panX).toBeCloseTo(40, 5);
      // panY = 400 - 300*1.5 = 400 - 450 = -50
      expect(cam.panY).toBeCloseTo(-50, 5);
    });

    it('should clamp to minZoom', () => {
      cam.zoomTo(0.1, 400, 300, VP_W, VP_H, 0);
      expect(cam.scale).toBe(0.3);
    });

    it('should clamp to maxZoom', () => {
      cam.zoomTo(5.0, 400, 300, VP_W, VP_H, 0);
      expect(cam.scale).toBe(2.0);
    });
  });

  // -------------------------------------------------------------------------
  // getWorldPosition / getScreenPosition
  // -------------------------------------------------------------------------

  describe('coordinate conversion', () => {
    it('getScreenPosition and getWorldPosition should be inverses', () => {
      cam.fitToView(VP_W, VP_H);

      const worldPt = { x: 400, y: 300 };
      const screen = cam.getScreenPosition(worldPt.x, worldPt.y);
      const backToWorld = cam.getWorldPosition(screen.x, screen.y);

      expect(backToWorld.x).toBeCloseTo(worldPt.x, 5);
      expect(backToWorld.y).toBeCloseTo(worldPt.y, 5);
    });

    it('getScreenPosition should apply scale and pan', () => {
      // Manual state: scale=2, pan=(100, 50)
      cam.zoomTo(2.0, 0, 0, 200, 100, 0);
      // After zoomTo(2, 0, 0, 200, 100): panX=100, panY=50
      const screen = cam.getScreenPosition(10, 20);
      expect(screen.x).toBeCloseTo(10 * cam.scale + cam.panX, 5);
      expect(screen.y).toBeCloseTo(20 * cam.scale + cam.panY, 5);
    });

    it('getWorldPosition should reverse scale and pan', () => {
      cam.fitToView(VP_W, VP_H);
      const world = cam.getWorldPosition(640, 400);
      // screenX = 640, panX = 160, scale = 1.2
      // worldX = (640 - 160) / 1.2 = 480 / 1.2 = 400
      expect(world.x).toBeCloseTo(400, 5);
      expect(world.y).toBeCloseTo(300, 5);
    });
  });

  // -------------------------------------------------------------------------
  // onWheel zoom
  // -------------------------------------------------------------------------

  describe('onWheel', () => {
    it('should zoom in on negative deltaY', () => {
      cam.fitToView(VP_W, VP_H);
      const prevScale = cam.scale;
      cam.onWheel(-100, VP_W / 2, VP_H / 2, VP_W, VP_H);
      expect(cam.scale).toBeGreaterThan(prevScale);
    });

    it('should zoom out on positive deltaY', () => {
      cam.fitToView(VP_W, VP_H);
      const prevScale = cam.scale;
      cam.onWheel(100, VP_W / 2, VP_H / 2, VP_W, VP_H);
      expect(cam.scale).toBeLessThan(prevScale);
    });

    it('should not exceed maxZoom', () => {
      cam.zoomTo(2.0, 400, 300, VP_W, VP_H, 0);
      cam.onWheel(-100, VP_W / 2, VP_H / 2, VP_W, VP_H);
      expect(cam.scale).toBeLessThanOrEqual(2.0);
    });

    it('should not go below minZoom', () => {
      cam.zoomTo(0.3, 400, 300, VP_W, VP_H, 0);
      cam.onWheel(100, VP_W / 2, VP_H / 2, VP_W, VP_H);
      expect(cam.scale).toBeGreaterThanOrEqual(0.3);
    });
  });

  // -------------------------------------------------------------------------
  // Pan operations
  // -------------------------------------------------------------------------

  describe('pan operations', () => {
    it('should pan the camera by pointer delta', () => {
      cam.fitToView(VP_W, VP_H);
      const startPanX = cam.panX;
      const startPanY = cam.panY;

      cam.onPanStart(500, 400);
      cam.onPanMove(600, 450, VP_W, VP_H);

      // Delta = (100, 50)
      expect(cam.panX).toBeCloseTo(startPanX + 100, 5);
      expect(cam.panY).toBeCloseTo(startPanY + 50, 5);
    });

    it('onPanEnd should not throw', () => {
      expect(() => cam.onPanEnd()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // focusZone
  // -------------------------------------------------------------------------

  describe('focusZone', () => {
    it('should center and scale to fit the zone bounds', () => {
      const zone = { x: 100, y: 100, width: 400, height: 300 };
      cam.focusZone(zone, VP_W, VP_H, 0);

      // padding=40
      // scaleX = (1280-80)/400 = 3.0, scaleY = (800-80)/300 = 2.4
      // scale = min(3.0, 2.4) = 2.0 (clamped)
      expect(cam.scale).toBe(2.0);

      // center = (300, 250)
      expect(cam.panX).toBeCloseTo(VP_W / 2 - 300 * cam.scale, 3);
      expect(cam.panY).toBeCloseTo(VP_H / 2 - 250 * cam.scale, 3);
    });
  });

  // -------------------------------------------------------------------------
  // isAnimating
  // -------------------------------------------------------------------------

  describe('isAnimating', () => {
    it('should be false after instant operations (duration=0)', () => {
      cam.zoomTo(1.5, 400, 300, VP_W, VP_H, 0);
      expect(cam.isAnimating).toBe(false);
    });
  });
});
