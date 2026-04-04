import type { RuntimeEvent, TaskStatePayload } from '@offisim/shared-types';
import { describe, expect, it, vi } from 'vitest';

/**
 * Tests the task.state.changed fallback logic extracted from useOffice3DViewState.
 *
 * The fallback path fires when sceneIntentBus is absent. Previously it expected
 * { taskState: 'active', assignedTo }, which never matched canonical TaskStatePayload.
 * After the fix it reads { prev, next, employeeId } and matches next === 'running'.
 */

type PayloadShape = { prev?: string; next?: string; employeeId?: string };

function simulateFallback(event: RuntimeEvent<TaskStatePayload>): string | null | false {
  const payload = event.payload as PayloadShape | undefined;
  if (payload?.next !== 'running') {
    return false; // filtered out
  }
  return payload.employeeId ?? null;
}

function makeTaskStateEvent(
  next: string,
  employeeId?: string,
): RuntimeEvent<TaskStatePayload> {
  return {
    type: 'task.state.changed',
    entityId: 'tr-1',
    entityType: 'task',
    companyId: 'co-1',
    timestamp: Date.now(),
    payload: {
      taskRunId: 'tr-1',
      prev: 'queued',
      next: next as TaskStatePayload['next'],
      employeeId,
    },
  };
}

describe('useOffice3DViewState task.state.changed fallback', () => {
  it('triggers flow line when next is running', () => {
    const result = simulateFallback(makeTaskStateEvent('running', 'emp-1'));
    expect(result).toBe('emp-1');
  });

  it('returns null employeeId when not provided', () => {
    const result = simulateFallback(makeTaskStateEvent('running'));
    expect(result).toBeNull();
  });

  it('filters out non-running states', () => {
    expect(simulateFallback(makeTaskStateEvent('queued', 'emp-1'))).toBe(false);
    expect(simulateFallback(makeTaskStateEvent('completed', 'emp-1'))).toBe(false);
    expect(simulateFallback(makeTaskStateEvent('planned', 'emp-1'))).toBe(false);
    expect(simulateFallback(makeTaskStateEvent('failed', 'emp-1'))).toBe(false);
  });

  it('does NOT match the old broken shape { taskState: active }', () => {
    // Verify that the old shape would NOT trigger the new logic
    const oldEvent = {
      type: 'task.state.changed',
      entityId: 'tr-1',
      entityType: 'task' as const,
      companyId: 'co-1',
      timestamp: Date.now(),
      payload: { taskState: 'active', assignedTo: 'emp-1' },
    } as unknown as RuntimeEvent<TaskStatePayload>;
    // next is undefined in the old shape, so it should be filtered
    expect(simulateFallback(oldEvent)).toBe(false);
  });
});
