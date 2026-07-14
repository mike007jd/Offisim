/**
 * Pi Collaboration runtime deterministic harness (PR-03).
 *
 * Proves the collaboration turn controller + the HOST capability gate WITHOUT a
 * live model. Every model call is injected (a fake transport returns canned reply
 * text + streams deltas), so this gate tests exactly the deterministic part:
 * scheduling (direct / mentions_only / roundtable), bounded speakers, the
 * new-round-id rule, stop / retry / partial failure, the context packet allowlist,
 * and that NO agent_runs / mission rows are ever written.
 *
 * It ALSO asserts the host `collaborate` path is isolated (zero tools, no
 * workspace, no persistence, no extension factories, streaming) by reading the
 * entry.mjs + pi_agent_host/*.rs source — the host config is a property of the
 * source, not of the in-memory controller. Style mirrors harness-prompt-enhance.mts
 * + harness-conversation-run-controller.mts: a `check(...)` counter, exit 0/1.
 */

import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveEmployeeRuntimeSelection } from '../apps/desktop/renderer/src/data/employee-persona.js';
import {
  type CollaborationParticipant,
  FORBIDDEN_CONTEXT_MARKERS,
  ROUNDTABLE_HARD_CAP_SPEAKERS,
  buildContextPacket,
  clampRoundtableSpeakers,
  parseMentions,
  recentWindow,
  scheduleSpeakers,
} from '../apps/desktop/renderer/src/runtime/collaboration/collaboration-context.js';
import type {
  CollaborationTransport,
  CollaborationTurnRequest,
  CollaborationTurnResult,
} from '../apps/desktop/renderer/src/runtime/collaboration/collaboration-transport.js';
import { selectCollaborationExecutionTarget } from '../apps/desktop/renderer/src/runtime/collaboration/collaboration-transport.js';
import {
  type CollaborationThreadContext,
  createCollaborationTurnController,
  emptyCollaborationSnapshot,
} from '../apps/desktop/renderer/src/runtime/collaboration/collaboration-turn-controller.js';
import { createCollaborationService } from '../packages/core/src/runtime/collaboration/collaboration-service.js';
import { createCollaborationMemoryRepos } from '../packages/core/src/runtime/repos/collaboration/memory.js';
import type {
  AiExecutionTarget,
  TurnExecutionProvenance,
} from '../packages/shared-types/src/index.js';

// Strip `//` line comments and `/* */` block comments so a NEGATIVE source scan
// (asserting a forbidden token is ABSENT) checks the executable code, not the
// explanatory comments that legitimately name what the path deliberately avoids
// (e.g. "deliberately does not call project_workspace_root"). Positive scans use
// the raw source; negative scans use this.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function extractNamedAsyncFunction(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}(`);
  if (start < 0) return '';
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return '';
}

let failures = 0;
let checks = 0;
function check(name: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('pi-collaboration-runtime gate');

// Deterministic id/clock so every run is byte-stable.
function makeDeps() {
  let idSeq = 0;
  let clockSeq = 0;
  return {
    newId: () => {
      idSeq += 1;
      return `id-${idSeq.toString().padStart(4, '0')}`;
    },
    now: () => {
      clockSeq += 1;
      return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, clockSeq)).toISOString();
    },
  };
}

const PARTICIPANTS: CollaborationParticipant[] = [
  { employeeId: 'e-alex', name: 'Alex', role: 'Engineer', personaSummary: 'Expertise: backend' },
  { employeeId: 'e-kai', name: 'Kai', role: 'Designer', personaSummary: 'Expertise: UI' },
  { employeeId: 'e-sophie', name: 'Sophie', role: 'PM', personaSummary: null },
];

const MODEL_SOURCE = {
  kind: 'official-api' as const,
  sourceUrl: 'https://provider.example/models/fixture-stable',
  checkedAt: '2026-07-14T00:00:00.000Z',
};

function fakeSelection(model?: string, frozenTarget?: AiExecutionTarget) {
  if (frozenTarget) {
    return {
      target: frozenTarget,
      runtimeModelRef: `${frozenTarget.accountId.includes(':other:') ? 'other' : 'fixture'}/${frozenTarget.modelId}`,
    };
  }
  const runtimeModelRef = model?.trim() || 'fixture/fixture-stable';
  const separator = runtimeModelRef.indexOf('/');
  const provider = separator > 0 ? runtimeModelRef.slice(0, separator) : 'fixture';
  const modelId = separator > 0 ? runtimeModelRef.slice(separator + 1) : runtimeModelRef;
  return {
    target: {
      engineId: 'api',
      accountId:
        provider === 'other' ? 'api:other:0123456789abcdef' : 'api:fixture:0123456789abcdef',
      billingMode: 'api' as const,
      modelId,
      modelSource: { ...MODEL_SOURCE, sourceUrl: `https://provider.example/models/${modelId}` },
    },
    runtimeModelRef,
  };
}

function fakeProvenance(req: CollaborationTurnRequest): TurnExecutionProvenance {
  return {
    ...req.expectedTarget,
    runId: req.requestId,
    adapter: { id: 'fixture-adapter', version: '1.0.0' },
  };
}

