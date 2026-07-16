#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  parseTaskWorkspaceBindingProjection,
  parseWorkspaceBoundProvenance,
} from '../apps/desktop/renderer/src/lib/tauri-commands.js';
import {
  acceptWorkspaceBinding,
  acceptWorkspaceUnavailable,
  canConsumeWorkspaceEvent,
  createWorkspaceBindingGate,
  rejectWorkspaceBinding,
} from '../apps/desktop/renderer/src/runtime/workspace-binding-stream-gate.js';

type ColumnInfo = { name: string; notnull: 0 | 1; type: string };
type ForeignKeyInfo = { from: string; table: string; to: string };
type IndexInfo = { name: string; unique: 0 | 1 };
type IndexColumnInfo = { name: string; seqno: number };

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const paths = {
  schema: `${ROOT}/packages/db-local/src/schema.sql`,
  commands: `${ROOT}/apps/desktop/renderer/src/lib/tauri-commands.ts`,
  runtime: `${ROOT}/apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts`,
  conversationController: `${ROOT}/apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.ts`,
  recovery: `${ROOT}/apps/desktop/renderer/src/runtime/recovery/useInterruptedRunRecovery.ts`,
  missionController: `${ROOT}/apps/desktop/renderer/src/runtime/mission/mission-run-controller.ts`,
  missionLoop: `${ROOT}/packages/core/src/runtime/mission/mission-loop-controller.ts`,
  evaluationContext: `${ROOT}/apps/desktop/renderer/src/runtime/mission/evaluation-context.ts`,
  tools: `${ROOT}/apps/desktop/src-tauri/src/builtin_tools.rs`,
  git: `${ROOT}/apps/desktop/src-tauri/src/git.rs`,
  binding: `${ROOT}/apps/desktop/src-tauri/src/task_workspace_binding.rs`,
  workspaceRecovery: `${ROOT}/apps/desktop/src-tauri/src/workspace_recovery.rs`,
  tauriLib: `${ROOT}/apps/desktop/src-tauri/src/lib.rs`,
  bridgePermissions: `${ROOT}/apps/desktop/src-tauri/permissions/agent-bridges.toml`,
  piRun: `${ROOT}/apps/desktop/src-tauri/src/pi_agent_host/run.rs`,
  piMod: `${ROOT}/apps/desktop/src-tauri/src/pi_agent_host/mod.rs`,
  localPaths: `${ROOT}/apps/desktop/src-tauri/src/local_paths.rs`,
} as const;

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function sliceBetween(text: string, startMarker: string, endMarker: string, label: string): string {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: missing start marker ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label}: missing end marker ${endMarker}`);
  return text.slice(start, end);
}

function assertContains(text: string, expected: string, label: string): void {
  assert.ok(text.includes(expected), `${label}: missing ${expected}`);
}

function assertExcludes(text: string, forbidden: readonly string[], label: string): void {
  for (const value of forbidden) {
    assert.ok(!text.includes(value), `${label}: forbidden field/token leaked: ${value}`);
  }
}

function sqliteIdentifierLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function expectConstraint(action: () => unknown, code: string, label: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error, `${label}: expected SQLite to reject the write`);
  const actual = (thrown as Error & { code?: string }).code;
  assert.equal(actual, code, `${label}: expected ${code}, got ${actual ?? 'no code'}`);
}

function tableColumns(db: Database.Database, table: string): Map<string, ColumnInfo> {
  const rows = db
    .prepare(`PRAGMA table_info(${sqliteIdentifierLiteral(table)})`)
    .all() as ColumnInfo[];
  assert.ok(rows.length > 0, `missing SQLite table: ${table}`);
  return new Map(rows.map((row) => [row.name, row]));
}

function insertProject(
  db: Database.Database,
  values: { companyId: string; projectId: string; workspaceRoot: string | null },
): void {
  db.prepare(
    'INSERT INTO projects ' +
      '(project_id, company_id, name, workspace_root, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    values.projectId,
    values.companyId,
    `Project ${values.projectId}`,
    values.workspaceRoot,
    '2026-07-14T00:00:00.000Z',
    '2026-07-14T00:00:00.000Z',
  );
  if (values.workspaceRoot !== null) {
    db.prepare(
      `INSERT INTO project_workspace_authority
        (project_id, company_id, canonical_root, root_identity_json,
         selected_at_unix_ms, updated_at_unix_ms)
       VALUES (?, ?, ?, ?, 1000, 1000)`,
    ).run(
      values.projectId,
      values.companyId,
      values.workspaceRoot,
      JSON.stringify({ canonicalRoot: values.workspaceRoot }),
    );
  }
}

type HistoryRow = {
  access?: string;
  authoritySnapshotCanonicalRoot?: string;
  authoritySnapshotRootIdentityJson?: string;
  authoritySnapshotUpdatedAtUnixMs?: number;
  bindingId: string;
  canonicalRoot?: string;
  companyId: string;
  gitOriginDigest?: string | null;
  projectId: string;
  projectNameNormalized?: string;
  reasonCode?: string;
  recoveryWitnessAuthorityProjectId?: string | null;
  recoveryWitnessBindingId?: string | null;
  requestId: string;
  rootIdentityJson?: string;
  source?: 'project_catalog' | 'conversation_history' | 'known_root_recovery' | 'resume_history';
  status?: string;
  threadId: string;
  workspaceBasenameNormalized?: string;
  workspaceAnchor?: string;
};

function insertAgentRun(
  db: Database.Database,
  row: {
    runId: string;
    companyId: string;
    projectId: string;
    threadId: string;
    parentRunId: string | null;
    rootRunId: string;
    status?: 'running' | 'interrupted' | 'completed' | 'failed' | 'cancelled';
  },
): void {
  db.prepare(
    'INSERT INTO agent_runs ' +
      '(run_id, thread_id, company_id, project_id, parent_run_id, root_run_id, status, started_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    row.runId,
    row.threadId,
    row.companyId,
    row.projectId,
    row.parentRunId,
    row.rootRunId,
    row.status ?? 'running',
    '2026-07-14T00:00:00.000Z',
  );
}

function insertWorkspaceLease(
  db: Database.Database,
  row: {
    leaseId: string;
    bindingId: string;
    rootRunId: string;
    childRunId: string;
    requestId: string;
    projectId: string;
    projectRootIdentityJson?: string;
  },
): void {
  db.prepare(
    `INSERT INTO task_workspace_lease_history
      (lease_id, project_id, created_binding_id, active_binding_id,
       created_root_run_id, child_run_id, created_request_id, branch,
       canonical_worktree, worktree_identity_json, project_root_identity_json,
       created_at_unix_ms, updated_at_unix_ms, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, 1000, 1000, 'active')`,
  ).run(
    row.leaseId,
    row.projectId,
    row.bindingId,
    row.bindingId,
    row.rootRunId,
    row.childRunId,
    row.requestId,
    `offisim/lease/${row.childRunId}-${row.leaseId}`,
    `/fixture/${row.projectId}/.offisim/worktrees/${row.leaseId}`,
    row.projectRootIdentityJson ?? JSON.stringify({ canonicalRoot: `/fixture/${row.projectId}` }),
  );
}

function insertHistory(db: Database.Database, row: HistoryRow): void {
  const canonicalRoot = row.canonicalRoot ?? `/fixture/${row.projectId}`;
  const authority = db
    .prepare(
      `SELECT canonical_root, root_identity_json, updated_at_unix_ms
       FROM project_workspace_authority WHERE project_id = ?`,
    )
    .get(row.projectId) as
    | { canonical_root: string; root_identity_json: string; updated_at_unix_ms: number }
    | undefined;
  db.prepare(
    `INSERT INTO task_workspace_binding_history (
       binding_id, company_id, project_id, thread_id, turn_id, request_id,
       access, canonical_root, root_identity_json, source, confidence, reason_code,
       workspace_basename_normalized, project_name_normalized, workspace_anchor,
       git_origin_digest, recovery_witness_binding_id,
       recovery_witness_authority_project_id, authority_snapshot_canonical_root,
       authority_snapshot_root_identity_json, authority_snapshot_updated_at_unix_ms,
       issued_at_unix_ms, expires_at_unix_ms, activated_at_unix_ms,
       last_used_at_unix_ms, status
     ) VALUES (
       @bindingId, @companyId, @projectId, @threadId, @turnId, @requestId,
       @access, @canonicalRoot, @rootIdentityJson, @source, 1, @reasonCode,
       @workspaceBasenameNormalized, @projectNameNormalized, @workspaceAnchor,
       @gitOriginDigest, @recoveryWitnessBindingId,
       @recoveryWitnessAuthorityProjectId, @authoritySnapshotCanonicalRoot,
       @authoritySnapshotRootIdentityJson, @authoritySnapshotUpdatedAtUnixMs,
       1000, 61000, 1000, 1000, @status
     )`,
  ).run({
    bindingId: row.bindingId,
    companyId: row.companyId,
    projectId: row.projectId,
    threadId: row.threadId,
    turnId: `turn-${row.bindingId}`,
    requestId: row.requestId,
    access: row.access ?? 'write',
    canonicalRoot,
    rootIdentityJson: row.rootIdentityJson ?? JSON.stringify({ canonicalRoot }),
    source: row.source ?? 'project_catalog',
    reasonCode: row.reasonCode ?? 'current_project_folder',
    workspaceBasenameNormalized: row.workspaceBasenameNormalized ?? row.projectId.toLowerCase(),
    projectNameNormalized: row.projectNameNormalized ?? `project ${row.projectId}`.toLowerCase(),
    workspaceAnchor: row.workspaceAnchor ?? '/fixture',
    gitOriginDigest: row.gitOriginDigest ?? null,
    recoveryWitnessBindingId: row.recoveryWitnessBindingId ?? null,
    recoveryWitnessAuthorityProjectId: row.recoveryWitnessAuthorityProjectId ?? null,
    authoritySnapshotCanonicalRoot:
      row.authoritySnapshotCanonicalRoot ?? authority?.canonical_root ?? '/missing-authority',
    authoritySnapshotRootIdentityJson:
      row.authoritySnapshotRootIdentityJson ?? authority?.root_identity_json ?? '{}',
    authoritySnapshotUpdatedAtUnixMs:
      row.authoritySnapshotUpdatedAtUnixMs ?? authority?.updated_at_unix_ms ?? -1,
    status: row.status ?? 'active',
  });
}

function verifySqlOracle(schemaSql: string): void {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(schemaSql);

    const projectColumns = tableColumns(db, 'projects');
    assert.equal(projectColumns.get('workspace_root')?.type, 'TEXT');
    assert.equal(projectColumns.get('workspace_root')?.notnull, 1);

    const insertCompany = db.prepare(
      'INSERT INTO companies (company_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    );
    insertCompany.run('company-a', 'Company A', '2026-07-14', '2026-07-14');
    insertCompany.run('company-b', 'Company B', '2026-07-14', '2026-07-14');
    insertCompany.run('company-empty', 'Company Empty', '2026-07-14', '2026-07-14');
    assert.equal(
      db.prepare("DELETE FROM companies WHERE company_id = 'company-empty'").run().changes,
      1,
      'a Company remains valid and deletable without any Project',
    );
    insertProject(db, {
      companyId: 'company-a',
      projectId: 'project-a',
      workspaceRoot: '/fixture/project-a',
    });
    insertProject(db, {
      companyId: 'company-b',
      projectId: 'project-b',
      workspaceRoot: '/fixture/project-b',
    });
    insertProject(db, {
      companyId: 'company-b',
      projectId: 'project-cas',
      workspaceRoot: '/fixture/project-cas',
    });
    db.prepare(
      `INSERT INTO projects
       (project_id, company_id, name, workspace_root, created_at, updated_at)
       VALUES ('project-authority-guard', 'company-a', 'Authority guard',
               '/fixture/authority-guard', '2026-07-14', '2026-07-14')`,
    ).run();
    expectConstraint(
      () =>
        db
          .prepare(
            `INSERT INTO project_workspace_authority
             (project_id, company_id, canonical_root, root_identity_json,
              selected_at_unix_ms, updated_at_unix_ms)
             VALUES ('project-authority-guard', 'company-b', '/fixture/foreign-root', '{}', 1, 1)`,
          )
          .run(),
      'SQLITE_CONSTRAINT_TRIGGER',
      'foreign Company/root cannot manufacture Project workspace authority',
    );
    expectConstraint(
      () =>
        insertProject(db, {
          companyId: 'company-a',
          projectId: 'project-null',
          workspaceRoot: null,
        }),
      'SQLITE_CONSTRAINT_NOTNULL',
      'projects.workspace_root NOT NULL',
    );
    for (const [projectId, workspaceRoot] of [
      ['project-empty', ''],
      ['project-whitespace', '   '],
    ] as const) {
      expectConstraint(
        () => insertProject(db, { companyId: 'company-a', projectId, workspaceRoot }),
        'SQLITE_CONSTRAINT_CHECK',
        `projects.workspace_root CHECK ${JSON.stringify(workspaceRoot)}`,
      );
    }

    const insertThread = db.prepare(
      'INSERT INTO chat_threads (thread_id, project_id, title, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?)',
    );
    insertThread.run('thread-a', 'project-a', 'Thread A', '2026-07-14', '2026-07-14');
    insertThread.run('thread-a-shared', 'project-a', 'Thread A shared', '2026-07-14', '2026-07-14');
    insertThread.run('thread-b', 'project-b', 'Thread B', '2026-07-14', '2026-07-14');
    insertThread.run('thread-cas', 'project-cas', 'Thread CAS', '2026-07-14', '2026-07-14');
    insertThread.run(
      'thread-live-unique',
      'project-b',
      'One live root',
      '2026-07-14',
      '2026-07-14',
    );

    insertAgentRun(db, {
      runId: 'root-live-first',
      companyId: 'company-b',
      projectId: 'project-b',
      threadId: 'thread-live-unique',
      parentRunId: null,
      rootRunId: 'root-live-first',
    });
    expectConstraint(
      () =>
        insertAgentRun(db, {
          runId: 'root-live-race',
          companyId: 'company-b',
          projectId: 'project-b',
          threadId: 'thread-live-unique',
          parentRunId: null,
          rootRunId: 'root-live-race',
        }),
      'SQLITE_CONSTRAINT_UNIQUE',
      'one Conversation cannot persist two running roots',
    );
    expectConstraint(
      () =>
        insertAgentRun(db, {
          runId: 'root-live-cross-company-race',
          companyId: 'company-a',
          projectId: 'project-a',
          threadId: 'thread-live-unique',
          parentRunId: null,
          rootRunId: 'root-live-cross-company-race',
        }),
      'SQLITE_CONSTRAINT_UNIQUE',
      'a forged cross-company row cannot reuse a Conversation live-root slot',
    );
    db.prepare(
      "UPDATE agent_runs SET status = 'interrupted' WHERE run_id = 'root-live-first'",
    ).run();
    expectConstraint(
      () =>
        insertAgentRun(db, {
          runId: 'root-live-after-interruption',
          companyId: 'company-b',
          projectId: 'project-b',
          threadId: 'thread-live-unique',
          parentRunId: null,
          rootRunId: 'root-live-after-interruption',
        }),
      'SQLITE_CONSTRAINT_UNIQUE',
      'an unresolved interrupted root reserves the Conversation until Resume or Discard',
    );
    db.prepare("UPDATE agent_runs SET status = 'cancelled' WHERE run_id = 'root-live-first'").run();
    insertAgentRun(db, {
      runId: 'root-live-next',
      companyId: 'company-b',
      projectId: 'project-b',
      threadId: 'thread-live-unique',
      parentRunId: null,
      rootRunId: 'root-live-next',
    });
    insertAgentRun(db, {
      runId: 'child-live-next',
      companyId: 'company-b',
      projectId: 'project-b',
      threadId: 'thread-live-unique',
      parentRunId: 'root-live-next',
      rootRunId: 'root-live-next',
    });

    insertProject(db, {
      companyId: 'company-a',
      projectId: 'project-recovery-owner',
      workspaceRoot: '/fixture/recovery-owner-old',
    });
    insertThread.run(
      'thread-recovery-owner',
      'project-recovery-owner',
      'Recovery owner',
      '2026-07-14',
      '2026-07-14',
    );
    insertHistory(db, {
      bindingId: 'binding-recovery-owner-witness',
      canonicalRoot: '/fixture/recovery-owner-old',
      companyId: 'company-a',
      gitOriginDigest: 'sha256:recovery-owner',
      projectId: 'project-recovery-owner',
      requestId: 'request-recovery-owner-witness',
      status: 'completed',
      threadId: 'thread-recovery-owner',
    });
    insertHistory(db, {
      bindingId: 'binding-recovery-owner-active',
      canonicalRoot: '/fixture/recovered-only',
      companyId: 'company-a',
      gitOriginDigest: 'sha256:recovery-owner',
      projectId: 'project-recovery-owner',
      reasonCode: 'unique_name_repo_identity_match',
      recoveryWitnessBindingId: 'binding-recovery-owner-witness',
      requestId: 'request-recovery-owner-active',
      rootIdentityJson: JSON.stringify({ canonicalRoot: '/fixture/recovered-only' }),
      source: 'known_root_recovery',
      status: 'active',
      threadId: 'thread-recovery-owner',
      workspaceBasenameNormalized: 'project-recovery-owner',
    });
    expectConstraint(
      () =>
        db.transaction(() => {
          insertProject(db, {
            companyId: 'company-b',
            projectId: 'project-recovery-seizer-create',
            workspaceRoot: '/fixture/recovered-only',
          });
        })(),
      'SQLITE_CONSTRAINT_TRIGGER',
      'a later Project cannot create authority over another Project active recovered root',
    );
    insertProject(db, {
      companyId: 'company-b',
      projectId: 'project-recovery-seizer-update',
      workspaceRoot: '/fixture/recovery-seizer-own',
    });
    expectConstraint(
      () =>
        db.transaction(() => {
          db.prepare(
            `UPDATE projects SET workspace_root = '/fixture/recovered-only'
             WHERE project_id = 'project-recovery-seizer-update'`,
          ).run();
          db.prepare(
            `UPDATE project_workspace_authority
             SET canonical_root = '/fixture/recovered-only',
                 root_identity_json = ?, updated_at_unix_ms = 2000
             WHERE project_id = 'project-recovery-seizer-update'`,
          ).run(JSON.stringify({ canonicalRoot: '/fixture/recovered-only' }));
        })(),
      'SQLITE_CONSTRAINT_TRIGGER',
      'a later Project cannot update authority over another Project active recovered root',
    );
    assert.equal(
      db
        .prepare(
          "SELECT workspace_root FROM projects WHERE project_id = 'project-recovery-seizer-update'",
        )
        .pluck()
        .get(),
      '/fixture/recovery-seizer-own',
      'rejected reverse authority CAS rolls back the Project catalog update',
    );

    const staleCasRoot = '/fixture/project-cas';
    const staleCasIdentity = JSON.stringify({ canonicalRoot: staleCasRoot });
    insertHistory(db, {
      bindingId: 'binding-cas-witness',
      canonicalRoot: staleCasRoot,
      companyId: 'company-b',
      gitOriginDigest: 'sha256:cas-witness',
      projectId: 'project-cas',
      requestId: 'request-cas-witness',
      rootIdentityJson: staleCasIdentity,
      status: 'completed',
      threadId: 'thread-cas',
    });
    db.transaction(() => {
      db.prepare(
        "UPDATE projects SET workspace_root = '/fixture/project-cas-new' WHERE project_id = 'project-cas'",
      ).run();
      db.prepare(
        `UPDATE project_workspace_authority
         SET canonical_root = '/fixture/project-cas-new',
             root_identity_json = ?, updated_at_unix_ms = 2000
         WHERE project_id = 'project-cas'`,
      ).run(JSON.stringify({ canonicalRoot: '/fixture/project-cas-new' }));
    })();
    expectConstraint(
      () =>
        insertHistory(db, {
          bindingId: 'binding-cas-old-root',
          canonicalRoot: '/fixture/project-cas',
          companyId: 'company-b',
          projectId: 'project-cas',
          requestId: 'request-cas-old-root',
          rootIdentityJson: JSON.stringify({ canonicalRoot: '/fixture/project-cas' }),
          status: 'completed',
          threadId: 'thread-cas',
        }),
      'SQLITE_CONSTRAINT_TRIGGER',
      'issue CAS rejects a binding prepared against the old protected Project root',
    );
    expectConstraint(
      () =>
        insertHistory(db, {
          authoritySnapshotCanonicalRoot: staleCasRoot,
          authoritySnapshotRootIdentityJson: staleCasIdentity,
          authoritySnapshotUpdatedAtUnixMs: 1000,
          bindingId: 'binding-cas-stale-recovery',
          canonicalRoot: '/fixture/recovered-project-cas',
          companyId: 'company-b',
          gitOriginDigest: 'sha256:cas-witness',
          projectId: 'project-cas',
          reasonCode: 'unique_name_repo_identity_match',
          recoveryWitnessBindingId: 'binding-cas-witness',
          requestId: 'request-cas-stale-recovery',
          rootIdentityJson: JSON.stringify({ canonicalRoot: '/fixture/recovered-project-cas' }),
          source: 'known_root_recovery',
          status: 'completed',
          threadId: 'thread-cas',
          workspaceBasenameNormalized: 'project-cas',
        }),
      'SQLITE_CONSTRAINT_TRIGGER',
      'resolver barrier CAS rejects recovered history signed by the authority selected before A to B reselection',
    );
    insertHistory(db, {
      bindingId: 'binding-cas-current-root',
      canonicalRoot: '/fixture/project-cas-new',
      companyId: 'company-b',
      projectId: 'project-cas',
      requestId: 'request-cas-current-root',
      rootIdentityJson: JSON.stringify({ canonicalRoot: '/fixture/project-cas-new' }),
      status: 'completed',
      threadId: 'thread-cas',
    });

    const historyColumns = tableColumns(db, 'task_workspace_binding_history');
    const requiredScopeColumns = [
      'binding_id',
      'company_id',
      'project_id',
      'thread_id',
      'turn_id',
      'request_id',
      'access',
      'authority_snapshot_canonical_root',
      'authority_snapshot_root_identity_json',
      'authority_snapshot_updated_at_unix_ms',
      'status',
    ] as const;
    for (const column of requiredScopeColumns) {
      assert.equal(historyColumns.get(column)?.notnull, 1, `${column} must be NOT NULL`);
    }
    for (const secretColumn of ['workspace_ref', 'binding_ref', 'active_ref']) {
      assert.ok(!historyColumns.has(secretColumn), `${secretColumn} must never enter SQLite`);
    }
    assert.ok(
      [...historyColumns.keys()].every((column) => !column.endsWith('_ref')),
      'history must contain no durable capability-ref column',
    );

    const foreignKeys = db
      .prepare("PRAGMA foreign_key_list('task_workspace_binding_history')")
      .all() as ForeignKeyInfo[];
    for (const expected of [
      { from: 'company_id', table: 'companies', to: 'company_id' },
      { from: 'project_id', table: 'projects', to: 'project_id' },
      { from: 'thread_id', table: 'chat_threads', to: 'thread_id' },
    ]) {
      assert.ok(
        foreignKeys.some(
          (row) =>
            row.from === expected.from && row.table === expected.table && row.to === expected.to,
        ),
        `missing history foreign key ${expected.from} -> ${expected.table}.${expected.to}`,
      );
    }

    const indexes = db
      .prepare("PRAGMA index_list('task_workspace_binding_history')")
      .all() as IndexInfo[];
    const uniqueIndexColumns = indexes
      .filter((index) => index.unique === 1)
      .map((index) =>
        (
          db
            .prepare(`PRAGMA index_info(${sqliteIdentifierLiteral(index.name)})`)
            .all() as IndexColumnInfo[]
        )
          .sort((left, right) => left.seqno - right.seqno)
          .map((column) => column.name),
      );
    assert.ok(
      uniqueIndexColumns.some((columns) => columns.length === 1 && columns[0] === 'request_id'),
      'history request_id must be unique across every scope',
    );

    insertHistory(db, {
      bindingId: 'binding-a',
      companyId: 'company-a',
      projectId: 'project-a',
      requestId: 'request-cross-scope',
      threadId: 'thread-a',
    });
    insertHistory(db, {
      bindingId: 'binding-a-shared',
      companyId: 'company-a',
      projectId: 'project-a',
      requestId: 'request-same-project-shared-root',
      threadId: 'thread-a-shared',
    });
    assert.equal(
      db
        .prepare(
          `SELECT COUNT(*) FROM task_workspace_binding_history
           WHERE project_id = 'project-a' AND canonical_root = '/fixture/project-a'
             AND status = 'active'`,
        )
        .pluck()
        .get(),
      2,
      'Conversations in one Project may share the same active workspace root',
    );
    expectConstraint(
      () =>
        insertHistory(db, {
          bindingId: 'binding-b',
          companyId: 'company-b',
          projectId: 'project-b',
          requestId: 'request-cross-scope',
          threadId: 'thread-b',
        }),
      'SQLITE_CONSTRAINT_UNIQUE',
      'request_id cross-scope uniqueness',
    );

    for (const status of ['active', 'completed', 'failed', 'aborted', 'expired', 'app_restart']) {
      insertHistory(db, {
        bindingId: `binding-status-${status}`,
        companyId: 'company-a',
        projectId: 'project-a',
        requestId: `request-status-${status}`,
        status,
        threadId: 'thread-a',
      });
    }
    expectConstraint(
      () =>
        insertHistory(db, {
          bindingId: 'binding-invalid-status',
          companyId: 'company-a',
          projectId: 'project-a',
          requestId: 'request-invalid-status',
          status: 'running',
          threadId: 'thread-a',
        }),
      'SQLITE_CONSTRAINT_CHECK',
      'history status domain',
    );
    insertHistory(db, {
      access: 'read',
      bindingId: 'binding-read',
      companyId: 'company-a',
      projectId: 'project-a',
      requestId: 'request-read',
      threadId: 'thread-a',
    });
    expectConstraint(
      () =>
        insertHistory(db, {
          access: 'admin',
          bindingId: 'binding-invalid-access',
          companyId: 'company-a',
          projectId: 'project-a',
          requestId: 'request-invalid-access',
          threadId: 'thread-a',
        }),
      'SQLITE_CONSTRAINT_CHECK',
      'history access domain',
    );
    insertHistory(db, {
      bindingId: 'binding-valid-resume-provenance',
      companyId: 'company-a',
      projectId: 'project-a',
      reasonCode: 'resume_history_identity_match',
      requestId: 'request-valid-resume-provenance',
      source: 'resume_history',
      threadId: 'thread-a',
    });
    for (const [sourceValue, reasonCode] of [
      ['project_catalog', 'resume_history_identity_match'],
      ['conversation_history', 'current_project_folder'],
      ['known_root_recovery', 'recent_successful_workspace'],
      ['resume_history', 'current_project_folder'],
    ] as const) {
      expectConstraint(
        () =>
          insertHistory(db, {
            bindingId: `binding-invalid-provenance-${sourceValue}`,
            companyId: 'company-a',
            projectId: 'project-a',
            reasonCode,
            requestId: `request-invalid-provenance-${sourceValue}`,
            source: sourceValue,
            threadId: 'thread-a',
          }),
        'SQLITE_CONSTRAINT_TRIGGER',
        `history provenance pair ${sourceValue}/${reasonCode}`,
      );
    }
    expectConstraint(
      () =>
        insertHistory(db, {
          bindingId: 'binding-foreign-project',
          companyId: 'company-a',
          projectId: 'project-missing',
          requestId: 'request-foreign-project',
          threadId: 'thread-a',
        }),
      'SQLITE_CONSTRAINT_TRIGGER',
      'history scope trigger rejects a missing Project before FK evaluation',
    );
    expectConstraint(
      () =>
        insertHistory(db, {
          bindingId: 'binding-mixed-scope',
          companyId: 'company-b',
          projectId: 'project-a',
          requestId: 'request-mixed-scope',
          threadId: 'thread-a',
        }),
      'SQLITE_CONSTRAINT_TRIGGER',
      'history scope trigger rejects mixed Company/Project/Conversation ownership',
    );

    insertAgentRun(db, {
      runId: 'turn-binding-a',
      companyId: 'company-a',
      projectId: 'project-a',
      threadId: 'thread-a',
      parentRunId: null,
      rootRunId: 'turn-binding-a',
    });
    insertAgentRun(db, {
      runId: 'child-binding-a',
      companyId: 'company-a',
      projectId: 'project-a',
      threadId: 'thread-a',
      parentRunId: 'turn-binding-a',
      rootRunId: 'turn-binding-a',
    });
    expectConstraint(
      () =>
        insertWorkspaceLease(db, {
          leaseId: 'lease-forged-project-identity',
          bindingId: 'binding-a',
          rootRunId: 'turn-binding-a',
          childRunId: 'child-binding-a',
          requestId: 'request-cross-scope',
          projectId: 'project-a',
          projectRootIdentityJson: JSON.stringify({
            canonicalRoot: '/fixture/project-a',
            inode: 999,
          }),
        }),
      'SQLITE_CONSTRAINT_TRIGGER',
      'lease registration rejects a same-path replacement Project identity',
    );
    insertWorkspaceLease(db, {
      leaseId: 'lease-valid',
      bindingId: 'binding-a',
      rootRunId: 'turn-binding-a',
      childRunId: 'child-binding-a',
      requestId: 'request-cross-scope',
      projectId: 'project-a',
    });
    expectConstraint(
      () =>
        db.transaction(() => {
          insertProject(db, {
            companyId: 'company-b',
            projectId: 'project-retained-worktree-seizer',
            workspaceRoot: '/fixture/project-a/.offisim/worktrees/lease-valid',
          });
        })(),
      'SQLITE_CONSTRAINT_TRIGGER',
      'a later Project cannot claim an active retained worktree as its authority root',
    );
    expectConstraint(
      () =>
        db
          .prepare(
            `UPDATE project_workspace_authority
             SET root_identity_json = ?
             WHERE project_id = 'project-a'`,
          )
          .run(JSON.stringify({ canonicalRoot: '/fixture/project-a', inode: 2 })),
      'SQLITE_CONSTRAINT_TRIGGER',
      'same path with a new filesystem identity is blocked while a binding is active',
    );
    assert.equal(
      db
        .prepare(
          "SELECT root_identity_json FROM project_workspace_authority WHERE project_id = 'project-a'",
        )
        .pluck()
        .get(),
      JSON.stringify({ canonicalRoot: '/fixture/project-a' }),
      'rejected identity replacement leaves protected authority unchanged',
    );
    expectConstraint(
      () =>
        insertWorkspaceLease(db, {
          leaseId: 'lease-forged-root',
          bindingId: 'binding-a',
          rootRunId: 'turn-binding-a',
          childRunId: 'turn-binding-a',
          requestId: 'request-cross-scope',
          projectId: 'project-a',
        }),
      'SQLITE_CONSTRAINT_TRIGGER',
      'lease provenance requires a distinct exact-scope running child',
    );
    for (const [sql, label] of [
      ["DELETE FROM chat_threads WHERE thread_id = 'thread-a'", 'Conversation delete gate'],
      ["DELETE FROM projects WHERE project_id = 'project-a'", 'Project delete gate'],
      ["DELETE FROM companies WHERE company_id = 'company-a'", 'Company delete gate'],
    ] as const) {
      expectConstraint(
        () => db.prepare(sql).run(),
        'SQLITE_CONSTRAINT_TRIGGER',
        `${label} retains active workspace authority`,
      );
    }
    db.prepare(
      "UPDATE task_workspace_binding_history SET status = 'completed' WHERE company_id = 'company-a'",
    ).run();
    expectConstraint(
      () =>
        db
          .prepare(
            "UPDATE projects SET workspace_root = '/fixture/project-a-moved' WHERE project_id = 'project-a'",
          )
          .run(),
      'SQLITE_CONSTRAINT_TRIGGER',
      'an active retained worktree blocks Project folder changes after the binding completes',
    );
    db.prepare(
      "UPDATE task_workspace_lease_history SET status = 'released' WHERE lease_id = 'lease-valid'",
    ).run();
    db.transaction(() => {
      db.prepare(
        "UPDATE projects SET workspace_root = '/fixture/project-a-moved' WHERE project_id = 'project-a'",
      ).run();
      db.prepare(
        `UPDATE project_workspace_authority
         SET canonical_root = '/fixture/project-a-moved',
             root_identity_json = ?, updated_at_unix_ms = 3000
         WHERE project_id = 'project-a'`,
      ).run(JSON.stringify({ canonicalRoot: '/fixture/project-a-moved' }));
    })();
    assert.equal(
      db
        .prepare("SELECT workspace_root FROM projects WHERE project_id = 'project-a'")
        .pluck()
        .get(),
      '/fixture/project-a-moved',
      'released bindings and worktrees allow an atomic Project folder change',
    );
    assert.equal(
      db.prepare("DELETE FROM companies WHERE company_id = 'company-a'").run().changes,
      1,
      'terminal binding/lease history must not make a Company undeletable',
    );

    console.log('  ✓ real SQLite schema enforces Project folder + durable history constraints');
    console.log('  ✓ request_id uniqueness is global across company/project/thread scopes');
    console.log(
      '  ✓ workspace history scope is atomically joined across Company/Project/Conversation',
    );
    console.log(
      '  ✓ lease provenance and destructive deletion gates are atomic SQLite constraints',
    );
    console.log('  ✓ SQLite permits only one running or interrupted root per Conversation');
  } finally {
    db.close();
  }
}

function verifyWireAndRuntimeContracts(): void {
  const commands = source(paths.commands);
  const runtime = source(paths.runtime);
  const recovery = source(paths.recovery);
  const tools = source(paths.tools);
  const git = source(paths.git);
  const binding = source(paths.binding);
  const workspaceRecovery = source(paths.workspaceRecovery);
  const tauriLib = source(paths.tauriLib);
  const bridgePermissions = source(paths.bridgePermissions);
  const piRun = source(paths.piRun);
  const piMod = source(paths.piMod);
  const missionController = source(paths.missionController);
  const missionLoop = source(paths.missionLoop);
  const evaluationContext = source(paths.evaluationContext);

  const executeRequest = sliceBetween(
    commands,
    'interface PiAgentExecuteRequest',
    'interface PiAgentEnhanceRequest',
    'Pi execute request',
  );
  for (const field of ['requestId:', 'companyId:', 'threadId:', 'projectId:', 'rootRunId:']) {
    assertContains(executeRequest, field, 'Pi execute request');
  }
  assertContains(
    executeRequest,
    'workspaceBindingHistoryId?: string | null;',
    'Pi resume workspace history request',
  );
  assertExcludes(
    executeRequest,
    ['turnId:', 'cwd:', 'workspaceRoot:', 'canonicalRoot:', 'workspaceRef:'],
    'Pi execute request',
  );

  const projection = sliceBetween(
    commands,
    'interface TaskWorkspaceBindingProjectionBase',
    '/** Ephemeral claim',
    'workspace binding projection',
  );
  assertContains(projection, 'turnId: string;', 'workspace binding projection');
  assertContains(
    projection,
    'WorkspaceBindingProvenanceFields<WorkspaceBoundProvenance>',
    'workspace binding discriminated provenance',
  );
  assertExcludes(
    projection,
    ['workspaceRef:', 'canonicalRoot:', 'workspaceRoot:'],
    'workspace binding projection',
  );
  const claim = sliceBetween(
    commands,
    'export type TaskWorkspaceBindingClaim',
    '/** Parse the persistable projection',
    'workspace binding claim',
  );
  assertContains(claim, 'TaskWorkspaceBindingProjection &', 'workspace binding claim');
  assertContains(claim, 'workspaceRef: string;', 'workspace binding claim');
  const evaluationLease = sliceBetween(
    commands,
    'export interface TaskWorkspaceEvaluationLeaseClaim',
    '/** Parse the persistable projection',
    'workspace evaluation lease claim',
  );
  for (const field of [
    'evaluationLeaseRef: string;',
    'historyId: string;',
    'missionId: string;',
    'attemptId: string;',
    'expiresAtUnixMs: number;',
  ]) {
    assertContains(evaluationLease, field, 'workspace evaluation lease claim');
  }
  assertExcludes(
    evaluationLease,
    ['workspaceRef', 'workspaceRoot', 'canonicalRoot', 'displayPath'],
    'workspace evaluation lease claim',
  );
  const resumeCompatibility = sliceBetween(
    commands,
    'export interface TaskWorkspaceResumeCompatibilityArgs',
    '/** Parse the persistable projection',
    'workspace resume compatibility wire',
  );
  for (const field of [
    'historyId: string;',
    'companyId: string;',
    'projectId: string;',
    'threadId: string;',
    'rootRunId: string;',
    "access: 'read' | 'write';",
    "status: 'same' | 'missing' | 'changed';",
    'reason: string;',
  ]) {
    assertContains(resumeCompatibility, field, 'workspace resume compatibility wire');
  }
  assertExcludes(
    resumeCompatibility,
    ['displayPath', 'workspaceRoot', 'canonicalRoot', 'workspaceRef'],
    'workspace resume compatibility wire',
  );
  assertContains(
    commands,
    'task_workspace_evaluation_lease_acquire:',
    'workspace evaluation lease command map',
  );
  assertContains(
    commands,
    'task_workspace_evaluation_lease_release:',
    'workspace evaluation lease command map',
  );
  assertContains(
    commands,
    'task_workspace_resume_compatibility:',
    'workspace resume compatibility command map',
  );
  for (const [text, label] of [
    [binding, 'workspace resume compatibility backend'],
    [tauriLib, 'workspace resume compatibility registration'],
    [bridgePermissions, 'workspace resume compatibility permission'],
  ] as const) {
    assertContains(text, 'task_workspace_resume_compatibility', label);
  }
  const resumeCompatibilityBackend = sliceBetween(
    binding,
    'async fn task_workspace_resume_compatibility_from_pool',
    '/// Read-only preflight for Recovery UI.',
    'workspace resume compatibility backend',
  );
  assertContains(
    resumeCompatibilityBackend,
    'resolve_resumed_workspace_root_from_pool',
    'resume compatibility shares durable recovered-history validation',
  );
  assertExcludes(
    resumeCompatibilityBackend,
    ['SELECT p.workspace_root', 'canonical_root_text', 'resume_identity_matches'],
    'resume compatibility must not compare recovered history to the catalog root',
  );
  for (const token of [
    'ResumedWorkspaceRootError::Incompatible',
    'ResumedWorkspaceRootError::Operational(error)',
    'Err(error)',
  ]) {
    assertContains(
      resumeCompatibilityBackend,
      token,
      'resume compatibility separates durable mismatch from retryable operational failure',
    );
  }
  const projectionParser = sliceBetween(
    commands,
    'export function parseTaskWorkspaceBindingProjection',
    'export interface CodexPetMetadata',
    'workspace binding projection parser',
  );
  assertContains(projectionParser, 'return {', 'workspace binding projection parser');
  assertContains(
    projectionParser,
    'parseWorkspaceBoundProvenance(',
    'workspace binding projection shares the discriminated provenance parser',
  );
  assertExcludes(
    projectionParser,
    ['workspaceRef', 'canonicalRoot', 'workspaceRoot', '...record', '...value'],
    'workspace binding projection parser',
  );
  assertContains(
    commands,
    "| ({ kind: 'workspaceBound' } & TaskWorkspaceBindingClaim)",
    'workspaceBound renderer event',
  );
  assertContains(commands, "kind: 'workspaceUnavailable'", 'workspaceUnavailable renderer event');
  assertContains(
    commands,
    "workspaceRequirement: 'optional' | 'required';",
    'workspace requirement request wire',
  );

  const persistedRunContext = sliceBetween(
    runtime,
    'interface PersistedRunContext',
    'interface SharedHostStreamState',
    'persisted runtime context',
  );
  assertContains(
    persistedRunContext,
    'workspaceBinding: TaskWorkspaceBindingProjection | null;',
    'persisted runtime context',
  );
  for (const field of [
    'workspaceRequirement: WorkspaceRequirement;',
    "workspaceAvailability: 'pending' | 'bound' | 'unavailable';",
    'workspaceProvenance?: WorkspaceProvenance;',
  ]) {
    assertContains(persistedRunContext, field, 'persisted workspace state');
  }
  assertExcludes(
    persistedRunContext,
    [
      'TaskWorkspaceBindingClaim',
      'workspaceRef',
      'workspaceRoot',
      'canonicalRoot',
      'workspaceDisclosure',
      'workspaceSource',
      'workspaceReasonCode',
    ],
    'persisted runtime context',
  );
  const projectionBuilder = sliceBetween(
    runtime,
    'function projectWorkspaceBinding',
    'function bindingMatchesRun',
    'runtime workspace projection',
  );
  assertContains(
    projectionBuilder,
    'parseTaskWorkspaceBindingProjection(claim)',
    'runtime workspace projection',
  );
  assert.equal(
    runtime.split('runtimeContext.workspaceBinding = projectWorkspaceBinding(event)').length - 1,
    1,
    'the shared live/reattach consumer must persist only the safe projection',
  );
  assert.equal(
    runtime.split('this.consumeSharedHostEvent({').length - 1,
    2,
    'live and reattached streams must both use the same typed host-event consumer',
  );
  assert.ok(
    !runtime.includes('runtimeContext.workspaceBinding = event'),
    'the ephemeral workspaceBound claim must never be assigned directly to runtime_context',
  );
  assertContains(
    piMod,
    'replay_workspace_bound_for_request(&app, &request_id)',
    'reattach workspace authority replay',
  );
  assert.ok(
    runtime.indexOf("if (event.kind === 'workspaceBound')") <
      runtime.indexOf('this.invokeReattach('),
    'reattach must install the workspaceBound handler before requesting replay',
  );

  assert.equal(
    runtime.split('this.persistArtifact(agentEvent, state.workspaceGate.claim)').length - 1,
    1,
    'the shared live/reattach artifact path must pass the complete ephemeral claim',
  );
  const artifactPersistence = sliceBetween(
    runtime,
    'private async persistArtifact(',
    'private async persistMcpToolCall(',
    'artifact persistence',
  );
  assertContains(
    artifactPersistence,
    'bindingClaim: TaskWorkspaceBindingClaim | null',
    'artifact persistence',
  );
  assertContains(artifactPersistence, "invokeCommand('project_read_file'", 'artifact persistence');
  assertContains(artifactPersistence, 'projectId: bindingClaim.projectId', 'artifact persistence');
  assertContains(artifactPersistence, 'bindingClaim,', 'artifact persistence');

  const runResult = sliceBetween(
    runtime,
    'export interface DesktopAgentRunResult',
    'export type { AiBillingMode',
    'desktop run result',
  );
  assertContains(
    runResult,
    'workspaceBindingClaim?: TaskWorkspaceBindingClaim;',
    'desktop run result',
  );
  assertContains(
    runtime,
    'Backend completed a workspace-required Turn without a binding claim.',
    'workspace-required Turn binding requirement',
  );
  assertContains(
    runtime,
    'Backend completed the Turn without declaring workspace availability.',
    'optional Turn availability declaration requirement',
  );
  assertContains(
    runtime,
    'canConsumeWorkspaceEvent(state.workspaceGate, event, input.policy)',
    'runtime events cannot mutate an interrupted row before workspace binding',
  );
  assertContains(
    runtime,
    'workspaceBindingClaim: workspaceBindingGate.claim',
    'bound Turn result claim',
  );
  assertContains(
    runtime,
    'resolveWorkspaceRequirement(input, commandName)',
    'workspace requirement',
  );
  assertContains(runtime, 'input.missionId?.trim()', 'Mission workspace requirement');
  assertContains(runtime, 'input.directDelegation', 'delegation workspace requirement');
  assertContains(runtime, 'workspaceRequirement,', 'workspace requirement backend request');
  const projectPreflight = source(
    `${ROOT}/apps/desktop/renderer/src/runtime/require-project-workspace.ts`,
  );
  assertExcludes(
    projectPreflight,
    ['project.workspace_root', 'Project folder is unavailable'],
    'renderer project ownership preflight',
  );
  assertContains(
    runtime,
    "event.kind === 'workspaceUnavailable'",
    'live and reattach workspace unavailable handling',
  );
  assertContains(
    runtime,
    "evidenceClass: 'offisim-gateway'",
    'workspace status projection provenance',
  );
  const resume = sliceBetween(
    runtime,
    'async resume(runId: string, signal?: AbortSignal)',
    'async reattachLiveRuns',
    'desktop resume authority preflight',
  );
  assertContains(
    resume,
    '!workspaceBinding.historyId.trim()',
    'desktop resume authority preflight',
  );
  assertContains(
    resume,
    'workspaceBinding.turnId !== row.root_run_id',
    'desktop resume scope preflight',
  );
  const compatibilityIndex = resume.indexOf("invokeCommand('task_workspace_resume_compatibility'");
  const abortCheckIndex = resume.indexOf('throwIfRunAborted(signal)', compatibilityIndex);
  assert.ok(
    compatibilityIndex >= 0 && abortCheckIndex > compatibilityIndex,
    'Stop must be rechecked after the async Resume compatibility preflight',
  );
  assertContains(resume, 'workspaceBinding,\n      signal,', 'Resume signal forwarding');
  assertContains(
    runtime,
    "signal?.addEventListener('abort', abortFromSignal",
    'native Resume abort',
  );
  assertContains(
    resume,
    'workspaceBinding.access !== row.access',
    'desktop resume access preflight',
  );
  assertContains(resume, "'agent_runtime_resume',", 'desktop resume command');
  assertContains(resume, 'workspaceBinding,', 'desktop resume history handoff');
  assertExcludes(
    resume,
    ["updateStatus(runId, 'running'"],
    'resume must not mutate interrupted status before backend compatibility',
  );
  assertContains(
    resume,
    "invokeCommand('task_workspace_resume_compatibility'",
    'desktop resume backend compatibility preflight',
  );
  assertContains(
    resume,
    "compatibility.status !== 'same'",
    'desktop resume consumes only the compatibility enum',
  );
  assertContains(
    runtime,
    'workspaceBindingHistoryId: resumeWorkspaceBinding?.historyId',
    'desktop resume backend history request',
  );
  assertContains(
    runtime,
    "commandName === 'agent_runtime_resume' && !rootRunOpened",
    'resume TOCTOU failure preserves interrupted recovery state',
  );
  const runNativeTurn = sliceBetween(
    runtime,
    'private async runNativeTurn(',
    '/** Mark the root run terminal',
    'desktop run persistence boundary',
  );
  const rootReadbackIndex = runNativeTurn.indexOf(
    'const openedRoot = await this.repos.agentRuns.findById(runScope.runId)',
  );
  const finalAbortCheckIndex = runNativeTurn.indexOf('throwIfRunAborted(signal)', rootReadbackIndex);
  const nativeInvokeIndex = runNativeTurn.indexOf('hostCommandStarted = true', rootReadbackIndex);
  assert.ok(
    rootReadbackIndex >= 0 &&
      finalAbortCheckIndex > rootReadbackIndex &&
      nativeInvokeIndex > finalAbortCheckIndex,
    'root authority readback and final Stop check must both precede native execution',
  );
  const preflightTerminal = sliceBetween(
    runNativeTurn,
    'if (!hostCommandStarted)',
    '} else {',
    'pre-native terminal convergence',
  );
  assertContains(
    preflightTerminal,
    'await commitFailedTerminal()',
    'pre-native Stop/error terminalizes an already-open root',
  );
  const rootTerminal = sliceBetween(
    runtime,
    'private async persistRootTerminal(',
    '/** Persist a delegation run',
    'atomic root terminal persistence',
  );
  for (const expected of [
    'this.repos.asyncTransact',
    'tx.agentRuns.updateStatus(rootRunId, status',
    'persistChatMessageWithRepositories',
  ]) {
    assertContains(rootTerminal, expected, 'atomic root + Conversation terminal persistence');
  }
  const streamCursorPersistence = sliceBetween(
    runtime,
    'private async persistRunStreamCursor(',
    'async execute(',
    'atomic assistant checkpoint cursor persistence',
  );
  assertContains(
    streamCursorPersistence,
    'persistConversationStreamCheckpointWithRepositories',
    'runtime must use the behaviorally tested assistant checkpoint transaction',
  );
  assertContains(
    runtime,
    'readonly ownsConversationProjectionPersistence = true',
    'production runtime owns conversation checkpoint persistence',
  );
  assertContains(
    source(paths.conversationController),
    'run.runtime?.ownsConversationProjectionPersistence',
    'controller must not race the runtime with an independent assistant checkpoint',
  );
  assertContains(
    recovery,
    "invokeCommand('task_workspace_resume_compatibility', args)",
    'recovery card backend compatibility preflight',
  );
  assertExcludes(
    recovery,
    ["invokeCommand('project_exists'", 'displayPath ===', 'displayPath !=='],
    'recovery compatibility must not trust catalog existence or displayPath',
  );
  const discardRecovery = sliceBetween(
    recovery,
    'const discard = useCallback',
    'const resume = useCallback',
    'interrupted run discard authority',
  );
  assertContains(
    discardRecovery,
    'discardInterruptedRunRecoveryCard(',
    'interrupted run discard backend CAS',
  );
  assertExcludes(
    discardRecovery,
    ['updateStatusForCompany', "'cancelled'", 'removeCard('],
    'interrupted run discard must not bypass backend resume/discard CAS',
  );
  assertContains(
    recovery,
    "invokeCommand('task_workspace_interrupted_run_cancel', args)",
    'interrupted run discard command',
  );
  assertContains(
    commands,
    'task_workspace_interrupted_run_cancel:',
    'interrupted run discard command map',
  );

  assertExcludes(
    missionController,
    ['workspaceRoot', 'repos.projects', '.projects?.findById'],
    'Mission controller workspace authority',
  );
  assertContains(
    missionController,
    'bindingClaim = result.workspaceBindingClaim;',
    'Mission controller Turn claim capture',
  );
  assert.ok(
    missionController.indexOf('setRootRunId(input.attemptId, attemptRunId)') <
      missionController.indexOf(
        'deps.agentRuntime.execute(runInput, attemptAbortController.signal)',
      ),
    'Mission attempt rootRunId must persist before the paid/writing runtime starts',
  );
  assertContains(
    missionController,
    'attemptAbortController.abort()',
    'Mission deadline and user cancellation share the preflight-safe signal',
  );
  assertContains(
    missionController,
    "code: 'attempt_root_run_persistence'",
    'Mission root identity persistence failure',
  );
  assertContains(
    missionController,
    "invokeCommand('task_workspace_evaluation_lease_acquire', input)",
    'Mission evaluation lease acquire',
  );
  assertContains(
    missionController,
    "invokeCommand('task_workspace_evaluation_lease_release', input)",
    'Mission evaluation lease release',
  );
  assertContains(
    missionController,
    'evaluationLeaseMatchesAttempt(acquired, bindingClaim, input.missionId, input.attemptId)',
    'Mission evaluation lease scope validation',
  );
  assertContains(
    missionController,
    'releaseEvaluationResources: async () =>',
    'Mission evaluation lease cleanup callback',
  );
  assertContains(
    evaluationContext,
    'evaluationLease: TaskWorkspaceEvaluationLeaseClaim | null;',
    'Mission evaluation context',
  );
  assertExcludes(
    evaluationContext,
    ['workspaceRoot', 'bindingClaim'],
    'Mission evaluation context',
  );
  assert.ok(
    evaluationContext.split('evaluationLease,').length - 1 >= 5,
    'file/exists/hash/bash/git capabilities must all forward the bounded evaluation lease',
  );
  assertContains(evaluationContext, 'verificationOnly: true,', 'Mission verification bash lane');
  assertContains(
    evaluationContext,
    "args: ['status', '--porcelain=v1', '-z']",
    'Mission read-only git lane',
  );
  assertContains(
    tools,
    'resolve_task_workspace_evaluation_claim',
    'backend evaluation authority resolver',
  );
  assertExcludes(
    tools,
    ['resolve_task_workspace_verification_claim'],
    'renderer shell must not resolve a completed Turn binding directly',
  );
  assertContains(
    tools,
    'renderer bash_execute does not accept bindingClaim',
    'backend evaluator-only bash lane discriminator',
  );
  assertContains(
    tools,
    'workspace access accepts bindingClaim or evaluationLease, never both',
    'project authority exclusivity',
  );
  assert.ok(
    tools.split('reject_renderer_cwd_for_workspace_authority(').length - 1 >= 7,
    'every cwd-bearing project command must reject renderer cwd under backend authority',
  );
  assertContains(
    git,
    'task workspace authority git lane is restricted to read-only status',
    'backend workspace-authority git restriction',
  );
  assertContains(
    git,
    'git_exec accepts bindingClaim or evaluationLease, never both',
    'backend git authority exclusivity',
  );
  assertContains(
    missionLoop,
    'releaseEvaluationResources?(): void | Promise<void>;',
    'Mission loop cleanup contract',
  );
  assertContains(missionLoop, 'await cleanup?.();', 'Mission loop finally cleanup');
  assertContains(
    missionLoop,
    'evaluation resource cleanup failed',
    'Mission cleanup failure preserves business truth',
  );

  const workspaceRoots = sliceBetween(
    tools,
    'pub(crate) async fn workspace_roots',
    'pub(crate) async fn workspace_roots_for_access',
    'project workspace root lookup',
  );
  assertContains(
    workspaceRoots,
    'projectId is required for project workspace access',
    'project workspace root lookup',
  );
  assertContains(
    workspaceRoots,
    'resolve_authorized_project_workspace(app, project_id)',
    'project workspace root lookup',
  );
  assertExcludes(
    workspaceRoots,
    ['SELECT workspace_root', 'FROM projects'],
    'project workspace root lookup',
  );
  const protectedProjectResolver = sliceBetween(
    binding,
    'pub(crate) async fn resolve_authorized_project_workspace_from_pool',
    'pub(crate) async fn resolve_authorized_project_workspace<',
    'protected Project workspace resolver',
  );
  for (const predicate of [
    'JOIN project_workspace_authority AS authority',
    'authority.canonical_root = project.workspace_root',
    'WHERE project.project_id = ?',
    'authority.verify_live()?;',
  ]) {
    assertContains(protectedProjectResolver, predicate, 'protected Project workspace resolver');
  }

  const issuer = sliceBetween(
    binding,
    'async fn record_task_workspace_binding_from_pool',
    'pub(crate) async fn resolve_task_workspace_binding',
    'workspace binding issuer',
  );
  for (const token of [
    'authority_snapshot_canonical_root',
    'authority_snapshot_root_identity_json',
    'authority_snapshot_updated_at_unix_ms',
    'AND EXISTS (',
    'for authority_attempt in 0..2',
    'publish_resolved_task_workspace_binding(',
  ]) {
    assertContains(issuer, token, 'workspace binding authority CAS');
  }
  assertContains(
    issuer,
    'WorkspaceRootResolution::Unavailable',
    'workspace binding unavailable result',
  );
  const recoveredPublisher = sliceBetween(
    binding,
    'async fn publish_resolved_task_workspace_binding',
    'pub(crate) async fn resolve_task_workspace_for_turn',
    'recovered workspace capability publisher',
  );
  for (const token of [
    'resume.is_some()',
    'resolved.verify_live()',
    'verify_initial_recovery_issuance()',
  ]) {
    assertContains(recoveredPublisher, token, 'initial recovery-only repository signing recheck');
  }
  const recoveryScope = sliceBetween(
    workspaceRecovery,
    'async fn load_project_workspace',
    'async fn load_successful_witnesses',
    'workspace recovery scope',
  );
  for (const predicate of [
    'FROM chat_threads AS thread',
    'JOIN projects AS project ON project.project_id = thread.project_id',
    'WHERE thread.thread_id = ? AND project.project_id = ? AND project.company_id = ?',
  ]) {
    assertContains(recoveryScope, predicate, 'workspace recovery scope');
  }
  const evaluationScope = sliceBetween(
    binding,
    'async fn verify_evaluation_scope',
    'pub(crate) async fn resolve_task_workspace_evaluation_claim',
    'Mission evaluation backend scope',
  );
  for (const token of [
    'JOIN mission_attempt AS a ON a.attempt_id = ?',
    'current_attempt_id.as_deref() != Some(attempt_id)',
    'root_run_id.as_deref() != Some(turn_id)',
    'EvaluationScopePhase::Acquire => "running"',
    'EvaluationScopePhase::Use => "verifying"',
  ]) {
    assertContains(
      token.includes('EvaluationScopePhase') ? binding : evaluationScope,
      token,
      'Mission evaluation backend scope',
    );
  }
  const execute = sliceBetween(
    piRun,
    'async fn do_execute',
    'async fn do_enhance',
    'Pi execute binding path',
  );
  assertContains(
    execute,
    'let turn_id = required_text(req.root_run_id.as_ref(), "rootRunId", PI_LANE)?;',
    'Pi execute binding path',
  );
  assertContains(execute, 'turn_id,', 'Pi execute binding path');
  const workspaceBound = sliceBetween(
    binding,
    'pub(crate) fn workspace_bound_event',
    'pub(crate) fn replay_workspace_bound_for_request',
    'workspaceBound event',
  );
  assertContains(
    workspaceBound,
    'turn_id: binding.turn_id.clone()',
    'workspaceBound event rootRunId projection',
  );

  console.log(
    '  ✓ execute wire carries projectId + rootRunId, never cwd/raw roots/duplicate turnId',
  );
  console.log(
    '  ✓ WorkspaceBound projects rootRunId as turnId; persisted context drops the secret ref',
  );
  console.log(
    '  ✓ artifact reads carry the complete claim; catalog lookup has no all-roots fallback',
  );
}

function assertRustTest(file: string, testName: string): void {
  const pattern = new RegExp(
    `#\\[(?:tokio::)?test\\]\\s*(?:async\\s+)?fn\\s+${testName}\\s*\\(`,
    'u',
  );
  assert.match(source(file), pattern, `missing Rust behavioral oracle: ${testName}`);
}

