import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrefabDefinition } from '@aics/shared-types';

// ── Mock GSAP ────────────────────────────────────────────────────

vi.mock('gsap', () => ({
  default: {
    fromTo: vi.fn(),
    killTweensOf: vi.fn(),
  },
}));

// ── Mock pixi.js ─────────────────────────────────────────────────

vi.mock('pixi.js', () => {
  class MockGraphicsContext {
    destroyed = false;
    // Drawing methods used by render-templates template functions
    roundRect() { return this; }
    rect() { return this; }
    circle() { return this; }
    ellipse() { return this; }
    fill() { return this; }
    stroke() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    destroy() {
      this.destroyed = true;
    }
  }

  class MockGraphics {
    context: unknown = null;
    x = 0;
    y = 0;
    destroyed = false;
    destroy() {
      this.destroyed = true;
    }
  }

  class MockContainer {
    children: unknown[] = [];
    alpha = 1;
    destroyed = false;
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    destroy() {
      this.destroyed = true;
    }
  }

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
    GraphicsContext: MockGraphicsContext,
  };
});

// Import after mocks
const gsapModule = await import('gsap');
const gsap = gsapModule.default;
const { Container, Graphics, GraphicsContext } = await import('pixi.js');
const { PrefabRuntime } = await import('../prefab/prefab-runtime.js');

// ── Test fixtures ────────────────────────────────────────────────

/** Atomic prefab: a single server rack (compute category) */
function makeAtomicDef(overrides: Partial<PrefabDefinition> = {}): PrefabDefinition {
  return {
    prefabId: 'server-rack-1u',
    name: 'Server Rack 1U',
    description: 'A single-unit server rack.',
    category: 'compute',
    gridSize: [1, 2] as readonly [number, number],
    composite: false,
    render2D: { template: 'server-rack', params: {} },
    bindingSlots: [{ name: 'rack-provider', type: 'rack-provider', required: true }],
    ...overrides,
  } as PrefabDefinition;
}

/** Composite prefab: workstation with desk + monitor (workspace category) */
function makeCompositeDef(overrides: Partial<PrefabDefinition> = {}): PrefabDefinition {
  return {
    prefabId: 'workstation-standard',
    name: 'Standard Workstation',
    description: 'Desk and monitor combo.',
    category: 'workspace',
    gridSize: [2, 2] as readonly [number, number],
    composite: true,
    children: [
      { render2D: { template: 'desk', params: {} }, offset: [0, 0] as readonly [number, number] },
      { render2D: { template: 'monitor', params: {} }, offset: [0, -12] as readonly [number, number] },
    ],
    bindingSlots: [{ name: 'agent-context', type: 'agent-context', required: true }],
    ...overrides,
  } as PrefabDefinition;
}

/** Decorative prefab: a plant (no state machine) */
function makeDecorativeDef(): PrefabDefinition {
  return {
    prefabId: 'plant-small',
    name: 'Small Plant',
    description: 'A decorative plant.',
    category: 'decorative',
    gridSize: [1, 1] as readonly [number, number],
    composite: false,
    render2D: { template: 'plant', params: {} },
    bindingSlots: [],
  } as PrefabDefinition;
}

// ── Tests ────────────────────────────────────────────────────────

