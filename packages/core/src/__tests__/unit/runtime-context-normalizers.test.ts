import type { InteractionRequest } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import {
  deriveRecommendedFocus,
  normalizeActiveTaskRuns,
  normalizeNodeSummaries,
  normalizePendingInteraction,
} from '../../semantics/runtime-context-normalizers.js';

const makeInteraction = (
  overrides: Partial<InteractionRequest> = {},
): InteractionRequest => ({
  interactionId: 'ix-1',
  threadId: 'thread-1',
  companyId: 'co-1',
  kind: 'permission_request',
  severity: 'normal',
  title: 'Allow tool X',
  prompt: 'The employee wants to use tool X',
  options: [],
  allowFreeformResponse: false,
  createdAt: Date.now(),
  ...overrides,
});

describe('normalizePendingInteraction', () => {
  it('returns null for null input', () => {
    expect(normalizePendingInteraction(null)).toBeNull();
  });

  it('extracts the expected fields', () => {
    const request = makeInteraction({
      kind: 'plan_review',
      severity: 'high',
      title: 'Review the plan',
      employeeId: 'emp-1',
      taskRunId: 'tr-1',
    });
    const result = normalizePendingInteraction(request);
    expect(result).toEqual({
      kind: 'plan_review',
      severity: 'high',
      title: 'Review the plan',
      employeeId: 'emp-1',
      taskRunId: 'tr-1',
    });
  });

  it('defaults employeeId and taskRunId to null when undefined', () => {
    const request = makeInteraction();
    const result = normalizePendingInteraction(request);
    expect(result?.employeeId).toBeNull();
    expect(result?.taskRunId).toBeNull();
  });
});

describe('normalizeActiveTaskRuns', () => {
  const running = {
    task_run_id: 'tr-1',
    employee_id: 'emp-1',
    task_type: 'code',
    status: 'running',
  };
  const queued = {
    task_run_id: 'tr-2',
    employee_id: 'emp-2',
    task_type: 'review',
    status: 'queued',
  };
  const completed = {
    task_run_id: 'tr-3',
    employee_id: 'emp-3',
    task_type: 'test',
    status: 'completed',
  };
  const waiting = {
    task_run_id: 'tr-4',
    employee_id: null,
    task_type: 'deploy',
    status: 'waiting_input',
  };
  const planned = {
    task_run_id: 'tr-5',
    employee_id: 'emp-5',
    task_type: 'code',
    status: 'planned',
    started_at: '2026-04-05T10:00:00Z',
  };

  it('prefers active task runs', () => {
    const result = normalizeActiveTaskRuns([completed, running, queued]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.status)).toEqual(
      expect.arrayContaining(['running', 'queued']),
    );
  });

  it('falls back to most recent completed if no active runs exist', () => {
    const result = normalizeActiveTaskRuns([completed]);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('completed');
  });

  it('returns empty array for empty input', () => {
    expect(normalizeActiveTaskRuns([])).toEqual([]);
  });

  it('respects limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...running,
      task_run_id: `tr-${i}`,
    }));
    expect(normalizeActiveTaskRuns(many, 3)).toHaveLength(3);
  });

  it('includes waiting_input as active', () => {
    const result = normalizeActiveTaskRuns([completed, waiting]);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('waiting_input');
  });

  it('includes planned/created/routed as active pre-dispatch states', () => {
    const created = { ...planned, task_run_id: 'tr-6', status: 'created' };
    const routed = { ...planned, task_run_id: 'tr-7', status: 'routed' };
    const result = normalizeActiveTaskRuns([completed, planned, created, routed]);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.status)).toEqual(
      expect.arrayContaining(['planned', 'created', 'routed']),
    );
  });

  it('sorts by started_at descending', () => {
    const older = { ...running, task_run_id: 'tr-old', started_at: '2026-04-05T08:00:00Z' };
    const newer = { ...running, task_run_id: 'tr-new', started_at: '2026-04-05T12:00:00Z' };
    const result = normalizeActiveTaskRuns([older, newer]);
    expect(result[0]?.taskRunId).toBe('tr-new');
    expect(result[1]?.taskRunId).toBe('tr-old');
  });

  it('completed fallback picks most recent by started_at', () => {
    const old = { ...completed, task_run_id: 'tr-old', started_at: '2026-04-05T08:00:00Z' };
    const recent = { ...completed, task_run_id: 'tr-recent', started_at: '2026-04-05T12:00:00Z' };
    const result = normalizeActiveTaskRuns([old, recent], 1);
    expect(result[0]?.taskRunId).toBe('tr-recent');
  });
});

