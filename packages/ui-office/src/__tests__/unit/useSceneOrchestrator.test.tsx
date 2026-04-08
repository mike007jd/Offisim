import type { RuntimeEvent, Zone } from '@offisim/shared-types';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  clearCompanyState,
  registerMovementHandle,
  unregisterMovementHandle,
  useSceneOrchestrator,
} from '../../hooks/useSceneOrchestrator';

type TestEvent = RuntimeEvent<Record<string, unknown>>;

class TestEventBus {
  private subscriptions: Array<{ prefix: string; handler: (event: TestEvent) => void }> = [];

  emit(event: TestEvent) {
    for (const sub of this.subscriptions) {
      if (event.type.startsWith(sub.prefix)) {
        sub.handler(event);
      }
    }
  }

  on(prefix: string, handler: (event: TestEvent) => void) {
    const sub = { prefix, handler };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx >= 0) {
        this.subscriptions.splice(idx, 1);
      }
    };
  }
}

const COMPANY_ID = 'co-scene-test';

const ZONES: Zone[] = [
  {
    companyId: COMPANY_ID,
    zoneId: `${COMPANY_ID}::zone-meeting`,
    kind: 'system',
    label: 'Meeting',
    archetype: 'meeting',
    accentColor: '#3b82f6',
    floorColor: 0x1e293b,
    cx: 0,
    cz: 0,
    w: 8,
    d: 8,
    targetRoles: [],
    allowedCategories: [],
    activityTypes: ['meet'],
    deskSlots: 0,
    sortOrder: 1,
  },
  {
    companyId: COMPANY_ID,
    zoneId: `${COMPANY_ID}::zone-dev`,
    kind: 'system',
    label: 'Engineering',
    archetype: 'workspace',
    accentColor: '#22c55e',
    floorColor: 0x14532d,
    cx: 10,
    cz: 8,
    w: 8,
    d: 8,
    deskSlots: 6,
    targetRoles: ['developer'],
    allowedCategories: [],
    activityTypes: ['work'],
    sortOrder: 2,
  },
  {
    companyId: COMPANY_ID,
    zoneId: `${COMPANY_ID}::zone-rest`,
    kind: 'system',
    label: 'Rest',
    archetype: 'rest',
    accentColor: '#f59e0b',
    floorColor: 0x78350f,
    cx: -8,
    cz: -8,
    w: 6,
    d: 6,
    targetRoles: [],
    allowedCategories: [],
    activityTypes: ['rest'],
    deskSlots: 0,
    sortOrder: 3,
  },
];

function emitEvent(
  eventBus: TestEventBus,
  type: string,
  payload: Record<string, unknown>,
  entityId = type,
) {
  eventBus.emit({
    type,
    entityId,
    entityType: 'graph',
    companyId: COMPANY_ID,
    timestamp: Date.now(),
    payload,
  });
}

function createImmediateHandle(initialPosition: [number, number, number]) {
  let position: [number, number, number] | null = [...initialPosition];
  let moving = false;
  return {
    moveTo(dest: [number, number, number], _speed?: number, onArrive?: () => void) {
      moving = true;
      position = [...dest];
      moving = false;
      onArrive?.();
    },
    stop() {
      moving = false;
    },
    isMoving() {
      return moving;
    },
    getPosition() {
      return position ? [...position] : null;
    },
  };
}

