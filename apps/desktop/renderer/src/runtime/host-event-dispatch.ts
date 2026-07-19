import {
  agentRunEvent,
  engineActivity,
  llmStreamChunk,
  toolExecutionTelemetry,
} from '@offisim/core/browser';
import {
  type AgentRunEvent,
  type RuntimeEvent,
  WORKSPACE_DIAGNOSTICS_UPDATED_EVENT,
  type WorkspaceDiagnosticsUpdatedPayload,
  type WorkspaceProvenance,
} from '@offisim/shared-types';
import type { TaskWorkspaceBindingClaim } from '@/lib/tauri-commands.js';
import {
  agentLifecycleEvent,
  agentUiRequestEvent,
  agentUiRequestResolvedEvent,
  missionEvaluationSubmittedEvent,
  parseWorkspaceDiagnosticsPayload,
  workspaceDiagnosticsUpdatedEvent,
} from './host-event-factories.js';
import type { PersistedRunContext } from './run-context.js';
import type { PiAgentHostEvent, WorkspaceUnavailableEvent } from './pi-runtime-driver.js';
import {
  type WorkspaceBindingStreamGate,
  type WorkspaceStreamConsumptionPolicy,
  acceptWorkspaceBinding,
  acceptWorkspaceUnavailable,
  canConsumeWorkspaceEvent,
  rejectWorkspaceBinding,
} from './workspace-binding-stream-gate.js';
import {
  bindingMatchesRun,
  isSameWorkspaceBindingClaim,
  isSameWorkspaceUnavailable,
  projectWorkspaceBinding,
  workspaceUnavailableMatchesRun,
} from './workspace-binding.js';
import {
  notableWorkspaceProvenanceForBinding,
  workspaceProvenanceForUnavailable,
} from './workspace-provenance.js';

type AgentRunHostEvent = Extract<PiAgentHostEvent, { kind: 'agentRun' }>;
type WorkspaceRequirement = 'optional' | 'required';

export interface HostEventStreamState {
  workspaceGate: WorkspaceBindingStreamGate<
    TaskWorkspaceBindingClaim,
    WorkspaceUnavailableEvent
  >;
  runtimeContext: Partial<PersistedRunContext>;
  contentText: string;
  reasoningText: string;
  readonly startedAtByTool: Map<string, number>;
  readonly inFlightToolCallIds: Set<string>;
}

interface HostEventContextBase {
  mode: 'live' | 'reattach' | 'shared';
  runId: string;
  threadId: string;
}

export interface BufferedHostEventContext extends HostEventContextBase {
  mode: 'reattach';
  phase: 'buffering';
  onWorkspaceBound: (
    event: Extract<PiAgentHostEvent, { kind: 'workspaceBound' }>,
  ) => boolean | void;
  onWorkspaceUnavailable: (
    event: Extract<PiAgentHostEvent, { kind: 'workspaceUnavailable' }>,
  ) => boolean | void;
  bufferEvent: (event: PiAgentHostEvent) => void;
}

export interface ActiveHostEventContext extends HostEventContextBase {
  phase: 'active';
  engineId: string;
  companyId: string;
  requestId: string;
  projectId: string | null;
  employeeId: string | null;
  activityEngineId: Parameters<typeof engineActivity>[2]['engineId'];
  policy: WorkspaceStreamConsumptionPolicy;
  workspaceRequirement: WorkspaceRequirement;
  expectedWorkspace: {
    projectId: string | null;
    access: 'read' | 'write' | null;
    threadId: string;
    turnId: string;
    requestId: string;
  };
  runScope: {
    conversationKey: string;
    runId: string;
    threadId: string;
  };
  state: HostEventStreamState;
  recordProgress: () => void;
  onUiRequestObserved: () => void;
  onWorkspaceAccepted: () => void;
  onRejected: (message: string) => void;
  onStarted: (event: Extract<PiAgentHostEvent, { kind: 'started' }>) => void;
  onExecutionPrepared: (
    event: Extract<PiAgentHostEvent, { kind: 'executionPrepared' }>,
  ) => void;
  onStreamCursor: (event: Extract<PiAgentHostEvent, { kind: 'streamCursor' }>) => void;
  onResult: (event: Extract<PiAgentHostEvent, { kind: 'result' }>) => void;
  onError: (event: Extract<PiAgentHostEvent, { kind: 'error' }>) => void;
  flushPendingControls: () => void;
  handleControlLifecycle: (payload: unknown) => void;
  persistContext: () => void;
  enqueuePersist: (work: () => Promise<void>) => void;
  persistArtifact: (
    event: AgentRunEvent,
    bindingClaim: TaskWorkspaceBindingClaim | null,
  ) => Promise<void>;
  persistWorkspaceDiagnostics: (
    event: AgentRunHostEvent,
    projectId: string | null,
    payload: WorkspaceDiagnosticsUpdatedPayload,
  ) => Promise<boolean>;
  persistMcpToolCall: (event: AgentRunHostEvent, employeeId: string | null) => Promise<void>;
  persistWorkspaceLeaseSnapshot: (
    event: AgentRunHostEvent,
    projectId: string | null,
  ) => Promise<void>;
  persistWorkspaceCheckpoint: (
    event: AgentRunHostEvent,
    projectId: string | null,
  ) => Promise<void>;
  persistAgentRun: (event: AgentRunEvent) => Promise<void>;
  rootRun: (type: AgentRunEvent['type'], payload: AgentRunEvent['payload']) => AgentRunEvent;
  emitRootBus: (event: AgentRunEvent) => void;
  emitRuntimeEvent: (event: RuntimeEvent<any>) => void;
  emitWorkspaceStatus: (provenance: WorkspaceProvenance) => void;
}

