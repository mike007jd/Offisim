import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}/${path}`, 'utf8');
const schemaSql = read('packages/db-local/src/schema.sql');
const actions = read('apps/desktop/renderer/src/surfaces/office/board/competitive-draft-actions.ts');
const runtime = read('apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts');
const piChildSupervisor = read('scripts/pi-child-supervisor.mjs');
const conversationController = read(
  'apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.ts',
);
const employeePersona = read('apps/desktop/renderer/src/data/employee-persona.ts');
const gitWorktreeOps = read(
  'apps/desktop/renderer/src/runtime/mission/workspace/git-worktree-ops.ts',
);
const review = read('apps/desktop/renderer/src/surfaces/office/board/ReviewWorkbenchStage.tsx');
const dialog = read('apps/desktop/renderer/src/surfaces/office/board/CompetitiveDraftDialog.tsx');
const board = read('apps/desktop/renderer/src/surfaces/office/board/BoardStage.tsx');
const stage = read('apps/desktop/renderer/src/surfaces/office/stage-viewer/StageViewer.tsx');
const uiState = read('apps/desktop/renderer/src/app/ui-state.ts');
const recovery = read('apps/desktop/renderer/src/runtime/recovery/reconcile-interrupted-runs.ts');
const recoveryHook = read('apps/desktop/renderer/src/runtime/recovery/useInterruptedRunRecovery.ts');
const gitBackend = read('apps/desktop/src-tauri/src/git/lease.rs');
const codexHost = read('apps/desktop/src-tauri/src/codex_agent_host/manager.rs');
const claudeHost = read('apps/desktop/src-tauri/src/claude_agent_host/mod.rs');

let checks = 0;
function check(value: unknown, message: string): asserts value {
  assert.ok(value, message);
  checks += 1;
}
function locate(source: string, needle: string, message: string): number {
  const at = source.indexOf(needle);
  check(at >= 0, message);
  return at;
}

function insertRun(
  db: Database.Database,
  runId: string,
  threadId: string,
  employeeId: string | null,
): void {
  db.prepare(`INSERT INTO agent_runs (
    run_id, thread_id, company_id, project_id, parent_run_id, root_run_id,
    employee_id, relation, work_kind, objective, access, failure_kind, status,
    usage_json, result_summary_json, session_file, runtime_context_json, started_at, finished_at
  ) VALUES (?, ?, 'company-1', 'project-1', NULL, ?, ?, NULL, 'implement',
    'Build the same feature', 'write', NULL, 'running', NULL, NULL, NULL, NULL,
    '2026-07-18T00:00:00.000Z', NULL)`).run(runId, threadId, runId, employeeId);
}

function insertBinding(
  db: Database.Database,
  bindingId: string,
  requestId: string,
  runId: string,
  threadId: string,
): void {
  db.prepare(`INSERT INTO task_workspace_binding_history (
    binding_id, company_id, project_id, thread_id, turn_id, request_id, access,
    canonical_root, root_identity_json, workspace_basename_normalized,
    project_name_normalized, workspace_anchor, git_origin_digest,
    recovery_witness_binding_id, recovery_witness_authority_project_id,
    authority_snapshot_canonical_root, authority_snapshot_root_identity_json,
    authority_snapshot_updated_at_unix_ms, source, confidence, reason_code,
    issued_at_unix_ms, expires_at_unix_ms, activated_at_unix_ms,
    last_used_at_unix_ms, status
  ) VALUES (?, 'company-1', 'project-1', ?, ?, ?, 'write', '/repo',
    '{"dev":1}', 'repo', 'project-1', 'anchor', NULL, NULL, NULL, '/repo',
    '{"dev":1}', 100, 'project_catalog', 1, 'current_project_folder',
    100, 10000, 100, 100, 'active')`).run(bindingId, threadId, runId, requestId);
}

function insertLease(
  db: Database.Database,
  leaseId: string,
  bindingId: string,
  requestId: string,
  runId: string,
): void {
  db.prepare(`INSERT INTO task_workspace_lease_history (
    lease_id, project_id, created_binding_id, active_binding_id,
    created_root_run_id, child_run_id, created_request_id, branch,
    canonical_worktree, worktree_identity_json, project_root_identity_json,
    created_at_unix_ms, updated_at_unix_ms, status
  ) VALUES (?, 'project-1', ?, ?, ?, ?, ?, ?, ?, '{"dev":2}', '{"dev":1}',
    100, 100, 'active')`).run(
    leaseId,
    bindingId,
    bindingId,
    runId,
    runId,
    requestId,
    `offisim/${leaseId}`,
    `/repo/.offisim/worktrees/${leaseId}`,
  );
}

function databaseContract(): void {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(schemaSql);
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        ({ name }) => name,
      ),
    );
    check(tables.has('competitive_draft_groups'), 'baseline must create comparison groups');
    check(tables.has('competitive_draft_attempts'), 'baseline must create comparison attempts');
    check(/CHECK\s*\(ordinal BETWEEN 1 AND 4\)/u.test(schemaSql), 'attempts must be capped at four');
    check(/UNIQUE\s*\(group_id, employee_id\)/u.test(schemaSql), 'employees must be unique per group');
    check(
      schemaSql.includes('verification_summary TEXT') &&
        schemaSql.includes('verification_passed INTEGER'),
      'attempts must retain structured cross-engine verification results',
    );

    db.exec(`
      INSERT INTO companies (company_id, name, created_at, updated_at)
        VALUES ('company-1', 'Harness Co', '2026-07-18', '2026-07-18');
      INSERT INTO employees (employee_id, company_id, name, role_slug, created_at, updated_at)
        VALUES ('employee-1', 'company-1', 'One', 'engineer', '2026-07-18', '2026-07-18'),
               ('employee-2', 'company-1', 'Two', 'engineer', '2026-07-18', '2026-07-18');
      INSERT INTO projects (project_id, company_id, name, status, workspace_root, created_at, updated_at)
        VALUES ('project-1', 'company-1', 'Harness Project', 'active', '/repo', '2026-07-18', '2026-07-18');
      INSERT INTO project_workspace_authority (
        project_id, company_id, canonical_root, root_identity_json, selected_at_unix_ms, updated_at_unix_ms
      ) VALUES ('project-1', 'company-1', '/repo', '{"dev":1}', 100, 100);
      INSERT INTO chat_threads (thread_id, project_id, title, created_at, updated_at)
        VALUES ('source-thread', 'project-1', 'Source', '2026-07-18', '2026-07-18');
    `);
    insertRun(db, 'source-run', 'source-thread', null);
    db.exec(`
      INSERT INTO competitive_draft_groups (
        group_id, company_id, project_id, source_run_id, objective, status, created_at, updated_at
      ) VALUES ('group-1', 'company-1', 'project-1', 'source-run', 'Build it', 'drafting', '2026-07-18', '2026-07-18');
      INSERT INTO chat_threads (thread_id, project_id, employee_id, title, created_at, updated_at)
        VALUES ('draft-thread', 'project-1', 'employee-1', 'Option 1', '2026-07-18', '2026-07-18'),
               ('draft-thread-two', 'project-1', 'employee-2', 'Option 2', '2026-07-18', '2026-07-18');
    `);
    insertRun(db, 'draft-run', 'draft-thread', 'employee-1');
    db.exec(`INSERT INTO competitive_draft_attempts (
      attempt_id, group_id, ordinal, employee_id, thread_id, run_id, status, started_at
    ) VALUES ('attempt-1', 'group-1', 1, 'employee-1', 'draft-thread', 'draft-run', 'running', '2026-07-18')`);

    assert.throws(
      () => db.exec("UPDATE competitive_draft_groups SET status = 'merging', winner_attempt_id = 'missing-attempt' WHERE group_id = 'group-1'"),
      /competitive draft winner does not belong/u,
    );
    checks += 1;

    assert.throws(
      () => db.exec(`INSERT INTO competitive_draft_attempts (
        attempt_id, group_id, ordinal, employee_id, thread_id, run_id, status, started_at
      ) VALUES ('attempt-duplicate', 'group-1', 2, 'employee-1', 'draft-thread', 'dup-run', 'planned', '2026-07-18')`),
      /UNIQUE constraint failed/u,
    );
    checks += 1;
    assert.throws(
      () => db.exec(`INSERT INTO competitive_draft_attempts (
        attempt_id, group_id, ordinal, employee_id, thread_id, run_id, status, started_at
      ) VALUES ('attempt-five', 'group-1', 5, 'employee-2', 'draft-thread-two', 'fifth-run', 'planned', '2026-07-18')`),
      /CHECK constraint failed/u,
    );
    checks += 1;

    insertBinding(db, 'binding-draft', 'request-draft', 'draft-run', 'draft-thread');
    insertLease(db, 'lease-draft', 'binding-draft', 'request-draft', 'draft-run');
    check(
      db.prepare("SELECT lease_id FROM task_workspace_lease_history WHERE lease_id = 'lease-draft'").get(),
      'the provenance trigger must admit the precisely registered competitive root lease',
    );

    db.exec(`INSERT INTO chat_threads (thread_id, project_id, employee_id, title, created_at, updated_at)
      VALUES ('ordinary-thread', 'project-1', 'employee-2', 'Ordinary', '2026-07-18', '2026-07-18')`);
    insertRun(db, 'ordinary-run', 'ordinary-thread', 'employee-2');
    insertBinding(db, 'binding-ordinary', 'request-ordinary', 'ordinary-run', 'ordinary-thread');
    assert.throws(
      () => insertLease(db, 'lease-ordinary', 'binding-ordinary', 'request-ordinary', 'ordinary-run'),
      /task workspace lease provenance does not match/u,
    );
    checks += 1;
  } finally {
    db.close();
  }
}

function sourceContract(): void {
  check(actions.includes('employeeIds.length < 2 || employeeIds.length > 4'), 'controller must enforce 2–4 employees');
  check(actions.includes('new Set(employeeIds.map'), 'controller must deduplicate employees');
  const submitAt = locate(actions, 'conversationRunController.submit({', 'must use the neutral controller seam');
  const submit = actions.slice(submitAt, actions.indexOf('});', submitAt));
  check(submit.includes('competitiveDraft: {'), 'submit must carry competitiveDraft context');
  check(submit.includes('employeeId: record.employeeId'), 'employee identity must choose its engine');
  check(!submit.includes('directDelegation'), 'competitive submit must not impersonate delegation');
  check(
    actions.includes('repos.asyncTransact(async (transactionRepos) =>') &&
      !actions.includes('async (transactionRepos = repos) =>'),
    'competitive group creation must use the transaction repositories supplied by Tauri',
  );

  const piAt = locate(runtime, "this.engineId === 'api' && competitiveDraft", 'Pi must adapt neutral context');
  check(runtime.slice(piAt, piAt + 500).includes('deferIntegration: true'), 'Pi must retain proposals for review');
  check(
    piChildSupervisor.includes('confirmIntegration: retainForReview ? undefined : ctx.confirmIntegration'),
    'Pi competitive proposals must enter Offisim review capture without automatic integration',
  );
  check(
    runtime.includes('competitiveDraft ? { includeActingEmployeeInRoster: true } : undefined'),
    'competitive Pi execution must expose its assigned employee to the isolated child supervisor',
  );
  check(
    runtime.includes('const effectiveSystemPromptAppend = competitiveDraft') &&
      runtime.includes('Do not commit, amend, merge, rebase, switch branches, or create branches.') &&
      runtime.match(/systemPromptAppend: effectiveSystemPromptAppend \?\? undefined/g)?.length === 3,
    'all engine lanes must leave competitive proposal changes uncommitted for neutral capture',
  );
  check(
    runtime.includes('if (input.directDelegation || competitiveDraft) return;'),
    'competitive Pi roots must not persist a child session as the orchestration shell identity',
  );
  check(
    runtime.includes('(input.delegationLimits && !competitiveDraft)'),
    'competitive orchestration budget must not be mistaken for external-engine delegation',
  );
  check(
    conversationController.includes("attempt.status === 'planned' || attempt.status === 'running'") &&
      conversationController.includes("allFailed ? 'failed' : 'reviewing'"),
    'pre-host competitive failures must converge the attempt and comparison group',
  );
  check(
    employeePersona.includes('runtimeStatus?.orchestrationEngines') &&
      employeePersona.includes('runtimeModelRef: engine.engineId'),
    'employee execution binding must recognize ready orchestration engine ids',
  );
  const mergeAt = locate(actions, "reviewWorkspaceLease(winnerLease, input.companyId, 'merge')", 'winner must merge');
  const discardAt = locate(actions, "reviewWorkspaceLease(lease, input.companyId, 'discard')", 'losers must discard');
  check(mergeAt < discardAt, 'winner merge must precede loser cleanup');

  check(review.includes('<DiffPanel'), 'comparison must drill into the existing diff review');
  check(review.includes('verificationPassed') && review.includes('verificationSummary'), 'comparison must show verification');
  check(review.includes('taskAccountingPresentation'), 'comparison must use neutral accounting presentation');
  check(
    uiState.includes('comparisonGroupId?: string') && stage.includes('comparisonGroupId={target.comparisonGroupId}'),
    'comparison must be a first-class Stage target',
  );
  const competitiveGui = [actions, review, dialog, board].join('\n');
  check(!/\b(?:codex|claude)\b/iu.test(competitiveGui), 'competitive GUI must not branch on named engines');
  check(!/engineId\s*===?\s*['"]/u.test(competitiveGui), 'competitive GUI must not compare engine ids');
  check(
    recovery.includes("context?.recoveryLane === 'competitive-draft'") &&
      recovery.includes('competitiveDraftRun ||'),
    'interrupted competitive attempts must never hydrate an ordinary resume action',
  );
  check(
    recoveryHook.includes("status: 'failed'") &&
      recoveryHook.includes("allFailed ? 'failed' : 'reviewing'"),
    'startup recovery must converge interrupted attempts and their comparison group',
  );
  check(
    runtime.includes("context?.recoveryLane === 'competitive-draft' || context?.competitiveDraft"),
    'runtime resume must reject competitive attempts before acquiring ordinary workspace authority',
  );
  check(
    gitBackend.includes('let mut transaction = match pool.begin().await') &&
      gitBackend.includes('SET lease_id = ?') &&
      gitBackend.includes('transaction.commit().await'),
    'workspace lease registration and attempt binding must commit atomically',
  );
  check(
    codexHost.includes('verify_competitive_draft_attempt(&app, binding, context, cwd)') &&
      claudeHost.includes('verify_competitive_draft_attempt(app, binding, context, &cwd)') &&
      review.includes('attempt.verification_passed'),
    'external-engine attempts must run and display the neutral Project verification contract',
  );
  check(
    gitWorktreeOps.includes("invokeCommand('project_read_file'") &&
      gitWorktreeOps.includes('untrackedTextDiff(changedPath, content)'),
    'review diffs must synthesize added-line hunks for untracked text files',
  );
}

try {
  databaseContract();
  sourceContract();
  console.log(`harness:best-of-n — PASS (${checks} checks)`);
} catch (error) {
  console.error('harness:best-of-n — FAIL');
  console.error(error);
  process.exitCode = 1;
}
