import type {
  PlanCompletedPayload,
  PlanCreatedPayload,
  PlanStepCompletedPayload,
  PlanStepStartedPayload,
} from '@offisim/shared-types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock EventBus
// ---------------------------------------------------------------------------

type Handler = (event: any) => void;
const handlers = new Map<string, Handler[]>();

function mockOn(prefix: string, handler: Handler) {
  const list = handlers.get(prefix) ?? [];
  list.push(handler);
  handlers.set(prefix, list);
  return () => {
    const l = handlers.get(prefix);
    if (l)
      handlers.set(
        prefix,
        l.filter((h) => h !== handler),
      );
  };
}

function emit(type: string, payload: any) {
  for (const [prefix, list] of handlers) {
    if (type.startsWith(prefix)) {
      for (const h of list)
        h({
          type,
          payload,
          entityId: '',
          entityType: '',
          companyId: '',
          threadId: '',
          timestamp: Date.now(),
        });
    }
  }
}

vi.mock('../../runtime/offisim-runtime-context.js', () => ({
  useOffisimRuntime: () => ({ eventBus: { on: mockOn } }),
  useOffisimRuntimeStatus: () => ({ isRunning: true }),
}));

import { useSopRuntimeState } from '../../hooks/useSopRuntimeState.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSopRuntimeState', () => {
  beforeEach(() => {
    handlers.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null initially', () => {
    const { result } = renderHook(() => useSopRuntimeState());
    expect(result.current).toBeNull();
  });

  it('initializes step states on plan.created', () => {
    const { result } = renderHook(() => useSopRuntimeState());

    act(() => {
      emit('plan.created', {
        planId: 'p1',
        threadId: 't1',
        summary: 'test',
        steps: [
          { stepIndex: 0, description: 'step 0', tasks: [] },
          { stepIndex: 1, description: 'step 1', tasks: [] },
        ],
      } satisfies PlanCreatedPayload);
    });

    expect(result.current).toEqual([
      { stepIndex: 0, status: 'pending' },
      { stepIndex: 1, status: 'pending' },
    ]);
  });

  it('marks step active on plan.step.started', () => {
    const { result } = renderHook(() => useSopRuntimeState());

    act(() => {
      emit('plan.created', {
        planId: 'p1',
        threadId: 't1',
        summary: 'test',
        steps: [
          { stepIndex: 0, description: 's0', tasks: [] },
          { stepIndex: 1, description: 's1', tasks: [] },
        ],
      } satisfies PlanCreatedPayload);
    });

    act(() => {
      emit('plan.step.started', {
        planId: 'p1',
        stepIndex: 0,
        taskCount: 1,
      } satisfies PlanStepStartedPayload);
    });

    expect(result.current![0].status).toBe('active');
    expect(result.current![1].status).toBe('pending');
  });

  it('marks step completed on plan.step.completed', () => {
    const { result } = renderHook(() => useSopRuntimeState());

    act(() => {
      emit('plan.created', {
        planId: 'p1',
        threadId: 't1',
        summary: 'test',
        steps: [{ stepIndex: 0, description: 's0', tasks: [] }],
      } satisfies PlanCreatedPayload);
    });

    act(() => {
      emit('plan.step.completed', {
        planId: 'p1',
        stepIndex: 0,
        outputCount: 1,
      } satisfies PlanStepCompletedPayload);
    });

    expect(result.current![0].status).toBe('completed');
  });

  it('marks all completed on plan.completed', () => {
    const { result } = renderHook(() => useSopRuntimeState());

    act(() => {
      emit('plan.created', {
        planId: 'p1',
        threadId: 't1',
        summary: 'test',
        steps: [
          { stepIndex: 0, description: 's0', tasks: [] },
          { stepIndex: 1, description: 's1', tasks: [] },
        ],
      } satisfies PlanCreatedPayload);
    });

    act(() => {
      emit('plan.completed', { planId: 'p1', totalSteps: 2 } satisfies PlanCompletedPayload);
    });

    expect(result.current!.every((s) => s.status === 'completed')).toBe(true);
  });
});
