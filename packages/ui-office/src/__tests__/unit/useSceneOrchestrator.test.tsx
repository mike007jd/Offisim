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
});