// A fake transport: records every request, streams two deltas, returns canned text
// + usage. `behavior` lets a scenario force a throw or a slow run for stop tests.
interface FakeTransport extends CollaborationTransport {
  requests: CollaborationTurnRequest[];
  packets: string[];
  behavior: (
    req: CollaborationTurnRequest,
  ) => Promise<
    Omit<CollaborationTurnResult, 'provenance'> & { provenance?: TurnExecutionProvenance }
  >;
}
function makeFakeTransport(): FakeTransport {
  const t: FakeTransport = {
    requests: [],
    packets: [],
    behavior: async (req) => ({
      text: `reply from ${req.employeeId}`,
      usage: { input: 3, output: 5 },
    }),
    async resolveExecutionSelection(input) {
      return fakeSelection(input.model, input.frozenTarget);
    },
    async run(req, opts) {
      t.requests.push(req);
      t.packets.push(req.systemPromptAppend ?? '');
      const provenance = fakeProvenance(req);
      await opts.verifyDurableTarget(provenance);
      // Stream two deltas so the live preview path is exercised.
      opts?.onDelta?.('partial ');
      opts?.onDelta?.('reply');
      const result = await t.behavior(req);
      return { ...result, provenance: result.provenance ?? provenance };
    },
  };
  return t;
}

// A controller backed by in-memory collaboration repos + a fake transport. The
// repos are the REAL CollaborationService repos (so message/turn persistence is
// exercised), but there is NO agent_runs / mission repo anywhere in scope — a
// write to one is structurally impossible (case 4).
function makeController(
  ctx: CollaborationThreadContext,
  transport: FakeTransport,
  runtimeOverrides?: {
    model?: (threadId: string) => string | undefined;
    thinkingLevel?: (threadId: string) => string | undefined;
  },
) {
  const deps = makeDeps();
  const repos = createCollaborationMemoryRepos();
  const service = createCollaborationService(
    {
      collaborationThreads: repos.collaborationThreads,
      collaborationMembers: repos.collaborationMembers,
      collaborationMessages: repos.collaborationMessages,
      collaborationReadState: repos.collaborationReadState,
      asyncTransact: async (fn) => fn(),
    },
    deps,
  );
  const controller = createCollaborationTurnController({
    transport,
    service: {
      appendMessage: (input) => service.appendMessage(input),
      listMembers: async () =>
        ctx.participants.map((p) => ({ employeeId: p.employeeId, actorType: 'employee' as const })),
    },
    turns: repos.collaborationTurns,
    messages: { update: (id, patch) => repos.collaborationMessages.update(id, patch) },
    resolveThread: async () => ctx,
    recentMessages: async (threadId) => {
      const page = await service.listMessages(threadId, null, 50);
      return page.messages;
    },
    now: deps.now,
    newId: deps.newId,
    ...runtimeOverrides,
  });
  // Seed the thread row so appendMessage's touchThread + the service find work.
  return { controller, repos, service };
}

function directCtx(): CollaborationThreadContext {
  return {
    threadId: 't-direct',
    companyId: 'co-1',
    companyName: 'Acme',
    title: 'Direct Alex',
    kind: 'direct',
    replyPolicy: 'mentions_only',
    directEmployeeId: 'e-alex',
    roundSpeakerLimit: 3,
    participants: [PARTICIPANTS[0]],
  };
}
function groupCtx(replyPolicy: 'mentions_only' | 'roundtable'): CollaborationThreadContext {
  return {
    threadId: 't-group',
    companyId: 'co-1',
    companyName: 'Acme',
    title: 'Team room',
    kind: 'group',
    replyPolicy,
    roundSpeakerLimit: 3,
    participants: PARTICIPANTS,
  };
}

// Seed the thread row into the service so appendMessage can touch it.
async function seedThread(
  service: ReturnType<typeof createCollaborationService>,
  ctx: CollaborationThreadContext,
) {
  if (ctx.kind === 'direct') {
    await service.getOrCreateDirect(ctx.companyId, ctx.directEmployeeId!, { title: ctx.title });
  } else {
    await service.createGroup({
      companyId: ctx.companyId,
      title: ctx.title,
      employeeIds: ctx.participants.map((p) => p.employeeId),
      replyPolicy: ctx.replyPolicy,
    });
  }
}