describe('normalizeNodeSummaries', () => {
  const summary1 = {
    node_name: 'boss',
    employee_id: null,
    step_index: null,
    summary_text: 'Boss routed to delegate_manager.',
  };
  const summary2 = {
    node_name: 'employee',
    employee_id: 'emp-1',
    step_index: 0,
    summary_text: 'Employee completed step 0.',
  };

  it('maps fields correctly', () => {
    const result = normalizeNodeSummaries([summary1, summary2]);
    expect(result).toEqual([
      {
        nodeName: 'boss',
        employeeId: null,
        stepIndex: null,
        summaryText: 'Boss routed to delegate_manager.',
      },
      {
        nodeName: 'employee',
        employeeId: 'emp-1',
        stepIndex: 0,
        summaryText: 'Employee completed step 0.',
      },
    ]);
  });

  it('respects limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      ...summary1,
      node_name: `node-${i}`,
    }));
    expect(normalizeNodeSummaries(many, 3)).toHaveLength(3);
  });

  it('returns empty for empty input', () => {
    expect(normalizeNodeSummaries([])).toEqual([]);
  });
});

describe('deriveRecommendedFocus', () => {
  it('prioritizes pending permission request', () => {
    const pending = normalizePendingInteraction(makeInteraction({ kind: 'permission_request' }));
    const result = deriveRecommendedFocus(pending, [], []);
    expect(result).toBe('Waiting for user approval before proceeding.');
  });

  it('prioritizes pending plan review', () => {
    const pending = normalizePendingInteraction(makeInteraction({ kind: 'plan_review' }));
    const result = deriveRecommendedFocus(pending, [], []);
    expect(result).toBe('Waiting for plan review before execution.');
  });

  it('prioritizes pending agent question', () => {
    const pending = normalizePendingInteraction(makeInteraction({ kind: 'agent_question' }));
    const result = deriveRecommendedFocus(pending, [], []);
    expect(result).toBe('Waiting for user clarification.');
  });

  it('reports blocked tasks when no pending interaction', () => {
    const tasks = [
      { taskRunId: 'tr-1', employeeId: null, taskType: 'code', status: 'waiting_input' },
      { taskRunId: 'tr-2', employeeId: null, taskType: 'code', status: 'waiting_dependency' },
    ];
    const result = deriveRecommendedFocus(null, tasks, []);
    expect(result).toBe('2 tasks blocked, waiting for input or dependencies.');
  });

  it('reports running tasks', () => {
    const tasks = [
      { taskRunId: 'tr-1', employeeId: 'emp-1', taskType: 'code', status: 'running' },
    ];
    const result = deriveRecommendedFocus(null, tasks, []);
    expect(result).toBe('1 task currently executing.');
  });

  it('reports planned tasks awaiting dispatch', () => {
    const tasks = [
      { taskRunId: 'tr-1', employeeId: 'emp-1', taskType: 'code', status: 'planned' },
      { taskRunId: 'tr-2', employeeId: 'emp-2', taskType: 'review', status: 'routed' },
    ];
    const result = deriveRecommendedFocus(null, tasks, []);
    expect(result).toBe('2 tasks planned, awaiting dispatch.');
  });

  it('falls back to last node summary', () => {
    const summaries = [
      { nodeName: 'employee', employeeId: 'emp-1', stepIndex: 2, summaryText: 'Done.' },
    ];
    const result = deriveRecommendedFocus(null, [], summaries);
    expect(result).toBe('Last completed: employee step 2.');
  });

  it('returns null when everything is empty', () => {
    expect(deriveRecommendedFocus(null, [], [])).toBeNull();
  });
});
