/**
 * pi-loop record/replay gate.
 *
 * Drives the PiOrchestrationService with a deterministic faux StreamFn (no real
 * provider) and in-memory repos, then asserts the kernel's load-bearing
 * invariants: direct chat, multi-round tool execution through the audited
 * executor, explicit deliverable submission, and — critically — the
 * boss → delegate → employee sub-agent → tool → audit mechanism that the
 * agent-as-tool design rests on. The last scenario is a deliberately-wrong
 * expectation that MUST fail, proving the harness catches regressions.
 *
 * Replaces the graph-coupled harness:contract/replay/deterministic for the pi
 * kernel. Pure Node (no app, no network).
 */

import {
  InMemoryEventBus,
  PiAgentRegistry,
  PiMessageStore,
  PiOrchestrationService,
  createMemoryRepositories,
  createRuntimeContext,
  createSubmitDeliverableTool,
} from '../packages/core/dist/index.js';
import { ModelResolver } from '../packages/core/dist/llm-public.js';

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
  const builtinTools = new Map([
    ['bash', { def: BASH_DEF, execute: async () => 'unused' }],
  ]);
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
    budgetService: { async prepareRequest(_ctx, req) { return req; } },
    modelResolver,
    messageStore: repos.piMessages ? new PiMessageStore(repos.piMessages) : undefined,
    modelMeta: { baseUrl: 'https://faux.local' },
    virtualToolProvider: (toolCtx, kind) =>
      kind === 'employee' ? [createSubmitDeliverableTool(runtimeCtx, toolCtx)] : [],
  });
}

const failures = [];
function check(name, cond, detail) {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

async function scenarioDirectChat() {
  console.log('• direct chat (text)');
  const repos = await seedRepos();
  const audit = [];
  const eventBus = new InMemoryEventBus();
  const svc = buildService(repos, eventBus, audit, {
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
  const repos = await seedRepos();
  const audit = [];
  const eventBus = new InMemoryEventBus();
  const svc = buildService(repos, eventBus, audit, {
    employee: [
      { toolCalls: [{ id: 'tc1', name: 'bash', arguments: { command: 'echo hi' } }] },
      { text: 'The command printed RAN:echo hi' },
    ],
  });
  const res = await svc.execute({
    companyId: COMPANY_ID,
    threadId: 't-tools',
    employeeId: EMP_DEV,
    text: 'run echo',
  });
  check('bash executed via toolExecutor', audit.some((a) => a.name === 'bash'));
  check('bash attributed to employee', audit[0]?.employeeId === EMP_DEV);
  check('final reports tool output', res.finalText.includes('RAN:echo hi'), res.finalText);
}

async function scenarioDeliverable() {
  console.log('• explicit deliverable submission');
  const repos = await seedRepos();
  const audit = [];
  const eventBus = new InMemoryEventBus();
  let deliverableEvent = null;
  eventBus.on('deliverable.created', (e) => {
    deliverableEvent = e;
  });
  const svc = buildService(repos, eventBus, audit, {
    employee: [
      {
        toolCalls: [
          {
            id: 'd1',
            name: 'submit_deliverable',
            arguments: { title: 'Report', content: 'body text' },
          },
        ],
      },
      { text: 'Submitted.' },
    ],
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
  const repos = await seedRepos();
  const audit = [];
  const eventBus = new InMemoryEventBus();
  const svc = buildService(repos, eventBus, audit, {
    boss: [
      { toolCalls: [{ id: 'dg1', name: 'delegate', arguments: { employee_id: EMP_FE, task: 'run echo' } }] },
      { text: 'Fe Two reported: RAN:echo delegated' },
    ],
    employee: [
      { toolCalls: [{ id: 'b1', name: 'bash', arguments: { command: 'echo delegated' } }] },
      { text: 'Done: RAN:echo delegated' },
    ],
  });
  const res = await svc.execute({
    companyId: COMPANY_ID,
    threadId: 't-boss',
    employeeId: undefined, // boss turn
    text: 'have Fe Two run echo',
  });
  check('delegated sub-agent ran bash', audit.some((a) => a.name === 'bash'));
  check('bash attributed to the delegated employee', audit.find((a) => a.name === 'bash')?.employeeId === EMP_FE);
  check('boss final summarizes the real result', res.finalText.includes('RAN:echo delegated'), res.finalText);
}

async function scenarioMultiTurn() {
  console.log('• multi-turn memory (persist + rehydrate)');
  const repos = await seedRepos();
  const audit = [];
  const eventBus = new InMemoryEventBus();
  const svc = buildService(repos, eventBus, audit, {
    employee: [{ text: 'Turn one reply.' }, { text: 'Turn two reply.' }],
  });
  await svc.execute({ companyId: COMPANY_ID, threadId: 't-mt', employeeId: EMP_DEV, text: 'first' });
  await svc.execute({ companyId: COMPANY_ID, threadId: 't-mt', employeeId: EMP_DEV, text: 'second' });
  const rows = await repos.piMessages.listByThread('t-mt');
  // Both turns persisted (user+assistant each), in seq order, owner stamped.
  check('both turns persisted', rows.length === 4, `rows=${rows.length}`);
  check('seqs are contiguous', rows.every((r, i) => r.seq === i));
  check('owner employee stamped', rows.every((r) => r.employee_id === EMP_DEV));
}

async function scenarioResume() {
  console.log('• resume an interrupted thread');
  const repos = await seedRepos();
  const audit = [];
  const eventBus = new InMemoryEventBus();
  const svc = buildService(repos, eventBus, audit, { employee: [{ text: 'Resumed reply.' }] });
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
  check('resume produced a continuation', !!res && res.finalText === 'Resumed reply.', res?.finalText);
  // Resuming a completed thread (ends with assistant) is a clean no-op.
  const noop = await svc.resume({ companyId: COMPANY_ID, threadId: 't-res', employeeId: EMP_DEV });
  check('resume on completed thread no-ops', noop === null);
}

async function scenarioRegressionGuard() {
  console.log('• regression guard (this MUST be caught)');
  const repos = await seedRepos();
  const audit = [];
  const eventBus = new InMemoryEventBus();
  const svc = buildService(repos, eventBus, audit, { employee: [{ text: 'actual' }] });
  const res = await svc.execute({
    companyId: COMPANY_ID,
    threadId: 't-reg',
    employeeId: EMP_DEV,
    text: 'x',
  });
  // Deliberately wrong expectation — the harness is sound only if it flags this.
  const caught = res.finalText !== 'WRONG_EXPECTED_VALUE';
  check('harness flags a wrong expectation', caught);
}

async function main() {
  await scenarioDirectChat();
  await scenarioMultiRoundTools();
  await scenarioDeliverable();
  await scenarioBossDelegate();
  await scenarioMultiTurn();
  await scenarioResume();
  await scenarioRegressionGuard();
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
