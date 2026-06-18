/**
 * pi-loop record/replay gate.
 *
 * Drives the PiOrchestrationService with a deterministic faux StreamFn (no real
 * provider) and in-memory repos, then asserts the kernel's load-bearing
 * invariants: direct chat, multi-round tool execution through the audited
 * executor, explicit deliverable submission, and — critically — the
 * boss → delegate → employee sub-agent → tool → audit mechanism that the
 * agent-as-tool design rests on. A final negative self-test proves the harness
 * records a deliberately failed assertion instead of false-greening it.
 *
 * Replaces the graph-coupled harness:contract/replay/deterministic for the pi
 * kernel. Pure Node (no app, no network).
 */

import {
  InMemoryEventBus,
  PiAgentRegistry,
  PiMessageStore,
  PiOrchestrationService,
  SkillInstallCommitter,
  SkillLoader,
  SkillStagingManager,
  createBudgetTransform,
  createMemoryRepositories,
  createRuntimeContext,
  createSubmitDeliverableTool,
} from '../packages/core/dist/index.js';
import { ModelResolver } from '../packages/core/dist/llm-public.js';
import { agentLoop, agentLoopContinue } from '../packages/pi-agent/dist/index.js';

/** Minimal pi stream: an async-iterable of events + a `result()`, no pi-ai dep. */
function makeFauxStream(startPartial, finalMessage) {
  const events = [
    { type: 'start', partial: startPartial },
    { type: 'done', reason: finalMessage.stopReason, message: finalMessage },
  ];
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
    result() {
      return Promise.resolve(finalMessage);
    },
  };
}

const COMPANY_ID = 'co-test';
const EMP_DEV = 'emp-dev';
const EMP_FE = 'emp-fe';
const FAUX_AGENT_MODEL = {
  id: 'faux-model',
  name: 'Faux Model',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'https://faux.local',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_000,
  maxTokens: 1_024,
};