function verifyRustBehavioralOracleNames(): void {
  const tests = [
    [paths.localPaths, 'workspace_root_resolver_rejects_raw_and_canonical_overbroad_roots'],
    [paths.localPaths, 'workspace_root_resolver_accepts_specific_project_folder'],
    [paths.localPaths, 'canonicalize_or_parent_resolves_symlink_to_outside_target'],
    [paths.tools, 'rejects_symlink_escape_before_write_target_resolution'],
    [paths.tools, 'anchored_write_rejects_swapped_parent_symlink_without_touching_outside'],
    [paths.tools, 'evaluator_bash_requires_explicit_lease_lane_and_backend_cwd'],
    [paths.git, 'binding_git_lane_only_accepts_read_only_status'],
    [paths.git, 'workspace_lease_agent_run_requires_exact_live_child_provenance'],
    [paths.git, 'registration_insert_failure_rolls_back_worktree_and_branch'],
    [paths.binding, 'registry_enforces_scope_access_expiry_and_revoked_read_grace'],
    [paths.binding, 'revoked_read_grace_covers_terminal_stream_replay_window'],
    [paths.binding, 'binding_expiry_transition_is_idempotent_and_preserves_read_grace'],
    [paths.binding, 'read_binding_never_authorizes_write'],
    [paths.binding, 'read_binding_never_authorizes_verification'],
    [paths.binding, 'revoked_write_binding_allows_only_read_for_full_terminal_grace'],
    [paths.binding, 'evaluation_lease_is_bounded_nonrenewable_and_never_direct_write'],
    [paths.binding, 'evaluation_lifecycle_separates_running_acquire_from_verifying_use'],
    [paths.binding, 'live_authority_recheck_rejects_expiry_scope_and_root_replacement'],
    [paths.binding, 'claim_projection_cannot_forge_history_access_or_catalog_project'],
    [
      paths.binding,
      'resume_compatibility_accepts_durable_recovered_history_without_returning_root',
    ],
    [paths.binding, 'registry_rejects_replaced_root_identity'],
    [paths.binding, 'resume_and_discard_are_atomic_and_mutually_exclusive'],
    [paths.binding, 'authority_snapshot_cas_rejects_reselection_after_resolver_barrier'],
    [paths.workspaceRecovery, 'injected_truncated_scan_never_signs_an_observed_unique_match'],
    [
      paths.workspaceRecovery,
      'repository_match_rejects_effective_origin_change_before_binding_issuance',
    ],
    [paths.workspaceRecovery, 'truncated_known_anchor_query_never_signs_an_observed_unique_match'],
    [
      paths.binding,
      'interrupted_discard_without_projection_is_safe_but_fail_closed_for_live_writers',
    ],
    [
      paths.binding,
      'deletion_preflight_reports_active_bindings_and_retained_leases_by_exact_scope',
    ],
    [paths.tools, 'evaluation_shell_timeout_is_bounded_by_backend_and_lease'],
    [paths.tools, 'evaluation_shell_reuses_the_rust_deny_classifier'],
    [paths.tools, 'evaluation_pipe_reader_stops_at_the_backend_memory_cap'],
    [paths.tools, 'evaluation_process_group_termination_reaps_descendants'],
    [paths.tools, 'evaluation_successful_leader_exit_still_reaps_background_descendants'],
    [
      paths.tools,
      'shell_lifetime_marker_reaps_a_close_fds_detached_child_that_keeps_environment_marker',
    ],
    [paths.tools, 'shell_lifetime_cleanup_documents_marker_stripping_daemon_boundary'],
  ] as const;
  for (const [file, testName] of tests) assertRustTest(file, testName);

  console.log(
    '  ℹ canonical/symlink/expiry/tool containment is not proven by this source harness;',
  );
  console.log(
    `    its behavioral oracle remains the locked Rust tests: ${tests.map(([, testName]) => testName).join(', ')}`,
  );
  console.log('  ✓ required Rust behavioral oracle tests exist');
}

