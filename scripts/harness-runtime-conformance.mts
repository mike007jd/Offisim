/**
 * Runtime Conformance Harness (PRD §27, RD-006).
 *
 * Runs RC1–RC12 against the {@link DeterministicTestDriver} — the model-free
 * reference runtime — proving the neutral Runtime Driver SPI (RD-001) is
 * coherent and that the same suite can later certify a real driver (Pi: RD-004,
 * a second runtime: M7). Each check scripts a scenario, drives it through a fresh
 * driver with a capturing sink, and asserts on the emitted
 * {@link RuntimeEventEnvelope}s.
 *
 * Pure Node via tsx against shared-types source — no DOM, no renderer, no Pi, no
 * vendor SDK. Exits non-zero if any RC fails.
 *
 * RC11/RC12 here assert the SPI-level contract (the driver must not surface a raw
 * secret, and must refuse an out-of-bounds path). The FULL RC11/RC12 against the
 * real Rust redaction + path-jail boundary are asserted when the Pi driver is
 * certified (RD-004), not in this suite.
 */
import {
  DETERMINISTIC_TEST_CAPABILITIES,
  type DeterministicScript,
  type RuntimeCapabilities,
  type RuntimeEventEnvelope,
  type RuntimeEventSink,
  type RuntimeResumeReference,
  type RuntimeRunRequest,
  createDeterministicTestDriver,
} from '../packages/shared-types/src/index.js';

let failures = 0;
let rcPassed = 0;
const RC_TOTAL = 12;