/** Scripted tool-call literal for a faux turn (explicit id keeps the gate deterministic). */
function toolCall(id, name, args) {
  return { id, name, arguments: args };
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createStoppedStaging(opts = {}) {
  return new SkillStagingManager({
    ...opts,
    setInterval: () => null,
    clearInterval: () => {},
  });
}

function skillConfirmRequest(stagingRef) {
  return { context: { type: 'skill_install_confirm', stagingRef } };
}

const CONFIRM_RESPONSE = { selectedOptionId: 'confirm' };
const CANCEL_RESPONSE = { selectedOptionId: 'cancel' };

function stagedInstallEntry(overrides = {}) {
  return {
    action: 'install',
    companyId: COMPANY_ID,
    tree: { files: [] },
    scan: { root: '', skillMdPath: 'SKILL.md', assetPaths: [] },
    name: 'Harness Skill',
    description: 'Harness skill',
    allowedTools: [],
    skillMdText: '---\nname: Harness Skill\ndescription: Harness skill\n---\nBody',
    source: { kind: 'upload', filename: 'harness.zip' },
    scope: 'company',
    employeeId: null,
    ...overrides,
  };
}

function createMemoryVaultFs(seed = {}) {
  const files = new Map(Object.entries(seed));
  let writeCount = 0;
  return {
    root: 'memory://vault',
    get writeCount() {
      return writeCount;
    },
    hasPath(path) {
      return files.has(path);
    },
    async readFile(path) {
      if (!files.has(path)) throw new Error(`ENOENT ${path}`);
      return files.get(path);
    },
    async writeFile(path, content) {
      writeCount += 1;
      files.set(path, content);
    },
    async listDir() {
      return [];
    },
    async stat(path) {
      const value = files.get(path);
      return value === undefined ? null : { mtimeMs: 1, size: value.length };
    },
    async remove(path) {
      files.delete(path);
    },
    async mkdir() {},
    async exists(path) {
      return files.has(path);
    },
  };
}

function skillRow(overrides = {}) {
  return {
    skill_id: 'sk-harness',
    company_id: COMPANY_ID,
    employee_id: EMP_DEV,
    scope: 'employee',
    slug: 'harness-skill',
    name: 'Harness Skill',
    description: 'Harness skill',
    version: '1.0.0',
    source_kind: 'self-authored',
    source_ref: 'llm-author:faux',
    vault_path: 'companies/co-test/employees/emp-dev/skills/harness-skill/SKILL.md',
    created_at: '1',
    updated_at: '1',
    ...overrides,
  };
}

async function commitEditWithRow(row, stagedOverrides = {}) {
  const repos = await seedRepos();
  await repos.skills.insert(row);
  const fs = createMemoryVaultFs({
    [row.vault_path]:
      '---\nname: Harness Skill\ndescription: Harness skill\nversion: 1.0.0\n---\nOld',
  });
  const loader = new SkillLoader({ skills: repos.skills, employees: repos.employees, fs });
  const staging = createStoppedStaging({ idFactory: () => `stg-${row.skill_id}` });
  let cleanupCalls = 0;
  const staged = staging.put({
    action: 'edit',
    companyId: COMPANY_ID,
    employeeId: EMP_DEV,
    skillId: row.skill_id,
    newBody: 'New body',
    cleanup: async () => {
      cleanupCalls += 1;
    },
    ...stagedOverrides,
  });
  const committer = new SkillInstallCommitter({
    companyId: COMPANY_ID,
    threadId: 't-skill',
    skillLoader: loader,
    staging,
  });
  const outcome = await committer.handle(skillConfirmRequest(staged.stagingRef), CONFIRM_RESPONSE);
  const after = await repos.skills.findById(row.skill_id);
  return { outcome, after, fs, cleanupCalls };
}

/** Build a faux StreamFn that replays scripted turns, keyed by boss vs employee. */
function createFauxStreamFn(scripts) {
  const queues = { boss: [...(scripts.boss ?? [])], employee: [...(scripts.employee ?? [])] };
  return (model, context) => {
    const isBoss = (context.systemPrompt ?? '').includes('founder and boss');
    const queue = isBoss ? queues.boss : queues.employee;
    const spec = queue.shift() ?? { text: '' };
    const content = [];
    if (spec.text) content.push({ type: 'text', text: spec.text });
    for (const tc of spec.toolCalls ?? []) {
      content.push({ type: 'toolCall', id: tc.id, name: tc.name, arguments: tc.arguments });
    }
    const base = {
      role: 'assistant',
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: emptyUsage(),
      stopReason: 'stop',
      timestamp: 1,
    };
    const final = {
      ...base,
      content,
      stopReason: spec.toolCalls?.length ? 'toolUse' : 'stop',
    };
    return makeFauxStream({ ...base }, final);
  };
}

/** A toolExecutor that records calls and returns canned results (stands in for AuditingToolExecutor). */
function createRecordingToolExecutor(audit) {
  return {
    async execute(call) {
      audit.push({ name: call.name, args: call.arguments, employeeId: call.employeeId ?? null });
      if (call.name === 'bash') {
        return { success: true, result: `RAN:${call.arguments.command}` };
      }
      return { success: true, result: 'ok' };
    },
    async listAvailable() {
      return [];
    },
  };
}

const BASH_DEF = {
  name: 'bash',
  description: 'Run a shell command',
  parameters: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command'],
  },
};