function verifyWorkspaceBindingStreamGate(): void {
  const matchingClaim = { historyId: 'history-good', workspaceRef: 'ref-good' };
  const mismatchedClaim = { historyId: 'history-wrong', workspaceRef: 'ref-wrong' };
  const unavailable = {
    projectId: 'project-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    requestId: 'request-1',
    source: 'workspace_recovery',
    reasonCode: 'none',
  };

  const pendingExecute = createWorkspaceBindingGate<typeof matchingClaim>();
  assert.equal(
    canConsumeWorkspaceEvent(pendingExecute, 'result', 'bound-required'),
    false,
    'execute/resume must not consume a terminal result before workspaceBound',
  );
  const rejectedOutOfOrderExecute = rejectWorkspaceBinding(pendingExecute);
  assert.equal(
    acceptWorkspaceBinding(rejectedOutOfOrderExecute, matchingClaim, true, true).status,
    'rejected',
    'a runtime event before workspaceBound must poison execute/resume permanently',
  );
  const rejectedExecute = acceptWorkspaceBinding(pendingExecute, mismatchedClaim, false, false);
  const cannotRecoverFromMismatch = acceptWorkspaceBinding(
    rejectedExecute,
    matchingClaim,
    true,
    true,
  );
  assert.equal(
    cannotRecoverFromMismatch.status,
    'rejected',
    'a later matching workspaceBound must never recover a mismatched stream',
  );
  assert.equal(
    canConsumeWorkspaceEvent(cannotRecoverFromMismatch, 'result', 'bound-required'),
    false,
    'resume mismatch followed by result must preserve the interrupted row',
  );
  const boundThenRejected = acceptWorkspaceBinding(
    acceptWorkspaceBinding(pendingExecute, matchingClaim, true, true),
    mismatchedClaim,
    false,
    false,
  );
  assert.equal(boundThenRejected.status, 'rejected');
  assert.equal(
    canConsumeWorkspaceEvent(boundThenRejected, 'result', 'bound-required'),
    false,
    'a mismatch after valid binding must fail the opened resume instead of completing it',
  );
  const replacementAfterBound = acceptWorkspaceBinding(
    acceptWorkspaceBinding(pendingExecute, matchingClaim, true, true),
    { historyId: 'history-replacement', workspaceRef: 'ref-replacement' },
    true,
    false,
  );
  assert.equal(
    replacementAfterBound.status,
    'rejected',
    'a second scope-matching claim cannot replace the first workspaceRef/historyId',
  );

  const pendingOptional = createWorkspaceBindingGate<typeof matchingClaim, typeof unavailable>();
  const unavailableOptional = acceptWorkspaceUnavailable(pendingOptional, unavailable, true, true);
  assert.equal(unavailableOptional.status, 'unavailable');
  for (const kind of ['started', 'messageDelta', 'messageEnd', 'result', 'error']) {
    assert.equal(
      canConsumeWorkspaceEvent(unavailableOptional, kind, 'workspace-optional'),
      true,
      `optional no-workspace stream must accept safe ${kind}`,
    );
  }
  assert.equal(
    canConsumeWorkspaceEvent(
      unavailableOptional,
      { kind: 'tool', toolName: 'project_workspace_required' },
      'workspace-optional',
    ),
    true,
    'optional no-workspace stream accepts only the project-workspace-required control tool',
  );
  for (const event of [
    { kind: 'tool', toolName: 'bash' },
    { kind: 'agentRun' },
    { kind: 'uiRequest' },
  ]) {
    assert.equal(
      canConsumeWorkspaceEvent(unavailableOptional, event, 'workspace-optional'),
      false,
      `optional no-workspace stream must reject ${event.kind}`,
    );
  }
  assert.equal(
    canConsumeWorkspaceEvent(unavailableOptional, 'started', 'bound-required'),
    false,
    'workspace-required run cannot start after an unavailable declaration',
  );
  assert.equal(
    canConsumeWorkspaceEvent(unavailableOptional, 'error', 'bound-required'),
    true,
    'workspace-required run may surface the backend terminal error',
  );
  assert.equal(
    acceptWorkspaceBinding(unavailableOptional, matchingClaim, true, true).status,
    'rejected',
    'a workspace cannot bind after the Turn declared itself unavailable',
  );
  const boundOptional = acceptWorkspaceBinding(pendingOptional, matchingClaim, true, true);
  assert.equal(
    acceptWorkspaceUnavailable(boundOptional, unavailable, true, true).status,
    'rejected',
    'a bound workspace cannot later become unavailable',
  );
  assert.equal(
    acceptWorkspaceUnavailable(
      unavailableOptional,
      { ...unavailable, reasonCode: 'ambiguous' },
      true,
      false,
    ).status,
    'rejected',
    'an unavailable explanation cannot change after it was accepted',
  );

  const pendingLiveReattach = createWorkspaceBindingGate<typeof matchingClaim>();
  assert.equal(
    canConsumeWorkspaceEvent(pendingLiveReattach, 'started', 'bound-required'),
    false,
    'a live reattach must ignore running events before workspaceBound',
  );
  assert.equal(
    canConsumeWorkspaceEvent(pendingLiveReattach, 'result', 'bound-required'),
    false,
    'a snapshot that was live must not reconcile a later terminal without workspaceBound',
  );

  const pendingTerminalReattach = createWorkspaceBindingGate<typeof matchingClaim>();
  assert.equal(
    canConsumeWorkspaceEvent(pendingTerminalReattach, 'result', 'terminal-reconcile'),
    true,
    'a terminal snapshot without any claim must remain historically reconcilable',
  );
  assert.equal(
    canConsumeWorkspaceEvent(pendingTerminalReattach, 'error', 'terminal-reconcile'),
    true,
    'a terminal error snapshot without any claim must remain historically reconcilable',
  );
  const firstSnapshot = { running: true };
  const reattachSnapshot = { running: false };
  const finalPolicy = reattachSnapshot.running ? 'bound-required' : 'terminal-reconcile';
  assert.equal(firstSnapshot.running, true, 'counterexample begins as a live stream');
  assert.equal(
    canConsumeWorkspaceEvent(pendingTerminalReattach, 'result', finalPolicy),
    true,
    'live-to-terminal reattach must use the command snapshot and reconcile its buffered result',
  );
  const rejectedTerminalReattach = acceptWorkspaceBinding(
    pendingTerminalReattach,
    mismatchedClaim,
    false,
    false,
  );
  assert.equal(
    canConsumeWorkspaceEvent(rejectedTerminalReattach, 'result', 'terminal-reconcile'),
    false,
    'a mismatched claim must permanently block terminal snapshot reconciliation',
  );

  const reattachRuntime = sliceBetween(
    source(paths.runtime),
    'async reattachLiveRuns(rootRunIds?: ReadonlySet<string>)',
    'private async runNativeTurn(',
    'reattach snapshot gate',
  );
  assertContains(
    reattachRuntime,
    'const bufferedEvents: PiAgentHostEvent[] = [];',
    'reattach event buffering',
  );
  assertContains(
    reattachRuntime,
    "bufferedBindingGate.status === 'unavailable'",
    'reattach must decide policy from the atomic command snapshot',
  );
  const runtime = source(paths.runtime);
  assertContains(runtime, 'claim.access === expected.access', 'workspace binding access gate');
  assert.equal(
    runtime.split('this.invokeAbort(requestId)').length - 1,
    1,
    'the backend abort command must have one coalesced call site',
  );
  assert.ok(
    runtime.split('this.invokeAbortOnce(requestId)').length - 1 >= 3,
    'binding rejection and user Stop must share the native abort transport coalescer',
  );
  assertContains(
    runtime,
    "snapshot?.terminal?.status === 'aborted'",
    'Stop authoritative aborted snapshot gate',
  );
  assertContains(runtime, 'StopLostTerminalRaceError', 'Stop versus natural terminal arbitration');
  assert.ok(
    runtime.split('if (bindingAbortPromise) await bindingAbortPromise').length - 1 >= 3,
    'binding rejection must await backend termination before returning from the runtime boundary',
  );
  assertContains(
    runtime,
    'isSameWorkspaceBindingClaim(state.workspaceGate.claim, event)',
    'bound claim replacement gate',
  );
  assertContains(
    reattachRuntime,
    'isSameWorkspaceBindingClaim(bufferedBindingGate.claim, event)',
    'reattach buffered claim replacement gate',
  );

  console.log('  ✓ workspace binding stream gate is monotonic and terminal replay stays bounded');
}