// ── Pure scheduling / context unit checks ────────────────────────────────────
{
  const inherited = { model: 'fixture/orchestrator', thinkingLevel: 'medium' };
  const availableModels = [
    { runtimeModelRef: 'fixture/orchestrator' },
    { runtimeModelRef: 'fixture/employee' },
  ];
  const bound = resolveEmployeeRuntimeSelection(
    { model: 'fixture/employee', thinking_level: 'high' },
    availableModels,
    inherited,
  );
  check(
    'employee model/thinking binding overrides the inherited conversation selection',
    bound.model === 'fixture/employee' && bound.thinkingLevel === 'high',
    JSON.stringify(bound),
  );
  const unbound = resolveEmployeeRuntimeSelection(
    { model: null, thinking_level: null },
    availableModels,
    inherited,
  );
  check(
    'unbound employee inherits the conversation model/thinking selection',
    unbound.model === inherited.model && unbound.thinkingLevel === inherited.thinkingLevel,
    JSON.stringify(unbound),
  );
  const stale = resolveEmployeeRuntimeSelection(
    { model: 'fixture/retired', thinking_level: 'xhigh' },
    availableModels,
    inherited,
  );
  check(
    'stale employee binding inherits without blocking the run',
    stale.model === inherited.model && stale.thinkingLevel === inherited.thinkingLevel,
    JSON.stringify(stale),
  );

  const safeCatalogStatus = {
    accounts: [
      {
        engineId: 'api',
        accountId: 'api:fixture:0123456789abcdef',
        billingMode: 'api',
        displayName: 'Fixture API',
        status: 'available',
        capabilities: {
          execute: { status: 'available' },
          models: { status: 'available' },
          usage: { status: 'available' },
          cost: { status: 'available' },
        },
      },
    ],
    models: [
      {
        engineId: 'api',
        accountId: 'api:fixture:0123456789abcdef',
        billingMode: 'api',
        modelId: 'fixture-stable',
        displayName: 'Fixture Stable',
        runtimeModelRef: 'fixture/fixture-stable',
        availability: 'available',
        capabilities: { textInput: true, imageInput: false, tools: true, reasoning: true },
        source: MODEL_SOURCE,
      },
    ],
    checkedAt: MODEL_SOURCE.checkedAt,
  };
  const selected = selectCollaborationExecutionTarget(safeCatalogStatus);
  check(
    'safe runtime catalog selects only a configured stable exact API model',
    selected.runtimeModelRef === 'fixture/fixture-stable' &&
      selected.target.accountId === 'api:fixture:0123456789abcdef' &&
      selected.target.modelId === 'fixture-stable',
    JSON.stringify(selected),
  );
  let unavailableRejected = false;
  try {
    selectCollaborationExecutionTarget({ ...safeCatalogStatus, accounts: [] });
  } catch {
    unavailableRejected = true;
  }
  check('safe runtime catalog rejects a model without an available account', unavailableRejected);

  // (6) mentions_only parsing.
  const m = parseMentions('hey @Kai and @Sophie can you look', PARTICIPANTS);
  check(
    'parseMentions extracts only mentioned members in order',
    m.map((p) => p.name).join(',') === 'Kai,Sophie',
    JSON.stringify(m.map((p) => p.name)),
  );
  check('parseMentions ignores unmentioned members', !m.some((p) => p.name === 'Alex'));
  const none = parseMentions('hey team can someone look', PARTICIPANTS);
  check('no @mention → no scheduled members', none.length === 0);
  // Whole-token guard.
  const partial = parseMentions('@Alexandra is not here', [{ employeeId: 'x', name: 'Alex' }]);
  check('partial-name @mention does not match a different name', partial.length === 0);

  // (7) deterministic speaker order: mention order first, then member order.
  const mentioned = parseMentions('@Sophie @Alex', PARTICIPANTS);
  const order = scheduleSpeakers(mentioned, PARTICIPANTS);
  check(
    'scheduleSpeakers: mention order first, then roster order',
    order.map((p) => p.name).join(',') === 'Sophie,Alex,Kai',
    JSON.stringify(order.map((p) => p.name)),
  );
  // Reproducible.
  const order2 = scheduleSpeakers(mentioned, PARTICIPANTS);
  check('speaker order is reproducible', JSON.stringify(order) === JSON.stringify(order2));

  // (7) caps.
  check('roundtable default cap = 3', clampRoundtableSpeakers(undefined) === 3);
  check('roundtable hard cap = 8', clampRoundtableSpeakers(99) === ROUNDTABLE_HARD_CAP_SPEAKERS);
  check('roundtable floor = 1', clampRoundtableSpeakers(0) === 1);

  // (10) context packet allowlist + forbidden markers.
  const packet = buildContextPacket({
    companyName: 'Acme',
    threadTitle: 'Team room',
    replyPolicy: 'mentions_only',
    participants: PARTICIPANTS,
    recentMessages: [],
    speaker: PARTICIPANTS[0],
    triggerMessageBody: 'please weigh in',
    priorRoundReplies: [{ speakerName: 'Kai', body: 'looks good' }],
  });
  check(
    'context packet states daily chat, no tools, no files',
    /no tools|no files|do not run commands/i.test(packet) && /Do not .*claim/i.test(packet),
  );
  const readPacket = buildContextPacket({
    companyName: 'Acme',
    threadTitle: 'Read room',
    replyPolicy: 'mentions_only',
    participants: PARTICIPANTS,
    recentMessages: [],
    speaker: PARTICIPANTS[0],
    capabilityProfile: 'collaboration_read',
    mcpToolNames: ['read_file'],
    triggerMessageBody: 'read a file',
  });
  check(
    'read profile packet allows only read-only tools',
    /read-only tools/i.test(readPacket) &&
      /MCP read\/search/i.test(readPacket) &&
      /read_file/.test(readPacket) &&
      /mcp_call/.test(readPacket),
  );
  check(
    'read profile packet still forbids writes and shell commands',
    /Do not run shell commands/i.test(readPacket) &&
      /do not write, edit, create, delete, publish, start missions/i.test(readPacket),
  );
  check(
    'context packet contains the company + thread title',
    packet.includes('Acme') && packet.includes('Team room'),
  );
  check(
    'context packet includes prior round reply for inter-employee talk',
    packet.includes('Kai: looks good'),
  );
  for (const marker of FORBIDDEN_CONTEXT_MARKERS) {
    check(
      `context packet has no forbidden marker "${marker}"`,
      !packet.includes(marker),
      packet.slice(0, 80),
    );
  }
  check(
    'context packet has no workspace root',
    !/workspace_root|workspaceRoot|\/Users\/|cwd/i.test(packet),
  );
  // A non-participating member's persona must not leak: only the speaker's persona
  // summary appears; others appear by name/role only.
  check(
    'only the speaker persona summary appears (no other persona body)',
    packet.includes('Expertise: backend') && !packet.includes('Expertise: UI'),
  );
}