async function seedRepos() {
  const repos = createMemoryRepositories();
  await repos.companies.create({
    company_id: COMPANY_ID,
    name: 'Test Co',
    description_json: null,
    tool_name: 'testco',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  for (const [id, name, role] of [
    [EMP_DEV, 'Dev One', 'developer'],
    [EMP_FE, 'Fe Two', 'frontend'],
  ]) {
    await repos.employees.create({
      employee_id: id,
      company_id: COMPANY_ID,
      name,
      role_slug: role,
      persona_json: null,
      config_json: null,
      enabled: 1,
      is_external: 0,
      brand_key: null,
      a2a_url: null,
      a2a_token: null,
      a2a_agent_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  return repos;
}

function buildService(repos, eventBus, audit, scripts) {
  const toolExecutor = createRecordingToolExecutor(audit);
  const modelResolver = new ModelResolver({
    default: { profileName: 'faux', provider: 'openai-compat', model: 'faux-model' },
  });
  const builtinTools = new Map([['bash', { def: BASH_DEF, execute: async () => 'unused' }]]);
  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway: { chat: async () => ({}), chatStream: async function* () {}, dispose() {} },
    modelResolver,
    toolExecutor,
    companyId: COMPANY_ID,
    threadId: 'placeholder',
    builtinTools,
    llmToolCallsEnabled: true,
  });
  return new PiOrchestrationService({
    runtimeCtx,
    registry: new PiAgentRegistry(),
    streamFn: createFauxStreamFn(scripts),
    budgetService: {
      async prepareRequest(_ctx, req) {
        return req;
      },
    },
    modelResolver,
    messageStore: new PiMessageStore(repos.piMessages),
    modelMeta: { baseUrl: 'https://faux.local' },
    virtualToolProvider: (toolCtx, kind) =>
      kind === 'employee' ? [createSubmitDeliverableTool(runtimeCtx, toolCtx)] : [],
  });
}

/** Seed repos + fresh per-scenario event/audit state and wire up the service. */
async function setup(scripts) {
  const repos = await seedRepos();
  const audit = [];
  const eventBus = new InMemoryEventBus();
  const svc = buildService(repos, eventBus, audit, scripts);
  return { svc, repos, audit, eventBus };
}

const failures = [];
let failureSink = failures;
function check(name, cond, detail) {
  if (cond) {
    if (failureSink === failures) console.log(`  PASS ${name}`);
  } else {
    if (failureSink === failures) console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    failureSink.push(name);
  }
}

function captureCheckFailures(fn) {
  const captured = [];
  const previous = failureSink;
  failureSink = captured;
  try {
    fn();
  } finally {
    failureSink = previous;
  }
  return captured;
}

async function collectAgentStream(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return { events, result: await stream.result() };
}

function throwingLoopConfig(message) {
  return {
    model: FAUX_AGENT_MODEL,
    convertToLlm() {
      throw new Error(message);
    },
  };
}

async function scenarioDirectChat() {
  console.log('• direct chat (text)');
  const { svc, audit } = await setup({
    employee: [{ text: 'Hello from Dev One.' }],
  });
  const res = await svc.execute({
    companyId: COMPANY_ID,
    threadId: 't-direct',
    employeeId: EMP_DEV,
    text: 'hi',
  });
  check('final text', res.finalText === 'Hello from Dev One.', res.finalText);
  check('no tools called', audit.length === 0);
}

async function scenarioMultiRoundTools() {
  console.log('• multi-round tools (bash → text)');
  const { svc, audit } = await setup({
    employee: [
      { toolCalls: [toolCall('tc1', 'bash', { command: 'echo hi' })] },
      { text: 'The command printed RAN:echo hi' },
    ],
  });
  const res = await svc.execute({
    companyId: COMPANY_ID,
    threadId: 't-tools',
    employeeId: EMP_DEV,
    text: 'run echo',
  });
  check(
    'bash executed via toolExecutor',
    audit.some((a) => a.name === 'bash'),
  );
  check('bash attributed to employee', audit[0]?.employeeId === EMP_DEV);
  check('final reports tool output', res.finalText.includes('RAN:echo hi'), res.finalText);
}

async function scenarioDeliverable() {
  console.log('• explicit deliverable submission');
  const { svc, eventBus } = await setup({
    employee: [
      {
        toolCalls: [
          toolCall('d1', 'submit_deliverable', { title: 'Report', content: 'body text' }),
        ],
      },
      { text: 'Submitted.' },
    ],
  });
  let deliverableEvent = null;
  eventBus.on('deliverable.created', (e) => {
    deliverableEvent = e;
  });
  await svc.execute({
    companyId: COMPANY_ID,
    threadId: 't-del',
    employeeId: EMP_DEV,
    text: 'make a report',
  });
  check('deliverable.created emitted', !!deliverableEvent);
  check('deliverable title', deliverableEvent?.payload?.title === 'Report');
  check(
    'contributor has brand fields',
    deliverableEvent?.payload?.contributingEmployees?.[0]?.isExternal === false &&
      'brandKey' in (deliverableEvent?.payload?.contributingEmployees?.[0] ?? {}),
  );
}

async function scenarioBossDelegate() {
  console.log('• boss → delegate → employee sub-agent → tool (the headline mechanism)');
  const { svc, audit } = await setup({
    boss: [
      { toolCalls: [toolCall('dg1', 'delegate', { employee_id: EMP_FE, task: 'run echo' })] },
      { text: 'Fe Two reported: RAN:echo delegated' },
    ],
    employee: [
      { toolCalls: [toolCall('b1', 'bash', { command: 'echo delegated' })] },
      { text: 'Done: RAN:echo delegated' },
    ],
  });
  const res = await svc.execute({
    companyId: COMPANY_ID,
    threadId: 't-boss',
    employeeId: undefined, // boss turn
    text: 'have Fe Two run echo',
  });
  check(
    'delegated sub-agent ran bash',
    audit.some((a) => a.name === 'bash'),
  );
  check(
    'bash attributed to the delegated employee',
    audit.find((a) => a.name === 'bash')?.employeeId === EMP_FE,
  );
  check(
    'boss final summarizes the real result',
    res.finalText.includes('RAN:echo delegated'),
    res.finalText,
  );
}

async function scenarioMultiTurn() {
  console.log('• multi-turn memory (persist + rehydrate)');
  const { svc, repos } = await setup({
    employee: [{ text: 'Turn one reply.' }, { text: 'Turn two reply.' }],
  });
  await svc.execute({
    companyId: COMPANY_ID,
    threadId: 't-mt',
    employeeId: EMP_DEV,
    text: 'first',
  });
  await svc.execute({
    companyId: COMPANY_ID,
    threadId: 't-mt',
    employeeId: EMP_DEV,
    text: 'second',
  });
  const rows = await repos.piMessages.listByThread('t-mt');
  // Both turns persisted (user+assistant each), in seq order, owner stamped.
  check('both turns persisted', rows.length === 4, `rows=${rows.length}`);
  check(
    'seqs are contiguous',
    rows.every((r, i) => r.seq === i),
  );
  check(
    'owner employee stamped',
    rows.every((r) => r.employee_id === EMP_DEV),
  );
}

async function scenarioResume() {
  console.log('• resume an interrupted thread');
  const { svc, repos } = await setup({ employee: [{ text: 'Resumed reply.' }] });
  // Simulate a crash mid-turn: a user message persisted with no assistant reply.
  await repos.piMessages.append([
    {
      message_id: 'm0',
      thread_id: 't-res',
      company_id: COMPANY_ID,
      employee_id: EMP_DEV,
      seq: 0,
      role: 'user',
      message_json: JSON.stringify({ role: 'user', content: 'do the thing', timestamp: 1 }),
      created_at: new Date().toISOString(),
    },
  ]);
  const res = await svc.resume({ companyId: COMPANY_ID, threadId: 't-res', employeeId: EMP_DEV });
  check(
    'resume produced a continuation',
    !!res && res.finalText === 'Resumed reply.',
    res?.finalText,
  );
  // Resuming a completed thread (ends with assistant) is a clean no-op.
  const noop = await svc.resume({ companyId: COMPANY_ID, threadId: 't-res', employeeId: EMP_DEV });
  check('resume on completed thread no-ops', noop === null);
}

async function scenarioCompactedTranscriptRebase() {
  console.log('• compacted transcript storage rebase');
  const repos = await seedRepos();
  const originalAsyncTransact = repos.asyncTransact.bind(repos);
  let rebaseTransactionUsed = false;
  repos.asyncTransact = async (fn) =>
    originalAsyncTransact(async (txRepos) => {
      rebaseTransactionUsed = true;
      return fn(txRepos);
    });
  const eventBus = new InMemoryEventBus();
  const modelResolver = new ModelResolver({
    default: { profileName: 'faux', provider: 'openai-compat', model: 'faux-model' },
  });
  await repos.threads.create({
    thread_id: 't-compact',
    company_id: COMPANY_ID,
    entry_mode: 'direct_chat',
    root_task_id: null,
    status: 'running',
    project_id: null,
    compact_baseline_json: JSON.stringify({
      compactId: 'fcb-test',
      compactVersion: 1,
      compactedAt: '2026-06-18T00:00:00.000Z',
      summaryText: 'Older work is summarized.',
      compactedNonSystemMessageCount: 2,
      keptTailNonSystemMessageCount: 2,
    }),
  });
  const storedMessages = [
    { role: 'user', content: 'old user', timestamp: 1 },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'old assistant' }],
      api: 'openai-completions',
      provider: 'openai',
      model: 'faux-model',
      usage: emptyUsage(),
      stopReason: 'stop',
      timestamp: 2,
    },
    { role: 'user', content: 'tail user', timestamp: 3 },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'tail assistant' }],
      api: 'openai-completions',
      provider: 'openai',
      model: 'faux-model',
      usage: emptyUsage(),
      stopReason: 'stop',
      timestamp: 4,
    },
  ];
  await repos.piMessages.append(
    storedMessages.map((message, i) => ({
      message_id: `pim-${i}`,
      thread_id: 't-compact',
      company_id: COMPANY_ID,
      employee_id: EMP_DEV,
      seq: i,
      role: message.role,
      message_json: JSON.stringify(message),
      created_at: '2026-06-18T00:00:00.000Z',
    })),
  );
  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway: { chat: async () => ({}), chatStream: async function* () {}, dispose() {} },
    modelResolver,
    toolExecutor: createRecordingToolExecutor([]),
    companyId: COMPANY_ID,
    threadId: 't-compact',
    builtinTools: new Map(),
    llmToolCallsEnabled: true,
  });
  const transform = createBudgetTransform({
    runtimeCtx,
    model: 'faux-model',
    systemPrompt: 'system',
    budgetService: {
      async prepareRequest(_ctx, req) {
        return {
          ...req,
          messages: [
            req.messages[0],
            { role: 'system', content: '## Compact baseline\nOlder work is summarized.' },
            ...req.messages.slice(3),
          ],
        };
      },
    },
  });
  const liveMessages = [...storedMessages];
  const transformed = await transform(liveMessages);
  const rows = await repos.piMessages.listByThread('t-compact');
  const thread = await repos.threads.findById('t-compact');
  const rebased = JSON.parse(thread.compact_baseline_json);
  check(
    'compaction rebase prunes persisted prefix',
    rows.length === 2 && rows[0]?.seq === 2 && rows[1]?.seq === 3,
    rows.map((row) => row.seq).join(','),
  );
  check('compaction rebase uses repository transaction', rebaseTransactionUsed);
  check(
    'compaction rebase resets compacted count',
    rebased.compactedNonSystemMessageCount === 0,
    String(rebased.compactedNonSystemMessageCount),
  );
  check(
    'compaction rebase mutates live agent state to tail',
    liveMessages.length === 2 && liveMessages[0]?.content === 'tail user',
    JSON.stringify(liveMessages),
  );
  check(
    'compaction transform still injects summary for the active call',
    transformed.length === 3 &&
      transformed[0]?.role === 'user' &&
      transformed[0]?.content?.[0]?.text?.includes('Older work is summarized'),
    JSON.stringify(transformed[0]),
  );
}