export type HostEventContext = BufferedHostEventContext | ActiveHostEventContext;

export type HostEventHandler<K extends PiAgentHostEvent['kind']> = (
  event: Extract<PiAgentHostEvent, { kind: K }>,
  ctx: HostEventContext,
) => Promise<void> | void;

function bufferEvent(
  event: PiAgentHostEvent,
  ctx: HostEventContext,
  beforeBuffer?: (ctx: BufferedHostEventContext) => boolean | void,
): ctx is BufferedHostEventContext {
  if (ctx.phase !== 'buffering') return false;
  if (beforeBuffer?.(ctx) === false) return true;
  ctx.bufferEvent(event);
  return true;
}

function activeContext(ctx: HostEventContext): ActiveHostEventContext | null {
  if (ctx.phase !== 'active') return null;
  return ctx;
}

function canConsume(
  ctx: ActiveHostEventContext,
  event: PiAgentHostEvent,
): boolean {
  if (canConsumeWorkspaceEvent(ctx.state.workspaceGate, event, ctx.policy)) return true;
  if (ctx.policy !== 'terminal-reconcile' && ctx.state.workspaceGate.status !== 'rejected') {
    ctx.state.workspaceGate = rejectWorkspaceBinding(ctx.state.workspaceGate);
    ctx.onRejected(`Backend emitted unsafe ${event.kind} activity without a task workspace binding.`);
  }
  return false;
}

function toolStatus(event: Extract<PiAgentHostEvent, { kind: 'tool' }>) {
  if (event.status === 'failed') return 'error' as const;
  if (event.status === 'completed') return 'completed' as const;
  return 'started' as const;
}

const workspaceBound: HostEventHandler<'workspaceBound'> = (event, ctx) => {
  if (bufferEvent(event, ctx, (buffered) => buffered.onWorkspaceBound(event))) return;
  const active = activeContext(ctx);
  if (!active) return;
  const { expectedWorkspace, state } = active;
  const matchesExpectedTurn = Boolean(
    expectedWorkspace.projectId &&
      expectedWorkspace.access &&
      bindingMatchesRun(event, {
        companyId: active.companyId,
        projectId: expectedWorkspace.projectId,
        threadId: expectedWorkspace.threadId,
        turnId: expectedWorkspace.turnId,
        requestId: expectedWorkspace.requestId,
        access: expectedWorkspace.access,
      }),
  );
  const matchesBoundClaim =
    state.workspaceGate.status !== 'bound' ||
    isSameWorkspaceBindingClaim(state.workspaceGate.claim, event);
  state.workspaceGate = acceptWorkspaceBinding(
    state.workspaceGate,
    event,
    matchesExpectedTurn,
    matchesBoundClaim,
  );
  if (state.workspaceGate.status === 'rejected') {
    active.onRejected('Backend returned a workspace binding for a different Turn.');
    return;
  }
  state.runtimeContext.workspaceBinding = projectWorkspaceBinding(event);
  state.runtimeContext.workspaceAvailability = 'bound';
  const workspaceProvenance = notableWorkspaceProvenanceForBinding(event);
  if (workspaceProvenance) {
    state.runtimeContext.workspaceProvenance = workspaceProvenance;
    active.emitWorkspaceStatus(workspaceProvenance);
  } else {
    state.runtimeContext.workspaceProvenance = undefined;
  }
  active.onWorkspaceAccepted();
  active.persistContext();
};