// ── (1) direct reply: projectId=null path, no default project/workspace ──────
await (async () => {
  const ctx = directCtx();
  const transport = makeFakeTransport();
  const { controller, repos, service } = makeController(ctx, transport, {
    model: (threadId) => (threadId === ctx.threadId ? 'fixture/model-connect' : undefined),
    thinkingLevel: (threadId) => (threadId === ctx.threadId ? 'high' : undefined),
  });
  await seedThread(service, ctx);
  const { message, scheduled } = await controller.sendBossMessage(ctx.threadId, 'hi alex');
  check(
    '(1) direct reply schedules exactly one turn',
    scheduled.turns.length === 1,
    String(scheduled.turns.length),
  );
  check('(1) the direct employee is the speaker', scheduled.turns[0]?.employeeId === 'e-alex');
  check(
    '(1) the transport request carries no project id (collaborationThreadId only)',
    !('projectId' in (transport.requests[0] ?? {})) &&
      transport.requests[0]?.collaborationThreadId === ctx.threadId,
  );
  check(
    '(1) Connect model/thinking overrides are resolved by thread id',
    transport.requests[0]?.model === 'fixture/model-connect' &&
      transport.requests[0]?.thinkingLevel === 'high',
    JSON.stringify({
      model: transport.requests[0]?.model,
      thinkingLevel: transport.requests[0]?.thinkingLevel,
    }),
  );
  // (5) stable-id streaming upsert: the visible message row id is the turn's, and
  // the final body is the canned reply (upserted, not duplicated).
  const turn = controller.getSnapshot(ctx.threadId).turns[0];
  check(
    '(5) turn streamed into a stable message id',
    turn.messageId.length > 0 && turn.phase === 'complete',
  );
  // getSnapshot MUST be reference-stable between emits or useSyncExternalStore
  // loops forever and the Connect surface crashes on mount (caught live in the
  // release .app; the deterministic gates can't see the React invariant).
  check(
    '(5) getSnapshot is reference-stable between changes',
    // biome-ignore lint/suspicious/noSelfCompare: two independent getSnapshot calls; intentional reference-stability assertion (instability crashed Connect in release — PR-11)
    controller.getSnapshot(ctx.threadId) === controller.getSnapshot(ctx.threadId),
  );
  check(
    '(5) getSnapshot on an untouched thread is reference-stable',
    // biome-ignore lint/suspicious/noSelfCompare: two independent getSnapshot calls; intentional reference-stability assertion (instability crashed Connect in release — PR-11)
    controller.getSnapshot('untouched') === controller.getSnapshot('untouched'),
  );
  check(
    '(5) emptyCollaborationSnapshot is reference-stable per threadId',
    // biome-ignore lint/suspicious/noSelfCompare: two independent emptyCollaborationSnapshot calls; intentional reference-stability assertion
    emptyCollaborationSnapshot('x') === emptyCollaborationSnapshot('x'),
  );
  const finalMsg = await repos.collaborationMessages.findById(turn.messageId);
  check(
    '(5) the stable message row was upserted to complete',
    finalMsg?.status === 'complete' && finalMsg?.body === 'reply from e-alex',
    JSON.stringify(finalMsg),
  );
  // Exactly two visible messages: boss + the single reply (no duplicate).
  const page = await service.listMessages(ctx.threadId, null, 50);
  check(
    '(5) no duplicate reply row (boss + one reply)',
    page.messages.length === 2,
    String(page.messages.length),
  );
  check('(1) boss message persisted complete', message.status === 'complete');
  // (4) a turn ledger row exists and reached complete.
  const turns = await repos.collaborationTurns.listByThread(ctx.threadId);
  check(
    '(4) collaboration_turns ledger row written + complete',
    turns.length === 1 && turns[0].status === 'complete',
  );
  check(
    '(4) ledger row carries usage + runtime_request_id',
    !!turns[0].usage_json && !!turns[0].runtime_request_id,
  );
  const durableTarget = turns[0] ? JSON.parse(turns[0].execution_target_json) : null;
  const durableProvenance = turns[0]?.result_provenance_json
    ? JSON.parse(turns[0].result_provenance_json)
    : null;
  check(
    '(4) exact target is durable before invoke and final provenance matches it',
    durableTarget?.accountId === 'api:fixture:0123456789abcdef' &&
      durableTarget?.modelId === 'model-connect' &&
      durableProvenance?.runId === turns[0]?.runtime_request_id &&
      durableProvenance?.accountId === durableTarget?.accountId &&
      durableProvenance?.modelId === durableTarget?.modelId &&
      durableProvenance?.adapter?.id === 'fixture-adapter',
    JSON.stringify({ durableTarget, durableProvenance }),
  );
})();

// ── A thread freezes engine/account/billing while allowing exact model changes ─
await (async () => {
  const ctx = directCtx();
  ctx.runtimeByEmployeeId = new Map([['e-alex', { model: 'fixture/model-one' }]]);
  const transport = makeFakeTransport();
  const { controller, repos, service } = makeController(ctx, transport);
  await seedThread(service, ctx);
  await controller.sendBossMessage(ctx.threadId, 'first account lane');
  ctx.runtimeByEmployeeId = new Map([['e-alex', { model: 'fixture/model-two' }]]);
  await controller.sendBossMessage(ctx.threadId, 'same account, different exact model');
  const sameLaneTurns = await repos.collaborationTurns.listByThread(ctx.threadId);
  check(
    'same thread permits exact model changes inside one API account lane',
    sameLaneTurns.length === 2 && transport.requests.length === 2,
  );

  ctx.runtimeByEmployeeId = new Map([['e-alex', { model: 'other/model-three' }]]);
  let laneSwitchRejected = false;
  try {
    await controller.sendBossMessage(ctx.threadId, 'try a different account');
  } catch (error) {
    laneSwitchRejected = String(error).includes(
      'cannot switch AI engine, account, or billing lane',
    );
  }
  check('same thread rejects an account-lane switch before host invocation', laneSwitchRejected);
  check('rejected lane switch crosses no model boundary', transport.requests.length === 2);
})();

