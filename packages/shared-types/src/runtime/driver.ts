/**
 * Agent Runtime Driver SPI — the neutral contract every runtime is certified
 * against (PRD §15). This layer is deliberately **vendor-agnostic**: no SDK,
 * model, or provider brand name ever crosses into these types. A concrete
 * runtime (the in-process host, a future second runtime, the in-repo
 * {@link DeterministicTestDriver}) is one possible producer of this vocabulary —
 * never the vocabulary itself. That vendor-name-freedom is the RD-001 acceptance
 * gate.
 *
 * This SPI is **additive and parallel** to the existing {@link AgentRunEvent}
 * delegation contract (`./events/agent-run.ts`). They coexist (PRD §15.4): the
 * live chat/office surfaces keep consuming the projected `AgentRunEvent` stream
 * while new Mission surfaces consume the richer neutral envelope. Nothing here
 * touches the live Pi path; a runtime driver is *certified* against this suite
 * before it is wired in.
 *
 * Design principles (PRD §15.1):
 * - Capability negotiation, not the pretense that all SDKs are equivalent.
 * - Events are neutral; a `rawRef` MAY point at runtime-specific debug data, but
 *   product data never depends on a particular SDK's session JSON shape.
 * - An unsupported capability is explicitly degraded or blocked — never silently
 *   simulated.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Capabilities (PRD §15.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a runtime can do, negotiated up front via {@link AgentRuntimeDriver.inspect}.
 * Every field is a plain boolean: a Mission that requires a capability the active
 * runtime reports `false` for must be refused or degraded, never faked (PRD §15.1).
 */
export interface RuntimeCapabilities {
  readonly sessions: {
    readonly resume: boolean;
    readonly fork: boolean;
    readonly serializedState: boolean;
    readonly compaction: boolean;
  };
  readonly interactions: {
    readonly approval: boolean;
    readonly select: boolean;
    readonly freeText: boolean;
  };
  readonly multiAgent: {
    readonly children: boolean;
    readonly nestedChildren: boolean;
    readonly handoff: boolean;
    readonly parallel: boolean;
  };
  readonly tools: {
    readonly customTools: boolean;
    readonly dynamicToolSet: boolean;
    readonly preExecutionApproval: boolean;
  };
  readonly artifacts: {
    readonly nativeReferences: boolean;
    readonly binary: boolean;
    readonly versioned: boolean;
  };
  readonly observability: {
    readonly usage: boolean;
    readonly reasoningDelta: boolean;
    readonly toolLifecycle: boolean;
    readonly nativeTraceReference: boolean;
  };
  readonly workspace: {
    readonly customCwd: boolean;
    readonly perChildCwd: boolean;
  };
}

/** Self-describing identity + capability negotiation result for a runtime. */
export interface RuntimeDescriptor {
  readonly id: string;
  readonly version: string;
  readonly capabilities: RuntimeCapabilities;
}

// ─────────────────────────────────────────────────────────────────────────────
// Neutral event envelope (PRD §15.4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The neutral event families a runtime emits. A superset of the projected
 * {@link AgentRunEvent} types — it adds session lifecycle, explicit interaction
 * resolution, usage/checkpoint observability, an `interrupted` terminal (crash /
 * recovery), and a runtime-level error channel.
 */
export type RuntimeEventType =
  | 'runtime.session.started'
  | 'runtime.session.resumed'
  | 'run.started'
  | 'message.delta'
  | 'reasoning.delta'
  | 'tool.started'
  | 'tool.updated'
  | 'tool.completed'
  | 'interaction.requested'
  | 'interaction.resolved'
  | 'child.started'
  | 'artifact.published'
  | 'usage.updated'
  | 'checkpoint.created'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'run.interrupted'
  | 'runtime.error';

/**
 * Every event a runtime emits is wrapped in this envelope. Scope fields rebuild
 * the run/Mission tree without out-of-band ordering; `sequence` is a per-run
 * strictly-increasing counter (PRD §29 Reliability); `eventId` is the idempotency
 * key for at-least-once ingestion. `payload` is the type-specific body and
 * `rawRef` MAY reference runtime-specific debug data that product code ignores.
 */