async function scenarioExportedAgentLoopFailureStreams() {
  console.log('• exported agentLoop failure streams');
  const prompt = { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 1 };
  const start = agentLoop(
    [prompt],
    { systemPrompt: '', messages: [], tools: [] },
    throwingLoopConfig('convert failed'),
  );
  const startCollected = await collectAgentStream(start);
  const startFinal = startCollected.result[0];
  check(
    'agentLoop helper closes on thrown conversion',
    startCollected.events.at(-1)?.type === 'agent_end',
    startCollected.events.map((event) => event.type).join(','),
  );
  check(
    'agentLoop helper returns structured error',
    startCollected.result.length === 1 &&
      startFinal?.role === 'assistant' &&
      startFinal.stopReason === 'error' &&
      startFinal.errorMessage === 'convert failed',
    startFinal?.errorMessage,
  );
  check(
    'agentLoop helper emits turn_end for error',
    startCollected.events.some(
      (event) => event.type === 'turn_end' && event.message.errorMessage === 'convert failed',
    ),
  );

  const continuation = agentLoopContinue(
    { systemPrompt: '', messages: [prompt], tools: [] },
    throwingLoopConfig('continue convert failed'),
  );
  const continuationCollected = await collectAgentStream(continuation);
  const continuationFinal = continuationCollected.result[0];
  check(
    'agentLoopContinue helper closes on thrown conversion',
    continuationCollected.events.at(-1)?.type === 'agent_end',
    continuationCollected.events.map((event) => event.type).join(','),
  );
  check(
    'agentLoopContinue helper returns structured error',
    continuationCollected.result.length === 1 &&
      continuationFinal?.role === 'assistant' &&
      continuationFinal.stopReason === 'error' &&
      continuationFinal.errorMessage === 'continue convert failed',
    continuationFinal?.errorMessage,
  );
}

