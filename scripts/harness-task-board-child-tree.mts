import assert from 'node:assert/strict';
import type { AgentEventRow, AgentRunRow } from '@offisim/core/browser';
import type { WorkspaceLeaseLifecycleRow } from '../apps/desktop/renderer/src/lib/tauri-commands.js';
import {
  WORKSPACE_LEASE_ACTION_EVENT,
  WORKSPACE_LEASE_SNAPSHOT_EVENT,
  buildProjectWorkspaceLeaseReviewRows,
  buildTaskTree,
  buildWorkspaceLeaseReviewRows,
  createWorkspaceLeaseDiffCache,
  filterTaskRows,
  flattenTaskRows,
  hydrateEventlessWorkspaceLeaseDiffs,
  workspaceLeaseReviewsQueryOptions,
} from '../apps/desktop/renderer/src/surfaces/office/board/task-board-data.js';

assert.deepEqual(
  workspaceLeaseReviewsQueryOptions(['project-b', 'project-a', 'project-b']).queryKey,
  ['workspace-lease-reviews', ['project-a', 'project-b']],
  'project and company lease reviews share one canonical sorted query factory',
);

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

function lifecycle(
  overrides: Partial<WorkspaceLeaseLifecycleRow> = {},
): WorkspaceLeaseLifecycleRow {
  return {
    leaseId: 'lease-1',
    projectId: 'project-a',
    threadId: 'chat-a',
    activeRootRunId: 'root-a',
    createdRootRunId: 'root-a',
    registeredRunId: 'child-a1',
    workspaceRoot: '/repo',
    cwd: '/repo/.offisim/worktrees/lease-1',
    branch: 'offisim/lease/child-a1-lease-1',
    createdAt: '2026-06-29T01:05:00.000Z',
    updatedAt: '2026-06-29T01:07:00.000Z',
    status: 'active',
    ownerBindingStatus: 'active',
    ...overrides,
  };
}

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
      status: 'pending_review',
      phase: 'planned',
      changedPaths: ['src/a.ts', 'src/b.ts'],
      files: [
        { path: 'src/a.ts', diff: 'diff --git a/src/a.ts b/src/a.ts' },
        { path: 'src/b.ts', diff: 'diff --git a/src/b.ts b/src/b.ts' },
      ],
      createdAt: '2026-06-29T01:05:00.000Z',
      conflicts: [],
      loopAttempt: 2,
      loopMaxAttempts: 3,
      verificationSummary: 'Exit 1\none test failed',
      verificationPassed: false,
      terminationReason: 'stuck',
      capturedAt: '2026-06-29T01:06:00.000Z',
    }),
    parent_event_id: null,
    created_at: '2026-06-29T01:06:00.000Z',
  },
  {
    event_id: 'evt-rework',
    project_id: 'project-a',
    thread_id: 'chat-a',
    company_id: 'co',
    agent_name: 'dev-1',
    event_type: WORKSPACE_LEASE_SNAPSHOT_EVENT,
    payload_json: JSON.stringify({
      rootRunId: 'root-a',
      runId: 'child-a2',
      leaseId: 'lease-1',
      status: 'active',
      phase: 'rework_started',
      capturedAt: '2026-06-29T01:06:30.000Z',
    }),
    parent_event_id: null,
    created_at: '2026-06-29T01:06:30.000Z',
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

const leases = buildWorkspaceLeaseReviewRows(
  [lifecycle({ status: 'released', ownerBindingStatus: 'completed' })],
  leaseEvents,
  'root-a',
);
assert.equal(leases.length, 1, 'durable lease row is enriched from agent_events');
assert.equal(leases[0]?.branch, 'offisim/lease/child-a1-lease-1');
assert.deepEqual(leases[0]?.changedPaths, ['src/a.ts', 'src/b.ts']);
assert.equal(leases[0]?.files.length, 2, 'per-file patch text survives later lifecycle snapshots');
assert.equal(leases[0]?.runId, 'child-a2', 'rework run remains associated with the same lease');
assert.equal(leases[0]?.status, 'merged', 'durable released status owns the terminal result');
assert.equal(leases[0]?.lastAction, 'merge_completed');
assert.equal(leases[0]?.loopAttempt, 2, 'loop attempt survives later lease events');
assert.equal(leases[0]?.loopMaxAttempts, 3);
assert.equal(leases[0]?.verificationSummary, 'Exit 1\none test failed');
assert.equal(leases[0]?.terminationReason, 'stuck', 'termination reason remains board-visible');

// Events explain why review is needed while durable terminal lease states remain
// authoritative over stale enrichment.
{
  const terminated = buildWorkspaceLeaseReviewRows(
    [lifecycle()],
    [
      {
        ...(leaseEvents[0] as AgentEventRow),
        event_id: 'evt-verify-terminated',
        payload_json: JSON.stringify({
          rootRunId: 'root-a',
          runId: 'child-a1',
          leaseId: 'lease-1',
          status: 'active',
          phase: 'verification_terminated',
          terminationReason: 'stuck',
          capturedAt: '2026-06-29T01:08:00.000Z',
        }),
        created_at: '2026-06-29T01:08:00.000Z',
      },
    ],
    'root-a',
  );
  assert.equal(
    terminated[0]?.status,
    'pending_review',
    'verification termination makes an otherwise-active durable lease reviewable',
  );
  assert.equal(terminated[0]?.phase, 'verification_terminated');
}

{
  const pending = buildProjectWorkspaceLeaseReviewRows(
    [lifecycle({ leaseId: 'lease-pending' })],
    [
      {
        ...(leaseEvents[0] as AgentEventRow),
        event_id: 'evt-pending-active-owner',
        payload_json: JSON.stringify({
          rootRunId: 'root-a',
          runId: 'child-a1',
          leaseId: 'lease-pending',
          status: 'pending_review',
          phase: 'pending_review',
        }),
      },
    ],
  );
  assert.equal(
    pending[0]?.status,
    'pending_review',
    'active owner accepts pending review event truth',
  );
}

{
  const planned = buildProjectWorkspaceLeaseReviewRows(
    [lifecycle({ leaseId: 'lease-planned' })],
    [
      {
        ...(leaseEvents[0] as AgentEventRow),
        event_id: 'evt-planned-active-owner',
        payload_json: JSON.stringify({
          rootRunId: 'root-a',
          runId: 'child-a1',
          leaseId: 'lease-planned',
          status: 'active',
          phase: 'planned',
        }),
      },
    ],
  );
  assert.equal(
    planned[0]?.status,
    'pending_review',
    'a completed integration plan makes an active durable lease reviewable',
  );
}

{
  const failedAction = buildProjectWorkspaceLeaseReviewRows(
    [lifecycle({ leaseId: 'lease-action-failed' })],
    [
      {
        ...(leaseEvents[0] as AgentEventRow),
        event_id: 'evt-action-failed',
        event_type: WORKSPACE_LEASE_ACTION_EVENT,
        payload_json: JSON.stringify({
          rootRunId: 'root-a',
          runId: 'child-a1',
          leaseId: 'lease-action-failed',
          action: 'merge_failed',
          status: 'active',
          error: 'conflict',
        }),
      },
    ],
  );
  assert.equal(failedAction[0]?.status, 'failed', 'failed review action remains Board-visible');
  assert.equal(failedAction[0]?.lastActionError, 'conflict');
}

{
  const replayedReview = buildProjectWorkspaceLeaseReviewRows(
    [lifecycle({ leaseId: 'lease-review-replay' })],
    [
      {
        ...(leaseEvents[0] as AgentEventRow),
        event_id: 'evt-review-replay',
        event_type: WORKSPACE_LEASE_ACTION_EVENT,
        payload_json: JSON.stringify({
          rootRunId: 'root-a',
          runId: 'child-a1',
          leaseId: 'lease-review-replay',
          action: 'review_steer_error',
          status: 'pending_review',
          review: {
            revision: 'diff-review-replay',
            decisions: { 'hunk-returned': 'returned' },
            annotations: [],
            appliedReturnAnchors: ['hunk-returned'],
          },
        }),
      },
    ],
  );
  assert.deepEqual(
    replayedReview[0]?.review?.appliedReturnAnchors,
    ['hunk-returned'],
    'app restart must retain returned patch anchors already applied before a failed steer',
  );
}

const crossRootReworkEvents: AgentEventRow[] = [
  leaseEvents[0] as AgentEventRow,
  {
    event_id: 'evt-cross-root-rework',
    project_id: 'project-a',
    thread_id: 'chat-b',
    company_id: 'co',
    agent_name: 'dev-1',
    event_type: WORKSPACE_LEASE_SNAPSHOT_EVENT,
    payload_json: JSON.stringify({
      rootRunId: 'root-b',
      runId: 'child-b1',
      originRunId: 'child-a1',
      leaseId: 'lease-1',
      status: 'active',
      phase: 'acquired',
      capturedAt: '2026-06-29T01:08:00.000Z',
    }),
    parent_event_id: null,
    created_at: '2026-06-29T01:08:00.000Z',
  },
  {
    event_id: 'evt-cross-root-review',
    project_id: 'project-a',
    thread_id: 'chat-b',
    company_id: 'co',
    agent_name: 'dev-1',
    event_type: WORKSPACE_LEASE_SNAPSHOT_EVENT,
    payload_json: JSON.stringify({
      rootRunId: 'root-b',
      runId: 'child-b1',
      leaseId: 'lease-1',
      status: 'pending_review',
      phase: 'pending_review',
      capturedAt: '2026-06-29T01:09:00.000Z',
    }),
    parent_event_id: null,
    created_at: '2026-06-29T01:09:00.000Z',
  },
];
const projectLeases = buildProjectWorkspaceLeaseReviewRows(
  [
    lifecycle({
      threadId: 'chat-b',
      activeRootRunId: 'root-b',
      ownerBindingStatus: 'completed',
    }),
  ],
  crossRootReworkEvents,
);
assert.equal(projectLeases.length, 1, 'one lease remains one state machine across root runs');
assert.equal(projectLeases[0]?.runId, 'child-b1', 'the rework run becomes the current lease run');
assert.equal(projectLeases[0]?.status, 'pending_review');
assert.deepEqual(
  projectLeases[0]?.relatedRunIds,
  ['child-a1', 'child-b1'],
  'the original task and rework run resolve to the same lease truth',
);
assert.deepEqual(projectLeases[0]?.relatedRootRunIds, ['root-a', 'root-b']);

const restartLifecycle = lifecycle({
  leaseId: 'lease-restart',
  registeredRunId: 'child-restart',
  cwd: '/repo/.offisim/worktrees/lease-restart',
  branch: 'offisim/lease/child-restart-lease-restart',
  ownerBindingStatus: 'app_restart',
});
const restartRows = buildProjectWorkspaceLeaseReviewRows([restartLifecycle], []);
assert.equal(restartRows.length, 1, 'zero-event active lease synthesizes a board row');
assert.equal(
  restartRows[0]?.status,
  'pending_review',
  'zero-event app_restart owner is retained for review',
);

const liveOwner = buildProjectWorkspaceLeaseReviewRows([lifecycle({ leaseId: 'lease-live' })], []);
assert.equal(liveOwner[0]?.status, 'active', 'live owner keeps its durable lease active');

const closedWithoutActionEvent = buildProjectWorkspaceLeaseReviewRows(
  [lifecycle({ leaseId: 'lease-closed', status: 'released', ownerBindingStatus: 'completed' })],
  [],
);
assert.equal(
  closedWithoutActionEvent[0]?.status,
  'merged',
  'backend close remains terminal when the action event append fails',
);

const staleActionableEvent: AgentEventRow = {
  ...(leaseEvents[0] as AgentEventRow),
  event_id: 'evt-stale-actionable',
  payload_json: JSON.stringify({
    rootRunId: 'root-a',
    runId: 'child-a1',
    leaseId: 'lease-closed',
    status: 'pending_review',
    phase: 'pending_review',
  }),
};
assert.equal(
  buildProjectWorkspaceLeaseReviewRows(
    [lifecycle({ leaseId: 'lease-closed', status: 'released' })],
    [staleActionableEvent],
  )[0]?.status,
  'merged',
  'durable terminal state overrides a stale actionable event',
);

let diffCollections = 0;
let diffNowUnixMs = 0;
const diffCache = createWorkspaceLeaseDiffCache(() => diffNowUnixMs);
const collectRestartDiff = async () => {
  diffCollections += 1;
  return {
    changedPaths: ['src/recovered.ts'],
    files: [{ path: 'src/recovered.ts', diff: 'diff --git recovered' }],
  };
};
const hydratedRestart = await hydrateEventlessWorkspaceLeaseDiffs(
  restartRows,
  [restartLifecycle],
  [],
  collectRestartDiff,
  diffCache,
);
assert.equal(diffCollections, 1, 'zero-event active lease collects its sandboxed Git diff');
assert.equal(
  hydratedRestart[0]?.files.length,
  1,
  'recovered active lease never falls through to a synthetic No patch state',
);
await hydrateEventlessWorkspaceLeaseDiffs(
  restartRows,
  [restartLifecycle],
  [],
  collectRestartDiff,
  diffCache,
);
assert.equal(diffCollections, 1, 'unchanged lease identity reuses its Git diff between 2s polls');
diffNowUnixMs += 6_000;
await hydrateEventlessWorkspaceLeaseDiffs(
  restartRows,
  [restartLifecycle],
  [],
  collectRestartDiff,
  diffCache,
);
assert.equal(diffCollections, 2, 'active lease diff refreshes after the bounded cache TTL');
const updatedRestartLifecycle = lifecycle({
  ...restartLifecycle,
  updatedAt: '2026-06-29T01:08:00.000Z',
});
await hydrateEventlessWorkspaceLeaseDiffs(
  buildProjectWorkspaceLeaseReviewRows([updatedRestartLifecycle], []),
  [updatedRestartLifecycle],
  [],
  collectRestartDiff,
  diffCache,
);
assert.equal(diffCollections, 3, 'updated durable lease identity invalidates the cached Git diff');

const liveDiffLifecycle = lifecycle({
  leaseId: 'lease-live-diff',
  registeredRunId: 'child-live-diff',
  cwd: '/repo/.offisim/worktrees/lease-live-diff',
  branch: 'offisim/lease/child-live-diff-lease-live-diff',
});
await hydrateEventlessWorkspaceLeaseDiffs(
  buildProjectWorkspaceLeaseReviewRows([liveDiffLifecycle], []),
  [liveDiffLifecycle],
  [],
  collectRestartDiff,
  diffCache,
);
assert.equal(diffCollections, 4, 'live lease establishes its active diff cache entry');
const reviewLifecycle = lifecycle({ ...liveDiffLifecycle, ownerBindingStatus: 'completed' });
const reviewRows = buildProjectWorkspaceLeaseReviewRows([reviewLifecycle], []);
assert.equal(reviewRows[0]?.status, 'pending_review');
await hydrateEventlessWorkspaceLeaseDiffs(
  reviewRows,
  [reviewLifecycle],
  [],
  collectRestartDiff,
  diffCache,
);
assert.equal(
  diffCollections,
  5,
  'active-to-review transition without a snapshot forces one final current diff',
);

const wrongProjectEvent: AgentEventRow = {
  ...(leaseEvents[0] as AgentEventRow),
  event_id: 'evt-project-b',
  project_id: 'project-b',
  payload_json: JSON.stringify({
    rootRunId: 'root-b',
    runId: 'child-b',
    leaseId: 'lease-restart',
    phase: 'pending_review',
    changedPaths: ['foreign.ts'],
  }),
};
const isolatedProject = buildProjectWorkspaceLeaseReviewRows(
  [restartLifecycle],
  [wrongProjectEvent],
);
assert.equal(isolatedProject[0]?.phase, null, 'foreign Project events cannot enrich the lease');
assert.deepEqual(isolatedProject[0]?.changedPaths, [], 'Project scope prevents event diff leakage');

console.log('✓ task-board-child-tree: root expansion and child metadata checks passed');
