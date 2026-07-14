#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  acceptWorkspaceBinding,
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
  recovery: `${ROOT}/apps/desktop/renderer/src/runtime/recovery/useInterruptedRunRecovery.ts`,
  missionController: `${ROOT}/apps/desktop/renderer/src/runtime/mission/mission-run-controller.ts`,
  missionLoop: `${ROOT}/packages/core/src/runtime/mission/mission-loop-controller.ts`,
  evaluationContext: `${ROOT}/apps/desktop/renderer/src/runtime/mission/evaluation-context.ts`,
  tools: `${ROOT}/apps/desktop/src-tauri/src/builtin_tools.rs`,
  git: `${ROOT}/apps/desktop/src-tauri/src/git.rs`,
  binding: `${ROOT}/apps/desktop/src-tauri/src/task_workspace_binding.rs`,
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
  bindingId: string;
  canonicalRoot?: string;
  companyId: string;
  projectId: string;
  requestId: string;
  rootIdentityJson?: string;
  status?: string;
  threadId: string;
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
  db.prepare(
    'INSERT INTO task_workspace_binding_history (' +
      'binding_id, company_id, project_id, thread_id, turn_id, request_id, ' +
      'access, canonical_root, root_identity_json, source, confidence, reason_code, ' +
      'issued_at_unix_ms, expires_at_unix_ms, activated_at_unix_ms, ' +
      'last_used_at_unix_ms, status' +
      ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    row.bindingId,
    row.companyId,
    row.projectId,
    row.threadId,
    `turn-${row.bindingId}`,
    row.requestId,
    row.access ?? 'write',
    canonicalRoot,
    row.rootIdentityJson ?? JSON.stringify({ canonicalRoot }),
    'project_catalog',
    1,
    'current_project_folder',
    1_000,
    61_000,
    1_000,
    1_000,
    row.status ?? 'active',
  );
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
    insertThread.run('thread-b', 'project-b', 'Thread B', '2026-07-14', '2026-07-14');
    insertThread.run('thread-cas', 'project-cas', 'Thread CAS', '2026-07-14', '2026-07-14');

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
    'export interface TaskWorkspaceBindingProjection',
    '/** Ephemeral claim',
    'workspace binding projection',
  );
  assertContains(projection, 'turnId: string;', 'workspace binding projection');
  assertExcludes(
    projection,
    ['workspaceRef:', 'canonicalRoot:', 'workspaceRoot:'],
    'workspace binding projection',
  );
  const claim = sliceBetween(
    commands,
    'export interface TaskWorkspaceBindingClaim',
    '/** Parse the persistable projection',
    'workspace binding claim',
  );
  assertContains(claim, 'extends TaskWorkspaceBindingProjection', 'workspace binding claim');
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
  const projectionParser = sliceBetween(
    commands,
    'export function parseTaskWorkspaceBindingProjection',
    'export interface CodexPetMetadata',
    'workspace binding projection parser',
  );
  assertContains(projectionParser, 'return {', 'workspace binding projection parser');
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

  const persistedRunContext = sliceBetween(
    runtime,
    'interface PersistedRunContext',
    'function projectWorkspaceBinding',
    'persisted runtime context',
  );
  assertContains(
    persistedRunContext,
    'workspaceBinding: TaskWorkspaceBindingProjection | null;',
    'persisted runtime context',
  );
  assertExcludes(
    persistedRunContext,
    ['TaskWorkspaceBindingClaim', 'workspaceRef', 'workspaceRoot', 'canonicalRoot'],
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
    2,
    'live and reattached runtime_context paths must persist only the safe projection',
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
      runtime.indexOf("invokeCommand('agent_runtime_reattach'"),
    'reattach must install the workspaceBound handler before requesting replay',
  );

  assert.equal(
    runtime.split('this.persistArtifact(agentEvt, workspaceBindingGate.claim)').length - 1,
    2,
    'live and reattached artifact paths must pass the complete ephemeral claim',
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
    'workspaceBindingClaim: TaskWorkspaceBindingClaim;',
    'desktop run result',
  );
  assertContains(
    runtime,
    'Backend completed the Turn without a task workspace binding claim.',
    'successful Turn binding requirement',
  );
  assertContains(
    runtime,
    'canConsumeWorkspaceEvent(workspaceBindingGate',
    'runtime events cannot mutate an interrupted row before workspace binding',
  );
  assertContains(
    runtime,
    'workspaceBindingClaim: workspaceBindingGate.claim',
    'successful Turn binding result',
  );
  const resume = sliceBetween(
    runtime,
    'async resume(runId: string)',
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
    runtime,
    'workspaceBindingHistoryId: resumeWorkspaceBinding?.historyId',
    'desktop resume backend history request',
  );
  assertContains(
    runtime,
    "commandName === 'agent_runtime_resume' && !rootRunOpened",
    'resume TOCTOU failure preserves interrupted recovery state',
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
      missionController.indexOf('deps.agentRuntime.execute(runInput)'),
    'Mission attempt rootRunId must persist before the paid/writing runtime starts',
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
    'pub(crate) async fn issue_task_workspace_binding',
    'fn host_error_message',
    'workspace binding issuer',
  );
  for (const predicate of [
    'WHERE t.thread_id = ?',
    'AND t.project_id = ?',
    'AND p.company_id = ?',
  ]) {
    assertContains(issuer, predicate, 'workspace binding issuer');
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
      'resume_compatibility_compares_scope_identity_and_access_without_returning_root',
    ],
    [paths.binding, 'registry_rejects_replaced_root_identity'],
    [paths.binding, 'resume_and_discard_are_atomic_and_mutually_exclusive'],
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
    'async reattachLiveRuns()',
    'private async runPiTurn(',
    'reattach snapshot gate',
  );
  assertContains(
    reattachRuntime,
    'const bufferedEvents: PiAgentHostEvent[] = [];',
    'reattach event buffering',
  );
  assertContains(
    reattachRuntime,
    "reattachSnapshot.running || bufferedBindingGate.status === 'bound'",
    'reattach must decide policy from the atomic command snapshot',
  );
  const runtime = source(paths.runtime);
  assertContains(runtime, 'claim.access === expected.access', 'workspace binding access gate');
  assert.ok(
    runtime.split("invokeCommand('agent_runtime_abort', { requestId })").length - 1 >= 3,
    'execute/resume, reattach, and user stop must all reach the backend abort command',
  );
  assert.ok(
    runtime.split('if (bindingAbortPromise) await bindingAbortPromise').length - 1 >= 3,
    'binding rejection must await backend termination before returning from the runtime boundary',
  );
  assertContains(
    runtime,
    'isSameWorkspaceBindingClaim(workspaceBindingGate.claim, event)',
    'bound claim replacement gate',
  );

  console.log('  ✓ workspace binding stream gate is monotonic and terminal replay stays bounded');
}

function main(): void {
  console.log('project-workspace contract');
  verifySqlOracle(source(paths.schema));
  verifyWireAndRuntimeContracts();
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
