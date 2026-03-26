import { describe, expect, it } from 'vitest';
import { planCreated } from '../../events/event-factories.js';

describe('planCreated (enriched)', () => {
  it('includes summary and task details in payload', () => {
    const event = planCreated('c1', 'plan-1', 'thread-1', 'Test plan', [
      {
        stepIndex: 0,
        description: 'Step one',
        taskCount: 2,
        tasks: [
          {
            taskRunId: 'tr-1',
            taskType: 'research',
            description: 'Research AI',
            employeeId: 'emp-a',
          },
          {
            taskRunId: 'tr-2',
            taskType: 'writing',
            description: 'Write report',
            employeeId: 'emp-b',
          },
        ],
      },
    ]);

    expect(event.type).toBe('plan.created');
    expect(event.payload.summary).toBe('Test plan');
    expect(event.payload.steps).toHaveLength(1);
    expect(event.payload.steps[0]?.tasks).toHaveLength(2);
    expect(event.payload.steps[0]?.tasks[0]?.taskRunId).toBe('tr-1');
    expect(event.payload.steps[0]?.tasks[0]?.description).toBe('Research AI');
    expect(event.payload.steps[0]?.taskCount).toBe(2);
  });
});