const workspaceUnavailable: HostEventHandler<'workspaceUnavailable'> = (event, ctx) => {
  if (bufferEvent(event, ctx, (buffered) => buffered.onWorkspaceUnavailable(event))) return;
  const active = activeContext(ctx);
  if (!active) return;
  const { expectedWorkspace, state } = active;
  const matchesExpectedTurn = Boolean(
    expectedWorkspace.projectId &&
      workspaceUnavailableMatchesRun(event, {
        projectId: expectedWorkspace.projectId,
        threadId: expectedWorkspace.threadId,
        turnId: expectedWorkspace.turnId,
        requestId: expectedWorkspace.requestId,
      }),
  );
  const matchesUnavailable =
    state.workspaceGate.status !== 'unavailable' ||
    isSameWorkspaceUnavailable(state.workspaceGate.unavailable, event);
  state.workspaceGate = acceptWorkspaceUnavailable(
    state.workspaceGate,
    event,
    matchesExpectedTurn,
    matchesUnavailable,
  );
  if (state.workspaceGate.status === 'rejected') {
    active.onRejected('Backend returned an unavailable workspace state for a different Turn.');
    return;
  }
  state.runtimeContext.workspaceBinding = null;
  state.runtimeContext.workspaceAvailability = 'unavailable';
  state.runtimeContext.workspaceProvenance = workspaceProvenanceForUnavailable(
    event,
    active.workspaceRequirement,
  );
  active.onWorkspaceAccepted();
  active.emitWorkspaceStatus(state.runtimeContext.workspaceProvenance);
  active.persistContext();
  if (active.workspaceRequirement === 'required') {
    active.onRejected('This run requires an available Project folder.');
  }
};

const executionPrepared: HostEventHandler<'executionPrepared'> = (event, ctx) => {
  if (bufferEvent(event, ctx)) return;
  activeContext(ctx)?.onExecutionPrepared(event);
};

const streamCursor: HostEventHandler<'streamCursor'> = (event, ctx) => {
  if (bufferEvent(event, ctx)) return;
  activeContext(ctx)?.onStreamCursor(event);
};

const started: HostEventHandler<'started'> = (event, ctx) => {
  if (bufferEvent(event, ctx)) return;
  const active = activeContext(ctx);
  if (!active || !canConsume(active, event)) return;
  active.onStarted(event);
  if (active.engineId === 'api') active.flushPendingControls();
};

const lifecycle: HostEventHandler<'lifecycle'> = (event, ctx) => {
  if (bufferEvent(event, ctx)) return;
  const active = activeContext(ctx);
  if (!active || !canConsume(active, event)) return;
  active.handleControlLifecycle(event.payload);
  active.emitRuntimeEvent(
    agentLifecycleEvent(active.companyId, active.threadId, {
      requestId: active.requestId,
      runId: active.runScope.runId,
      event: event.event,
      data:
        event.payload && typeof event.payload === 'object'
          ? (event.payload as Record<string, unknown>)
          : {},
    }),
  );
};

const messageDelta: HostEventHandler<'messageDelta'> = (event, ctx) => {
  if (bufferEvent(event, ctx)) return;
  const active = activeContext(ctx);
  if (!active || !canConsume(active, event) || !event.delta) return;
  const channel = event.channel === 'reasoning' ? 'reasoning' : 'content';
  if (channel === 'reasoning') active.state.reasoningText += event.delta;
  else active.state.contentText += event.delta;
  active.emitRuntimeEvent(
    llmStreamChunk(
      active.companyId,
      active.threadId,
      active.engineId,
      event.delta,
      channel,
      active.runScope,
    ),
  );
};

const messageEnd: HostEventHandler<'messageEnd'> = (event, ctx) => {
  if (bufferEvent(event, ctx)) return;
  const active = activeContext(ctx);
  if (!active || !canConsume(active, event)) return;
  if (event.text) active.state.contentText = event.text;
};

