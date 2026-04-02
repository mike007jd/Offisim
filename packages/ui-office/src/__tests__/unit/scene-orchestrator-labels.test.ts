import { describe, expect, it } from 'vitest';
import {
  describeEmployeeEscalation,
  describeInteractionSceneRequest,
  describeInteractionSceneResolution,
  describeWorkingToolActivity,
} from '../../hooks/useSceneOrchestrator';

describe('describeWorkingToolActivity', () => {
  it('maps started tool categories to working-stage bubble text', () => {
    expect(
      describeWorkingToolActivity({
        toolName: 'search_code',
        serverName: 'github',
        status: 'started',
      }),
    ).toBe('Searching code...');
    expect(
      describeWorkingToolActivity({
        toolName: 'read_file',
        status: 'started',
      }),
    ).toBe('Reading files...');
    expect(
      describeWorkingToolActivity({
        toolName: 'apply_patch',
        status: 'started',
      }),
    ).toBe('Editing workspace...');
    expect(
      describeWorkingToolActivity({
        toolName: 'bash',
        status: 'started',
      }),
    ).toBe('Running shell task...');
  });

  it('maps completed and blocked tool activity to concise scene feedback', () => {
    expect(
      describeWorkingToolActivity({
        toolName: 'fetch_file',
        serverName: 'github',
        status: 'completed',
      }),
    ).toBe('Files reviewed');
    expect(
      describeWorkingToolActivity({
        toolName: 'search_code',
        serverName: 'github',
        status: 'denied',
        errorType: 'TOOL_PERMISSION_REQUIRED',
      }),
    ).toBe('Waiting on approval...');
    expect(
      describeWorkingToolActivity({
        toolName: 'bash',
        status: 'error',
      }),
    ).toBe('Tool step failed');
  });

  it('describes pending and restored interaction states in scene language', () => {
    expect(describeInteractionSceneRequest({ kind: 'permission_request' })).toBe(
      'Waiting for approval...',
    );
    expect(describeInteractionSceneRequest({ kind: 'plan_review' }, true)).toBe(
      'Plan review restored',
    );
    expect(describeInteractionSceneRequest({ kind: 'agent_question' })).toBe(
      'Waiting for clarification...',
    );
  });

  it('describes interaction outcomes and employee escalation clearly', () => {
    expect(
      describeInteractionSceneResolution({
        request: { kind: 'permission_request' },
        response: { selectedOptionId: 'approve_once' },
      }),
    ).toBe('Approval received');
    expect(
      describeInteractionSceneResolution({
        request: { kind: 'plan_review' },
        response: { selectedOptionId: 'revise_plan' },
      }),
    ).toBe('Revising the plan...');
    expect(describeEmployeeEscalation('Ava', 'blocked')).toBe('Ava is blocked');
    expect(describeEmployeeEscalation('Ava', 'failed')).toBe('Ava hit a failure');
  });
});