async function scenarioSkillConfirmCleanup() {
  console.log('• skill mutation confirm cleanup');
  const staging = createStoppedStaging({ idFactory: () => 'stg-install-fail' });
  let cleanupCalls = 0;
  const staged = staging.put(
    stagedInstallEntry({
      cleanup: async () => {
        cleanupCalls += 1;
      },
    }),
  );
  const committer = new SkillInstallCommitter({
    companyId: COMPANY_ID,
    threadId: 't-skill-cleanup',
    staging,
    skillLoader: {
      async installSkill() {
        const err = new Error('simulated install failure');
        err.kind = 'install-simulated';
        throw err;
      },
    },
  });

  const outcome = await committer.handle(skillConfirmRequest(staged.stagingRef), CONFIRM_RESPONSE);
  check('failed confirm returns structured error', outcome.kind === 'error', outcome.kind);
  check(
    'failed confirm preserves error kind',
    outcome.errorKind === 'install-simulated',
    outcome.errorKind,
  );
  check('failed confirm cleanup runs once', cleanupCalls === 1, `cleanupCalls=${cleanupCalls}`);
  check('confirmed staging entry is consumed', staging.peek(staged.stagingRef) === null);
}

async function scenarioSkillCancelAndExpiryCleanup() {
  console.log('• skill mutation cancel / expiry cleanup');
  const staging = createStoppedStaging({ idFactory: () => 'stg-cancel' });
  let cancelCleanupCalls = 0;
  const cancelled = staging.put(
    stagedInstallEntry({
      cleanup: async () => {
        cancelCleanupCalls += 1;
      },
    }),
  );
  const committer = new SkillInstallCommitter({
    companyId: COMPANY_ID,
    threadId: 't-skill-cancel',
    staging,
    skillLoader: {},
  });

  const cancelOutcome = await committer.handle(
    skillConfirmRequest(cancelled.stagingRef),
    CANCEL_RESPONSE,
  );
  check('cancel returns cancelled', cancelOutcome.kind === 'cancelled', cancelOutcome.kind);
  check('cancel cleanup runs once', cancelCleanupCalls === 1, `cleanupCalls=${cancelCleanupCalls}`);

  let now = 1_000;
  const expiring = createStoppedStaging({
    ttlMs: 10,
    now: () => now,
    idFactory: () => 'stg-expired',
  });
  let expiryCleanupCalls = 0;
  expiring.put(
    stagedInstallEntry({
      cleanup: async () => {
        expiryCleanupCalls += 1;
      },
    }),
  );
  now = 2_000;
  await expiring.sweep();
  check('expiry cleanup runs once', expiryCleanupCalls === 1, `cleanupCalls=${expiryCleanupCalls}`);
}