const tool: HostEventHandler<'tool'> = (event, ctx) => {
  if (bufferEvent(event, ctx)) return;
  const active = activeContext(ctx);
  if (!active || !canConsume(active, event)) return;
  const { state } = active;
  const wasInFlight = state.inFlightToolCallIds.has(event.toolCallId);
  if (event.status === 'started' || event.status === 'running') {
    state.inFlightToolCallIds.add(event.toolCallId);
  } else {
    state.inFlightToolCallIds.delete(event.toolCallId);
  }
  if (wasInFlight !== state.inFlightToolCallIds.has(event.toolCallId)) {
    state.runtimeContext.inFlightToolCallIds = [...state.inFlightToolCallIds];
    active.persistContext();
  }
  const startedAt = state.startedAtByTool.get(event.toolCallId) ?? Date.now();
  if (event.status === 'started') state.startedAtByTool.set(event.toolCallId, startedAt);
  const completedAt =
    event.status === 'completed' || event.status === 'failed' ? Date.now() : undefined;
  active.emitRuntimeEvent(
    toolExecutionTelemetry(active.companyId, active.threadId, {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      toolType: 'builtin',
      evidenceClass: 'sdk-native',
      threadId: active.threadId,
      nodeName: active.engineId,
      employeeId: active.employeeId ?? undefined,
      startedAt,
      completedAt,
      durationMs:
        event.durationMs ?? (completedAt ? Math.max(0, completedAt - startedAt) : undefined),
      status: toolStatus(event),
      detail: event.detail,
      errorType:
        event.status === 'failed' ? (event.detail ?? `${active.engineId}_tool_failed`) : undefined,
      chatConversationKey: active.runScope.conversationKey,
      chatRunId: active.runScope.runId,
    }),
  );
  if (event.status === 'started') {
    active.emitRootBus(
      active.rootRun('tool.started', {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: 'started',
        detail: event.detail,
      }),
    );
  } else if (event.status === 'completed' || event.status === 'failed') {
    active.emitRootBus(
      active.rootRun('tool.completed', {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: event.status,
        detail: event.detail,
      }),
    );
  }
  if (
    active.engineId === 'codex' &&
    event.status === 'completed' &&
    event.toolName === 'file_change' &&
    event.artifactPaths?.length
  ) {
    for (const [index, rawPath] of event.artifactPaths.entries()) {
      const path = rawPath.trim();
      if (!path) continue;
      const title = path.split(/[\\/]/).pop() || path;
      const artifactEvent = active.rootRun('artifact.created', {
        deliverableId: `artifact-${active.runScope.runId}-${event.toolCallId}-${index}`,
        path,
        title,
        kind: 'file',
      });
      active.enqueuePersist(() =>
        active.persistArtifact(artifactEvent, state.workspaceGate.claim),
      );
    }
  }
};

const uiRequest: HostEventHandler<'uiRequest'> = (event, ctx) => {
  if (bufferEvent(event, ctx)) return;
  const active = activeContext(ctx);
  if (!active) return;
  active.onUiRequestObserved();
  if (!canConsume(active, event)) return;
  active.emitRuntimeEvent(
    agentUiRequestEvent(active.companyId, active.threadId, {
      engineId: active.engineId,
      requestId: active.requestId,
      runId: active.runId,
      id: event.id,
      method: event.method,
      title: event.title,
      message: event.message,
      options: event.options,
      placeholder: event.placeholder,
      prefill: event.prefill,
      params: event.params,
    }),
  );
  if (event.method === 'confirm') {
    active.emitRootBus(
      active.rootRun('approval.requested', {
        uiRequestId: event.id,
        title: event.title,
        message: event.message,
      }),
    );
  }
};

const uiRequestResolved: HostEventHandler<'uiRequestResolved'> = (event, ctx) => {
  if (bufferEvent(event, ctx)) return;
  const active = activeContext(ctx);
  if (!active || !canConsume(active, event)) return;
  active.emitRuntimeEvent(
    agentUiRequestResolvedEvent(active.companyId, active.threadId, {
      engineId: active.engineId,
      requestId: active.requestId,
      runId: active.runId,
      id: event.id,
      resolution: event.resolution,
    }),
  );
};