function verifyWorkspaceProvenanceParser(): void {
  const legalPairs = [
    ['project_catalog', 'current_project_folder'],
    ['conversation_history', 'recent_successful_workspace'],
    ['known_root_recovery', 'renamed_same_filesystem_object'],
    ['known_root_recovery', 'unique_name_repo_identity_match'],
    ['resume_history', 'resume_history_identity_match'],
  ] as const;
  const sources = [
    'project_catalog',
    'conversation_history',
    'known_root_recovery',
    'resume_history',
  ] as const;
  const reasons = [
    'current_project_folder',
    'recent_successful_workspace',
    'renamed_same_filesystem_object',
    'unique_name_repo_identity_match',
    'resume_history_identity_match',
  ] as const;
  const baseProjection = {
    historyId: 'history-1',
    companyId: 'company-1',
    projectId: 'project-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    requestId: 'request-1',
    access: 'write',
    confidence: 1,
    issuedAtUnixMs: 1,
    expiresAtUnixMs: 2,
    displayPath: '/fixture/project-1',
  } as const;

  for (const [sourceValue, reasonCode] of legalPairs) {
    const provenance = parseWorkspaceBoundProvenance(
      sourceValue,
      reasonCode,
      baseProjection.displayPath,
    );
    assert.deepEqual(provenance, {
      availability: 'bound',
      source: sourceValue,
      reasonCode,
      displayPath: baseProjection.displayPath,
    });
    assert.deepEqual(
      parseTaskWorkspaceBindingProjection({ ...baseProjection, source: sourceValue, reasonCode }),
      {
        ...baseProjection,
        source: sourceValue,
        reasonCode,
      },
    );
  }

  for (const sourceValue of sources) {
    for (const reasonCode of reasons) {
      if (legalPairs.some(([source, reason]) => source === sourceValue && reason === reasonCode)) {
        continue;
      }
      assert.equal(
        parseWorkspaceBoundProvenance(sourceValue, reasonCode, baseProjection.displayPath),
        null,
        `${sourceValue}/${reasonCode} must not parse as bound provenance`,
      );
      assert.equal(
        parseTaskWorkspaceBindingProjection({ ...baseProjection, source: sourceValue, reasonCode }),
        null,
        `${sourceValue}/${reasonCode} must not parse as a persisted projection`,
      );
    }
  }

  console.log('  ✓ TypeScript workspace provenance parser accepts only exact source/reason pairs');
}

function main(): void {
  console.log('project-workspace contract');
  verifySqlOracle(source(paths.schema));
  verifyWireAndRuntimeContracts();
  verifyWorkspaceProvenanceParser();
  verifyWorkspaceBindingStreamGate();
  verifyRustBehavioralOracleNames();
  console.log('project-workspace contract: PASS');
}

try {
  main();
} catch (error) {
  console.error('project-workspace contract: FAIL');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
