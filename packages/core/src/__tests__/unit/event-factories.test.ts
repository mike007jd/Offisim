import { describe, expect, it } from 'vitest';
import {
  employeeStateChanged,
  handoffCompleted,
  handoffInitiated,
  meetingActionCreated,
  meetingStateChanged,
  memoryAccessed,
  memoryCreated,
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
    const event = taskStateChanged('c-1', 'tr-1', 'queued', 'running', 't-1', 'e-1');
    expect(event.type).toBe('task.state.changed');
    expect(event.entityType).toBe('task');
    expect(event.payload.prev).toBe('queued');
    expect(event.payload.next).toBe('running');
  });

  it('taskAssignmentChanged', () => {
    const event = taskAssignmentChanged('c-1', 'tr-1', 'e-1', 'assigned', 't-1');
    expect(event.type).toBe('task.assignment.changed');
    expect(event.payload.action).toBe('assigned');
  });

  it('meetingStateChanged', () => {
    const event = meetingStateChanged('c-1', 'm-1', 'scheduled', 'running', ['e-1', 'e-2'], 't-1');
    expect(event.type).toBe('meeting.state.changed');
    expect(event.entityType).toBe('meeting');
    expect(event.payload.participantIds).toEqual(['e-1', 'e-2']);
  });
});

describe('P2 event factories', () => {
  it('meetingActionCreated produces correct event', () => {
    const e = meetingActionCreated('co-1', 'mtg-1', 'tr-1', 'Implement auth', 'emp-bob', 'high', [
      'tr-0',
    ]);
    expect(e.type).toBe('meeting.action.created');
    expect(e.entityType).toBe('task');
    expect(e.payload.meetingId).toBe('mtg-1');
    expect(e.payload.assigneeEmployeeId).toBe('emp-bob');
    expect(e.payload.dependsOn).toEqual(['tr-0']);
  });

  it('handoffInitiated produces correct event', () => {
    const e = handoffInitiated('co-1', 'ho-1', 'th-1', 'emp-a', 'emp-b', 'needs expertise', 'tr-1');
    expect(e.type).toBe('handoff.initiated');
    expect(e.payload.fromEmployeeId).toBe('emp-a');
    expect(e.payload.toEmployeeId).toBe('emp-b');
  });

  it('handoffCompleted produces correct event', () => {
    const e = handoffCompleted('co-1', 'ho-1', 'emp-b', 'tr-1', 'th-1');
    expect(e.type).toBe('handoff.completed');
    expect(e.payload.toEmployeeId).toBe('emp-b');
  });

  it('memoryCreated produces correct event', () => {
    const e = memoryCreated(
      'co-1',
      'mem-1',
      'emp-bob',
      'employee',
      'experience',
      'JWT is better',
      'th-1',
    );
    expect(e.type).toBe('memory.created');
    expect(e.payload.scope).toBe('employee');
  });

  it('memoryAccessed produces correct event', () => {
    const e = memoryAccessed('co-1', 'mem-1', 'emp-bob', 'auth patterns', 'th-1');
    expect(e.type).toBe('memory.accessed');
    expect(e.payload.query).toBe('auth patterns');
  });
});