const agentRun: HostEventHandler<'agentRun'> = (event, ctx) => {
  if (bufferEvent(event, ctx)) return;
  const active = activeContext(ctx);
  if (!active || !canConsume(active, event)) return;
  if (event.runType === WORKSPACE_DIAGNOSTICS_UPDATED_EVENT) {
    const diagnostics = parseWorkspaceDiagnosticsPayload(event.payload);
    if (!diagnostics) return;
    const payload: WorkspaceDiagnosticsUpdatedPayload = {
      ...diagnostics,
      requestId: active.requestId,
      runId: event.rootRunId,
      ...(event.runId !== event.rootRunId ? { childRunId: event.runId } : {}),
    };
    active.enqueuePersist(async () => {
      const persisted = await active.persistWorkspaceDiagnostics(
        event,
        active.projectId,
        payload,
      );
      if (persisted) {
        active.emitRuntimeEvent(
          workspaceDiagnosticsUpdatedEvent(active.companyId, event.threadId, payload),
        );
      }
    });
    return;
  }
  if (event.runType === 'mcp.tool.called') {
    active.enqueuePersist(() => active.persistMcpToolCall(event, active.employeeId));
    return;
  }
  if (event.runType === 'workspace.lease.snapshot') {
    active.enqueuePersist(() =>
      active.persistWorkspaceLeaseSnapshot(event, active.projectId),
    );
    return;
  }
  if (event.runType === 'workspace.checkpoint') {
    const payload =
      event.payload && typeof event.payload === 'object'
        ? (event.payload as Record<string, unknown>)
        : {};
    const checkpointId =
      typeof payload.checkpointId === 'string' ? payload.checkpointId : event.runId;
    const step = typeof payload.step === 'number' ? payload.step : null;
    const changedPaths = Array.isArray(payload.changedPaths)
      ? payload.changedPaths.filter((path): path is string => typeof path === 'string')
      : [];
    active.emitRuntimeEvent(
      engineActivity(active.companyId, event.threadId, {
        runId: event.runId,
        engineId: active.activityEngineId,
        employeeId: event.employeeId ?? event.runId,
        employeeName: event.employeeId ?? event.runId,
        taskRunId: event.rootRunId,
        kind: 'checkpoint',
        status: 'completed',
        activityId: checkpointId,
        label: step === null ? 'Workspace checkpoint' : `Workspace checkpoint · Step ${step}`,
        detail:
          changedPaths.length > 0
            ? `${changedPaths.length} changed file${changedPaths.length === 1 ? '' : 's'}`
            : 'Workspace baseline',
      }),
    );
    active.enqueuePersist(() =>
      active.persistWorkspaceCheckpoint(event, active.projectId),
    );
    return;
  }
  if (event.runType === 'evaluation_submitted') {
    const payload = (event.payload ?? {}) as {
      criterionId?: string;
      summary?: string;
      evidenceRefs?: string[];
    };
    if (typeof payload.criterionId === 'string' && payload.criterionId.trim()) {
      active.emitRuntimeEvent(
        missionEvaluationSubmittedEvent(active.companyId, event.threadId, {
          runId: event.runId,
          rootRunId: event.rootRunId,
          criterionId: payload.criterionId,
          summary: typeof payload.summary === 'string' ? payload.summary : '',
          evidenceRefs: Array.isArray(payload.evidenceRefs)
            ? payload.evidenceRefs.filter((ref): ref is string => typeof ref === 'string')
            : [],
        }),
      );
    }
    return;
  }
  if (event.runType === 'mission_state_query') return;
  const agentPayload =
    event.runType === 'run.started'
      ? {
          ...(event.payload && typeof event.payload === 'object' ? event.payload : {}),
          projectId: active.projectId,
        }
      : event.payload;
  const agentEvent = {
    threadId: event.threadId,
    rootRunId: event.rootRunId,
    runId: event.runId,
    ...(event.parentRunId ? { parentRunId: event.parentRunId } : {}),
    ...(event.employeeId ? { employeeId: event.employeeId } : {}),
    ...(event.relation ? { relation: event.relation } : {}),
    ...(event.workKind ? { workKind: event.workKind } : {}),
    type: event.runType,
    payload: agentPayload,
  } as AgentRunEvent;
  if (event.runType === 'artifact.created') {
    active.enqueuePersist(() =>
      active.persistArtifact(agentEvent, active.state.workspaceGate.claim),
    );
  } else {
    active.emitRuntimeEvent(agentRunEvent(active.companyId, agentEvent));
    active.enqueuePersist(() => active.persistAgentRun(agentEvent));
  }
};

const result: HostEventHandler<'result'> = (event, ctx) => {
  if (bufferEvent(event, ctx)) return;
  const active = activeContext(ctx);
  if (!active || !canConsume(active, event)) return;
  active.onResult(event);
};

const error: HostEventHandler<'error'> = (event, ctx) => {
  if (bufferEvent(event, ctx)) return;
  const active = activeContext(ctx);
  if (!active || !canConsume(active, event)) return;
  active.onError(event);
};

export const HOST_EVENT_HANDLERS = {
  executionPrepared,
  started,
  workspaceBound,
  workspaceUnavailable,
  messageDelta,
  messageEnd,
  tool,
  uiRequest,
  uiRequestResolved,
  lifecycle,
  agentRun,
  result,
  error,
  streamCursor,
} satisfies { [K in PiAgentHostEvent['kind']]: HostEventHandler<K> };

export async function dispatchHostEvent(
  event: PiAgentHostEvent,
  ctx: HostEventContext,
): Promise<void> {
  if (ctx.phase === 'active') ctx.recordProgress();
  const handler = HOST_EVENT_HANDLERS[event.kind] as HostEventHandler<PiAgentHostEvent['kind']>;
  await handler(event, ctx);
}
