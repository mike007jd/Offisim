import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RuntimeEvent } from '@aics/shared-types';
import type { SceneEventBus } from '../core/types.js';

// Mock pixi.js — must be before importing SceneManager
vi.mock('pixi.js', () => {
  class MockContainer {
    children: unknown[] = [];
    position = { set: vi.fn(), x: 0, y: 0 };
    scale = { set: vi.fn(), x: 1, y: 1 };
    visible = true;
    alpha = 1;
    addChild(c: unknown) { this.children.push(c); return c; }
    addChildAt(c: unknown, i: number) { this.children.splice(i, 0, c); return c; }
    removeChild(c: unknown) { const idx = this.children.indexOf(c); if (idx >= 0) this.children.splice(idx, 1); }
    destroy() {}
  }

  class MockGraphics extends MockContainer {
    clear() { return this; }
    circle() { return this; }
    roundRect() { return this; }
    fill() { return this; }
    stroke() { return this; }
    cut() { return this; }
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

// Mock gsap — return unique tween objects with vars for trackTween compatibility
vi.mock('gsap', () => {
  function makeTween() {
    return { kill: vi.fn(), vars: {} };
  }
  return {
    default: {
      to: vi.fn(() => makeTween()),
      fromTo: vi.fn(() => makeTween()),
    },
  };
});

// Now import after mocks
const { SceneManager } = await import('../core/scene-manager.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockEventBus(): SceneEventBus & { fire: (event: RuntimeEvent<any>) => void } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers: Array<{ prefix: string; handler: (event: RuntimeEvent<any>) => void }> = [];

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(prefix: string, handler: (event: RuntimeEvent<any>) => void) {
      const entry = { prefix, handler };
      handlers.push(entry);
      return () => {
        const idx = handlers.indexOf(entry);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fire(event: RuntimeEvent<any>) {
      for (const { prefix, handler } of handlers) {
        if (event.type.startsWith(prefix)) {
          handler(event);
        }
      }
    },
  };
}

function makeEvent(type: string, payload: Record<string, unknown>): RuntimeEvent {
  return {
    type,
    entityId: 'test',
    entityType: 'employee',
    companyId: 'company-1',
    timestamp: Date.now(),
    payload,
  };
}

describe('SceneManager', () => {
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

  it('mount creates app and subscribes to events', async () => {
    const sm = new SceneManager({ container, eventBus });
    await sm.mount();

    // Should have appended canvas
    expect(container.appendChild).toHaveBeenCalled();
  });

  it('mount is idempotent', async () => {
    const sm = new SceneManager({ container, eventBus });
    await sm.mount();
    await sm.mount(); // second call should be no-op

    expect(container.appendChild).toHaveBeenCalledTimes(1);
  });

  it('destroy cleans up without errors', async () => {
    const sm = new SceneManager({ container, eventBus });
    await sm.mount();
    sm.destroy();

    // Calling destroy again should be safe
    sm.destroy();
  });

  it('responds to employee.state.changed events', async () => {
    const sm = new SceneManager({ container, eventBus });
    await sm.mount();

    // Fire a state change — should not throw
    eventBus.fire(makeEvent('employee.state.changed', {
      employeeId: 'emp-alice',
      prev: 'idle',
      next: 'thinking',
    }));
  });

  it('responds to task.assignment.changed events', async () => {
    const sm = new SceneManager({ container, eventBus });
    await sm.mount();

    eventBus.fire(makeEvent('task.assignment.changed', {
      taskRunId: 'task-1',
      employeeId: 'emp-bob',
      action: 'assigned',
    }));

    // Unassign
    eventBus.fire(makeEvent('task.assignment.changed', {
      taskRunId: 'task-1',
      employeeId: 'emp-bob',
      action: 'unassigned',
    }));
  });

  it('responds to graph.node.entered/exited events', async () => {
    const sm = new SceneManager({ container, eventBus });
    await sm.mount();

    eventBus.fire(makeEvent('graph.node.entered', { nodeName: 'alice_work' }));
    eventBus.fire(makeEvent('graph.node.exited', { nodeName: 'alice_work' }));
  });

  it('ignores events for unknown employees', async () => {
    const sm = new SceneManager({ container, eventBus });
    await sm.mount();

    // Should not throw
    eventBus.fire(makeEvent('employee.state.changed', {
      employeeId: 'emp-unknown',
      prev: 'idle',
      next: 'thinking',
    }));
  });

  it('uses custom employee seeds', async () => {
    const sm = new SceneManager({
      container,
      eventBus,
      employees: [{ id: 'emp-dave', name: 'Dave' }],
    });
    await sm.mount();

    // Dave events should work
    eventBus.fire(makeEvent('employee.state.changed', {
      employeeId: 'emp-dave',
      prev: 'idle',
      next: 'assigned',
    }));
  });

  it('motion getter returns reduced tokens when configured', () => {
    const sm = new SceneManager({ container, eventBus, reducedMotion: true });
    expect(sm.motion.M1.duration).toBe(0);
    expect(sm.motion.M2.duration).toBe(0);
  });

  it('motion getter returns standard tokens by default', () => {
    const sm = new SceneManager({ container, eventBus });
    expect(sm.motion.M1.duration).toBe(0.6);
    expect(sm.motion.M2.duration).toBe(0.4);
  });

  it('reducedMotion setter updates motion without rebuild', async () => {
    const sm = new SceneManager({ container, eventBus, reducedMotion: false });
    await sm.mount();

    expect(sm.motion.M2.duration).toBe(0.4);
    sm.reducedMotion = true;
    expect(sm.motion.M2.duration).toBe(0);
    sm.reducedMotion = false;
    expect(sm.motion.M2.duration).toBe(0.4);
  });
});
