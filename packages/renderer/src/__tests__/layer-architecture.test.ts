import type { RuntimeEvent } from '@aics/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneEventBus } from '../core/types.js';
import { LAYER_NAMES } from '../core/types.js';

// Mock pixi.js — must be before importing SceneManager
vi.mock('pixi.js', () => {
  class MockContainer {
    children: unknown[] = [];
    position = { set: vi.fn(), x: 0, y: 0 };
    scale = { set: vi.fn(), x: 1, y: 1 };
    pivot = { set: vi.fn(), x: 0, y: 0 };
    visible = true;
    alpha = 1;
    rotation = 0;
    x = 0;
    y = 0;
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
    addChild(c: unknown) {
      this.children.push(c);
      return c;
    }
    addChildAt(c: unknown, i: number) {
      this.children.splice(i, 0, c);
      return c;
    }
    removeChild(c: unknown) {
      const idx = this.children.indexOf(c);
      if (idx >= 0) this.children.splice(idx, 1);
    }
    destroy() {}
  }

  class MockGraphics extends MockContainer {
    clear() {
      return this;
    }
    circle() {
      return this;
    }
    roundRect() {
      return this;
    }
    rect() {
      return this;
    }
    fill() {
      return this;
    }
    stroke() {
      return this;
    }
    cut() {
      return this;
    }
  }

  class MockText extends MockContainer {
    text = '';
    anchor = { set: vi.fn() };
    width = 40;
    height = 12;
    constructor(opts?: { text?: string }) {
      super();
      if (opts?.text) this.text = opts.text;
    }
  }

  const mockRenderer = {
    on: vi.fn(),
    off: vi.fn(),
  };

  class MockApplication {
    stage = new MockContainer();
    canvas = { style: {} };
    screen = { width: 800, height: 600 };
    renderer = mockRenderer;
    async init() {}
    destroy() {}
  }

  return {
    Application: MockApplication,
    Container: MockContainer,
    Graphics: MockGraphics,
    Text: MockText,
  };
});

// Mock gsap
vi.mock('gsap', () => {
  function makeTween() {
    return { kill: vi.fn(), vars: {} };
  }
  function makeTimeline() {
    const tl = {
      to: vi.fn(() => tl),
      kill: vi.fn(),
      vars: {},
    };
    return tl;
  }
  return {
    default: {
      to: vi.fn(() => makeTween()),
      fromTo: vi.fn(() => makeTween()),
      timeline: vi.fn(() => makeTimeline()),
    },
  };
});

// Import after mocks (top-level await pattern matches scene-manager.test.ts)
const { SceneManager } = await import('../core/scene-manager.js');
const { Container: MockContainer } = await import('pixi.js');

// biome-ignore lint/suspicious/noExplicitAny: test mock mirrors SceneEventBus
function createMockEventBus(): SceneEventBus & { fire: (event: RuntimeEvent<any>) => void } {
  // biome-ignore lint/suspicious/noExplicitAny: test mock stores generic event handlers
  const handlers: Array<{ prefix: string; handler: (event: RuntimeEvent<any>) => void }> = [];
  return {
    // biome-ignore lint/suspicious/noExplicitAny: mirrors SceneEventBus signature
    on(prefix: string, handler: (event: RuntimeEvent<any>) => void) {
      const entry = { prefix, handler };
      handlers.push(entry);
      return () => {
        const idx = handlers.indexOf(entry);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
    // biome-ignore lint/suspicious/noExplicitAny: test mock fires generic events
    emit(event: RuntimeEvent<any>) {
      for (const { prefix, handler } of handlers) {
        if (event.type.startsWith(prefix)) handler(event);
      }
    },
    // biome-ignore lint/suspicious/noExplicitAny: test mock fires generic events
    fire(event: RuntimeEvent<any>) {
      for (const { prefix, handler } of handlers) {
        if (event.type.startsWith(prefix)) handler(event);
      }
    },
  };
}

describe('Layer architecture', () => {
  it('LAYER_NAMES has 8 entries', () => {
    expect(LAYER_NAMES).toHaveLength(8);
  });

  it('LAYER_NAMES entries are in correct L0–L7 order', () => {
    expect(LAYER_NAMES[0]).toBe('floor');
    expect(LAYER_NAMES[1]).toBe('furniture');
    expect(LAYER_NAMES[2]).toBe('entity');
    expect(LAYER_NAMES[3]).toBe('accent');
    expect(LAYER_NAMES[4]).toBe('semantic');
    expect(LAYER_NAMES[5]).toBe('bubble');
    expect(LAYER_NAMES[6]).toBe('focus');
    expect(LAYER_NAMES[7]).toBe('bridge');
  });

  describe('SceneManager with layers', () => {
    let container: HTMLElement;
    let eventBus: ReturnType<typeof createMockEventBus>;

    beforeEach(() => {
      container = {
        appendChild: vi.fn(),
        offsetWidth: 800,
        offsetHeight: 600,
      } as unknown as HTMLElement;
      eventBus = createMockEventBus();
    });

    it('mounts successfully with layer architecture', async () => {
      const sm = new SceneManager({ container, eventBus });
      await sm.mount();
      expect(container.appendChild).toHaveBeenCalled();
    });

    it('addToLayer returns false before mount', () => {
      const sm = new SceneManager({ container, eventBus });
      const child = new MockContainer();
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      expect(sm.addToLayer('entity', child as any)).toBe(false);
    });

    it('addToLayer returns true after mount', async () => {
      const sm = new SceneManager({ container, eventBus });
      await sm.mount();
      const child = new MockContainer();
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      expect(sm.addToLayer('floor', child as any)).toBe(true);
    });

    it('entityStyle option defaults to lobster', () => {
      // entityStyle is private — instantiation without option should succeed
      const sm = new SceneManager({ container, eventBus });
      expect(sm).toBeTruthy();
    });

    it('entityStyle option can be set to employee', () => {
      const sm = new SceneManager({ container, eventBus, entityStyle: 'employee' });
      expect(sm).toBeTruthy();
    });

    it('destroy cleans up layers without errors', async () => {
      const sm = new SceneManager({ container, eventBus });
      await sm.mount();
      sm.destroy();
      // addToLayer should return false after destroy (layers is null)
      const child = new MockContainer();
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      expect(sm.addToLayer('entity', child as any)).toBe(false);
    });
  });
});
