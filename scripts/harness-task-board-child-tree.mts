import assert from 'node:assert/strict';
import type { AgentEventRow, AgentRunRow } from '@offisim/core/browser';
import {
  WORKSPACE_LEASE_ACTION_EVENT,
  WORKSPACE_LEASE_SNAPSHOT_EVENT,
  buildWorkspaceLeaseReviewRows,
  buildTaskTree,
  filterTaskRows,
  flattenTaskRows,
} from '../apps/desktop/renderer/src/surfaces/tasks/task-board-data.js';

const rows: AgentRunRow[] = [
  {
    run_id: 'root-a',
    thread_id: 'chat-a',
    company_id: 'co',
    project_id: 'project-a',
    parent_run_id: null,
    root_run_id: 'root-a',
    employee_id: 'lead',
    relation: null,
    work_kind: null,
    failure_kind: null,
    objective: 'Build export flow',
    access: 'write',
    status: 'running',
    usage_json: null,
    result_summary_json: null,
    session_file: '/sessions/root-a.jsonl',
    runtime_context_json: null,
    started_at: '2026-06-29T01:00:00.000Z',
    finished_at: null,
  },
  {
    run_id: 'child-a1',
    thread_id: 'chat-a',
    company_id: 'co',
    project_id: 'project-a',
    parent_run_id: 'root-a',
    root_run_id: 'root-a',
    employee_id: 'dev-1',
    relation: 'delegate',
    work_kind: 'implement',
    failure_kind: null,
    objective: 'Implement writer',
    access: 'write',
    status: 'completed',
    usage_json: JSON.stringify({ totalTokens: 1200 }),
    result_summary_json: JSON.stringify({ summary: 'Writer finished' }),
    session_file: null,
    runtime_context_json: null,
    started_at: '2026-06-29T01:01:00.000Z',
    finished_at: '2026-06-29T01:05:00.000Z',
  },
  {
    run_id: 'child-a2',
    thread_id: 'chat-a',
    company_id: 'co',
    project_id: 'project-a',
    parent_run_id: 'root-a',
    root_run_id: 'root-a',
    employee_id: 'reviewer',
    relation: 'review',
    work_kind: 'review',
    failure_kind: null,
    objective: 'Review writer',
    access: 'read',
    status: 'running',
    usage_json: null,
    result_summary_json: null,
    session_file: null,
    runtime_context_json: null,
    started_at: '2026-06-29T01:02:00.000Z',
    finished_at: null,
  },
];

const tree = buildTaskTree(rows);
assert.equal(tree.length, 1, 'only root rows are top-level');
assert.equal(tree[0]?.projectId, 'project-a');
assert.equal(tree[0]?.children.length, 2, 'root has two child rows');
assert.equal(tree[0]?.children[0]?.runId, 'child-a2', 'running child sorts before completed');
assert.equal(tree[0]?.children[0]?.relation, 'review');
assert.equal(tree[0]?.children[0]?.access, 'read');

const collapsed = flattenTaskRows(tree, new Set());
assert.deepEqual(
  collapsed.map((item) => item.row.runId),
  ['root-a'],
);

const expanded = flattenTaskRows(tree, new Set(['root-a']));
assert.deepEqual(
  expanded.map((item) => `${item.level}:${item.row.runId}`),
  ['0:root-a', '1:child-a2', '1:child-a1'],
);

const childMatch = filterTaskRows(tree, { status: 'all', search: 'reviewer' });
assert.equal(childMatch.length, 1, 'search matches child employee');
assert.equal(childMatch[0]?.runId, 'root-a', 'matching child keeps root visible');
const visibleRunIdsForSearch = (search: string) =>
  flattenTaskRows(filterTaskRows(tree, { status: 'all', search }), new Set()).map(
    (item) => item.row.runId,
  );
assert.deepEqual(
  visibleRunIdsForSearch('reviewer'),
  ['root-a', 'child-a2'],
  'searching a child employee auto-expands the matching child row',
);
assert.deepEqual(
  visibleRunIdsForSearch('running'),
  ['root-a', 'child-a2'],
  'mixed root and child search match still auto-expands the matching child row',
);
assert.deepEqual(
  visibleRunIdsForSearch('review'),
  ['root-a', 'child-a2'],
  'searching a child relation auto-expands the matching child row',
);
assert.deepEqual(
  visibleRunIdsForSearch('read'),
  ['root-a', 'child-a2'],
  'searching a child access mode auto-expands the matching child row',
);
assert.deepEqual(
  visibleRunIdsForSearch('writer'),
  ['root-a', 'child-a2', 'child-a1'],
  'searching a child objective auto-expands all matching child rows in task order',
);
assert.deepEqual(
  visibleRunIdsForSearch('export flow'),
  ['root-a'],
  'root-only search match stays collapsed',
);
assert.deepEqual(
  visibleRunIdsForSearch('chat-a'),
  ['root-a'],
  'thread/root-only search match stays collapsed',
);
assert.deepEqual(
  flattenTaskRows(tree, new Set()).map((item) => item.row.runId),
  ['root-a'],
  'clearing search restores the collapsed tree',
);

const leaseEvents: AgentEventRow[] = [
  {
    event_id: 'evt-1',
    project_id: 'project-a',
    thread_id: 'chat-a',
    company_id: 'co',
    agent_name: 'dev-1',
    event_type: WORKSPACE_LEASE_SNAPSHOT_EVENT,
    payload_json: JSON.stringify({
      rootRunId: 'root-a',
      runId: 'child-a1',
      leaseId: 'lease-1',
      projectId: 'project-a',
      workspaceRoot: '/repo',
      access: 'write',
      cwd: '/repo/.offisim/worktrees/lease-1',
      branch: 'offisim/lease/child-a1-lease-1',
      isolated: true,
      status: 'pending_merge',
      phase: 'planned',
      changedPaths: ['src/a.ts', 'src/b.ts'],
      conflicts: [],
      capturedAt: '2026-06-29T01:06:00.000Z',
    }),
    parent_event_id: null,
    created_at: '2026-06-29T01:06:00.000Z',
  },
  {
    event_id: 'evt-2',
    project_id: 'project-a',
    thread_id: 'chat-a',
    company_id: 'co',
    agent_name: 'workspace-lease-review',
    event_type: WORKSPACE_LEASE_ACTION_EVENT,
    payload_json: JSON.stringify({
      rootRunId: 'root-a',
      runId: 'child-a1',
      leaseId: 'lease-1',
      action: 'merge_completed',
      status: 'merged',
      createdAt: '2026-06-29T01:07:00.000Z',
    }),
    parent_event_id: null,
    created_at: '2026-06-29T01:07:00.000Z',
  },
];

const leases = buildWorkspaceLeaseReviewRows(leaseEvents, 'root-a');
assert.equal(leases.length, 1, 'lease snapshot is restored from agent_events');
assert.equal(leases[0]?.branch, 'offisim/lease/child-a1-lease-1');
assert.deepEqual(leases[0]?.changedPaths, ['src/a.ts', 'src/b.ts']);
assert.equal(leases[0]?.status, 'merged', 'action event updates current lease status');
assert.equal(leases[0]?.lastAction, 'merge_completed');

console.log('✓ task-board-child-tree: root expansion and child metadata checks passed');