// ── Concurrent first turns cannot race two account lanes past the bind ──────
await (async () => {
  const ctx = directCtx();
  ctx.threadId = 't-concurrent-lane';
  ctx.runtimeByEmployeeId = new Map([['e-alex', { model: 'fixture/model-one' }]]);
  const transport = makeFakeTransport();
  let markFirstAtBoundary!: () => void;
  const firstAtBoundary = new Promise<void>((resolve) => {
    markFirstAtBoundary = resolve;
  });
  let releaseFirst!: () => void;
  const firstCanPrepare = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  transport.run = async (req, opts) => {
    transport.requests.push(req);
    const provenance = fakeProvenance(req);
    if (transport.requests.length === 1) {
      markFirstAtBoundary();
      await firstCanPrepare;
    }
    await opts.verifyDurableTarget(provenance);
    return { text: `reply from ${req.employeeId}`, provenance };
  };
  const { controller, repos, service } = makeController(ctx, transport);
  await seedThread(service, ctx);

  const first = controller.sendBossMessage(ctx.threadId, 'first lane claimant');
  await firstAtBoundary;
  ctx.runtimeByEmployeeId = new Map([['e-alex', { model: 'other/model-two' }]]);
  let secondError = '';
  try {
    await controller.sendBossMessage(ctx.threadId, 'racing different account lane');
  } catch (error) {
    secondError = String(error);
  } finally {
    releaseFirst();
  }
  await first;

  const turns = await repos.collaborationTurns.listByThread(ctx.threadId);
  check(
    'concurrent first turns reject the losing account lane before host invocation',
    secondError.includes('cannot switch AI engine, account, or billing lane'),
    secondError,
  );
  check(
    'concurrent lane rejection invokes exactly one model boundary',
    transport.requests.length === 1,
  );
  check(
    'concurrent lane rejection persists only the winning turn',
    turns.length === 1 && turns[0]?.status === 'complete',
    JSON.stringify(turns),
  );
})();

// ── Employee binding beats conversation selection for the actual speaker ─────
await (async () => {
  const ctx = directCtx();
  ctx.runtimeByEmployeeId = new Map([
    ['e-alex', { model: 'fixture/model-employee', thinkingLevel: 'xhigh' }],
  ]);
  const transport = makeFakeTransport();
  const { controller, service } = makeController(ctx, transport, {
    model: () => 'fixture/model-conversation',
    thinkingLevel: () => 'low',
  });
  await seedThread(service, ctx);
  await controller.sendBossMessage(ctx.threadId, 'use the employee binding');
  check(
    '(1) employee-owned collaboration request sends employee input.model and thinkingLevel',
    transport.requests[0]?.model === 'fixture/model-employee' &&
      transport.requests[0]?.thinkingLevel === 'xhigh',
    JSON.stringify({
      model: transport.requests[0]?.model,
      thinkingLevel: transport.requests[0]?.thinkingLevel,
    }),
  );
})();

// ── (6) mentions_only: only mentioned members scheduled; no mention → none ───
await (async () => {
  const ctx = groupCtx('mentions_only');
  const transport = makeFakeTransport();
  const { controller, service } = makeController(ctx, transport);
  await seedThread(service, ctx);
  const r1 = await controller.sendBossMessage(ctx.threadId, 'hey @Kai please review');
  check(
    '(6) only the mentioned member is scheduled',
    r1.scheduled.turns.map((t) => t.employeeId).join(',') === 'e-kai',
    JSON.stringify(r1.scheduled.turns.map((t) => t.employeeId)),
  );

  const transport2 = makeFakeTransport();
  const { controller: c2, service: s2 } = makeController(ctx, transport2);
  await seedThread(s2, ctx);
  const r2 = await c2.sendBossMessage(ctx.threadId, 'hey team anyone around');
  check('(6) no mention → NO auto-fire of the whole group', r2.scheduled.turns.length === 0);
  // Ask team deterministically picks the first member.
  const ask = await c2.askTeam(ctx.threadId, r2.message);
  check(
    '(6) askTeam deterministically picks 1 (first roster member)',
    ask.turns.length === 1 && ask.turns[0].employeeId === 'e-alex',
  );
  const askChosen = await c2.askTeam(ctx.threadId, r2.message, ['e-sophie']);
  check(
    '(6) askTeam honors explicitly chosen responders',
    askChosen.turns.length === 1 && askChosen.turns[0].employeeId === 'e-sophie',
  );
})();

