/**
 * DeterministicTestDriver — a model-free, I/O-free reference runtime (PRD §RD-005).
 *
 * It implements {@link AgentRuntimeDriver} by *replaying a script* of events:
 * message/reasoning deltas, tool lifecycle, interactions, children, artifacts,
 * usage, crash and cancel points. It exists to (1) certify the SPI itself and
 * the conformance suite, and (2) drive UI/state with stable, reproducible runs.
 *
 * Determinism is the contract: no `Date.now`, no `Math.random`, no Node I/O. All
 * envelope fields (`eventId`, `sequence`, `occurredAt`, `runtimeId`, scope) are
 * derived from the run context and a monotonic per-run counter, so the same
 * script always yields the byte-identical event stream.
 *
 * Two product invariants are enforced *at the SPI level* here so the suite can
 * assert them before a real driver exists:
 * - Redaction (RC11): a secret-looking token in a scripted payload is scrubbed in
 *   the emitted envelope — a raw secret never reaches the sink.
 * - Workspace jail (RC12): a scripted out-of-bounds path (outside `workspaceRef`)
 *   is refused — the driver emits `runtime.error`, never an escaping access.
 * The FULL RC11/RC12 against the real Rust boundary are asserted when the Pi
 * driver is certified (RD-004), not here.
 */

import type {
  AgentRuntimeDriver,
  RuntimeCapabilities,
  RuntimeDescriptor,
  RuntimeEventEnvelope,
  RuntimeEventSink,
  RuntimeEventType,
  RuntimeInteractionAnswer,
  RuntimeResumeReference,
  RuntimeResumeRequest,
  RuntimeRunHandle,
  RuntimeRunReference,
  RuntimeRunRequest,
} from './driver.js';

// ─────────────────────────────────────────────────────────────────────────────
// Script model
// ─────────────────────────────────────────────────────────────────────────────

/** The driver fills in `eventId`, `sequence`, `occurredAt`, `runtimeId`, scope. */
export interface ScriptEmitStep {
  readonly kind: 'emit';
  readonly type: RuntimeEventType;
  readonly payload?: unknown;
  /** Override the emitting run scope (e.g. a child run); defaults to the root run. */
  readonly runId?: string;
  readonly parentRunId?: string;
  readonly employeeId?: string;
}

/**
 * Pause the run until {@link AgentRuntimeDriver.answerInteraction} is called for
 * `interactionId`. The driver emits an `interaction.requested` event for it.
 */
export interface ScriptAwaitInteractionStep {
  readonly kind: 'awaitInteraction';
  readonly interactionId: string;
  readonly interaction: {
    readonly kind: 'approval' | 'select' | 'freeText';
    readonly title: string;
    readonly message?: string;
    readonly options?: readonly string[];
  };
  readonly employeeId?: string;
}

/** Simulate a crash here: the run reaches the `run.interrupted` terminal. */
export interface ScriptCrashStep {
  readonly kind: 'crash';
  readonly reason?: string;
}

export type ScriptStep = ScriptEmitStep | ScriptAwaitInteractionStep | ScriptCrashStep;

/** How a scripted run ends if it runs to completion without a crash. */
export type ScriptTerminal = 'run.completed' | 'run.failed';

export interface DeterministicScript {
  readonly steps: readonly ScriptStep[];
  /** Terminal emitted after the last step if no crash intervened. */
  readonly terminal?: ScriptTerminal;
  readonly terminalPayload?: unknown;
}

export interface DeterministicTestDriverOptions {
  readonly id?: string;
  readonly version?: string;
  readonly capabilities?: RuntimeCapabilities;
  /** Per-run script to replay on `start`. */
  readonly script: DeterministicScript;
  /** Optional distinct script for `resume`; defaults to `script`. */
  readonly resumeScript?: DeterministicScript;
  /**
   * Predicate that accepts a resume reference. Defaults to "opaqueSessionRefJson
   * parses to an object with a truthy `sessionId`". An invalid ref is rejected so
   * RC5 can assert resume refuses it.
   */
  readonly isValidResumeRef?: (reference: RuntimeResumeReference) => boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Redaction (RC11) + workspace jail (RC12) — SPI-level enforcement
// ─────────────────────────────────────────────────────────────────────────────

const REDACTED = '[REDACTED]';

/**
 * Secret-looking tokens that must never reach the sink. Deliberately broad: API
 * key prefixes (`sk-`, `pk-`, `ghp_`, …), bearer tokens, and long opaque blobs.
 * Whole-value scrub, not partial, so no prefix of a secret leaks either.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|pk|rk|ak)-[A-Za-z0-9_-]{8,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi,
  /\beyJ[A-Za-z0-9._-]{16,}\b/g,
];

/** Recursively scrub secret-looking strings out of any scripted payload. */
function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    let out = value;
    for (const pattern of SECRET_PATTERNS) {
      out = out.replace(pattern, REDACTED);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactDeep(inner);
    }
    return result;
  }
  return value;
}