describe('PrefabRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────

  describe('constructor', () => {
    it('creates Container with one child Graphics for atomic prefab', () => {
      const rt = new PrefabRuntime('inst-1', makeAtomicDef());

      expect(rt.container).toBeInstanceOf(Container);
      expect(rt.container.children).toHaveLength(1);
      expect(rt.container.children[0]).toBeInstanceOf(Graphics);
      expect(rt.instanceId).toBe('inst-1');
    });

    it('creates Container with multiple child Graphics for composite prefab', () => {
      const rt = new PrefabRuntime('inst-2', makeCompositeDef());

      expect(rt.container).toBeInstanceOf(Container);
      // 2 children: desk + monitor
      expect(rt.container.children).toHaveLength(2);
      for (const child of rt.container.children) {
        expect(child).toBeInstanceOf(Graphics);
      }
    });

    it('sets child offsets for composite prefab', () => {
      const rt = new PrefabRuntime('inst-3', makeCompositeDef());

      const desk = rt.container.children[0] as InstanceType<typeof Graphics>;
      const monitor = rt.container.children[1] as InstanceType<typeof Graphics>;
      expect(desk.x).toBe(0);
      expect(desk.y).toBe(0);
      expect(monitor.x).toBe(0);
      expect(monitor.y).toBe(-12);
    });

    it('sets initial state from category state machine', () => {
      const computeRt = new PrefabRuntime('c1', makeAtomicDef());
      expect(computeRt.currentState).toBe('offline'); // compute initial

      const workspaceRt = new PrefabRuntime('w1', makeCompositeDef());
      expect(workspaceRt.currentState).toBe('empty'); // workspace initial
    });

    it('sets currentState to "static" for decorative prefabs', () => {
      const rt = new PrefabRuntime('d1', makeDecorativeDef());
      expect(rt.currentState).toBe('static');
    });

    it('assigns GraphicsContext to each child Graphics', () => {
      const rt = new PrefabRuntime('inst-4', makeAtomicDef());
      const g = rt.container.children[0] as InstanceType<typeof Graphics>;
      // context should be set (a GraphicsContext instance from the mock)
      expect(g.context).toBeInstanceOf(GraphicsContext);
    });

    it('creates graphics for decorative prefab with "static" state', () => {
      const rt = new PrefabRuntime('d2', makeDecorativeDef());
      expect(rt.container.children).toHaveLength(1);
      const g = rt.container.children[0] as InstanceType<typeof Graphics>;
      expect(g.context).toBeInstanceOf(GraphicsContext);
    });
  });

  // ── setState ─────────────────────────────────────────────────

  describe('setState', () => {
    it('swaps graphics.context to the new state context (atomic)', () => {
      const rt = new PrefabRuntime('s1', makeAtomicDef());
      const g = rt.container.children[0] as InstanceType<typeof Graphics>;
      const contextBefore = g.context;

      // compute: offline -> idle is valid
      const result = rt.setState('idle');

      expect(result).toBe(true);
      expect(rt.currentState).toBe('idle');
      // Context should change (different GraphicsContext for different state)
      expect(g.context).toBeInstanceOf(GraphicsContext);
      expect(g.context).not.toBe(contextBefore);
    });

    it('swaps graphics.context for all children in composite prefab', () => {
      const rt = new PrefabRuntime('s2', makeCompositeDef());
      const desk = rt.container.children[0] as InstanceType<typeof Graphics>;
      const monitor = rt.container.children[1] as InstanceType<typeof Graphics>;
      const deskCtxBefore = desk.context;
      const monitorCtxBefore = monitor.context;

      // workspace: empty -> occupied is valid
      const result = rt.setState('occupied');

      expect(result).toBe(true);
      expect(rt.currentState).toBe('occupied');
      expect(desk.context).not.toBe(deskCtxBefore);
      expect(monitor.context).not.toBe(monitorCtxBefore);
    });

    it('returns false for invalid transitions', () => {
      const rt = new PrefabRuntime('s3', makeAtomicDef());
      // compute: offline -> processing is invalid (must go through idle)
      const result = rt.setState('processing');

      expect(result).toBe(false);
      expect(rt.currentState).toBe('offline'); // state unchanged
    });

    it('returns false for decorative category', () => {
      const rt = new PrefabRuntime('s4', makeDecorativeDef());
      const result = rt.setState('anything');

      expect(result).toBe(false);
      expect(rt.currentState).toBe('static'); // unchanged
    });

    it('calls GSAP fromTo with overwrite: "auto"', () => {
      const rt = new PrefabRuntime('s5', makeAtomicDef());
      rt.setState('idle'); // valid transition

      expect(gsap.fromTo).toHaveBeenCalledWith(
        rt.container,
        { alpha: 0.7 },
        { alpha: 1, duration: 0.3, overwrite: 'auto' },
      );
    });

    it('does not call GSAP on failed transition', () => {
      const rt = new PrefabRuntime('s6', makeAtomicDef());
      rt.setState('processing'); // invalid from offline

      expect(gsap.fromTo).not.toHaveBeenCalled();
    });
  });

  // ── Bindings ─────────────────────────────────────────────────

  describe('bindings', () => {
    it('bindToResource stores binding, getBinding retrieves it', () => {
      const rt = new PrefabRuntime('b1', makeAtomicDef());
      rt.bindToResource('rack-provider', 'llm:openai:gpt-4', 'GPT-4');

      const binding = rt.getBinding('rack-provider');
      expect(binding).toBeDefined();
      expect(binding!.slotName).toBe('rack-provider');
      expect(binding!.resourceRef).toBe('llm:openai:gpt-4');
      expect(binding!.label).toBe('GPT-4');
    });

    it('getBinding returns undefined for unbound slot', () => {
      const rt = new PrefabRuntime('b2', makeAtomicDef());
      expect(rt.getBinding('nonexistent')).toBeUndefined();
    });

    it('unbindResource removes binding', () => {
      const rt = new PrefabRuntime('b3', makeAtomicDef());
      rt.bindToResource('rack-provider', 'llm:openai:gpt-4');
      rt.unbindResource('rack-provider');

      expect(rt.getBinding('rack-provider')).toBeUndefined();
    });

    it('getAllBindings returns all stored bindings', () => {
      const rt = new PrefabRuntime('b4', makeCompositeDef());
      rt.bindToResource('agent-context', 'agent:dev-01', 'Dev 01');
      rt.bindToResource('extra-slot', 'extra:ref', 'Extra');

      const all = rt.getAllBindings();
      expect(all).toHaveLength(2);
      expect(all.map((b) => b.slotName).sort()).toEqual(['agent-context', 'extra-slot']);
    });

    it('bindToResource without label stores binding without label', () => {
      const rt = new PrefabRuntime('b5', makeAtomicDef());
      rt.bindToResource('rack-provider', 'llm:anthropic:claude');

      const binding = rt.getBinding('rack-provider');
      expect(binding).toBeDefined();
      expect(binding!.label).toBeUndefined();
    });
  });

  // ── destroy ──────────────────────────────────────────────────

  describe('destroy', () => {
    it('calls gsap.killTweensOf on the container', () => {
      const rt = new PrefabRuntime('d1', makeAtomicDef());
      rt.destroy();

      expect(gsap.killTweensOf).toHaveBeenCalledWith(rt.container);
    });

    it('calls all event unsubscribers', () => {
      const rt = new PrefabRuntime('d2', makeAtomicDef());
      const unsub1 = vi.fn();
      const unsub2 = vi.fn();
      rt.eventUnsubscribers.push(unsub1, unsub2);

      rt.destroy();

      expect(unsub1).toHaveBeenCalled();
      expect(unsub2).toHaveBeenCalled();
      expect(rt.eventUnsubscribers).toHaveLength(0);
    });

    it('destroys all child graphics', () => {
      const rt = new PrefabRuntime('d3', makeCompositeDef());
      const children = [...rt.container.children] as Array<InstanceType<typeof Graphics>>;
      expect(children.length).toBeGreaterThan(0);

      rt.destroy();

      for (const g of children) {
        expect(g.destroyed).toBe(true);
      }
    });

    it('destroys all GraphicsContexts for atomic prefab', () => {
      const rt = new PrefabRuntime('d4', makeAtomicDef());
      // Grab a reference to the context before destroy
      const g = rt.container.children[0] as InstanceType<typeof Graphics>;
      const ctx = g.context as InstanceType<typeof GraphicsContext>;

      rt.destroy();

      expect(ctx.destroyed).toBe(true);
    });

    it('destroys the container', () => {
      const rt = new PrefabRuntime('d5', makeAtomicDef());
      rt.destroy();

      expect(rt.container.destroyed).toBe(true);
    });

    it('clears bindings on destroy', () => {
      const rt = new PrefabRuntime('d6', makeAtomicDef());
      rt.bindToResource('rack-provider', 'some-ref');

      rt.destroy();

      expect(rt.getAllBindings()).toHaveLength(0);
    });
  });
});