// ── (7) roundtable: order + 3 default + 8 cap + 1 msg each + inter-speaker ctx ─
await (async () => {
  const ctx = groupCtx('roundtable');
  const transport = makeFakeTransport();
  const { controller, service } = makeController(ctx, transport);
  await seedThread(service, ctx);
  const boss = await controller.sendBossMessage(ctx.threadId, 'lets discuss the launch');
  check('(7) roundtable does NOT auto-fire on a boss message', boss.scheduled.turns.length === 0);
  const round = await controller.startRound(ctx.threadId, boss.message, {
    mentionedFromBody: '@Sophie',
  });
  // Default cap 3: 3 participants, all 3 speak (Sophie first by mention, then roster).
  check(
    '(7) startRound schedules up to the default cap (3)',
    round.turns.length === 3,
    String(round.turns.length),
  );
  check(
    '(7) deterministic order: mention first then roster',
    round.turns.map((t) => t.employeeId).join(',') === 'e-sophie,e-alex,e-kai',
    JSON.stringify(round.turns.map((t) => t.employeeId)),
  );
  check(
    '(7) each speaker produced at most one message',
    new Set(round.turns.map((t) => t.employeeId)).size === round.turns.length,
  );
  // Exact-fit round: all 3 eligible speakers spoke within the cap, so no speakers
  // remain — roundCompleted must be FALSE (no spurious "Continue round").
  check(
    '(7) exact-fit round (all members spoke) → roundCompleted false',
    round.roundCompleted === false,
    String(round.roundCompleted),
  );
  // Inter-speaker context: the 2nd+ speakers' packets include prior speakers' replies.
  const secondPacket = transport.packets[1] ?? '';
  check(
    '(7) a later speaker sees prior speakers’ replies this round',
    secondPacket.includes('reply from e-sophie'),
  );

  // 8 hard cap: a bigger roster only schedules 8.
  const bigParticipants: CollaborationParticipant[] = Array.from({ length: 12 }, (_, i) => ({
    employeeId: `e-${i}`,
    name: `Emp${i}`,
  }));
  const bigCtx: CollaborationThreadContext = {
    ...groupCtx('roundtable'),
    participants: bigParticipants,
    roundSpeakerLimit: 99,
  };
  const bt = makeFakeTransport();
  const { controller: bc, service: bs } = makeController(bigCtx, bt);
  await bs.createGroup({
    companyId: bigCtx.companyId,
    title: bigCtx.title,
    employeeIds: bigParticipants.map((p) => p.employeeId),
    replyPolicy: 'roundtable',
  });
  const bMsg = (await bc.sendBossMessage(bigCtx.threadId, 'go')).message;
  const bigRound = await bc.startRound(bigCtx.threadId, bMsg, { maxSpeakers: 99 });
  check(
    '(7) hard cap = 8 speakers even with 12 members',
    bigRound.turns.length === ROUNDTABLE_HARD_CAP_SPEAKERS,
    String(bigRound.turns.length),
  );
  check('(7) hitting the cap returns roundCompleted', bigRound.roundCompleted === true);
})();

// ── (8) Continue creates a NEW round id, never reuses a terminated turn id ────
await (async () => {
  const ctx = groupCtx('roundtable');
  const transport = makeFakeTransport();
  const { controller, service } = makeController(ctx, transport);
  await seedThread(service, ctx);
  const boss = (await controller.sendBossMessage(ctx.threadId, 'round one')).message;
  const r1 = await controller.startRound(ctx.threadId, boss, {});
  const r2 = await controller.continueRound(ctx.threadId, boss, {});
  check(
    '(8) continueRound mints a NEW round id',
    r1.roundId !== r2.roundId && !!r2.roundId,
    `${r1.roundId} vs ${r2.roundId}`,
  );
  const r1TurnIds = new Set(r1.turns.map((t) => t.turnId));
  const reused = r2.turns.some((t) => r1TurnIds.has(t.turnId));
  check('(8) continueRound never reuses a terminated turn id', !reused);
})();