function rc(id: string, name: string, run: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(run)
    .then(() => {
      rcPassed += 1;
      console.log(`  ✓ ${id} ${name}`);
    })
    .catch((error: unknown) => {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${id} ${name} — ${message}`);
    });
}

function assert(condition: boolean, detail: string): void {
  if (!condition) throw new Error(detail);
}

/** A sink that captures every envelope, in emit order. */
function capturingSink(): { sink: RuntimeEventSink; events: RuntimeEventEnvelope[] } {
  const events: RuntimeEventEnvelope[] = [];
  return { sink: { emit: (event) => events.push(event) }, events };
}

const TERMINALS = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted']);

/**
 * Pair tool lifecycle envelopes by toolCallId. Returns the started ids and any
 * orphan completions (a `tool.completed` whose toolCallId never appeared in a
 * preceding `tool.started`) — the RC2 violation detector.
 */
function pairToolLifecycle(events: RuntimeEventEnvelope[]): {
  startedIds: Set<string>;
  orphanCompletions: string[];
} {
  const startedIds = new Set<string>();
  const orphanCompletions: string[] = [];
  for (const event of events) {
    const id = (event.payload as { toolCallId?: string }).toolCallId;
    if (event.type === 'tool.started' && id) {
      startedIds.add(id);
    } else if (event.type === 'tool.completed' && id && !startedIds.has(id)) {
      orphanCompletions.push(id);
    }
  }
  return { startedIds, orphanCompletions };
}

function baseRequest(overrides: Partial<RuntimeRunRequest> = {}): RuntimeRunRequest {
  return {
    threadId: 'thread-1',
    rootRunId: 'root-1',
    runId: 'root-1',
    prompt: 'do the thing',
    employeeId: 'alex',
    ...overrides,
  };
}

console.log('runtime-conformance gate (RC1–RC12 against DeterministicTestDriver)');

async function main(): Promise<void> {
  // ── RC1 Start/stream/complete ──────────────────────────────────────────────
  await rc('RC1', 'Start/stream/complete — legal order, monotonic sequence', async () => {
    const script: DeterministicScript = {
      steps: [
        { kind: 'emit', type: 'message.delta', payload: { delta: 'Working' } },
        { kind: 'emit', type: 'reasoning.delta', payload: { delta: 'thinking' } },
        { kind: 'emit', type: 'message.delta', payload: { delta: ' done' } },
      ],
      terminal: 'run.completed',
    };
    const driver = createDeterministicTestDriver({ script });
    const { sink, events } = capturingSink();
    await driver.start(baseRequest(), sink);

    assert(events.length > 0, 'no events emitted');
    assert(
      events[0]?.type === 'runtime.session.started',
      'first event must be runtime.session.started',
    );
    assert(events[1]?.type === 'run.started', 'run.started must precede deltas');
    const terminals = events.filter((event) => TERMINALS.has(event.type));
    assert(terminals.length === 1, `expected exactly one terminal, got ${terminals.length}`);
    assert(
      events[events.length - 1]?.type === 'run.completed',
      'terminal must be last and completed',
    );
    const middleHasDeltas = events.some((event) => event.type === 'message.delta');
    assert(middleHasDeltas, 'expected message.delta in the middle');
    // sequence strictly monotonic
    for (let i = 1; i < events.length; i += 1) {
      assert(
        (events[i]?.sequence ?? -1) === (events[i - 1]?.sequence ?? -1) + 1,
        'sequence not strictly monotonic',
      );
    }
  });

  // ── RC2 Tool lifecycle ─────────────────────────────────────────────────────
  await rc('RC2', 'Tool lifecycle — pairing detector catches the orphan', async () => {
    // (a) Happy path: a started/completed pair with a stable toolCallId.
    const paired = createDeterministicTestDriver({
      script: {
        steps: [
          {
            kind: 'emit',
            type: 'tool.started',
            payload: { toolCallId: 't1', toolName: 'read_file' },
          },
          {
            kind: 'emit',
            type: 'tool.completed',
            payload: { toolCallId: 't1', status: 'completed' },
          },
        ],
        terminal: 'run.completed',
      },
    });
    const okCap = capturingSink();
    await paired.start(baseRequest(), okCap.sink);

    const started = okCap.events.filter((event) => event.type === 'tool.started');
    const completed = okCap.events.filter((event) => event.type === 'tool.completed');
    assert(started.length === 1 && completed.length === 1, 'expected one start + one complete');
    const ok = pairToolLifecycle(okCap.events);
    assert(ok.orphanCompletions.length === 0, 'happy path must have no orphan completions');
    assert(
      (started[0]?.payload as { toolCallId: string }).toolCallId ===
        (completed[0]?.payload as { toolCallId: string }).toolCallId,
      'toolCallId must be stable across start/complete',
    );

    // (b) Misbehaving driver: an ORPHAN tool.completed (no preceding tool.started).
    // The pairing detector must flag it — proving the check catches a real defect,
    // not just a self-consistent input.
    const orphaned = createDeterministicTestDriver({
      script: {
        steps: [
          {
            kind: 'emit',
            type: 'tool.completed',
            payload: { toolCallId: 'orphan', status: 'completed' },
          },
        ],
        terminal: 'run.completed',
      },
    });
    const badCap = capturingSink();
    await orphaned.start(baseRequest(), badCap.sink);

    const bad = pairToolLifecycle(badCap.events);
    assert(!bad.startedIds.has('orphan'), 'orphan id must not be in started-ids set');
    assert(
      bad.orphanCompletions.length === 1 && bad.orphanCompletions[0] === 'orphan',
      `pairing detector failed to flag the orphan completion (got ${JSON.stringify(bad.orphanCompletions)})`,
    );
  });

  // ── RC3 Interaction ────────────────────────────────────────────────────────
  await rc('RC3', 'Interaction — pause, answer, resolve, then complete', async () => {
    const script: DeterministicScript = {
      steps: [
        { kind: 'emit', type: 'message.delta', payload: { delta: 'about to ask' } },
        {
          kind: 'awaitInteraction',
          interactionId: 'i1',
          interaction: { kind: 'approval', title: 'Approve rm?', message: 'destructive' },
        },
        { kind: 'emit', type: 'message.delta', payload: { delta: 'resumed' } },
      ],
      terminal: 'run.completed',
    };
    const driver = createDeterministicTestDriver({ script });
    const { sink, events } = capturingSink();
    const request = baseRequest();
    await driver.start(request, sink);

    // Paused: interaction.requested emitted, no terminal yet.
    assert(
      events.some((event) => event.type === 'interaction.requested'),
      'no interaction.requested',
    );
    assert(!events.some((event) => TERMINALS.has(event.type)), 'must not terminate while paused');

    await driver.answerInteraction(
      { threadId: request.threadId, rootRunId: request.rootRunId, runId: request.runId },
      { interactionId: 'i1', approved: true },
    );
    assert(
      events.some((event) => event.type === 'interaction.resolved'),
      'no interaction.resolved',
    );
    const terminal = events[events.length - 1];
    assert(terminal?.type === 'run.completed', 'run must complete after the interaction resolves');
    // Order: requested before resolved before terminal.
    const idxReq = events.findIndex((event) => event.type === 'interaction.requested');
    const idxRes = events.findIndex((event) => event.type === 'interaction.resolved');
    assert(idxReq < idxRes && idxRes < events.length - 1, 'interaction ordering wrong');
  });

  // ── RC4 Cancel ─────────────────────────────────────────────────────────────
  await rc('RC4', 'Cancel — run cancelled, child cancelled, no events after terminal', async () => {
    // The driver is synchronous, so to cancel a *live* run we leave it awaiting an
    // interaction (still open), then cancel — proving the cancel cascade.
    const request = baseRequest();
    const driver2 = createDeterministicTestDriver({
      script: {
        steps: [
          {
            kind: 'emit',
            type: 'child.started',
            payload: { objective: 'subtask' },
            runId: 'c1',
            employeeId: 'maya',
          },
          {
            kind: 'awaitInteraction',
            interactionId: 'hold',
            interaction: { kind: 'approval', title: 'hold' },
          },
          { kind: 'emit', type: 'message.delta', payload: { delta: 'should not happen' } },
        ],
        terminal: 'run.completed',
      },
    });
    const cap = capturingSink();
    const handle2 = await driver2.start(request, cap.sink);
    assert(
      cap.events.some((event) => event.type === 'child.started'),
      'child.started missing',
    );
    assert(!cap.events.some((event) => TERMINALS.has(event.type)), 'run terminated before cancel');

    await handle2.cancel();
    const childCancel = cap.events.filter(
      (event) => event.type === 'run.cancelled' && event.runId === 'c1',
    );
    assert(childCancel.length === 1, 'child run was not cancelled (hanging child)');
    const rootTerminal = cap.events[cap.events.length - 1];
    assert(
      rootTerminal?.type === 'run.cancelled' && rootTerminal.runId === request.runId,
      'root not cancelled last',
    );
    assert(
      !cap.events.some(
        (event) => (event.payload as { delta?: string }).delta === 'should not happen',
      ),
      'event leaked after cancel',
    );

    // No events emitted after a terminal: cancel again is a no-op.
    const countAfter = cap.events.length;
    await driver2.cancel({
      threadId: request.threadId,
      rootRunId: request.rootRunId,
      runId: request.runId,
    });
    assert(cap.events.length === countAfter, 'events emitted after terminal');
  });

  // ── RC5 Session resume ─────────────────────────────────────────────────────
  await rc('RC5', 'Session resume — valid ref resumes, invalid ref rejected', async () => {
    const startScript: DeterministicScript = { steps: [], terminal: 'run.completed' };
    const driver = createDeterministicTestDriver({
      script: startScript,
      resumeScript: {
        steps: [{ kind: 'emit', type: 'message.delta', payload: { delta: 'continuing' } }],
        terminal: 'run.completed',
      },
    });
    // First, get a valid opaque ref from a real start.
    const startCap = capturingSink();
    await driver.start(baseRequest(), startCap.sink);
    const sessionStarted = startCap.events.find(
      (event) => event.type === 'runtime.session.started',
    );
    const opaqueRef = (sessionStarted?.payload as { runtimeSessionRef: string }).runtimeSessionRef;
    assert(typeof opaqueRef === 'string' && opaqueRef.length > 0, 'no opaque session ref produced');

    const validRef: RuntimeResumeReference = {
      runtimeId: driver.id,
      opaqueSessionRefJson: opaqueRef,
    };
    const resumeCap = capturingSink();
    await driver.resume(validRef, { feedback: 'try again' }, resumeCap.sink);
    assert(
      resumeCap.events[0]?.type === 'runtime.session.resumed',
      'resume must emit runtime.session.resumed first',
    );
    assert(
      resumeCap.events.some((event) => event.type === 'message.delta'),
      'resume did not continue',
    );
    assert(
      resumeCap.events[resumeCap.events.length - 1]?.type === 'run.completed',
      'resumed run did not complete',
    );

    // Invalid ref must be rejected.
    let rejected = false;
    try {
      await driver.resume(
        { runtimeId: driver.id, opaqueSessionRefJson: 'not-json-{{{' },
        {},
        capturingSink().sink,
      );
    } catch {
      rejected = true;
    }
    assert(rejected, 'invalid resume reference was NOT rejected');
  });

  // ── RC6 Artifact publish ───────────────────────────────────────────────────
  await rc('RC6', 'Artifact publish — title + contentHash + version + provenance', async () => {
    const script: DeterministicScript = {
      steps: [
        {
          kind: 'emit',
          type: 'artifact.published',
          payload: {
            title: 'report.md',
            contentHash: 'sha256:abc123',
            version: 1,
            provenance: { runId: 'root-1' },
          },
        },
      ],
      terminal: 'run.completed',
    };
    const driver = createDeterministicTestDriver({ script });
    const { sink, events } = capturingSink();
    await driver.start(baseRequest(), sink);

    const artifact = events.find((event) => event.type === 'artifact.published');
    assert(artifact !== undefined, 'no artifact.published event');
    const payload = artifact.payload as {
      title?: string;
      contentHash?: string;
      version?: number;
      provenance?: { runId?: string };
    };
    assert(typeof payload.title === 'string' && payload.title.length > 0, 'artifact missing title');
    assert(
      typeof payload.contentHash === 'string' && payload.contentHash.includes(':'),
      'artifact missing well-formed contentHash',
    );
    assert(typeof payload.version === 'number' && payload.version >= 1, 'artifact missing version');
    assert(payload.provenance?.runId === artifact.runId, 'artifact provenance runId mismatch');
  });

  // ── RC7 Child runs ─────────────────────────────────────────────────────────
  await rc('RC7', 'Child runs — parent/root relation rebuildable from envelopes', async () => {
    const script: DeterministicScript = {
      steps: [
        {
          kind: 'emit',
          type: 'child.started',
          payload: { objective: 'A' },
          runId: 'c1',
          employeeId: 'maya',
        },
        {
          kind: 'emit',
          type: 'child.started',
          payload: { objective: 'B' },
          runId: 'c2',
          employeeId: 'kai',
        },
        // grandchild under c1
        {
          kind: 'emit',
          type: 'child.started',
          payload: { objective: 'A.1' },
          runId: 'g1',
          parentRunId: 'c1',
          employeeId: 'raj',
        },
      ],
      terminal: 'run.completed',
    };
    const driver = createDeterministicTestDriver({ script });
    const { sink, events } = capturingSink();
    await driver.start(baseRequest(), sink);

    const children = events.filter((event) => event.type === 'child.started');
    assert(children.length === 3, `expected 3 children, got ${children.length}`);
    // Rebuild the tree purely from scope fields.
    const parentOf = new Map<string, string | undefined>();
    for (const event of children) {
      assert(event.rootRunId === 'root-1', `child ${event.runId} lost rootRunId`);
      parentOf.set(event.runId, event.parentRunId);
    }
    assert(
      parentOf.get('c1') === 'root-1' && parentOf.get('c2') === 'root-1',
      'c1/c2 must parent to root',
    );
    assert(parentOf.get('g1') === 'c1', 'grandchild must parent to c1 (depth 2 rebuildable)');
  });

  // ── RC8 Usage ──────────────────────────────────────────────────────────────
  await rc('RC8', 'Usage — input/output/cost aggregates without double count', async () => {
    const script: DeterministicScript = {
      steps: [
        { kind: 'emit', type: 'usage.updated', payload: { input: 100, output: 40, cost: 0.01 } },
        { kind: 'emit', type: 'usage.updated', payload: { input: 50, output: 20, cost: 0.005 } },
      ],
      terminal: 'run.completed',
      terminalPayload: { status: 'completed', usage: { input: 150, output: 60, cost: 0.015 } },
    };
    const driver = createDeterministicTestDriver({ script });
    const { sink, events } = capturingSink();
    await driver.start(baseRequest(), sink);

    const updates = events
      .filter((event) => event.type === 'usage.updated')
      .map((event) => event.payload as { input: number; output: number; cost: number });
    const agg = updates.reduce(
      (acc, u) => ({
        input: acc.input + u.input,
        output: acc.output + u.output,
        cost: acc.cost + u.cost,
      }),
      { input: 0, output: 0, cost: 0 },
    );
    const terminal = events[events.length - 1];
    const declared = (
      terminal?.payload as { usage: { input: number; output: number; cost: number } }
    ).usage;
    assert(
      agg.input === declared.input,
      `input aggregate ${agg.input} != terminal ${declared.input}`,
    );
    assert(
      agg.output === declared.output,
      `output aggregate ${agg.output} != terminal ${declared.output}`,
    );
    assert(
      Math.abs(agg.cost - declared.cost) < 1e-9,
      `cost aggregate ${agg.cost} != terminal ${declared.cost}`,
    );
  });

  // ── RC9 Crash recovery ─────────────────────────────────────────────────────
  await rc(
    'RC9',
    'Crash recovery — interrupted (not completed), no unsafe tool repeated',
    async () => {
      const script: DeterministicScript = {
        steps: [
          {
            kind: 'emit',
            type: 'tool.started',
            payload: { toolCallId: 'rm1', toolName: 'bash', detail: 'rm -rf x' },
          },
          {
            kind: 'emit',
            type: 'tool.completed',
            payload: { toolCallId: 'rm1', status: 'completed' },
          },
          { kind: 'crash', reason: 'process exited' },
          // Anything past the crash must not be emitted (would re-run the unsafe tool).
          {
            kind: 'emit',
            type: 'tool.started',
            payload: { toolCallId: 'rm1', toolName: 'bash', detail: 'rm -rf x' },
          },
        ],
        terminal: 'run.completed',
      };
      const driver = createDeterministicTestDriver({ script });
      const { sink, events } = capturingSink();
      await driver.start(baseRequest(), sink);

      const terminal = events[events.length - 1];
      assert(
        terminal?.type === 'run.interrupted',
        `crash must yield run.interrupted, got ${terminal?.type}`,
      );
      assert(
        !events.some((event) => event.type === 'run.completed'),
        'crashed run must NOT report completed',
      );
      // The unsafe tool (rm1) started exactly once — not auto-repeated post-crash.
      const rmStarts = events.filter(
        (event) =>
          event.type === 'tool.started' &&
          (event.payload as { toolCallId: string }).toolCallId === 'rm1',
      );
      assert(rmStarts.length === 1, `unsafe tool repeated ${rmStarts.length} times after crash`);
    },
  );

  // ── RC10 Capability fallback ───────────────────────────────────────────────
  await rc('RC10', 'Capability fallback — unsupported capability refused, not faked', async () => {
    // Build a driver that does NOT support child runs, then *script a child run*.
    // The driver must refuse it (emit a capability error) and must NOT fake the
    // child.started — this exercises real behavior, not a hardcoded constant.
    const noChildren: RuntimeCapabilities = {
      ...DETERMINISTIC_TEST_CAPABILITIES,
      multiAgent: { ...DETERMINISTIC_TEST_CAPABILITIES.multiAgent, children: false },
    };
    const driver = createDeterministicTestDriver({
      capabilities: noChildren,
      script: {
        steps: [
          {
            kind: 'emit',
            type: 'child.started',
            payload: { objective: 'subtask' },
            runId: 'c1',
            employeeId: 'maya',
          },
        ],
        terminal: 'run.completed',
      },
    });
    const descriptor = await driver.inspect();
    assert(
      descriptor.capabilities.multiAgent.children === false,
      'driver must report children unsupported',
    );

    const { sink, events } = capturingSink();
    await driver.start(baseRequest(), sink);

    // (a) Exactly one capability.unsupported error.
    const capErrors = events.filter(
      (event) =>
        event.type === 'runtime.error' &&
        (event.payload as { code?: string }).code === 'capability.unsupported',
    );
    assert(
      capErrors.length === 1,
      `expected exactly one capability.unsupported error, got ${capErrors.length}`,
    );
    assert(
      (capErrors[0]?.payload as { capability?: string }).capability === 'multiAgent.children',
      'capability error must name multiAgent.children',
    );
    // (b) The unsupported feature was NOT silently faked — no child.started emitted.
    assert(
      !events.some((event) => event.type === 'child.started'),
      'driver faked an unsupported capability (child.started leaked despite children:false)',
    );
  });

  // ── RC11 Redaction ─────────────────────────────────────────────────────────
  await rc(
    'RC11',
    'Redaction (SPI-level) — secret token scrubbed from emitted envelope',
    async () => {
      const secret = 'sk-live-ABCD1234efgh5678IJKL';
      const script: DeterministicScript = {
        steps: [
          {
            kind: 'emit',
            type: 'message.delta',
            payload: { delta: `here is the key ${secret} ok` },
          },
          {
            kind: 'emit',
            type: 'tool.started',
            payload: {
              toolCallId: 't1',
              toolName: 'bash',
              detail: `export TOKEN=${secret}`,
              env: { API_KEY: secret },
            },
          },
        ],
        terminal: 'run.completed',
      };
      const driver = createDeterministicTestDriver({ script });
      const { sink, events } = capturingSink();
      await driver.start(baseRequest(), sink);

      const serialized = JSON.stringify(events);
      assert(!serialized.includes(secret), 'raw secret leaked into an emitted envelope');
      assert(
        !/\bsk-[A-Za-z0-9_-]{8,}\b/.test(serialized),
        'sk- token pattern leaked into envelopes',
      );
      assert(serialized.includes('[REDACTED]'), 'expected redaction marker in place of the secret');
    },
  );

  // ── RC12 Workspace jail ────────────────────────────────────────────────────
  await rc('RC12', 'Workspace jail (SPI-level) — out-of-bounds path refused', async () => {
    const workspaceRef = '/workspace/lease-1';
    const script: DeterministicScript = {
      steps: [
        // In-bounds: allowed.
        {
          kind: 'emit',
          type: 'tool.started',
          payload: {
            toolCallId: 'ok',
            toolName: 'read_file',
            path: '/workspace/lease-1/src/app.ts',
          },
        },
        // Out-of-bounds absolute path: refused.
        {
          kind: 'emit',
          type: 'tool.started',
          payload: { toolCallId: 'bad1', toolName: 'read_file', path: '/etc/passwd' },
        },
        // Traversal escape: refused.
        {
          kind: 'emit',
          type: 'tool.started',
          payload: { toolCallId: 'bad2', toolName: 'read_file', path: 'src/../../secrets' },
        },
      ],
      terminal: 'run.completed',
    };
    const driver = createDeterministicTestDriver({ script });
    const { sink, events } = capturingSink();
    await driver.start(baseRequest({ workspaceRef }), sink);

    // The in-bounds tool started; the two escapes became runtime.error, not tool.started.
    const toolStarts = events.filter((event) => event.type === 'tool.started');
    assert(
      toolStarts.length === 1,
      `expected only the in-bounds tool to start, got ${toolStarts.length}`,
    );
    assert(
      (toolStarts[0]?.payload as { toolCallId: string }).toolCallId === 'ok',
      'wrong tool allowed through jail',
    );
    const jailErrors = events.filter(
      (event) =>
        event.type === 'runtime.error' &&
        (event.payload as { code?: string }).code === 'workspace.jail.violation',
    );
    assert(jailErrors.length === 2, `expected 2 jail violations refused, got ${jailErrors.length}`);
    // No escaping path string ever appears on a tool.started envelope.
    const escaped = toolStarts.some((event) => {
      const path = (event.payload as { path?: string }).path ?? '';
      return path.includes('passwd') || path.includes('secrets');
    });
    assert(!escaped, 'an out-of-bounds path leaked onto a tool.started envelope');
  });

  console.log(
    `\nruntime-conformance: ${rcPassed}/${RC_TOTAL} passed (RC11/RC12 SPI-level; full Rust-boundary coverage at Pi-driver certification)`,
  );
  if (failures > 0) {
    console.error(`runtime-conformance gate FAILED with ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('runtime-conformance gate PASSED');
}

void main();
