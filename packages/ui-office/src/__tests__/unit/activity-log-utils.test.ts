import type { RuntimeEvent } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import {
  getActivityActorLabel,
  getAvailableActorFilters,
  getEventId,
  matchesActorFilters,
} from '../../components/events/workspace/activity-log-utils.js';

function makeEvent(
  overrides: Partial<RuntimeEvent<Record<string, unknown>>> = {},
): RuntimeEvent<Record<string, unknown>> {
  return {
    type: 'employee.created',
    timestamp: Date.now(),
    companyId: 'co-1',
    entityId: 'emp-1',
    entityType: 'employee',
    payload: {},
    ...overrides,
  };
}

describe('activity-log actor helpers', () => {
  it('prefers explicit employee names from payload', () => {
    const event = makeEvent({
      payload: { employeeName: 'Aria Patel' },
    });

    expect(getActivityActorLabel(event)).toBe('Aria Patel');
  });

  it('falls back to entity identity when no human-friendly name exists', () => {
    const event = makeEvent({
      entityId: 'plan-42',
      entityType: 'plan',
      payload: {},
    });

    expect(getActivityActorLabel(event)).toBe('plan:plan-42');
  });

  it('returns unique sorted actor options', () => {
    const events = [
      makeEvent({ payload: { employeeName: 'Sam Rivera' } }),
      makeEvent({ payload: { employeeName: 'Aria Patel' }, entityId: 'emp-2' }),
      makeEvent({ payload: { employeeName: 'Sam Rivera' }, entityId: 'emp-3' }),
    ];

    expect(getAvailableActorFilters(events)).toEqual(['Aria Patel', 'Sam Rivera']);
  });

  it('matches events against actor filters using the derived actor label', () => {
    const event = makeEvent({ payload: { employeeName: 'Leo Chen' } });

    expect(matchesActorFilters(event, [])).toBe(true);
    expect(matchesActorFilters(event, ['Leo Chen'])).toBe(true);
    expect(matchesActorFilters(event, ['Sam Rivera'])).toBe(false);
  });
});

describe('getEventId', () => {
  it('distinguishes events that share timestamp + entityId but have different types', () => {
    // Regression for R1: recorded-call.ts emits llm.call.completed and
    // llm.usage.recorded synchronously, back-to-back, both using the same
    // llmCallId as entityId. Their Date.now() calls land on the same
    // millisecond, so (timestamp, entityId) alone is not a unique identity
    // and React key collisions occur in ActivityTimeGroup.
    const callCompleted = makeEvent({
      type: 'llm.call.completed',
      entityId: 'lc-abc123',
      timestamp: 1_700_000_000_000,
    });
    const usageRecorded = makeEvent({
      type: 'llm.usage.recorded',
      entityId: 'lc-abc123',
      timestamp: 1_700_000_000_000,
    });

    expect(getEventId(callCompleted)).not.toBe(getEventId(usageRecorded));
  });

  it('is stable for the same event (round-trip identity)', () => {
    const event = makeEvent({
      type: 'task.started',
      entityId: 'task-7',
      timestamp: 1_700_000_000_000,
    });
    expect(getEventId(event)).toBe(getEventId(event));
  });
});