// ── (9) stop / retry / partial failure / thread switch ───────────────────────
await (async () => {
  // partial failure: a speaker failing does not block already-completed messages.
  const ctx = groupCtx('roundtable');
  const transport = makeFakeTransport();
  // Fail only Kai; Sophie + Alex succeed.
  transport.behavior = async (req) => {
    if (req.employeeId === 'e-kai') throw new Error('model error');
    return { text: `reply from ${req.employeeId}` };
  };
  const { controller, repos, service } = makeController(ctx, transport);
  await seedThread(service, ctx);
  const boss = (await controller.sendBossMessage(ctx.threadId, 'go')).message;
  const round = await controller.startRound(ctx.threadId, boss, {
    mentionedFromBody: '@Sophie @Alex @Kai',
  });
  const byEmp = new Map(round.turns.map((t) => [t.employeeId, t]));
  check(
    '(9) partial failure: failed speaker is marked failed',
    byEmp.get('e-kai')?.phase === 'failed',
  );
  check(
    '(9) partial failure: other speakers still completed',
    byEmp.get('e-sophie')?.phase === 'complete' && byEmp.get('e-alex')?.phase === 'complete',
  );
  // The failed turn's visible message is marked failed (not lost).
  const failedMsg = await repos.collaborationMessages.findById(byEmp.get('e-kai')!.messageId);
  check('(9) failed turn message row marked failed', failedMsg?.status === 'failed');
  const failedTurnRow = (await repos.collaborationTurns.listByThread(ctx.threadId)).find(
    (t) => t.employee_id === 'e-kai',
  );
  check('(9) failed turn ledger carries an error summary', !!failedTurnRow?.error_summary);
  check(
    '(9) failed turn retains the prepared execution identity',
    !!failedTurnRow?.result_provenance_json,
  );

  // retry: retrying the failed turn re-runs the same speaker into the same message id.
  transport.behavior = async (req) => ({ text: `retried ${req.employeeId}` });
  const retried = await controller.retry(ctx.threadId, byEmp.get('e-kai')!.turnId, boss);
  check('(9) retry re-runs the failed turn to complete', retried?.phase === 'complete');
  const retriedMsg = await repos.collaborationMessages.findById(byEmp.get('e-kai')!.messageId);
  check(
    '(9) retry upserts the SAME stable message id',
    retriedMsg?.body === 'retried e-kai' && retriedMsg?.status === 'complete',
  );

  // stop: a slow turn receives the controller's AbortSignal, settles with a
  // deliberately late "complete" payload, and must still finish interrupted.
  const stopCtx = directCtx();
  const stopTransport = makeFakeTransport();
  let stopSignal: AbortSignal | undefined;
  let markStopStarted!: () => void;
  const stopStarted = new Promise<void>((resolve) => {
    markStopStarted = resolve;
  });
  stopTransport.run = async (req, opts) => {
    stopTransport.requests.push(req);
    const provenance = fakeProvenance(req);
    await opts.verifyDurableTarget(provenance);
    opts?.onDelta?.('half ');
    stopSignal = opts?.signal;
    markStopStarted();
    return new Promise<CollaborationTurnResult>((resolve) => {
      opts?.signal?.addEventListener(
        'abort',
        () => resolve({ text: 'late completion that must be ignored', provenance }),
        { once: true },
      );
    });
  };
  const { controller: sc, repos: stopRepos, service: ss } = makeController(stopCtx, stopTransport);
  await seedThread(ss, stopCtx);
  const stopRun = sc.sendBossMessage(stopCtx.threadId, 'stop this reply');
  await stopStarted;
  const activeTurn = sc.getSnapshot(stopCtx.threadId).turns[0];
  check('(9) stop scenario exposes an active streaming turn', activeTurn?.phase === 'streaming');
  if (!activeTurn) throw new Error('stop scenario did not create a live turn');
  sc.stop(activeTurn.turnId);
  const stopped = await Promise.race([
    stopRun,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('stop did not settle the in-flight transport')), 250),
    ),
  ]);
  const stoppedTurn = stopped.scheduled.turns[0];
  const stoppedLedger = (await stopRepos.collaborationTurns.listByThread(stopCtx.threadId))[0];
  if (!stoppedTurn) throw new Error('stop scenario did not return its interrupted turn');
  const stoppedMessage = await stopRepos.collaborationMessages.findById(stoppedTurn.messageId);
  check('(9) stop aborts the transport signal', stopSignal?.aborted === true);
  check(
    '(9) stop marks the live turn and durable ledger interrupted',
    stoppedTurn?.phase === 'interrupted' && stoppedLedger?.status === 'interrupted',
  );
  check(
    '(9) stopped turn retains exact execution provenance when the host settled',
    !!stoppedLedger?.result_provenance_json,
  );
  check(
    '(9) a late transport completion cannot overwrite the stopped message',
    stoppedMessage?.status === 'interrupted' &&
      stoppedMessage?.body !== 'late completion that must be ignored',
  );

  // thread switch: snapshots are per-thread and independent.
  const { controller: threadSwitchController, service: threadSwitchService } = makeController(
    stopCtx,
    makeFakeTransport(),
  );
  await seedThread(threadSwitchService, stopCtx);
  const other = directCtx();
  other.threadId = 't-other';
  other.directEmployeeId = 'e-kai';
  const { controller: oc, service: os } = makeController(other, makeFakeTransport());
  await os.getOrCreateDirect(other.companyId, 'e-kai', { title: 'Direct Kai' });
  await threadSwitchController.sendBossMessage(stopCtx.threadId, 'a');
  await oc.sendBossMessage(other.threadId, 'b');
  check(
    '(9) thread switch: snapshots are per-thread independent',
    threadSwitchController.getSnapshot(stopCtx.threadId).turns.length === 1 &&
      threadSwitchController.getSnapshot('t-other').turns.length === 0,
  );
})();