export interface RuntimeEventEnvelope<T = unknown> {
  readonly eventId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly runtimeId: string;
  readonly runtimeVersion?: string;
  readonly runtimeSessionRef?: string;
  readonly missionId?: string;
  readonly attemptId?: string;
  readonly criterionId?: string;
  readonly threadId: string;
  readonly rootRunId: string;
  readonly runId: string;
  readonly parentRunId?: string;
  readonly employeeId?: string;
  readonly type: RuntimeEventType;
  readonly payload: T;
  readonly rawRef?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Requests, references, interactions (PRD §15.2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How interactive (approval / select / free-text) pauses are handled for a run.
 * `auto` resolves with the runtime's own default and never pauses; `manual`
 * surfaces every interaction to the caller via `interaction.requested` and waits
 * for {@link AgentRuntimeDriver.answerInteraction}.
 */
export type RuntimeInteractionMode = 'auto' | 'manual';

/**
 * A neutral run request. Deliberately minimal: a prompt, the run scope, an
 * optional workspace lease reference, an opaque policy blob, and an opaque
 * runtime-specific override. It carries **no** provider/model registry types — a
 * runtime that needs SDK-specific knobs reads them from `runtimeOptionsJson`.
 */
export interface RuntimeRunRequest {
  readonly threadId: string;
  readonly rootRunId: string;
  readonly runId: string;
  readonly prompt: string;
  readonly employeeId?: string;
  /** Opaque reference to the leased workspace root the run is jailed to. */
  readonly workspaceRef?: string;
  /** Opaque, runtime-neutral policy blob (redaction, tool gating, caps). */
  readonly policyJson?: string;
  readonly interactionMode?: RuntimeInteractionMode;
  /** Opaque runtime-specific options; the SPI never inspects this. */
  readonly runtimeOptionsJson?: string;
}

/**
 * An opaque handle to a previously-run session, sufficient to resume it. The ref
 * JSON is treated as sensitive local metadata (PRD §28.3) and never interpreted
 * by product code; `compatibilityHash` lets resume refuse a version-incompatible
 * restore instead of blindly retrying (PRD §29 Compatibility).
 */
export interface RuntimeResumeReference {
  readonly runtimeId: string;
  readonly runtimeVersion?: string;
  readonly opaqueSessionRefJson: string;
  readonly compatibilityHash?: string;
  readonly lastSafeBoundary?: string;
}

/** Minimal payload supplied when resuming — e.g. repair feedback for the run. */
export interface RuntimeResumeRequest {
  readonly feedback?: string;
}

/** Identifies a single run within its thread/root, for answer/cancel addressing. */
export interface RuntimeRunReference {
  readonly threadId: string;
  readonly rootRunId: string;
  readonly runId: string;
}

/** A pending interactive request raised by a run and awaiting a caller answer. */
export interface RuntimeInteraction {
  readonly interactionId: string;
  readonly kind: 'approval' | 'select' | 'freeText';
  readonly title: string;
  readonly message?: string;
  readonly options?: readonly string[];
}

/** The caller's resolution of a {@link RuntimeInteraction}. */
export interface RuntimeInteractionAnswer {
  readonly interactionId: string;
  readonly approved?: boolean;
  readonly value?: string;
  readonly cancelled?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sink + handle + the driver interface (PRD §15.2)
// ─────────────────────────────────────────────────────────────────────────────

/** The channel a driver pushes neutral events onto. Push, never pull. */
export interface RuntimeEventSink {
  emit(event: RuntimeEventEnvelope): void;
}

/** A live handle to a started/resumed run; `cancel` stops it cooperatively. */
export interface RuntimeRunHandle {
  readonly runId: string;
  cancel(): Promise<void>;
}

/**
 * The Service Provider Interface every runtime implements and is certified
 * against by the conformance suite (PRD §27). No method, parameter, or return
 * type references a vendor; a concrete driver maps its SDK to this shape.
 */
export interface AgentRuntimeDriver {
  readonly id: string;
  readonly version: string;

  /** Negotiate identity + capabilities before any run. */
  inspect(): Promise<RuntimeDescriptor>;

  /** Begin a fresh run, streaming neutral events to `sink`. */
  start(request: RuntimeRunRequest, sink: RuntimeEventSink): Promise<RuntimeRunHandle>;

  /** Resume a prior run from an opaque reference; rejects an incompatible ref. */
  resume(
    reference: RuntimeResumeReference,
    request: RuntimeResumeRequest,
    sink: RuntimeEventSink,
  ): Promise<RuntimeRunHandle>;

  /** Resolve a pending interaction so a paused run can continue. */
  answerInteraction(run: RuntimeRunReference, answer: RuntimeInteractionAnswer): Promise<void>;

  /** Cancel a run; the runtime stops and the run reaches a cancelled terminal. */
  cancel(run: RuntimeRunReference): Promise<void>;

  /** Release all driver-held resources. */
  dispose(): Promise<void>;
}
