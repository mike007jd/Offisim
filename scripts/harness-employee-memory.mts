import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { EmployeeProjectMemoryRow, RuntimeRepositories } from '@offisim/core/browser';
import type { AgentRunEvent } from '@offisim/shared-types';
import Database from 'better-sqlite3';
import { loadPersistedChatMessageWithRepositories } from '../apps/desktop/renderer/src/data/chat-message-events.js';
import { AgentRunPersistence } from '../apps/desktop/renderer/src/runtime/agent-run-persistence.js';
import { EmployeeProjectMemoryDistillationQueue } from '../apps/desktop/renderer/src/runtime/employee-project-memory-distillation-queue.js';
import {
  EMPLOYEE_PROJECT_MEMORY_LIMIT,
  applyEmployeeMemoryCandidates,
  buildProjectExperienceSection,
  parseEmployeeMemoryCandidates,
} from '../apps/desktop/renderer/src/runtime/employee-project-memory.js';

const platformRequire = createRequire(new URL('../apps/platform/package.json', import.meta.url));
const coreBrowserUrl = pathToFileURL(platformRequire.resolve('@offisim/core/dist/browser.js')).href;
type CoreBrowserModule = typeof import('@offisim/core/browser');
const { createMemoryRepositories } = (await import(coreBrowserUrl)) as CoreBrowserModule;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(`${ROOT}/${path}`, 'utf8');
let checks = 0;
function check(value: unknown, message: string): asserts value {
  assert.ok(value, message);
  checks += 1;
}

const schema = read('packages/db-local/src/schema.sql');
const rustSchema = read('apps/desktop/src-tauri/src/local_db.rs');
const tsSchema = read('packages/db-local/src/schema.ts');
const wire = read('scripts/pi-agent-host-wire.mjs');
const rustWire = read('apps/desktop/src-tauri/src/pi_agent_host/wire.rs');
const codexHost = read('apps/desktop/src-tauri/src/codex_agent_host/manager.rs');
const claudeHost = read('apps/desktop/src-tauri/src/claude_agent_host/mod.rs');
const overlay = read('apps/desktop/src-tauri/src/engine_skill_overlay.rs');
const persona = read('apps/desktop/renderer/src/data/employee-persona.ts');
const childSupervisor = read('scripts/pi-child-supervisor.mjs');
const agentRunPersistence = read('apps/desktop/renderer/src/runtime/agent-run-persistence.ts');
const distillationQueueSource = read(
  'apps/desktop/renderer/src/runtime/employee-project-memory-distillation-queue.ts',
);