// ── (2)(3) HOST isolation: zero tools, no delegate/mission, streaming ────────
{
  const entryPath = fileURLToPath(new URL('./tauri-pi-agent-host.entry.mjs', import.meta.url));
  const entry = readFileSync(entryPath, 'utf8');
  const start = entry.indexOf('async function runCollaboration(');
  const end = entry.indexOf('// The host is line-delimited on stdin');
  check('(2) runCollaboration boundary found in host source', start >= 0, String(start));
  check('(2) end boundary found after runCollaboration', end > start, `${start}..${end}`);
  const fn = extractNamedAsyncFunction(entry, 'runCollaboration');
  // Exact brace extraction prevents a moved end-comment sentinel from making
  // negative isolation scans accidentally inspect the rest of the host.
  check(
    '(2) runCollaboration function extraction is bounded',
    fn.length > 0 && fn.length < 12_000,
    String(fn.length),
  );
  const fnCode = stripComments(fn);
  check(
    '(2) host registers a dedicated collaborate dispatch',
    entry.includes("payload.mode === 'collaborate'"),
  );
  check(
    '(2) host strict collaborate uses noTools: all',
    /collaborationRead\s*\?\s*\{\}\s*:\s*\{\s*noTools:\s*'all'\s*\}/.test(fn),
  );
  check(
    '(2) host strict collaborate can pass an empty allowlist',
    /collaborationToolAllowlist\(collaborationProfile\)/.test(fn),
  );
  check(
    '(3) host collaborate registers only MCP extension factories',
    fnCode.includes('createMcpBridgeExtensionFactory') &&
      !/createDelegationExtensionFactory|createMissionBridgeExtensionFactory|createPublishArtifactExtensionFactory/.test(
        fnCode,
      ),
  );
  check(
    '(3) host collaborate never registers a delegate/mission bridge',
    !/createDelegationExtensionFactory|createMissionBridgeExtensionFactory|createPublishArtifactExtensionFactory|roster|missionContext/.test(
      fnCode,
    ),
  );
  check(
    '(1) host collaborate never binds a project workspace',
    !fnCode.includes('requireProjectWorkspaceForRun') &&
      !fnCode.includes('project_read_file') &&
      !/project_workspace_root/.test(fnCode),
  );
  check(
    '(2) host collaborate creates an ephemeral session (no session dir persistence)',
    /SessionManager\.inMemory\(cwd\)/.test(fn) && !/sessionDir/.test(fnCode),
  );
  check(
    '(4) host collaborate never writes agent_runs / chat_threads / mission tables',
    !/agent_runs|chat_threads|mission_/.test(fnCode),
  );
  check(
    '(2) host collaborate throws on strict or forbidden tool execution',
    fn.includes('COLLABORATION_FORBIDDEN_TOOLS') &&
      (fn.includes('isolation breach') || fn.includes('must not execute tool')),
  );
  // Streaming, unlike enhance: it must emit content deltas (messageDeltaLine).
  check(
    '(5) host collaborate STREAMS content deltas (messageDelta)',
    /messageDeltaLine\(\{\s*channel:\s*'content'/.test(fn),
  );

  // Rust host: a neutral cwd, no project bind, stdin reserved for the mandatory
  // execution-target ACK (and MCP results only in collaboration_read).
  const rsPattern = fileURLToPath(
    new URL('../apps/desktop/src-tauri/src/pi_agent_host/*.rs', import.meta.url),
  );
  const rs = globSync(rsPattern)
    .sort()
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  const rstart = rs.indexOf('async fn do_collaborate');
  const rend = rs.indexOf('async fn collaborate_impl');
  check('(1) do_collaborate found in Rust host', rstart >= 0 && rend > rstart);
  const rfn = rs.slice(rstart, rend);
  const rfnCode = stripComments(rfn);
  check(
    '(1) Rust collaborate uses neutral_cwd (no project bind)',
    /neutral_cwd\(app\)/.test(rfnCode) &&
      !/project_workspace_root/.test(rfnCode) &&
      !/resolved_request_cwd/.test(rfnCode),
  );
  check(
    '(2) Rust collaborate keeps stdin for the mandatory execution-target ACK',
    /register_stdin\s*=\s*Some\(req\.request_id\.as_str\(\)\)/.test(rfnCode),
  );
  check(
    '(2) Rust collaborate carries no roster / missionContextJson field',
    !/roster|mission_context_json/.test(rfnCode),
  );

  // Wire: a dedicated gateway command exists + is gated.
  check(
    '(2) agent_runtime_collaborate command exists',
    rs.includes('pub async fn agent_runtime_collaborate'),
  );
  const libRs = readFileSync(
    fileURLToPath(new URL('../apps/desktop/src-tauri/src/lib.rs', import.meta.url)),
    'utf8',
  );
  check(
    '(2) agent_runtime_collaborate registered in lib.rs handler',
    libRs.includes('pi_agent_host::agent_runtime_collaborate'),
  );
  const perm = readFileSync(
    fileURLToPath(
      new URL('../apps/desktop/src-tauri/permissions/agent-bridges.toml', import.meta.url),
    ),
    'utf8',
  );
  check(
    '(2) agent_runtime_collaborate allowlisted in agent-bridges.toml',
    perm.includes('"agent_runtime_collaborate"'),
  );

  // The transport invokes the dedicated command, NOT agent_runtime_execute.
  const transportPath = fileURLToPath(
    new URL(
      '../apps/desktop/renderer/src/runtime/collaboration/collaboration-transport.ts',
      import.meta.url,
    ),
  );
  const transportSrc = readFileSync(transportPath, 'utf8');
  check(
    '(4) collaboration transport invokes agent_runtime_collaborate (not _execute)',
    transportSrc.includes("invokeCommand('agent_runtime_collaborate'") &&
      !transportSrc.includes("invokeCommand('agent_runtime_execute'"),
  );
  check(
    '(4) collaboration transport never touches agent_runs / mission / chat_threads',
    !/agent_runs|mission|chat_thread|persistAgentRun|requireProjectWorkspaceForRun/.test(
      stripComments(transportSrc),
    ),
  );
  const transportCode = stripComments(transportSrc);
  check(
    '(4) collaboration transport resolves only the safe runtime account/model projection',
    transportCode.includes("invokeCommand('agent_runtime_status'") &&
      transportCode.includes('selectCollaborationExecutionTarget'),
  );
  check(
    '(4) collaboration transport sends the exact target + adapter model reference',
    transportCode.includes('expectedTarget: req.expectedTarget') &&
      transportCode.includes('runtimeModelRef: req.runtimeModelRef'),
  );
  check(
    '(4) executionPrepared requires durable readback before renderer ACK',
    transportCode.includes("event.kind === 'executionPrepared'") &&
      transportCode.includes('await opts.verifyDurableTarget(identity)') &&
      transportCode.includes("invokeCommand('agent_runtime_confirm_execution'"),
  );
  check(
    '(4) missing/duplicate preparation and identity mismatch abort instead of prompting',
    transportCode.includes('did not prepare the collaboration execution target') &&
      transportCode.includes('prepared the same collaboration request twice') &&
      transportCode.includes("invokeCommand('agent_runtime_abort'") &&
      transportCode.includes('requireTurnExecutionProvenance'),
  );
  check(
    '(4) collaboration has no adapter-global model override fallback',
    !transportCode.includes('readPiModelOverride'),
  );
}

// recentWindow sanity (context window bound).
{
  const msgs = Array.from({ length: 30 }, (_, i) => ({
    messageId: `m-${String(i).padStart(3, '0')}`,
    threadId: 't',
    senderType: 'boss' as const,
    body: `m${i}`,
    status: 'complete' as const,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  }));
  const w = recentWindow(msgs, 12);
  check(
    'recentWindow bounds the message window',
    w.length === 12 && w[w.length - 1].messageId === 'm-029',
  );
}

console.log(`\npi-collaboration-runtime: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`pi-collaboration-runtime gate FAILED with ${failures} failing check(s)`);
  process.exit(1);
}
console.log('pi-collaboration-runtime gate OK');
