import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneEntity, SceneEventBus } from '../../core/types.js';
import type { WorkstationBounds } from '../../layers/floor-layer.js';
import type { MotionTokens } from '../../tokens/motion.js';

// Mock pixi.js
vi.mock('pixi.js', () => {
  class MockContainer {
    children: unknown[] = [];
    position = { set: vi.fn(), x: 0, y: 0 };
    scale = { set: vi.fn(), x: 1, y: 1 };
    visible = true;
    alpha = 1;
    x = 100;
    y = 100;
    eventMode: string | undefined;
    cursor: string | undefined;
    private _listeners: Map<string, Set<Function>> = new Map();

    on(event: string, handler: Function) {
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      this._listeners.get(event)!.add(handler);
      return this;
    }
    off(event: string, handler: Function) {
      this._listeners.get(event)?.delete(handler);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      const handlers = this._listeners.get(event);
      if (handlers) {
        for (const h of handlers) h(...args);
      }
    }
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    removeChild(c: unknown) {
      const idx = this.children.indexOf(c);
      if (idx >= 0) this.children.splice(idx, 1);
    }
    destroy() {}
    /** Identity transform — no offset in tests */
    toLocal(pos: { x: number; y: number }) {
      return { x: pos.x, y: pos.y };
    }
  }

  class MockGraphics extends MockContainer {
    clear() { return this; }
    circle() { return this; }
    rect() { return this; }
    fill() { return this; }
    stroke() { return this; }
  }

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
  };
});

// Mock gsap
vi.mock('gsap', () => {
  return {
    default: {
      to: vi.fn((_target: unknown, vars: Record<string, unknown>) => {
        // Immediately apply final values for reduced-motion or testing
        if (vars.onComplete && typeof vars.onComplete === 'function') {
          vars.onComplete();
        }
        return { kill: vi.fn() };
      }),
      killTweensOf: vi.fn(),
    },
  };
});

const { InteractionController } = await import('../../interaction/interaction-controller.js');
const { Container: PixiContainer } = await import('pixi.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEntity(id: string, x = 100, y = 100): SceneEntity {
  const container = new PixiContainer();
  container.x = x;
  container.y = y;
  return {
    id,
    container: container as unknown as SceneEntity['container'],
    setState: vi.fn(),
    setTask: vi.fn(),
    setHighlight: vi.fn(),
    destroy: vi.fn(),
  };
}

function createMockEventBus(): SceneEventBus {
  return {
    on: vi.fn(() => () => {}),
  };
}

/** Standard M2 motion tokens for testing. */
const MOTION: MotionTokens = {
  M0: { duration: 0, ease: 'none' },
  M1: { duration: 0.6, ease: 'power2.out' },
  M2: { duration: 0.4, ease: 'power2.out' },
  M3: { duration: 0.3, ease: 'back.out(1.2)' },
};

/** Reduced-motion tokens (duration 0 — snap immediately). */
const MOTION_REDUCED: MotionTokens = {
  M0: { duration: 0, ease: 'none' },
  M1: { duration: 0, ease: 'none' },
  M2: { duration: 0, ease: 'none' },
  M3: { duration: 0, ease: 'none' },
};

function createWorkstationBounds(): Map<string, WorkstationBounds> {
  return new Map([
    ['ws-1', { x: 50, y: 50, width: 100, height: 100 }],
    ['ws-2', { x: 250, y: 50, width: 100, height: 100 }],
    ['ws-3', { x: 50, y: 250, width: 100, height: 100 }],
    ['ws-4', { x: 250, y: 250, width: 100, height: 100 }],
  ]);
}

