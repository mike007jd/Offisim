import { describe, expect, it } from 'vitest';
import {
  employeeStateChanged,
  meetingStateChanged,
  taskAssignmentChanged,
  taskStateChanged,
} from '../../events/event-factories.js';

describe('event factories', () => {
  it('employeeStateChanged', () => {
    const event = employeeStateChanged('c-1', 'e-1', 'idle', 'thinking', 't-1', 'tr-1');
    expect(event.type).toBe('employee.state.changed');
    expect(event.entityType).toBe('employee');
    expect(event.entityId).toBe('e-1');
    expect(event.companyId).toBe('c-1');
    expect(event.threadId).toBe('t-1');
    expect(event.payload.prev).toBe('idle');
    expect(event.payload.next).toBe('thinking');
    expect(event.payload.taskRunId).toBe('tr-1');
    expect(event.timestamp).toBeGreaterThan(0);
  });

  it('taskStateChanged', () => {
    const event = taskStateChanged('c-1', 'tr-1', 'queued', 'active', 't-1', 'e-1');
    expect(event.type).toBe('task.state.changed');
    expect(event.entityType).toBe('task');
    expect(event.payload.prev).toBe('queued');
    expect(event.payload.next).toBe('active');
  });

  it('taskAssignmentChanged', () => {
    const event = taskAssignmentChanged('c-1', 'tr-1', 'e-1', 'assigned', 't-1');
    expect(event.type).toBe('task.assignment.changed');
    expect(event.payload.action).toBe('assigned');
  });

  it('meetingStateChanged', () => {
    const event = meetingStateChanged('c-1', 'm-1', 'scheduled', 'active', ['e-1', 'e-2'], 't-1');
    expect(event.type).toBe('meeting.state.changed');
    expect(event.entityType).toBe('meeting');
    expect(event.payload.participantIds).toEqual(['e-1', 'e-2']);
  });
});