describe('useSceneOrchestrator', () => {
  it('finishes reporting even when a dispatched employee handle disappears before return-to-meeting', () => {
    vi.useFakeTimers();
    const eventBus = new TestEventBus();
    const agents = new Map([
      ['emp-1', { id: 'emp-1', name: 'Ava', role: 'developer', state: 'idle' }],
      ['emp-2', { id: 'emp-2', name: 'Ben', role: 'developer', state: 'idle' }],
    ]);

    clearCompanyState(COMPANY_ID);
    registerMovementHandle(COMPANY_ID, 'emp-1', createImmediateHandle([0, 0, 0]));
    registerMovementHandle(COMPANY_ID, 'emp-2', createImmediateHandle([0, 0, 0]));

    const { result, unmount } = renderHook(() =>
      useSceneOrchestrator({
        companyId: COMPANY_ID,
        eventBus: eventBus as unknown as {
          on: <TPayload = unknown>(
            prefix: string,
            handler: (e: RuntimeEvent<TPayload>) => void,
          ) => () => void;
        },
        agents,
        zones: ZONES,
      }),
    );

    act(() => {
      emitEvent(eventBus, 'graph.node.entered', { nodeName: 'manager' });
      vi.advanceTimersByTime(301);
      emitEvent(eventBus, 'graph.node.entered', { nodeName: 'step_dispatcher' });
      emitEvent(eventBus, 'task.assignment.dispatched', {
        employeeId: 'emp-1',
        employeeName: 'Ava',
        stepLabel: 'Build feature',
        stepIndex: 0,
        totalSteps: 2,
      });
      emitEvent(eventBus, 'task.assignment.dispatched', {
        employeeId: 'emp-2',
        employeeName: 'Ben',
        stepLabel: 'Review feature',
        stepIndex: 1,
        totalSteps: 2,
      });
      vi.advanceTimersByTime(1501);
    });

    expect(result.current.phase).toBe('working');
    expect(result.current.dispatchedIds).toEqual(new Set(['emp-1', 'emp-2']));

    unregisterMovementHandle(COMPANY_ID, 'emp-2');

    act(() => {
      emitEvent(eventBus, 'graph.node.entered', { nodeName: 'boss_summary' });
      vi.advanceTimersByTime(4501);
    });

    expect(result.current.phase).toBe('idle');
    expect(result.current.dispatchedIds.size).toBe(0);

    unmount();
    unregisterMovementHandle(COMPANY_ID, 'emp-1');
    clearCompanyState(COMPANY_ID);
    vi.useRealTimers();
  });

  it('ignores reasoning-only boss summary chunks when updating reporting bubble text', () => {
    vi.useFakeTimers();
    const eventBus = new TestEventBus();
    const agents = new Map([['emp-1', { id: 'emp-1', name: 'Ava', role: 'developer', state: 'idle' }]]);

    clearCompanyState(COMPANY_ID);
    registerMovementHandle(COMPANY_ID, 'emp-1', createImmediateHandle([0, 0, 0]));

    const { result, unmount } = renderHook(() =>
      useSceneOrchestrator({
        companyId: COMPANY_ID,
        eventBus: eventBus as unknown as {
          on: <TPayload = unknown>(
            prefix: string,
            handler: (e: RuntimeEvent<TPayload>) => void,
          ) => () => void;
        },
        agents,
        zones: ZONES,
      }),
    );

    act(() => {
      emitEvent(eventBus, 'graph.node.entered', { nodeName: 'manager' });
      vi.advanceTimersByTime(301);
      emitEvent(eventBus, 'graph.node.entered', { nodeName: 'step_dispatcher' });
      emitEvent(eventBus, 'task.assignment.dispatched', {
        employeeId: 'emp-1',
        employeeName: 'Ava',
        stepLabel: 'Build feature',
        stepIndex: 0,
        totalSteps: 1,
      });
      vi.advanceTimersByTime(1501);
      emitEvent(eventBus, 'graph.node.entered', { nodeName: 'boss_summary' });
    });

    expect(result.current.phase).toBe('reporting');
    expect(result.current.bubbleText).toBe('Work complete.');

    act(() => {
      emitEvent(eventBus, 'llm.stream.chunk', {
        nodeName: 'boss_summary',
        content: 'Hidden reasoning',
        channel: 'reasoning',
      });
    });

    expect(result.current.bubbleText).toBe('Work complete.');

    act(() => {
      emitEvent(eventBus, 'llm.stream.chunk', {
        nodeName: 'boss_summary',
        content: 'Visible summary',
        channel: 'content',
      });
    });

    expect(result.current.bubbleText).toBe('Visible summary');

    unmount();
    unregisterMovementHandle(COMPANY_ID, 'emp-1');
    clearCompanyState(COMPANY_ID);
    vi.useRealTimers();
  });

  it('assigns distinct meeting gather positions when more than eight employees join the ceremony', () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const eventBus = new TestEventBus();
    const agents = new Map(
      Array.from({ length: 10 }, (_, index) => [
        `emp-${index + 1}`,
        {
          id: `emp-${index + 1}`,
          name: `Employee ${index + 1}`,
          role: 'developer',
          state: 'idle',
        },
      ]),
    );

    clearCompanyState(COMPANY_ID);
    const handles = Array.from({ length: 10 }, (_, index) => {
      const id = `emp-${index + 1}`;
      const handle = createImmediateHandle([0, 0, 0]);
      registerMovementHandle(COMPANY_ID, id, handle);
      return { id, handle };
    });

    const { unmount } = renderHook(() =>
      useSceneOrchestrator({
        companyId: COMPANY_ID,
        eventBus: eventBus as unknown as {
          on: <TPayload = unknown>(
            prefix: string,
            handler: (e: RuntimeEvent<TPayload>) => void,
          ) => () => void;
        },
        agents,
        zones: ZONES,
      }),
    );

    act(() => {
      emitEvent(eventBus, 'graph.node.entered', { nodeName: 'manager' });
      vi.advanceTimersByTime(301);
    });

    const positions = handles.map(({ handle }) => handle.getPosition()).filter(Boolean);
    expect(positions).toHaveLength(10);

    const serialized = positions.map((position) => JSON.stringify(position));
    expect(new Set(serialized).size).toBe(10);

    unmount();
    for (const { id } of handles) {
      unregisterMovementHandle(COMPANY_ID, id);
    }
    clearCompanyState(COMPANY_ID);
    randomSpy.mockRestore();
    vi.useRealTimers();
  });

  it('spreads fallback workstation dispatch positions when no workspace zone matches the role', () => {
    vi.useFakeTimers();
    const eventBus = new TestEventBus();
    const agents = new Map(
      Array.from({ length: 5 }, (_, index) => [
        `emp-${index + 1}`,
        {
          id: `emp-${index + 1}`,
          name: `Employee ${index + 1}`,
          role: 'developer',
          state: 'idle',
        },
      ]),
    );
    const zonesWithoutWorkspace = ZONES.filter((zone) => zone.zoneId !== `${COMPANY_ID}::zone-dev`);

    clearCompanyState(COMPANY_ID);
    const handles = Array.from({ length: 5 }, (_, index) => {
      const id = `emp-${index + 1}`;
      const handle = createImmediateHandle([0, 0, 0]);
      registerMovementHandle(COMPANY_ID, id, handle);
      return { id, handle };
    });

    const { unmount } = renderHook(() =>
      useSceneOrchestrator({
        companyId: COMPANY_ID,
        eventBus: eventBus as unknown as {
          on: <TPayload = unknown>(
            prefix: string,
            handler: (e: RuntimeEvent<TPayload>) => void,
          ) => () => void;
        },
        agents,
        zones: zonesWithoutWorkspace,
      }),
    );

    act(() => {
      emitEvent(eventBus, 'graph.node.entered', { nodeName: 'manager' });
      vi.advanceTimersByTime(301);
      emitEvent(eventBus, 'graph.node.entered', { nodeName: 'step_dispatcher' });
      for (let index = 0; index < 5; index++) {
        emitEvent(eventBus, 'task.assignment.dispatched', {
          employeeId: `emp-${index + 1}`,
          employeeName: `Employee ${index + 1}`,
          stepLabel: `Fallback task ${index + 1}`,
          stepIndex: index,
          totalSteps: 5,
        });
      }
      vi.advanceTimersByTime(1501);
    });

    const positions = handles.map(({ handle }) => handle.getPosition()).filter(Boolean);
    expect(positions).toHaveLength(5);
    expect(new Set(positions.map((position) => JSON.stringify(position))).size).toBe(5);

    unmount();
    for (const { id } of handles) {
      unregisterMovementHandle(COMPANY_ID, id);
    }
    clearCompanyState(COMPANY_ID);
    vi.useRealTimers();
  });
});