function createPointerEvent(x: number, y: number): { global: { x: number; y: number }; stopPropagation: () => void } {
  return {
    global: { x, y },
    stopPropagation: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InteractionController', () => {
  let stage: InstanceType<typeof PixiContainer>;
  let entities: Map<string, SceneEntity>;
  let workstationBounds: Map<string, WorkstationBounds>;
  let eventBus: SceneEventBus;
  let onDrop: ReturnType<typeof vi.fn>;
  let onHighlight: ReturnType<typeof vi.fn>;
  let controller: InstanceType<typeof InteractionController>;
  /** Captured keydown handlers from globalThis.addEventListener. */
  let capturedKeydownHandlers: Function[];

  beforeEach(() => {
    capturedKeydownHandlers = [];
    // Provide addEventListener/removeEventListener on globalThis for Node env
    globalThis.addEventListener = ((type: string, handler: unknown) => {
      if (type === 'keydown' && typeof handler === 'function') {
        capturedKeydownHandlers.push(handler);
      }
    }) as typeof globalThis.addEventListener;
    globalThis.removeEventListener = (() => {}) as typeof globalThis.removeEventListener;

    stage = new PixiContainer();
    entities = new Map([
      ['emp-alice', createMockEntity('emp-alice', 100, 100)],
      ['emp-bob', createMockEntity('emp-bob', 300, 100)],
    ]);
    workstationBounds = createWorkstationBounds();
    eventBus = createMockEventBus();
    onDrop = vi.fn();
    onHighlight = vi.fn();

    controller = new InteractionController(
      stage as unknown as InstanceType<typeof InteractionController>['stage' & keyof object],
      entities,
      workstationBounds,
      eventBus,
      MOTION,
      onDrop,
      onHighlight,
    );
  });

  describe('enable/disable lifecycle', () => {
    it('should set eventMode and cursor on entities when enabled', () => {
      controller.enable();

      for (const entity of entities.values()) {
        expect(entity.container.eventMode).toBe('static');
        expect(entity.container.cursor).toBe('grab');
      }
    });

    it('should report enabled state correctly', () => {
      expect(controller.enabled).toBe(false);
      controller.enable();
      expect(controller.enabled).toBe(true);
      controller.disable();
      expect(controller.enabled).toBe(false);
    });

    it('should not double-enable', () => {
      controller.enable();
      controller.enable(); // Should be no-op
      expect(controller.enabled).toBe(true);
    });

    it('should reset cursor on disable', () => {
      controller.enable();
      controller.disable();

      for (const entity of entities.values()) {
        expect(entity.container.cursor).toBe('default');
      }
    });
  });

  describe('drag lifecycle', () => {
    beforeEach(() => {
      controller.enable();
    });

    it('should start drag on pointerdown', () => {
      const alice = entities.get('emp-alice')!;
      const downEvent = createPointerEvent(100, 100);

      // Simulate pointerdown on the entity
      (alice.container as unknown as { emit: Function }).emit('pointerdown', downEvent);

      expect(controller.isDragging).toBe(true);
      expect(alice.container.cursor).toBe('grabbing');
      expect(alice.container.alpha).toBe(0.8);
    });

    it('should move entity on pointermove during drag', () => {
      const alice = entities.get('emp-alice')!;

      // Start drag
      (alice.container as unknown as { emit: Function }).emit(
        'pointerdown',
        createPointerEvent(100, 100),
      );

      // Move pointer
      (stage as unknown as { emit: Function }).emit(
        'pointermove',
        createPointerEvent(150, 150),
      );

      // Entity should follow pointer (with offset)
      expect(alice.container.x).toBe(150); // 150 + (100 - 100)
      expect(alice.container.y).toBe(150);
    });

    it('should call onDrop with workstation ID when dropped on valid workstation', () => {
      const alice = entities.get('emp-alice')!;

      // Start drag from (100, 100)
      (alice.container as unknown as { emit: Function }).emit(
        'pointerdown',
        createPointerEvent(100, 100),
      );

      // Move to center of ws-2 (300, 100)
      (stage as unknown as { emit: Function }).emit(
        'pointermove',
        createPointerEvent(300, 100),
      );

      // Drop
      (stage as unknown as { emit: Function }).emit(
        'pointerup',
        createPointerEvent(300, 100),
      );

      expect(onDrop).toHaveBeenCalledWith({
        entityId: 'emp-alice',
        targetWorkstationId: 'ws-2',
      });
      expect(controller.isDragging).toBe(false);
    });

    it('should snap back when dropped outside any workstation', async () => {
      const gsapModule = vi.mocked(await import('gsap'));
      const gsap = gsapModule.default;

      const alice = entities.get('emp-alice')!;
      const originalX = alice.container.x;
      const originalY = alice.container.y;

      // Start drag
      (alice.container as unknown as { emit: Function }).emit(
        'pointerdown',
        createPointerEvent(100, 100),
      );

      // Move to empty area (500, 500) — outside all workstation bounds
      (stage as unknown as { emit: Function }).emit(
        'pointermove',
        createPointerEvent(500, 500),
      );

      // Drop in empty area
      (stage as unknown as { emit: Function }).emit(
        'pointerup',
        createPointerEvent(500, 500),
      );

      // Should NOT call onDrop
      expect(onDrop).not.toHaveBeenCalled();

      // Should trigger snap-back animation (GSAP.to)
      expect(gsap.to).toHaveBeenCalledWith(
        alice.container,
        expect.objectContaining({
          x: originalX,
          y: originalY,
          alpha: 1,
        }),
      );
    });

    it('should snap back immediately with reduced motion', () => {
      controller.disable();

      const reducedController = new InteractionController(
        stage as unknown as InstanceType<typeof InteractionController>['stage' & keyof object],
        entities,
        workstationBounds,
        eventBus,
        MOTION_REDUCED,
        onDrop,
        onHighlight,
      );
      reducedController.enable();

      const alice = entities.get('emp-alice')!;
      const originalX = alice.container.x;
      const originalY = alice.container.y;

      // Start drag
      (alice.container as unknown as { emit: Function }).emit(
        'pointerdown',
        createPointerEvent(100, 100),
      );

      // Move away
      (stage as unknown as { emit: Function }).emit(
        'pointermove',
        createPointerEvent(500, 500),
      );

      // Drop in empty area
      (stage as unknown as { emit: Function }).emit(
        'pointerup',
        createPointerEvent(500, 500),
      );

      // Should snap immediately (no GSAP call for M2 duration=0)
      expect(alice.container.x).toBe(originalX);
      expect(alice.container.y).toBe(originalY);
      expect(alice.container.alpha).toBe(1);

      reducedController.destroy();
    });
  });

  describe('workstation highlight', () => {
    beforeEach(() => {
      controller.enable();
    });

    it('should call onHighlight when hovering over a workstation during drag', () => {
      const alice = entities.get('emp-alice')!;

      // Start drag
      (alice.container as unknown as { emit: Function }).emit(
        'pointerdown',
        createPointerEvent(100, 100),
      );

      // Move to ws-2 area (center: 300, 100)
      (stage as unknown as { emit: Function }).emit(
        'pointermove',
        createPointerEvent(300, 100),
      );

      expect(onHighlight).toHaveBeenCalledWith('ws-2', true);
    });

    it('should clear previous highlight when moving to different workstation', () => {
      const alice = entities.get('emp-alice')!;

      // Start drag
      (alice.container as unknown as { emit: Function }).emit(
        'pointerdown',
        createPointerEvent(100, 100),
      );

      // Move to ws-2
      (stage as unknown as { emit: Function }).emit(
        'pointermove',
        createPointerEvent(300, 100),
      );

      // Move to ws-4
      (stage as unknown as { emit: Function }).emit(
        'pointermove',
        createPointerEvent(300, 300),
      );

      expect(onHighlight).toHaveBeenCalledWith('ws-2', false);
      expect(onHighlight).toHaveBeenCalledWith('ws-4', true);
    });
  });

  describe('cancel via Escape', () => {
    beforeEach(() => {
      controller.enable();
    });

    it('should cancel drag on Escape key', () => {
      const alice = entities.get('emp-alice')!;

      // Start drag
      (alice.container as unknown as { emit: Function }).emit(
        'pointerdown',
        createPointerEvent(100, 100),
      );

      expect(controller.isDragging).toBe(true);

      // Simulate Escape via captured keydown handler
      expect(capturedKeydownHandlers.length).toBeGreaterThan(0);
      capturedKeydownHandlers[0]!({ key: 'Escape' } as KeyboardEvent);

      expect(controller.isDragging).toBe(false);
      expect(onDrop).not.toHaveBeenCalled();
    });
  });

  describe('registerEntity / unregisterEntity', () => {
    it('should register a new entity for drag-drop when enabled', () => {
      controller.enable();

      const carol = createMockEntity('emp-carol', 100, 300);
      entities.set('emp-carol', carol);
      controller.registerEntity('emp-carol', carol);

      expect(carol.container.eventMode).toBe('static');
      expect(carol.container.cursor).toBe('grab');
    });

    it('should not register when disabled', () => {
      const carol = createMockEntity('emp-carol', 100, 300);
      entities.set('emp-carol', carol);
      controller.registerEntity('emp-carol', carol);

      expect(carol.container.eventMode).toBeUndefined();
    });

    it('should unregister an entity', () => {
      controller.enable();

      const alice = entities.get('emp-alice')!;
      controller.unregisterEntity('emp-alice');

      expect(alice.container.cursor).toBe('default');
    });
  });

  describe('destroy', () => {
    it('should disable and clean up on destroy', () => {
      controller.enable();
      controller.destroy();

      expect(controller.enabled).toBe(false);
      expect(controller.isDragging).toBe(false);
    });
  });
});
