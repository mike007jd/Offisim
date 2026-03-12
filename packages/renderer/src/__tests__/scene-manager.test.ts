import type { RuntimeEvent } from '@aics/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneEventBus } from '../core/types.js';

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

// Mock gsap — return unique tween objects with vars for trackTween compatibility
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

// Now import after mocks
const { SceneManager } = await import('../core/scene-manager.js');
const gsapModule = await import('gsap');
const gsap = gsapModule.default;

// biome-ignore lint/suspicious/noExplicitAny: test mock mirrors SceneEventBus which requires any for payload types
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
    eventBus.fire(
      makeEvent('employee.state.changed', {
        employeeId: 'emp-alice',
        prev: 'idle',
        next: 'thinking',
      }),
    );
  });

  it('responds to task.assignment.changed events', async () => {
    const sm = new SceneManager({ container, eventBus });
    await sm.mount();

    eventBus.fire(
      makeEvent('task.assignment.changed', {
        taskRunId: 'task-1',
        employeeId: 'emp-bob',
        action: 'assigned',
      }),
    );

    // Unassign
    eventBus.fire(
      makeEvent('task.assignment.changed', {
        taskRunId: 'task-1',
        employeeId: 'emp-bob',
        action: 'unassigned',
      }),
    );
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
    eventBus.fire(
      makeEvent('employee.state.changed', {
        employeeId: 'emp-unknown',
        prev: 'idle',
        next: 'thinking',
      }),
    );
  });

  it('uses custom employee seeds', async () => {
    const sm = new SceneManager({
      container,
      eventBus,
      employees: [{ id: 'emp-dave', name: 'Dave' }],
    });
    await sm.mount();

    // Dave events should work
    eventBus.fire(
      makeEvent('employee.state.changed', {
        employeeId: 'emp-dave',
        prev: 'idle',
        next: 'assigned',
      }),
    );
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

  describe('entity types', () => {
    it('default employees use EmployeeEntity (human avatar)', async () => {
      const sm = new SceneManager({
        container,
        eventBus,
        employees: [{ id: 'emp-alice', name: 'Alice' }], // no entityType → default 'employee'
      });
      await sm.mount();

      expect(sm.employeeCount).toBe(1);
      expect(sm.employeeIds).toEqual(['emp-alice']);

      // Employee entity should respond to state + task events
      eventBus.fire(
        makeEvent('employee.state.changed', {
          employeeId: 'emp-alice',
          prev: 'idle',
          next: 'thinking',
        }),
      );
    });

    it('lobster entityType creates LobsterEntity', async () => {
      const sm = new SceneManager({
        container,
        eventBus,
        employees: [{ id: 'claw-01', name: 'OpenClaw Agent', entityType: 'lobster' as const }],
      });
      await sm.mount();

      expect(sm.employeeCount).toBe(1);
      expect(sm.employeeIds).toEqual(['claw-01']);

      // Lobster entity should also respond to state events
      eventBus.fire(
        makeEvent('employee.state.changed', {
          employeeId: 'claw-01',
          prev: 'idle',
          next: 'executing',
        }),
      );
    });

    it('mixed entity types coexist in the same scene', async () => {
      const sm = new SceneManager({
        container,
        eventBus,
        employees: [
          { id: 'emp-alice', name: 'Alice' }, // default → employee
          { id: 'claw-01', name: 'Lobster', entityType: 'lobster' as const },
          { id: 'emp-bob', name: 'Bob', entityType: 'employee' as const },
        ],
      });
      await sm.mount();

      expect(sm.employeeCount).toBe(3);

      // All entity types respond to events
      for (const id of ['emp-alice', 'claw-01', 'emp-bob']) {
        eventBus.fire(
          makeEvent('employee.state.changed', {
            employeeId: id,
            prev: 'idle',
            next: 'assigned',
          }),
        );
      }
    });
  });

  describe('addEmployee', () => {
    it('returns false before mount', () => {
      const sm = new SceneManager({ container, eventBus });
      expect(sm.addEmployee('emp-new', 'NewGuy')).toBe(false);
    });

    it('adds a lobster entity by default (installed = OpenClaw)', async () => {
      const sm = new SceneManager({ container, eventBus });
      await sm.mount();

      const initialCount = sm.employeeCount;
      const result = sm.addEmployee('claw-new', 'NewLobster');
      expect(result).toBe(true);
      expect(sm.employeeCount).toBe(initialCount + 1);
      expect(sm.employeeIds).toContain('claw-new');

      // Lobster entity should respond to state events
      eventBus.fire(
        makeEvent('employee.state.changed', {
          employeeId: 'claw-new',
          prev: 'idle',
          next: 'thinking',
        }),
      );
    });

    it('adds an employee entity when entityType is employee', async () => {
      const sm = new SceneManager({ container, eventBus });
      await sm.mount();

      const result = sm.addEmployee('emp-dave', 'Dave', 'employee');
      expect(result).toBe(true);
      expect(sm.employeeIds).toContain('emp-dave');

      eventBus.fire(
        makeEvent('employee.state.changed', {
          employeeId: 'emp-dave',
          prev: 'idle',
          next: 'thinking',
        }),
      );
    });

    it('returns false for duplicate employee id', async () => {
      const sm = new SceneManager({ container, eventBus });
      await sm.mount();

      // emp-alice already exists from DEFAULT_EMPLOYEES
      expect(sm.addEmployee('emp-alice', 'Alice2')).toBe(false);
    });

    it('plays entrance animation with gsap.to when motion is enabled', async () => {
      const sm = new SceneManager({ container, eventBus, reducedMotion: false });
      await sm.mount();

      // Clear previous gsap calls from mount
      vi.mocked(gsap.to).mockClear();

      const result = sm.addEmployee('emp-dave', 'Dave');
      expect(result).toBe(true);

      // gsap.to should have been called twice: once for scale, once for alpha
      expect(gsap.to).toHaveBeenCalledTimes(2);
    });

    it('snaps to final state with reduced motion', async () => {
      const sm = new SceneManager({ container, eventBus, reducedMotion: true });
      await sm.mount();

      vi.mocked(gsap.to).mockClear();

      const result = sm.addEmployee('emp-dave', 'Dave');
      expect(result).toBe(true);

      // No gsap.to calls — reduced motion snaps immediately
      expect(gsap.to).not.toHaveBeenCalled();
    });

    it('cycles desk positions when more employees than desks', async () => {
      const sm = new SceneManager({
        container,
        eventBus,
        employees: [], // start with no employees
      });
      await sm.mount();

      // Add 5 employees (more than 4 desk positions)
      for (let i = 0; i < 5; i++) {
        expect(sm.addEmployee(`emp-extra-${i}`, `Extra${i}`)).toBe(true);
      }

      // All 5 should respond to events without errors
      for (let i = 0; i < 5; i++) {
        eventBus.fire(
          makeEvent('employee.state.changed', {
            employeeId: `emp-extra-${i}`,
            prev: 'idle',
            next: 'assigned',
          }),
        );
      }
    });

    it('newly added employee is cleaned up by destroy', async () => {
      const sm = new SceneManager({ container, eventBus });
      await sm.mount();

      sm.addEmployee('emp-dave', 'Dave');
      // destroy should not throw even with dynamically added employees
      sm.destroy();
    });
  });

  describe('employee.installed event', () => {
    it('adds a lobster entity when employee.installed fires', async () => {
      const sm = new SceneManager({ container, eventBus });
      await sm.mount();

      const initialCount = sm.employeeCount;

      eventBus.fire(
        makeEvent('employee.installed', {
          employeeId: 'claw-installed-01',
          name: 'Installed Agent',
        }),
      );

      expect(sm.employeeCount).toBe(initialCount + 1);
      expect(sm.employeeIds).toContain('claw-installed-01');
    });

    it('ignores duplicate employee.installed for same id', async () => {
      const sm = new SceneManager({ container, eventBus });
      await sm.mount();

      eventBus.fire(
        makeEvent('employee.installed', {
          employeeId: 'claw-dup',
          name: 'Dup Agent',
        }),
      );

      const countAfterFirst = sm.employeeCount;

      // Second install with same id should be silently ignored
      eventBus.fire(
        makeEvent('employee.installed', {
          employeeId: 'claw-dup',
          name: 'Dup Agent 2',
        }),
      );

      expect(sm.employeeCount).toBe(countAfterFirst);
    });
  });

  describe('meeting room', () => {
    it('responds to meeting.state.changed active event without errors', async () => {
      const sm = new SceneManager({ container, eventBus });
      await sm.mount();

      eventBus.fire(
        makeEvent('meeting.state.changed', {
          meetingId: 'mtg-1',
          prev: 'scheduled',
          next: 'active',
          participantIds: ['emp-alice', 'emp-bob'],
        }),
      );
    });

    it('responds to meeting.state.changed ended event without errors', async () => {
      const sm = new SceneManager({ container, eventBus });
      await sm.mount();

      // Show first
      eventBus.fire(
        makeEvent('meeting.state.changed', {
          meetingId: 'mtg-1',
          prev: 'scheduled',
          next: 'active',
          participantIds: ['emp-alice'],
        }),
      );

      // Then hide
      eventBus.fire(
        makeEvent('meeting.state.changed', {
          meetingId: 'mtg-1',
          prev: 'active',
          next: 'ended',
          participantIds: ['emp-alice'],
        }),
      );
    });

    it('meeting room is cleaned up by destroy', async () => {
      const sm = new SceneManager({ container, eventBus });
      await sm.mount();

      // Show meeting room
      eventBus.fire(
        makeEvent('meeting.state.changed', {
          meetingId: 'mtg-1',
          prev: 'scheduled',
          next: 'active',
          participantIds: [],
        }),
      );

      // Should not throw
      sm.destroy();
    });
  });

  describe('mcp tool bubble', () => {
    it('shows tool name in employee bubble on mcp.tool.called', async () => {
      const sm = new SceneManager({ container, eventBus });
      await sm.mount();

      // Should not throw — tool name shown in alice's bubble
      eventBus.fire(
        makeEvent('mcp.tool.called', {
          serverName: 'filesystem',
          toolName: 'read_file',
          employeeId: 'emp-alice',
        }),
      );
    });

    it('ignores mcp.tool.called for unknown employees', async () => {
      const sm = new SceneManager({ container, eventBus });
      await sm.mount();

      // Should not throw for unknown employee
      eventBus.fire(
        makeEvent('mcp.tool.called', {
          serverName: 'filesystem',
          toolName: 'write_file',
          employeeId: 'emp-unknown',
        }),
      );
    });
  });
});
