/**
 * AttentionSystem tests — ANIM-032
 * Covers: priority preemption, auto-clear, event subscriptions, manual API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (must come before any import of the module under test) ──────────

vi.mock('pixi.js', () => {
  class MockGraphics {
    _attentionZoneId?: string;
    alpha = 0;
    clear() { return this; }
    circle() { return this; }
    roundRect() { return this; }
    rect() { return this; }
    fill() { return this; }
    stroke() { return this; }
    destroy() {}
  }
  class MockContainer {
    children: unknown[] = [];
    x = 0;
    y = 0;
    addChild(c: unknown) { this.children.push(c); return c; }
    removeChild(c: unknown) {
      const idx = this.children.indexOf(c);
      if (idx >= 0) this.children.splice(idx, 1);
    }
    destroy() {}
  }
  return { Graphics: MockGraphics, Container: MockContainer };
});

vi.mock('gsap', () => {
  function makeTween() {
    return { kill: vi.fn() };
  }
  return {
    default: {
      to: vi.fn(() => makeTween()),
      killTweensOf: vi.fn(),
    },
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────

import type { RuntimeEvent } from '@aics/shared-types';
import type { SceneEventBus, SceneEntity, SceneLayers } from '../core/types.js';
import type { MotionTokens } from '../tokens/motion.js';

function makeEventBus(): SceneEventBus & {
  _emit(event: RuntimeEvent<Record<string, unknown>>): void;
  _handlers: Map<string, ((e: RuntimeEvent<Record<string, unknown>>) => void)[]>;
} {
  const handlers = new Map<string, ((e: RuntimeEvent<Record<string, unknown>>) => void)[]>();
  return {
    _handlers: handlers,
    on(prefix: string, handler: (e: RuntimeEvent<Record<string, unknown>>) => void) {
      if (!handlers.has(prefix)) handlers.set(prefix, []);
      handlers.get(prefix)!.push(handler);
      return () => {
        const arr = handlers.get(prefix);
        if (!arr) return;
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      };
    },
    emit: vi.fn(),
    _emit(event: RuntimeEvent<Record<string, unknown>>) {
      for (const [prefix, arr] of handlers) {
        if (event.type.startsWith(prefix)) {
          for (const h of arr) h(event);
        }
      }
    },
  };
}

function makeLayers() {
  // We'll just use plain objects for layer containers
  const makeContainer = () => ({
    children: [] as unknown[],
    addChild(c: unknown) { this.children.push(c); return c; },
    removeChild(c: unknown) {
      const idx = this.children.indexOf(c);
      if (idx >= 0) this.children.splice(idx, 1);
    },
  });
  return {
    floor: makeContainer(),
    furniture: makeContainer(),
    entity: makeContainer(),
    accent: makeContainer(),
    semantic: makeContainer(),
    bubble: makeContainer(),
    focus: makeContainer(),
    bridge: makeContainer(),
  } as unknown as SceneLayers;
}

function makeEmployee(id: string, x = 0, y = 0): SceneEntity {
  return {
    id,
    container: { x, y, children: [], addChild: vi.fn(), removeChild: vi.fn() } as unknown as import('pixi.js').Container,
    setState: vi.fn(),
    setTask: vi.fn(),
    setHighlight: vi.fn(),
    flashHighlight: vi.fn(),
    destroy: vi.fn(),
  };
}

const MOTION: MotionTokens = {
  M0: { duration: 0, ease: 'none' },
  M1: { duration: 0, ease: 'none' },
  M2: { duration: 0, ease: 'none' },
  M3: { duration: 0, ease: 'none' },
};

// ── Import module under test (after mocks) ────────────────────────────────

const { AttentionSystem } = await import('../systems/attention-system.js');

// ── Tests ─────────────────────────────────────────────────────────────────

describe('AttentionSystem', () => {
  let bus: ReturnType<typeof makeEventBus>;
  let layers: SceneLayers;
  let employees: Map<string, SceneEntity>;
  let system: InstanceType<typeof AttentionSystem>;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = makeEventBus();
    layers = makeLayers();
    employees = new Map();
    system = new AttentionSystem(
      bus,
      () => layers,
      () => employees,
      MOTION,
    );
  });

  afterEach(() => {
    system.deactivate();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── Basic manual API ───────────────────────────────────────────

  describe('requestAttention / getCurrentFocus / clearAttention', () => {
    it('getCurrentFocus returns null before any request', () => {
      expect(system.getCurrentFocus()).toBeNull();
    });

    it('requestAttention sets current focus', () => {
      system.requestAttention({ id: 'a', priority: 1 });
      expect(system.getCurrentFocus()?.id).toBe('a');
    });

    it('clearAttention removes all focus', () => {
      system.requestAttention({ id: 'a', priority: 1 });
      system.clearAttention();
      expect(system.getCurrentFocus()).toBeNull();
    });

    it('clearAttention emits attention.cleared', () => {
      system.requestAttention({ id: 'a', priority: 1 });
      vi.clearAllMocks();
      system.clearAttention();
      const emitted = vi.mocked(bus.emit).mock.calls.map((c) => c[0].type);
      expect(emitted).toContain('attention.cleared');
    });
  });

  // ── Priority preemption ────────────────────────────────────────

  describe('priority preemption', () => {
    it('higher priority preempts lower priority focus', () => {
      system.requestAttention({ id: 'low', priority: 1 });
      expect(system.getCurrentFocus()?.id).toBe('low');

      system.requestAttention({ id: 'high', priority: 4 });
      expect(system.getCurrentFocus()?.id).toBe('high');
    });

    it('lower priority does NOT preempt higher priority focus', () => {
      system.requestAttention({ id: 'high', priority: 4 });
      system.requestAttention({ id: 'low', priority: 1 });
      expect(system.getCurrentFocus()?.id).toBe('high');
    });

    it('equal priority: newer request wins', () => {
      system.requestAttention({ id: 'first', priority: 3 });
      vi.advanceTimersByTime(1); // ensure different timestamp
      system.requestAttention({ id: 'second', priority: 3 });
      expect(system.getCurrentFocus()?.id).toBe('second');
    });

    it('after high-priority clears, reverts to next best', () => {
      system.requestAttention({ id: 'low', priority: 1, duration: 60000 });
      system.requestAttention({ id: 'high', priority: 4, duration: 60000 });
      expect(system.getCurrentFocus()?.id).toBe('high');

      // Manually clear just the high-priority one
      // We simulate auto-clear by advancing timer for 'high' (5s default)
      // but it was set with 60000ms — instead, use deactivate + re-request
      // Direct approach: use internal clearAttentionById via a public wrapper
      // Since there's no public clearById, simulate via requesting a new session
      // Actually test: auto-clear of high reverts to low
      system.requestAttention({ id: 'high', priority: 4, duration: 100 });
      vi.advanceTimersByTime(150);
      // high should be gone, low still active
      expect(system.getCurrentFocus()?.id).toBe('low');
    });
  });

  // ── Auto-clear ────────────────────────────────────────────────

  describe('auto-clear after duration', () => {
    it('auto-clears after default 5000ms', () => {
      system.requestAttention({ id: 'x', priority: 2 });
      expect(system.getCurrentFocus()?.id).toBe('x');

      vi.advanceTimersByTime(5001);
      expect(system.getCurrentFocus()).toBeNull();
    });

    it('auto-clears after custom duration', () => {
      system.requestAttention({ id: 'y', priority: 2, duration: 1000 });
      vi.advanceTimersByTime(500);
      expect(system.getCurrentFocus()?.id).toBe('y');

      vi.advanceTimersByTime(600);
      expect(system.getCurrentFocus()).toBeNull();
    });

    it('emits attention.cleared after auto-clear', () => {
      system.requestAttention({ id: 'z', priority: 1, duration: 100 });
      vi.clearAllMocks();
      vi.advanceTimersByTime(200);
      const emitted = vi.mocked(bus.emit).mock.calls.map((c) => c[0].type);
      expect(emitted).toContain('attention.cleared');
    });

    it('re-requesting same id resets auto-clear timer', () => {
      system.requestAttention({ id: 'reuse', priority: 1, duration: 1000 });
      vi.advanceTimersByTime(800);
      // Re-request with fresh duration
      system.requestAttention({ id: 'reuse', priority: 1, duration: 1000 });
      vi.advanceTimersByTime(800);
      // Should still be active (reset timer)
      expect(system.getCurrentFocus()?.id).toBe('reuse');
      vi.advanceTimersByTime(300);
      expect(system.getCurrentFocus()).toBeNull();
    });
  });

  // ── attention.focused event ───────────────────────────────────

  describe('attention.focused event', () => {
    it('emits attention.focused when a new request becomes the focus', () => {
      system.requestAttention({ id: 'f1', priority: 2 });
      const calls = vi.mocked(bus.emit).mock.calls;
      const focused = calls.find((c) => c[0].type === 'attention.focused');
      expect(focused).toBeDefined();
      expect((focused![0].payload as Record<string, unknown>).attentionId).toBe('f1');
    });

    it('emits attention.focused with correct priority', () => {
      system.requestAttention({ id: 'f2', priority: 4 });
      const calls = vi.mocked(bus.emit).mock.calls;
      const focused = calls.find((c) => c[0].type === 'attention.focused');
      expect((focused![0].payload as Record<string, unknown>).priority).toBe(4);
    });
  });

  // ── Event subscription triggers ──────────────────────────────

  describe('event subscriptions (activate)', () => {
    beforeEach(() => system.activate());

    it('employee.blocked triggers attention with priority 3', () => {
      bus._emit({
        type: 'employee.blocked',
        entityId: 'emp-alice',
        entityType: 'employee',
        companyId: 'co1',
        timestamp: Date.now(),
        payload: { employeeId: 'emp-alice' },
      });
      expect(system.getCurrentFocus()?.priority).toBe(3);
      expect(system.getCurrentFocus()?.employeeId).toBe('emp-alice');
    });

    it('install.state.changed with materializing triggers attention priority 2', () => {
      bus._emit({
        type: 'install.state.changed',
        entityId: 'txn-1',
        entityType: 'employee',
        companyId: 'co1',
        timestamp: Date.now(),
        payload: { next: 'materializing', installTxnId: 'txn-1', prev: 'compatibility_checked' },
      });
      expect(system.getCurrentFocus()?.priority).toBe(2);
    });

    it('install.state.changed with failed triggers attention priority 4', () => {
      bus._emit({
        type: 'install.state.changed',
        entityId: 'txn-2',
        entityType: 'employee',
        companyId: 'co1',
        timestamp: Date.now(),
        payload: { next: 'failed', installTxnId: 'txn-2', prev: 'materializing' },
      });
      expect(system.getCurrentFocus()?.priority).toBe(4);
    });

    it('install.state.changed with installed clears install attention', () => {
      // First set a materializing request
      bus._emit({
        type: 'install.state.changed',
        entityId: 'txn-3',
        entityType: 'employee',
        companyId: 'co1',
        timestamp: Date.now(),
        payload: { next: 'materializing', installTxnId: 'txn-3', prev: 'compatibility_checked' },
      });
      expect(system.getCurrentFocus()).not.toBeNull();

      bus._emit({
        type: 'install.state.changed',
        entityId: 'txn-3',
        entityType: 'employee',
        companyId: 'co1',
        timestamp: Date.now(),
        payload: { next: 'installed', installTxnId: 'txn-3', prev: 'materializing' },
      });
      expect(system.getCurrentFocus()).toBeNull();
    });

    it('task.state.changed with failed triggers attention priority 3', () => {
      bus._emit({
        type: 'task.state.changed',
        entityId: 'task-run-1',
        entityType: 'employee',
        companyId: 'co1',
        timestamp: Date.now(),
        payload: { next: 'failed', taskRunId: 'task-run-1', prev: 'running', employeeId: 'emp-bob' },
      });
      expect(system.getCurrentFocus()?.priority).toBe(3);
      expect(system.getCurrentFocus()?.employeeId).toBe('emp-bob');
    });

    it('task.state.changed with completed clears task attention', () => {
      bus._emit({
        type: 'task.state.changed',
        entityId: 'task-run-2',
        entityType: 'employee',
        companyId: 'co1',
        timestamp: Date.now(),
        payload: { next: 'failed', taskRunId: 'task-run-2', prev: 'running' },
      });
      expect(system.getCurrentFocus()).not.toBeNull();

      bus._emit({
        type: 'task.state.changed',
        entityId: 'task-run-2',
        entityType: 'employee',
        companyId: 'co1',
        timestamp: Date.now(),
        payload: { next: 'completed', taskRunId: 'task-run-2', prev: 'failed' },
      });
      expect(system.getCurrentFocus()).toBeNull();
    });

    it('install.failed (priority 4) preempts employee.blocked (priority 3)', () => {
      bus._emit({
        type: 'employee.blocked',
        entityId: 'emp-carol',
        entityType: 'employee',
        companyId: 'co1',
        timestamp: Date.now(),
        payload: { employeeId: 'emp-carol' },
      });
      expect(system.getCurrentFocus()?.priority).toBe(3);

      bus._emit({
        type: 'install.state.changed',
        entityId: 'txn-4',
        entityType: 'employee',
        companyId: 'co1',
        timestamp: Date.now(),
        payload: { next: 'failed', installTxnId: 'txn-4', prev: 'materializing' },
      });
      expect(system.getCurrentFocus()?.priority).toBe(4);
    });
  });

  // ── Visual building ───────────────────────────────────────────

  describe('visual indicators', () => {
    it('adds employee ring to focus layer when employeeId is present', async () => {
      const emp = makeEmployee('emp-x', 100, 50);
      employees.set('emp-x', emp);

      system.requestAttention({ id: 'ring-test', priority: 2, employeeId: 'emp-x' });

      // A Graphics child should have been added to focus layer
      expect((layers.focus as unknown as { children: unknown[] }).children.length).toBeGreaterThan(0);
    });

    it('clears visual indicators when focus changes', async () => {
      const emp = makeEmployee('emp-y', 0, 0);
      employees.set('emp-y', emp);

      system.requestAttention({ id: 'vis-1', priority: 1, employeeId: 'emp-y', duration: 100 });
      const childCountAfterAdd = (layers.focus as unknown as { children: unknown[] }).children.length;
      expect(childCountAfterAdd).toBeGreaterThan(0);

      vi.advanceTimersByTime(150);
      // After auto-clear, focus removed — visuals destroyed
      expect((layers.focus as unknown as { children: unknown[] }).children.length).toBe(0);
    });
  });

  // ── deactivate ────────────────────────────────────────────────

  describe('deactivate', () => {
    it('deactivate removes all subscriptions (no events processed after)', () => {
      system.activate();
      system.deactivate();

      bus._emit({
        type: 'employee.blocked',
        entityId: 'emp-z',
        entityType: 'employee',
        companyId: 'co1',
        timestamp: Date.now(),
        payload: { employeeId: 'emp-z' },
      });
      expect(system.getCurrentFocus()).toBeNull();
    });

    it('deactivate clears pending timers (no late callbacks)', () => {
      system.activate();
      system.requestAttention({ id: 'pending', priority: 1, duration: 1000 });
      system.deactivate();

      // Should not throw or set focus after deactivate
      vi.advanceTimersByTime(2000);
      expect(system.getCurrentFocus()).toBeNull();
    });
  });
});