/**
 * Decide whether a scripted path lies within the leased `workspaceRef`. Pure
 * lexical jail (the SPI-level stand-in for the real Rust path jail): absolute
 * paths, `..` traversal, and any path not prefixed by the workspace root are
 * out of bounds. With no `workspaceRef`, every path is unconstrained.
 */
function isPathWithinWorkspace(path: string, workspaceRef: string | undefined): boolean {
  if (!workspaceRef) return true;
  const segments = path.split(/[\\/]+/);
  if (segments.includes('..')) return false;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return path === workspaceRef || path.startsWith(`${workspaceRef}/`);
  }
  // Relative path with no traversal stays inside the lease.
  return true;
}

/**
 * Extract a candidate filesystem path from a tool/artifact payload, if any. Used
 * only to enforce the workspace jail on scripted tool/artifact steps.
 */
function candidatePath(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const value = record.path ?? record.cwd ?? record.workspacePath;
    if (typeof value === 'string') return value;
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Capabilities default
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What the test driver models. At least one capability is `false`
 * (`multiAgent.handoff`) so RC10 (capability fallback) has an unsupported feature
 * to exercise.
 */
export const DETERMINISTIC_TEST_CAPABILITIES: RuntimeCapabilities = {
  sessions: { resume: true, fork: false, serializedState: true, compaction: false },
  interactions: { approval: true, select: true, freeText: true },
  multiAgent: { children: true, nestedChildren: true, handoff: false, parallel: true },
  tools: { customTools: true, dynamicToolSet: false, preExecutionApproval: true },
  artifacts: { nativeReferences: false, binary: false, versioned: true },
  observability: {
    usage: true,
    reasoningDelta: true,
    toolLifecycle: true,
    nativeTraceReference: false,
  },
  workspace: { customCwd: true, perChildCwd: false },
};

const DEFAULT_ID = 'deterministic-test';
const DEFAULT_VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────────────────────
// Per-run state machine
// ─────────────────────────────────────────────────────────────────────────────

type RunPhase = 'running' | 'awaiting' | 'terminal';

interface ActiveRun {
  readonly request: RuntimeRunRequest;
  readonly sink: RuntimeEventSink;
  readonly steps: readonly ScriptStep[];
  readonly terminal: ScriptTerminal;
  readonly terminalPayload: unknown;
  cursor: number;
  sequence: number;
  phase: RunPhase;
  pendingInteractionId?: string;
  /** Children started by this run that are still in flight (for cancel cascade). */
  readonly liveChildren: Set<string>;
}

/** Deterministic ISO-ish timestamp derived only from the sequence number. */
function deterministicTimestamp(sequence: number): string {
  // 2000-01-01T00:00:00.000Z + `sequence` seconds — stable, no clock read.
  const base = Date.UTC(2000, 0, 1, 0, 0, 0, 0);
  return new Date(base + sequence * 1000).toISOString();
}

export class DeterministicTestDriver implements AgentRuntimeDriver {
  public readonly id: string;
  public readonly version: string;
  private readonly capabilities: RuntimeCapabilities;
  private readonly script: DeterministicScript;
  private readonly resumeScript: DeterministicScript;
  private readonly isValidResumeRef: (reference: RuntimeResumeReference) => boolean;
  private readonly runs = new Map<string, ActiveRun>();

  constructor(options: DeterministicTestDriverOptions) {
    this.id = options.id ?? DEFAULT_ID;
    this.version = options.version ?? DEFAULT_VERSION;
    this.capabilities = options.capabilities ?? DETERMINISTIC_TEST_CAPABILITIES;
    this.script = options.script;
    this.resumeScript = options.resumeScript ?? options.script;
    this.isValidResumeRef = options.isValidResumeRef ?? defaultResumeValidator;
  }

  inspect(): Promise<RuntimeDescriptor> {
    return Promise.resolve({ id: this.id, version: this.version, capabilities: this.capabilities });
  }

  start(request: RuntimeRunRequest, sink: RuntimeEventSink): Promise<RuntimeRunHandle> {
    const run = this.createRun(request, sink, this.script);
    this.emit(run, 'runtime.session.started', { runtimeSessionRef: this.sessionRef(request) }, {});
    this.emit(run, 'run.started', { prompt: request.prompt }, {});
    this.drive(run);
    return Promise.resolve(this.handleFor(request.runId, request));
  }

  resume(
    reference: RuntimeResumeReference,
    request: RuntimeResumeRequest,
    sink: RuntimeEventSink,
  ): Promise<RuntimeRunHandle> {
    if (!this.isValidResumeRef(reference)) {
      return Promise.reject(new Error('runtime.resume: incompatible or invalid session reference'));
    }
    // Rebuild the run context from the opaque ref (deterministic: it encodes scope).
    const runRequest = resumeRequestFromRef(reference, request);
    const run = this.createRun(runRequest, sink, this.resumeScript);
    this.emit(
      run,
      'runtime.session.resumed',
      { feedback: request.feedback ?? null, runtimeSessionRef: reference.opaqueSessionRefJson },
      {},
    );
    this.drive(run);
    return Promise.resolve(this.handleFor(runRequest.runId, runRequest));
  }

  answerInteraction(run: RuntimeRunReference, answer: RuntimeInteractionAnswer): Promise<void> {
    const active = this.runs.get(run.runId);
    if (
      !active ||
      active.phase !== 'awaiting' ||
      active.pendingInteractionId !== answer.interactionId
    ) {
      return Promise.reject(
        new Error(`runtime.answerInteraction: no pending interaction ${answer.interactionId}`),
      );
    }
    this.emit(
      active,
      'interaction.resolved',
      {
        interactionId: answer.interactionId,
        approved: answer.approved ?? null,
        value: answer.value ?? null,
        cancelled: answer.cancelled ?? false,
      },
      {},
    );
    active.pendingInteractionId = undefined;
    active.phase = 'running';
    active.cursor += 1; // step past the awaitInteraction step
    this.drive(active);
    return Promise.resolve();
  }

  cancel(run: RuntimeRunReference): Promise<void> {
    const active = this.runs.get(run.runId);
    if (!active || active.phase === 'terminal') return Promise.resolve();
    this.cancelRun(active);
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    this.runs.clear();
    return Promise.resolve();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private createRun(
    request: RuntimeRunRequest,
    sink: RuntimeEventSink,
    script: DeterministicScript,
  ): ActiveRun {
    const run: ActiveRun = {
      request,
      sink,
      steps: script.steps,
      terminal: script.terminal ?? 'run.completed',
      terminalPayload: script.terminalPayload ?? {
        status: terminalStatusOf(script.terminal ?? 'run.completed'),
      },
      cursor: 0,
      sequence: 0,
      phase: 'running',
      liveChildren: new Set<string>(),
    };
    this.runs.set(request.runId, run);
    return run;
  }

  /** Synchronously walk the script from the cursor until pause/terminal. */
  private drive(run: ActiveRun): void {
    while (run.phase === 'running' && run.cursor < run.steps.length) {
      const step = run.steps[run.cursor];
      if (!step) break;
      if (step.kind === 'awaitInteraction') {
        this.emit(
          run,
          'interaction.requested',
          {
            interactionId: step.interactionId,
            kind: step.interaction.kind,
            title: step.interaction.title,
            ...(step.interaction.message !== undefined
              ? { message: step.interaction.message }
              : {}),
            ...(step.interaction.options !== undefined
              ? { options: step.interaction.options }
              : {}),
          },
          { employeeId: step.employeeId },
        );
        run.phase = 'awaiting';
        run.pendingInteractionId = step.interactionId;
        return; // wait for answerInteraction
      }
      if (step.kind === 'crash') {
        this.terminate(run, 'run.interrupted', {
          status: 'interrupted',
          ...(step.reason !== undefined ? { reason: step.reason } : {}),
        });
        return;
      }
      // emit step
      this.driveEmit(run, step);
      run.cursor += 1;
    }
    if (run.phase === 'running') {
      this.terminate(run, run.terminal, run.terminalPayload);
    }
  }

  private driveEmit(run: ActiveRun, step: ScriptEmitStep): void {
    const workspaceRef = run.request.workspaceRef;
    // RC12: refuse out-of-bounds path on tool/artifact steps.
    if (step.type === 'tool.started' || step.type === 'artifact.published') {
      const path = candidatePath(step.payload);
      if (path !== undefined && !isPathWithinWorkspace(path, workspaceRef)) {
        this.emit(
          run,
          'runtime.error',
          { code: 'workspace.jail.violation', path, message: 'path escapes workspace lease' },
          {},
        );
        return;
      }
    }
    if (step.type === 'child.started' && !this.capabilities.multiAgent.children) {
      this.emit(
        run,
        'runtime.error',
        { code: 'capability.unsupported', capability: 'multiAgent.children' },
        {},
      );
      return;
    }
    if (step.type === 'child.started' && step.runId) {
      run.liveChildren.add(step.runId);
    }
    this.emit(run, step.type, step.payload, {
      runId: step.runId,
      parentRunId: step.parentRunId,
      employeeId: step.employeeId,
    });
  }

  private terminate(run: ActiveRun, type: RuntimeEventType, payload: unknown): void {
    run.phase = 'terminal';
    this.emit(run, type, payload, {});
  }

  private cancelRun(run: ActiveRun): void {
    // Cascade: every live child reaches a cancelled terminal first (no hanging child).
    for (const childRunId of run.liveChildren) {
      this.emit(
        run,
        'run.cancelled',
        { status: 'cancelled', cancelledChild: childRunId },
        { runId: childRunId },
      );
    }
    run.liveChildren.clear();
    run.pendingInteractionId = undefined;
    this.terminate(run, 'run.cancelled', { status: 'cancelled' });
  }

  private handleFor(runId: string, request: RuntimeRunReference): RuntimeRunHandle {
    return {
      runId,
      cancel: () => this.cancel(request),
    };
  }

  private sessionRef(request: RuntimeRunRequest): string {
    return JSON.stringify({
      sessionId: `${this.id}:${request.threadId}:${request.rootRunId}:${request.runId}`,
      threadId: request.threadId,
      rootRunId: request.rootRunId,
      runId: request.runId,
    });
  }

  /** Stamp + scrub + emit. Scope falls back to the run's own request scope. */
  private emit(
    run: ActiveRun,
    type: RuntimeEventType,
    payload: unknown,
    scope: { runId?: string; parentRunId?: string; employeeId?: string },
  ): void {
    const sequence = run.sequence;
    run.sequence += 1;
    const runId = scope.runId ?? run.request.runId;
    // A child run (its own runId differs from this run's) defaults its parent to
    // this run; the run's own events carry no parent unless the scope set one.
    const parentRunId =
      scope.parentRunId ?? (runId === run.request.runId ? undefined : run.request.runId);
    const employeeId = scope.employeeId ?? run.request.employeeId;
    const envelope: RuntimeEventEnvelope = {
      eventId: `${run.request.runId}:${sequence}`,
      sequence,
      occurredAt: deterministicTimestamp(sequence),
      runtimeId: this.id,
      runtimeVersion: this.version,
      threadId: run.request.threadId,
      rootRunId: run.request.rootRunId,
      runId,
      ...(parentRunId ? { parentRunId } : {}),
      ...(employeeId ? { employeeId } : {}),
      type,
      // RC11: scrub secret-looking tokens before they reach the sink.
      payload: redactDeep(payload),
    };
    run.sink.emit(envelope);
  }
}

/** Build a {@link DeterministicTestDriver} (factory mirror of the class). */
export function createDeterministicTestDriver(
  options: DeterministicTestDriverOptions,
): DeterministicTestDriver {
  return new DeterministicTestDriver(options);
}

function terminalStatusOf(terminal: ScriptTerminal): string {
  return terminal === 'run.completed' ? 'completed' : 'failed';
}

function defaultResumeValidator(reference: RuntimeResumeReference): boolean {
  try {
    const parsed = JSON.parse(reference.opaqueSessionRefJson) as { sessionId?: unknown };
    return typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0;
  } catch {
    return false;
  }
}

function resumeRequestFromRef(
  reference: RuntimeResumeReference,
  _request: RuntimeResumeRequest,
): RuntimeRunRequest {
  const parsed = JSON.parse(reference.opaqueSessionRefJson) as {
    threadId?: string;
    rootRunId?: string;
    runId?: string;
  };
  return {
    threadId: parsed.threadId ?? 'resumed-thread',
    rootRunId: parsed.rootRunId ?? 'resumed-root',
    runId: parsed.runId ?? 'resumed-run',
    prompt: '',
  };
}