async function scenarioSkillEditOwnershipChecks() {
  console.log('• skill edit final ownership checks');
  const companyMismatch = await commitEditWithRow(
    skillRow({ skill_id: 'sk-company-mismatch', company_id: 'co-other' }),
  );
  check('edit rejects company mismatch', companyMismatch.outcome.kind === 'error');
  check('company mismatch does not write file', companyMismatch.fs.writeCount === 0);
  check('company mismatch leaves version unchanged', companyMismatch.after?.version === '1.0.0');
  check('company mismatch cleanup runs once', companyMismatch.cleanupCalls === 1);

  const employeeMismatch = await commitEditWithRow(
    skillRow({ skill_id: 'sk-employee-mismatch', employee_id: EMP_FE }),
  );
  check('edit rejects employee mismatch', employeeMismatch.outcome.kind === 'error');
  check('employee mismatch does not write file', employeeMismatch.fs.writeCount === 0);
  check('employee mismatch leaves version unchanged', employeeMismatch.after?.version === '1.0.0');
  check('employee mismatch cleanup runs once', employeeMismatch.cleanupCalls === 1);
}

async function scenarioSkillAssetPathSegments() {
  console.log('• skill asset path segment validation');
  const repos = await seedRepos();
  const fs = createMemoryVaultFs();
  const loader = new SkillLoader({ skills: repos.skills, employees: repos.employees, fs });
  const ok = await loader.installSkill({
    scope: 'company',
    companyId: COMPANY_ID,
    slug: 'asset-segments',
    skillId: 'sk-asset-segments',
    name: 'Asset Segments',
    description: 'Asset path harness',
    source: { kind: 'upload', filename: 'asset.zip' },
    files: {
      skillMd: '---\nname: Asset Segments\ndescription: Asset path harness\n---\nBody',
      assets: [{ relPath: 'assets/v1..notes.md', content: 'ok' }],
    },
  });
  check('filename with internal dot-dot is accepted', ok.row.skill_id === 'sk-asset-segments');

  for (const [relPath, expectedKind] of [
    ['assets/../x.md', 'path-traversal'],
    ['assets/./x.md', 'path-traversal'],
    ['assets//x.md', 'path-traversal'],
    ['/assets/x.md', 'absolute-path-forbidden'],
  ]) {
    try {
      await loader.installSkill({
        scope: 'company',
        companyId: COMPANY_ID,
        slug: `bad-${relPath.replace(/[^a-z0-9]/giu, '-')}`,
        skillId: `sk-bad-${relPath.replace(/[^a-z0-9]/giu, '-')}`,
        name: `Bad ${relPath}`,
        description: 'Bad asset path harness',
        source: { kind: 'upload', filename: 'bad.zip' },
        files: {
          skillMd: '---\nname: Bad\ndescription: Bad asset path harness\n---\nBody',
          assets: [{ relPath, content: 'bad' }],
        },
      });
      check(`${relPath} rejected`, false, 'install unexpectedly succeeded');
    } catch (err) {
      check(`${relPath} rejected`, err?.kind === expectedKind, err?.kind);
    }
  }
}

async function scenarioRegressionGuard() {
  console.log('• regression guard (negative self-test)');
  const captured = captureCheckFailures(() => {
    check('intentional harness failure', false, 'sentinel');
  });
  check(
    'harness captures an intentional failure',
    captured.length === 1 && captured[0] === 'intentional harness failure',
    JSON.stringify(captured),
  );
}

const SCENARIOS = [
  scenarioDirectChat,
  scenarioMultiRoundTools,
  scenarioDeliverable,
  scenarioBossDelegate,
  scenarioMultiTurn,
  scenarioResume,
  scenarioCompactedTranscriptRebase,
  scenarioExportedAgentLoopFailureStreams,
  scenarioSkillConfirmCleanup,
  scenarioSkillCancelAndExpiryCleanup,
  scenarioSkillEditOwnershipChecks,
  scenarioSkillAssetPathSegments,
  scenarioRegressionGuard,
];

async function main() {
  for (const scenario of SCENARIOS) await scenario();
  if (failures.length > 0) {
    console.error(`\npi-loop gate FAILED: ${failures.length} check(s) — ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\npi-loop gate PASSED');
}

main().catch((err) => {
  console.error('pi-loop gate ERROR', err);
  process.exit(1);
});
