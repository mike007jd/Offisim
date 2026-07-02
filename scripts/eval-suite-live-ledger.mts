/**
 * H2 live eval ledger scorer.
 *
 * This is intentionally read-only: it scores the shipped eval suite from the
 * release app's live SQLite database and active workspace files. A pass requires
 * deterministic environment evidence; missing live prerequisites stay blocked.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { EVAL_SUITE, type EvalResult, summarizeLedger } from './eval-suite.mts';

type Db = Database.Database;
type Row = Record<string, unknown>;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const checkedAt = new Date().toISOString();
const dbPath = path.join(os.homedir(), '.offisim/offisim.db');
const ledgerPath = path.join(repoRoot, 'Docs/eval/H2-ledger-2026-06-28.json');

function all<T extends Row>(db: Db, sql: string, params: readonly unknown[] = []): T[] {
  return db.prepare(sql).all(...params) as T[];
}

function get<T extends Row>(db: Db, sql: string, params: readonly unknown[] = []): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

function count(db: Db, sql: string, params: readonly unknown[] = []): number {
  const row = get<{ value: number }>(db, sql, params);
  return Number(row?.value ?? 0);
}

function tableExists(db: Db, name: string): boolean {
  return (
    count(db, "SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table' AND name = ?", [name]) > 0
  );
}

function sqliteIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe SQLite identifier: ${name}`);
  }
  return `"${name}"`;
}

function columnExists(db: Db, table: string, column: string): boolean {
  return all<{ name: string }>(db, `PRAGMA table_info(${sqliteIdentifier(table)})`).some((row) => row.name === column);
}

function requireLiveEvalSchema(db: Db): void {
  const requiredTables = ['projects', 'agent_runs', 'agent_events', 'pi_messages', 'mcp_audit_log'];
  const requiredColumns: Array<[table: string, column: string]> = [
    ['agent_runs', 'status'],
    ['agent_runs', 'session_file'],
    ['agent_runs', 'context_json'],
    ['agent_events', 'payload_json'],
    ['pi_messages', 'message_json'],
  ];
  const missing = [
    ...requiredTables.filter((table) => !tableExists(db, table)).map((table) => `table:${table}`),
    ...requiredColumns
      .filter(([table, column]) => !columnExists(db, table, column))
      .map(([table, column]) => `column:${table}.${column}`),
  ];
  if (missing.length > 0) {
    throw new Error(`Live DB schema is missing H2 scoring baseline objects: ${missing.join(', ')}`);
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function firstLine(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf8');
  return content.split(/\r?\n/, 1)[0] ?? '';
}

function withinWorkspace(workspaceRoot: string, candidate: string): boolean {
  const relative = path.relative(workspaceRoot, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function result(
  taskId: string,
  outcome: EvalResult['outcome'],
  evidence: readonly string[],
  notes?: string,
  extra: Partial<Pick<EvalResult, 'askCount' | 'artifactUsable' | 'durationMs'>> = {},
): EvalResult {
  return {
    taskId,
    outcome,
    groundTruthMet: outcome === 'pass',
    evidence,
    ...(notes ? { notes } : {}),
    ...extra,
  };
}

function baseEvidence(userVersion: number, workspaceRoot: string): string[] {
  return [
    `checkedAt=${checkedAt}`,
    `dbPath=${dbPath}`,
    `db.user_version=${userVersion}`,
    `workspaceRoot=${workspaceRoot}`,
  ];
}

function activeWorkspaceRoot(db: Db): string {
  const row = get<{ workspace_root: string }>(
    db,
    `SELECT workspace_root
       FROM projects
      WHERE workspace_root IS NOT NULL AND workspace_root != ''
      ORDER BY updated_at DESC
      LIMIT 1`,
  );
  return stringValue(row?.workspace_root);
}

function scoreResearch(db: Db, evidence: string[]): EvalResult {
  const browserAudits = count(
    db,
    `SELECT COUNT(*) AS value
       FROM mcp_audit_log
      WHERE server_name LIKE '%browser%'
         OR tool_name LIKE '%browser%'
         OR tool_name LIKE '%puppeteer%'
         OR tool_name LIKE '%navigate%'
         OR tool_name LIKE '%fetch%'`,
  );
  const citedTauriMessages = count(
    db,
    `SELECT COUNT(*) AS value
       FROM (
         SELECT payload_json AS body FROM agent_events
         UNION ALL
         SELECT message_json AS body FROM pi_messages
       )
      WHERE body LIKE '%Tauri%'
        AND body LIKE '%http%'`,
  );
  const latestAudit = get<{ server_name: string; tool_name: string; created_at: string }>(
    db,
    `SELECT server_name, tool_name, created_at
       FROM mcp_audit_log
      WHERE server_name LIKE '%browser%'
         OR tool_name LIKE '%browser%'
         OR tool_name LIKE '%puppeteer%'
         OR tool_name LIKE '%navigate%'
         OR tool_name LIKE '%fetch%'
      ORDER BY created_at DESC
      LIMIT 1`,
  );
  const taskEvidence = [
    ...evidence,
    `mcp_browser_audit_count=${browserAudits}`,
    latestAudit
      ? `latest_browser_audit=${latestAudit.server_name}.${latestAudit.tool_name}@${latestAudit.created_at}`
      : 'latest_browser_audit=none',
    `tauri_cited_message_count=${citedTauriMessages}`,
  ];

  if (browserAudits === 0) {
    return result('research-web', 'blocked', taskEvidence, 'No live web/MCP read audit row exists.');
  }
  if (citedTauriMessages === 0) {
    return result(
      'research-web',
      'fail',
      taskEvidence,
      'Web tooling exists, but live DB has no cited Tauri-version summary to satisfy the file_content ground truth.',
    );
  }
  return result('research-web', 'pass', taskEvidence);
}

function scoreFileEdit(db: Db, workspaceRoot: string, evidence: string[]): EvalResult {
  const target = path.join(workspaceRoot, 'src/index.ts');
  const header = firstLine(target);
  const editAudits = count(
    db,
    `SELECT COUNT(*) AS value
       FROM mcp_audit_log
      WHERE tool_name LIKE '%write%'
         OR tool_name LIKE '%edit%'
         OR tool_name LIKE '%apply%'`,
  );
  const editCalls = tableExists(db, 'tool_calls')
    ? count(
        db,
        `SELECT COUNT(*) AS value
           FROM tool_calls
          WHERE tool_name LIKE '%write%'
             OR tool_name LIKE '%edit%'
             OR tool_name LIKE '%apply%'`,
      )
    : 0;
  const taskEvidence = [
    ...evidence,
    `target=${target}`,
    `target_exists=${fs.existsSync(target)}`,
    `target_first_line=${JSON.stringify(header)}`,
    `edit_audit_count=${editAudits}`,
    `edit_tool_call_count=${editCalls}`,
  ];

  if (!fs.existsSync(target)) {
    return result('file-edit', 'blocked', taskEvidence, 'The active workspace has no src/index.ts target file.');
  }
  if (/MIT License/i.test(header) && editAudits + editCalls > 0) {
    return result('file-edit', 'pass', taskEvidence);
  }
  return result('file-edit', 'fail', taskEvidence, 'The target file exists but the MIT header or edit-tool evidence is missing.');
}

function scoreArtifact(db: Db, workspaceRoot: string, evidence: string[]): EvalResult {
  const rows = all<{
    deliverable_id: string;
    run_id: string | null;
    title: string;
    file_name: string | null;
    content_hash: string | null;
    content_len: number;
    created_at: string;
  }>(
    db,
    `SELECT deliverable_id, run_id, title, file_name, content_hash, length(content) AS content_len, created_at
       FROM deliverables
      ORDER BY created_at DESC
      LIMIT 10`,
  );
  const row = rows.find((candidate) => stringValue(candidate.content_hash).length > 0);
  const fileName = stringValue(row?.file_name);
  const filePath = fileName ? path.resolve(workspaceRoot, fileName) : '';
  const readableFile =
    Boolean(row) && filePath.length > 0 && withinWorkspace(workspaceRoot, filePath) && fs.existsSync(filePath);
  const taskEvidence = [
    ...evidence,
    `deliverables_count=${rows.length}`,
    row
      ? `latest_hashed_deliverable=${row.deliverable_id}|run_id=${stringValue(row.run_id)}|hash=${row.content_hash}|file_name=${fileName}|content_len=${row.content_len}`
      : 'latest_hashed_deliverable=none',
    `resolved_file=${filePath || 'none'}`,
    `resolved_file_readable=${readableFile}`,
  ];

  if (!row) {
    return result('artifact-publish', 'blocked', taskEvidence, 'No deliverables row with content_hash exists in live DB.');
  }
  if (readableFile) {
    return result('artifact-publish', 'pass', taskEvidence, undefined, { artifactUsable: true });
  }
  return result(
    'artifact-publish',
    'fail',
    taskEvidence,
    'A deliverable row exists, but the published artifact file is not readable under the active workspace.',
    { artifactUsable: false },
  );
}

function scoreApproval(db: Db, evidence: string[]): EvalResult {
  const interactionRows = tableExists(db, 'interaction_history')
    ? all<{ kind: string; status: string; selected_option_id: string | null; resolved_at: string }>(
        db,
        `SELECT kind, status, selected_option_id, resolved_at
           FROM interaction_history
          ORDER BY resolved_at DESC
          LIMIT 5`,
      )
    : [];
  const approvalRows = tableExists(db, 'tool_permission_approvals')
    ? all<{ server_name: string; tool_name: string; approved_by: string; consumed_at: string | null; created_at: string }>(
        db,
        `SELECT server_name, tool_name, approved_by, consumed_at, created_at
           FROM tool_permission_approvals
          ORDER BY created_at DESC
          LIMIT 5`,
      )
    : [];
  const taskEvidence = [
    ...evidence,
    `interaction_history_count=${interactionRows.length}`,
    `tool_permission_approval_count=${approvalRows.length}`,
    interactionRows[0]
      ? `latest_interaction=${interactionRows[0].kind}|${interactionRows[0].status}|${stringValue(interactionRows[0].selected_option_id)}@${interactionRows[0].resolved_at}`
      : 'latest_interaction=none',
    approvalRows[0]
      ? `latest_tool_permission=${approvalRows[0].server_name}.${approvalRows[0].tool_name}|approved_by=${approvalRows[0].approved_by}|consumed_at=${stringValue(approvalRows[0].consumed_at)}@${approvalRows[0].created_at}`
      : 'latest_tool_permission=none',
  ];

  if (interactionRows.length === 0 && approvalRows.length === 0) {
    return result('ask-approval', 'blocked', taskEvidence, 'No approval interaction or tool permission row exists.');
  }

  const approved = interactionRows.some((row) => /approved|completed|resolved/i.test(row.status)) || approvalRows.length > 0;
  if (approved) {
    return result('ask-approval', 'pass', taskEvidence, undefined, { askCount: interactionRows.length });
  }
  return result('ask-approval', 'fail', taskEvidence, 'Approval evidence exists, but no approved/resolved state was recorded.', {
    askCount: interactionRows.length,
  });
}

function scoreAbort(db: Db, evidence: string[]): EvalResult {
  const cancelled = get<{ run_id: string; root_run_id: string; objective: string; finished_at: string }>(
    db,
    `SELECT run_id, root_run_id, objective, finished_at
       FROM agent_runs
      WHERE status = 'cancelled'
        AND (parent_run_id IS NULL OR parent_run_id = '')
      ORDER BY started_at DESC
      LIMIT 1`,
  );
  const runningChildren = cancelled
    ? count(db, "SELECT COUNT(*) AS value FROM agent_runs WHERE root_run_id = ? AND parent_run_id IS NOT NULL AND status = 'running'", [
        cancelled.root_run_id,
      ])
    : 0;
  const taskEvidence = [
    ...evidence,
    cancelled
      ? `latest_cancelled_root=${cancelled.run_id}|root=${cancelled.root_run_id}|finished_at=${cancelled.finished_at}|objective=${JSON.stringify(cancelled.objective.slice(0, 120))}`
      : 'latest_cancelled_root=none',
    `running_children_after_cancel=${runningChildren}`,
  ];

  if (!cancelled) {
    return result('abort-run', 'blocked', taskEvidence, 'No cancelled root run exists in live DB.');
  }
  if (runningChildren === 0) return result('abort-run', 'pass', taskEvidence);
  return result('abort-run', 'fail', taskEvidence, 'A cancelled root still has running child runs.');
}

function scoreDelegation(db: Db, evidence: string[]): EvalResult {
  const threeChildRoot = get<{
    root_run_id: string;
    child_count: number;
    completed_children: number;
    started_at: string;
    finished_at: string | null;
  }>(
    db,
    `SELECT root_run_id,
            SUM(CASE WHEN parent_run_id IS NOT NULL THEN 1 ELSE 0 END) AS child_count,
            SUM(CASE WHEN parent_run_id IS NOT NULL AND status = 'completed' THEN 1 ELSE 0 END) AS completed_children,
            MIN(started_at) AS started_at,
            MAX(finished_at) AS finished_at
       FROM agent_runs
      GROUP BY root_run_id
     HAVING child_count >= 3
      ORDER BY started_at DESC
      LIMIT 1`,
  );
  const closestRoot = get<{ root_run_id: string; child_count: number; completed_children: number; started_at: string }>(
    db,
    `SELECT root_run_id,
            SUM(CASE WHEN parent_run_id IS NOT NULL THEN 1 ELSE 0 END) AS child_count,
            SUM(CASE WHEN parent_run_id IS NOT NULL AND status = 'completed' THEN 1 ELSE 0 END) AS completed_children,
            MIN(started_at) AS started_at
       FROM agent_runs
      GROUP BY root_run_id
     HAVING child_count > 0
      ORDER BY child_count DESC, started_at DESC
      LIMIT 1`,
  );
  const taskEvidence = [
    ...evidence,
    threeChildRoot
      ? `three_child_root=${threeChildRoot.root_run_id}|children=${threeChildRoot.child_count}|completed=${threeChildRoot.completed_children}|started=${threeChildRoot.started_at}|finished=${stringValue(threeChildRoot.finished_at)}`
      : 'three_child_root=none',
    closestRoot
      ? `closest_delegation_root=${closestRoot.root_run_id}|children=${closestRoot.child_count}|completed=${closestRoot.completed_children}|started=${closestRoot.started_at}`
      : 'closest_delegation_root=none',
  ];

  if (threeChildRoot && Number(threeChildRoot.completed_children) >= 3) {
    return result('delegation-parallel', 'pass', taskEvidence);
  }
  if (closestRoot) {
    return result(
      'delegation-parallel',
      'fail',
      taskEvidence,
      'Live delegation evidence exists, but no root has three completed child runs.',
    );
  }
  return result('delegation-parallel', 'blocked', taskEvidence, 'No delegated child runs exist in live DB.');
}

function scoreMission(db: Db, evidence: string[]): EvalResult {
  const passEval = get<{
    mission_id: string;
    verdict: string;
    summary: string;
    status: string;
    created_at: string;
    completed_at: string | null;
  }>(
    db,
    `SELECT m.mission_id, e.verdict, e.summary, m.status, e.created_at, m.completed_at
       FROM mission_evaluation e
       JOIN mission m ON m.mission_id = e.mission_id
      WHERE e.verdict = 'PASS'
        AND m.status = 'completed'
      ORDER BY e.created_at DESC
      LIMIT 1`,
  );
  const blockedGateMissions = count(
    db,
    `SELECT COUNT(*) AS value
       FROM mission
      WHERE status = 'blocked'
        AND goal LIKE '%G2 parallel live%'`,
  );
  const taskEvidence = [
    ...evidence,
    passEval
      ? `latest_pass_evaluation=${passEval.mission_id}|verdict=${passEval.verdict}|summary=${JSON.stringify(passEval.summary)}|completed_at=${stringValue(passEval.completed_at)}`
      : 'latest_pass_evaluation=none',
    `g2_blocked_gate_mission_count=${blockedGateMissions}`,
  ];

  if (!passEval && blockedGateMissions === 0) {
    return result('mission-evaluation', 'blocked', taskEvidence, 'No live mission evaluation row exists.');
  }
  if (passEval) {
    return result('mission-evaluation', 'pass', taskEvidence);
  }
  return result('mission-evaluation', 'fail', taskEvidence, 'Mission attempts exist, but none completed through a PASS evaluation.');
}

function scoreRecovery(db: Db, evidence: string[]): EvalResult {
  const interruptedCount = count(db, "SELECT COUNT(*) AS value FROM agent_runs WHERE status = 'interrupted'");
  const recoveryRun = get<{ run_id: string; status: string; objective: string; started_at: string; finished_at: string | null }>(
    db,
    `SELECT run_id, status, objective, started_at, finished_at
       FROM agent_runs
      WHERE objective LIKE '%recovery%'
         OR objective LIKE '%Resume%'
         OR objective LIKE '%restart%'
      ORDER BY started_at DESC
      LIMIT 1`,
  );
  const duplicateHashes = count(
    db,
    `SELECT COUNT(*) AS value
       FROM (
         SELECT content_hash, COUNT(*) AS c
           FROM deliverables
          WHERE content_hash IS NOT NULL AND content_hash != ''
          GROUP BY content_hash
         HAVING c > 1
       )`,
  );
  const taskEvidence = [
    ...evidence,
    `interrupted_run_count=${interruptedCount}`,
    recoveryRun
      ? `latest_recovery_like_run=${recoveryRun.run_id}|status=${recoveryRun.status}|started=${recoveryRun.started_at}|finished=${stringValue(recoveryRun.finished_at)}|objective=${JSON.stringify(recoveryRun.objective.slice(0, 140))}`
      : 'latest_recovery_like_run=none',
    `duplicate_deliverable_hash_groups=${duplicateHashes}`,
  ];

  if (!recoveryRun && interruptedCount === 0) {
    return result('restart-recovery', 'blocked', taskEvidence, 'No recovery/restart live run evidence exists.');
  }
  if (interruptedCount > 0 && duplicateHashes === 0) {
    return result('restart-recovery', 'pass', taskEvidence);
  }
  return result(
    'restart-recovery',
    'fail',
    taskEvidence,
    'Recovery-like run evidence exists, but agent_runs has no interrupted row at scoring time.',
  );
}

function scoreTask(db: Db, taskId: string, userVersion: number, workspaceRoot: string): EvalResult {
  const evidence = baseEvidence(userVersion, workspaceRoot);
  switch (taskId) {
    case 'research-web':
      return scoreResearch(db, evidence);
    case 'file-edit':
      return scoreFileEdit(db, workspaceRoot, evidence);
    case 'artifact-publish':
      return scoreArtifact(db, workspaceRoot, evidence);
    case 'ask-approval':
      return scoreApproval(db, evidence);
    case 'abort-run':
      return scoreAbort(db, evidence);
    case 'delegation-parallel':
      return scoreDelegation(db, evidence);
    case 'mission-evaluation':
      return scoreMission(db, evidence);
    case 'restart-recovery':
      return scoreRecovery(db, evidence);
    default:
      return result(taskId, 'skipped', evidence, 'No H2 scorer is registered for this eval task.');
  }
}

if (!fs.existsSync(dbPath)) {
  throw new Error(`Live Offisim database does not exist: ${dbPath}`);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const userVersion = Number(get<{ user_version: number }>(db, 'PRAGMA user_version')?.user_version ?? 0);
  requireLiveEvalSchema(db);

  const workspaceRoot = activeWorkspaceRoot(db);
  if (!workspaceRoot) throw new Error('No active project workspace_root found in live DB.');
  if (!fs.existsSync(workspaceRoot)) throw new Error(`Active project workspace_root is not readable: ${workspaceRoot}`);

  const results = EVAL_SUITE.map((task) => scoreTask(db, task.id, userVersion, workspaceRoot));
  const ledger = summarizeLedger(results);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

  console.log(`H2 live eval ledger written: ${ledgerPath}`);
  console.log(
    `summary: total=${ledger.summary.total} passed=${ledger.summary.passed} failed=${ledger.summary.failed} blocked=${ledger.summary.blocked} skipped=${ledger.summary.skipped}`,
  );
  for (const row of ledger.results) {
    console.log(`  ${row.taskId}: ${row.outcome}${row.notes ? ` — ${row.notes}` : ''}`);
  }
} finally {
  db.close();
}
