import { describe, it, expect } from 'vitest';
import {
  planCreated,
  planStepStarted,
  planStepCompleted,
  planCompleted,
  mcpServerConnected,
  mcpToolCalled,
} from '../../events/event-factories.js';

describe('plan event factories', () => {
  it('planCreated produces correct event', () => {
    const e = planCreated('co1', 'plan-1', 'th-1', [
      { stepIndex: 0, description: 'research', taskCount: 2 },
    ]);
    expect(e.type).toBe('plan.created');
    expect(e.entityType).toBe('plan');
    expect(e.entityId).toBe('plan-1');
    expect(e.companyId).toBe('co1');
    expect(e.threadId).toBe('th-1');
    expect(e.payload.planId).toBe('plan-1');
    expect(e.payload.steps).toHaveLength(1);
    expect(e.payload.steps[0]!.taskCount).toBe(2);
  });

  it('planStepStarted produces correct event', () => {
    const e = planStepStarted('co1', 'plan-1', 0, 3, 'th-1');
    expect(e.type).toBe('plan.step.started');
    expect(e.payload.stepIndex).toBe(0);
    expect(e.payload.taskCount).toBe(3);
  });

  it('planStepCompleted produces correct event', () => {
    const e = planStepCompleted('co1', 'plan-1', 0, 2, 'th-1');
    expect(e.type).toBe('plan.step.completed');
    expect(e.payload.outputCount).toBe(2);
  });

  it('planCompleted produces correct event', () => {
    const e = planCompleted('co1', 'plan-1', 3, 'th-1');
    expect(e.type).toBe('plan.completed');
    expect(e.payload.totalSteps).toBe(3);
  });

  it('mcpServerConnected produces correct event', () => {
    const e = mcpServerConnected('co1', 'fs-server', 5);
    expect(e.type).toBe('mcp.server.connected');
    expect(e.entityType).toBe('mcp');
    expect(e.entityId).toBe('fs-server');
    expect(e.payload.toolCount).toBe(5);
  });

  it('mcpToolCalled produces correct event', () => {
    const e = mcpToolCalled('co1', 'fs-server', 'read_file', 'emp-1', 'th-1');
    expect(e.type).toBe('mcp.tool.called');
    expect(e.entityId).toBe('fs-server/read_file');
    expect(e.payload.serverName).toBe('fs-server');
    expect(e.payload.employeeId).toBe('emp-1');
  });
});