check(
  schema.includes('CREATE TABLE IF NOT EXISTS employee_project_memories'),
  'baseline schema owns employee memories',
);
check(
  /last_hit_at\s+TEXT/u.test(schema),
  'baseline records last hit time for deterministic eviction',
);
check(tsSchema.includes('employeeProjectMemories'), 'Drizzle schema mirrors employee memories');
check(rustSchema.includes('LOCAL_SCHEMA_VERSION: i64 = 18'), 'fresh database schema is version 18');
check(wire.includes('PI_HOST_PROTOCOL_VERSION = 14'), 'JavaScript Pi wire is version 14');
check(rustWire.includes('PI_HOST_PROTOCOL_VERSION: u32 = 14'), 'Rust Pi wire is version 14');
check(wire.includes("'projectExperience'"), 'Pi wire carries project experience');
check(
  codexHost.includes('req.project_experience.as_deref()'),
  'Codex receives project experience through overlay',
);
check(
  claudeHost.includes('req.project_experience.as_deref()'),
  'Claude receives project experience through overlay',
);
check(
  overlay.includes('OFFISIM_PROJECT_EXPERIENCE.md'),
  'external-engine context has an explicit read-only file',
);
check(
  overlay.includes('Permissions::from_mode(0o444)'),
  'external-engine context file is read-only',
);
check(
  persona.includes('listByProjectScope(companyId, projectId)') &&
    persona.includes('projectExperience: teammateExperience.text'),
  'Pi root and delegated employees receive their own Project experience',
);
check(
  childSupervisor.includes('[persona, projectExperience, CHILD_RESULT_GUIDANCE]'),
  'Pi child resource loaders append the delegated employee experience',
);
check(
  /evt\.runId !== evt\.rootRunId[\s\S]*?memoryDistillationQueue\.enqueue\(/u.test(
    agentRunPersistence,
  ),
  'delegated child terminals participate in automatic distillation',
);
check(
  agentRunPersistence.includes('memoryDistillationQueue.enqueue') &&
    agentRunPersistence.includes('cancelActiveForForegroundRun()'),
  'durable root terminal enqueues distillation off-path and yields on new foreground roots',
);
check(
  distillationQueueSource.includes('EmployeeProjectMemoryDistillationTimeoutError') &&
    distillationQueueSource.includes('cancelActiveForForegroundRun'),
  'distillation queue is timeout-bounded and foreground-cancellable',
);

const parsed = parseEmployeeMemoryCandidates(`\`\`\`json
[
  {"type":"pitfall","content":"Run the schema drift gate before release.","mergeIndex":null},
  {"type":"convention","content":"Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456","mergeIndex":null},
  {"type":"convention","content":"Contact user@example.com for access.","mergeIndex":null},
  {"type":"repository_preference","content":"Prefer repository-native harnesses.","mergeIndex":1},
  {"type":"retrospective","content":"A valid retrospective.","mergeIndex":null},
  {"type":"convention","content":"This fourth valid item must be ignored.","mergeIndex":null}
]
\`\`\``);
assert.deepEqual(parsed, [
  { type: 'pitfall', content: 'Run the schema drift gate before release.', mergeIndex: null },
  { type: 'repository_preference', content: 'Prefer repository-native harnesses.', mergeIndex: 1 },
  { type: 'retrospective', content: 'A valid retrospective.', mergeIndex: null },
]);
checks += 2;

const repos = createMemoryRepositories();
const base = {
  company_id: 'company-memory',
  employee_id: 'employee-memory',
  project_id: 'project-memory',
  source_run_id: 'run-memory',
  pinned: false,
  hit_count: 0,
  last_hit_at: null,
};
for (let index = 0; index < EMPLOYEE_PROJECT_MEMORY_LIMIT; index += 1) {
  const at = `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`;
  await repos.employeeProjectMemories.create({
    ...base,
    memory_id: `memory-${index}`,
    memory_type: 'pitfall',
    content: `Lesson ${index}`,
    created_at: at,
    updated_at: at,
  });
}
await repos.employeeProjectMemories.incrementHits(['memory-1'], '2026-08-01T00:00:00.000Z');
await applyEmployeeMemoryCandidates({
  repos,
  companyId: base.company_id,
  employeeId: base.employee_id,
  projectId: base.project_id,
  sourceRunId: base.source_run_id,
  candidates: [{ type: 'convention', content: 'A new lesson at capacity', mergeIndex: null }],
  now: () => '2026-08-02T00:00:00.000Z',
});
let rows = await repos.employeeProjectMemories.listByProject(base.employee_id, base.project_id);
assert.equal(rows.length, EMPLOYEE_PROJECT_MEMORY_LIMIT);
assert.equal(await repos.employeeProjectMemories.findById('memory-0'), null);
check(
  await repos.employeeProjectMemories.findById('memory-1'),
  'a recently hit memory survives capacity eviction',
);

const mergeTarget = rows.find((row) => row.memory_id === 'memory-1');
check(mergeTarget, 'merge target remains present after capacity eviction');
const mergeIndex = rows.findIndex((row) => row.memory_id === mergeTarget.memory_id) + 1;
await applyEmployeeMemoryCandidates({
  repos,
  companyId: base.company_id,
  employeeId: base.employee_id,
  projectId: base.project_id,
  sourceRunId: 'run-new',
  candidates: [{ type: 'retrospective', content: 'Lesson 1, improved after review', mergeIndex }],
  now: () => '2026-08-03T00:00:00.000Z',
});
rows = await repos.employeeProjectMemories.listByProject(base.employee_id, base.project_id);
assert.equal(rows.length, EMPLOYEE_PROJECT_MEMORY_LIMIT);
assert.equal(
  (await repos.employeeProjectMemories.findById('memory-1'))?.content,
  'Lesson 1, improved after review',
);
assert.equal((await repos.employeeProjectMemories.findById('memory-1'))?.source_run_id, 'run-new');
checks += 5;

const fixtureBase = rows[0];
check(fixtureBase, 'capacity fixture retains rows for injection ordering');
const orderedFixture: EmployeeProjectMemoryRow[] = [
  {
    ...fixtureBase,
    memory_id: 'pinned',
    content: 'pinned first',
    pinned: true,
    hit_count: 0,
    updated_at: '2026-08-01T00:00:00.000Z',
  },
  {
    ...fixtureBase,
    memory_id: 'frequent',
    content: 'frequent second',
    pinned: false,
    hit_count: 20,
    updated_at: '2026-08-02T00:00:00.000Z',
  },
  {
    ...fixtureBase,
    memory_id: 'ordinary',
    content: 'ordinary last',
    pinned: false,
    hit_count: 12,
    updated_at: '2026-08-03T00:00:00.000Z',
  },
];
const section = buildProjectExperienceSection(orderedFixture);
assert.deepEqual(section.memoryIds, ['pinned', 'frequent', 'ordinary']);
check(
  section.text?.startsWith('## Project experience'),
  'injection has a visible Project experience section',
);
check((section.text?.length ?? 0) < 6_000, 'injection stays within the 1.5k-token hard estimate');

const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
db.exec(schema);
db.exec(`
  INSERT INTO companies (company_id, name, created_at, updated_at) VALUES
    ('company-a', 'Company A', '2026-07-18', '2026-07-18'),
    ('company-b', 'Company B', '2026-07-18', '2026-07-18');
  INSERT INTO employees (employee_id, company_id, name, role_slug, created_at, updated_at)
    VALUES ('employee-a', 'company-a', 'Ari', 'developer', '2026-07-18', '2026-07-18');
  INSERT INTO projects (project_id, company_id, name, workspace_root, created_at, updated_at) VALUES
    ('project-a', 'company-a', 'Alpha', '/tmp/alpha', '2026-07-18', '2026-07-18'),
    ('project-b', 'company-b', 'Beta', '/tmp/beta', '2026-07-18', '2026-07-18');
  INSERT INTO agent_runs (
    run_id, thread_id, company_id, project_id, root_run_id, employee_id,
    objective, status, started_at
  ) VALUES ('run-a', 'thread-a', 'company-a', 'project-a', 'run-a', 'employee-a',
    'Learn the repository gate', 'completed', '2026-07-18');
  INSERT INTO employee_project_memories (
    memory_id, company_id, employee_id, project_id, memory_type, content,
    source_run_id, created_at, updated_at
  ) VALUES ('db-memory', 'company-a', 'employee-a', 'project-a', 'pitfall',
    'Run validation before release.', 'run-a', '2026-07-18', '2026-07-18');
`);
assert.equal(
  (db.prepare('SELECT COUNT(*) AS count FROM employee_project_memories').get() as { count: number })
    .count,
  1,
);
assert.throws(() =>
  db
    .prepare(`INSERT INTO employee_project_memories (
  memory_id, company_id, employee_id, project_id, memory_type, content, created_at, updated_at
) VALUES ('bad-scope', 'company-a', 'employee-a', 'project-b', 'pitfall', 'Bad scope', '2026-07-18', '2026-07-18')`)
    .run(),
);
checks += 2;
db.close();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function createScopedRootRun(
  repos: RuntimeRepositories,
  input: {
    companyId: string;
    employeeId: string;
    projectId: string;
    threadId: string;
    runId: string;
    objective: string;
  },
): Promise<void> {
  await repos.agentRuns.create({
    run_id: input.runId,
    thread_id: input.threadId,
    company_id: input.companyId,
    project_id: input.projectId,
    parent_run_id: null,
    root_run_id: input.runId,
    employee_id: input.employeeId,
    relation: null,
    objective: input.objective,
    access: null,
    status: 'running',
  });
}

{
  const DISTILL_TIMEOUT_MS = 40;
  const companyId = 'company-distill-hang';
  const employeeId = 'employee-distill-hang';
  const projectId = 'project-distill-hang';
  const threadId = 'thread-distill-hang';
  const runId = 'run-distill-hang';
  const assistantMessageId = 'assistant-distill-hang';
  const userMessageId = 'user-distill-hang';
  const terminalText = 'Durable terminal summary before hung distillation.';
  const hangRepos = createMemoryRepositories();
  await createScopedRootRun(hangRepos, {
    companyId,
    employeeId,
    projectId,
    threadId,
    runId,
    objective: 'Prove terminal durability under hung distillation',
  });

  let distillEntered = false;
  const distillationErrors: Error[] = [];
  const hangQueue = new EmployeeProjectMemoryDistillationQueue({
    timeoutMs: DISTILL_TIMEOUT_MS,
    distill: async () => {
      distillEntered = true;
      await new Promise<never>(() => {});
    },
    onError: (_job, error) => {
      if (error instanceof Error) distillationErrors.push(error);
      else distillationErrors.push(new Error(String(error)));
    },
  });
  const hangPersistence = new AgentRunPersistence(companyId, hangRepos, hangQueue);

  let distillationTimedOut = false;
  const timeoutWatch = sleep(DISTILL_TIMEOUT_MS).then(() => {
    distillationTimedOut = true;
    return 'timeout' as const;
  });
  const persistOutcome = await Promise.race([
    hangPersistence
      .persistRootTerminal(runId, 'completed', undefined, undefined, {
        context: {
          conversationProjection: {
            assistantMessageId,
            userMessageId,
            source: 'office',
          },
          createdAt: '2026-07-21T00:00:00.000Z',
        },
        terminal: {
          runId,
          status: 'completed',
          text: terminalText,
        },
      })
      .then(() => 'persisted' as const),
    timeoutWatch,
  ]);
  assert.equal(persistOutcome, 'persisted');
  check(
    !distillationTimedOut,
    'persistRootTerminal resolves before the injected distillation timeout',
  );

  await sleep(10);
  check(distillEntered, 'hung distillation still starts after durable terminal commit');

  const durableRun = await hangRepos.agentRuns.findById(runId);
  assert.equal(durableRun?.status, 'completed');
  const durableMessage = await loadPersistedChatMessageWithRepositories({
    repos: hangRepos,
    threadId,
    messageId: assistantMessageId,
  });
  assert.equal(durableMessage?.body, terminalText);
  assert.equal(durableMessage?.status, 'complete');
  checks += 3;

  await hangQueue.drain();
  assert.equal(distillationErrors.length, 1);
  assert.equal(distillationErrors[0]?.name, 'EmployeeProjectMemoryDistillationTimeoutError');
  assert.equal((await hangRepos.agentRuns.findById(runId))?.status, 'completed');
  assert.equal(
    (
      await loadPersistedChatMessageWithRepositories({
        repos: hangRepos,
        threadId,
        messageId: assistantMessageId,
      })
    )?.body,
    terminalText,
  );
  checks += 3;
}

{
  const CANCEL_TIMEOUT_MS = 200;
  const companyId = 'company-distill-cancel';
  const employeeId = 'employee-distill-cancel';
  const projectId = 'project-distill-cancel';
  const threadId = 'thread-distill-cancel';
  const hangRunId = 'run-distill-cancel-hang';
  const foregroundRunId = 'run-distill-cancel-fg';
  const cancelRepos = createMemoryRepositories();
  await createScopedRootRun(cancelRepos, {
    companyId,
    employeeId,
    projectId,
    threadId,
    runId: hangRunId,
    objective: 'Hang until a foreground root starts',
  });

  const signals: string[] = [];
  const cancelErrors: Error[] = [];
  let nextJobFinished = false;
  const cancelQueue = new EmployeeProjectMemoryDistillationQueue({
    timeoutMs: CANCEL_TIMEOUT_MS,
    distill: async (job) => {
      signals.push(`start:${job.run.run_id}`);
      if (job.run.run_id === hangRunId) {
        await new Promise<never>(() => {});
      }
      signals.push(`done:${job.run.run_id}`);
      nextJobFinished = true;
    },
    onError: (_job, error) => {
      if (error instanceof Error) cancelErrors.push(error);
      else cancelErrors.push(new Error(String(error)));
    },
  });
  const cancelPersistence = new AgentRunPersistence(companyId, cancelRepos, cancelQueue);

  await cancelPersistence.persistRootTerminal(hangRunId, 'completed', undefined, undefined, {
    context: {
      conversationProjection: {
        assistantMessageId: 'assistant-distill-cancel',
        userMessageId: 'user-distill-cancel',
        source: 'office',
      },
      createdAt: '2026-07-21T00:00:00.000Z',
    },
    terminal: {
      runId: hangRunId,
      status: 'completed',
      text: 'Hang source terminal.',
    },
  });
  await sleep(10);
  check(
    signals.includes(`start:${hangRunId}`),
    'foreground-cancel fixture starts a never-resolving distillation job',
  );

  const foregroundStarted: AgentRunEvent = {
    type: 'run.started',
    threadId,
    rootRunId: foregroundRunId,
    runId: foregroundRunId,
    employeeId,
    payload: {
      objective: 'New foreground root',
      access: 'write',
      projectId,
    },
  };
  const yieldStartedAt = Date.now();
  await cancelPersistence.persistAgentRun(foregroundStarted);
  await cancelQueue.drain();
  const yieldElapsedMs = Date.now() - yieldStartedAt;
  check(
    yieldElapsedMs < CANCEL_TIMEOUT_MS,
    'cancelActiveForForegroundRun via new root run.started yields before queue timeout',
  );
  assert.equal(cancelErrors.length, 1);
  assert.equal(cancelErrors[0]?.name, 'EmployeeProjectMemoryDistillationCancelledError');
  assert.equal((await cancelRepos.agentRuns.findById(hangRunId))?.status, 'completed');
  assert.equal((await cancelRepos.agentRuns.findById(foregroundRunId))?.status, 'running');
  checks += 3;

  const followUpRun = await cancelRepos.agentRuns.findById(foregroundRunId);
  check(followUpRun, 'foreground root remains available for the next serialized job');
  cancelQueue.enqueue({
    repos: cancelRepos,
    run: followUpRun,
    status: 'completed',
    summary: 'Follow-up distillation after cancel',
  });
  await cancelQueue.drain();
  check(nextJobFinished, 'queue remains usable for the next serialized distillation job');
  assert.deepEqual(signals, [
    `start:${hangRunId}`,
    `start:${foregroundRunId}`,
    `done:${foregroundRunId}`,
  ]);
  checks += 1;
}

{
  const companyId = 'company-distill-success';
  const employeeId = 'employee-distill-success';
  const projectId = 'project-distill-success';
  const threadId = 'thread-distill-success';
  const runId = 'run-distill-success';
  const successRepos = createMemoryRepositories();
  await createScopedRootRun(successRepos, {
    companyId,
    employeeId,
    projectId,
    threadId,
    runId,
    objective: 'Successful async distillation still completes',
  });

  let successFinished = false;
  const successErrors: Error[] = [];
  const successQueue = new EmployeeProjectMemoryDistillationQueue({
    timeoutMs: 50,
    distill: async (job) => {
      await sleep(10);
      await job.repos.employeeProjectMemories.create({
        memory_id: 'distill-success-memory',
        company_id: job.run.company_id,
        employee_id: employeeId,
        project_id: projectId,
        memory_type: 'retrospective',
        content: 'Async distillation still lands after terminal commit.',
        source_run_id: job.run.run_id,
        pinned: false,
        hit_count: 0,
        last_hit_at: null,
        created_at: '2026-07-21T00:00:10.000Z',
        updated_at: '2026-07-21T00:00:10.000Z',
      });
      successFinished = true;
    },
    onError: (_job, error) => {
      if (error instanceof Error) successErrors.push(error);
      else successErrors.push(new Error(String(error)));
    },
  });
  const successPersistence = new AgentRunPersistence(companyId, successRepos, successQueue);

  await successPersistence.persistRootTerminal(runId, 'completed', undefined, undefined, {
    context: {
      conversationProjection: {
        assistantMessageId: 'assistant-distill-success',
        userMessageId: 'user-distill-success',
        source: 'office',
      },
      createdAt: '2026-07-21T00:00:00.000Z',
    },
    terminal: {
      runId,
      status: 'completed',
      text: 'Success path terminal.',
    },
  });
  assert.equal((await successRepos.agentRuns.findById(runId))?.status, 'completed');
  assert.equal(successFinished, false);
  await successQueue.drain();
  check(successFinished, 'successful distillation still finishes after async decoupling');
  assert.equal(successErrors.length, 0);
  assert.equal(
    (await successRepos.employeeProjectMemories.findById('distill-success-memory'))?.content,
    'Async distillation still lands after terminal commit.',
  );
  checks += 2;
}

console.log(`[employee-memory] ${checks} deterministic checks passed`);
