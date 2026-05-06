import { type InteractionRequest, chatScopeFields } from '@offisim/shared-types';
import type {
  EngineArtifact,
  EngineProposal,
  RuntimeActivityEvent,
} from '../engine/engine-types.js';
import type { EmployeeRuntimeBinding } from '../engine/engine-types.js';
import {
  engineActivity,
  engineProposalCreated,
  interactionRequested,
  llmStreamChunk,
  llmUsageRecorded,
  toolExecutionTelemetry,
} from '../events/event-factories.js';
import type { OffisimGraphState, RunScope } from '../graph/state.js';
import type { LlmResponse } from '../llm/gateway.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { generateId } from '../utils/generate-id.js';
import { finalizeEmployeeSuccess } from './employee-completion.js';
import type { MaterializedEmployeeDeliverable } from './employee-deliverables.js';
import { finalizeEmployeeFailure } from './employee-error-finalize.js';
import type { PreflightResult } from './employee-preflight.js';

interface ToolTiming {
  readonly startedAt: number;
}

function materializeEngineArtifact(
  artifact: EngineArtifact | undefined,
): MaterializedEmployeeDeliverable | null {
  if (!artifact) return null;
  return {
    fileName: artifact.fileName ?? null,
    mimeType: artifact.mimeType ?? null,
    artifactContent: artifact.content,
  };
}

function proposalPayload(
  proposal: EngineProposal,
  runtimeBinding: Extract<EmployeeRuntimeBinding, { mode: 'engine' }>,
  preflight: PreflightResult,
) {
  return {
    proposalId: proposal.proposalId,
    engineId: runtimeBinding.engineId,
    kind: proposal.kind,
    title: proposal.title,
    description: proposal.description,
    employeeId: preflight.employee.employee_id,
    taskRunId: preflight.taskRunId ?? null,
    ...(proposal.payload ? { payload: proposal.payload } : {}),
    createdAt: proposal.createdAt,
  };
}

async function requestEngineApproval(
  runtimeCtx: RuntimeContext,
  preflight: PreflightResult,
  event: Extract<RuntimeActivityEvent, { kind: 'approval_requested' }>,
  signal?: AbortSignal,
  runScope: RunScope | null = null,
): Promise<void> {
  const request: InteractionRequest = {
    interactionId: generateId('interaction'),
    threadId: runtimeCtx.threadId,
    companyId: runtimeCtx.companyId,
    kind: 'agent_question',
    severity: 'high',
    title: event.title,
    prompt: event.prompt,
    options: [
      {
        id: 'approve',
        label: 'Approve',
        recommended: true,
      },
      {
        id: 'reject',
        label: 'Reject',
      },
    ],
    allowFreeformResponse: true,
    requestedByNode: 'employee_engine',
    employeeId: preflight.employee.employee_id,
    taskRunId: preflight.taskRunId ?? null,
    context: {
      type: 'agent_question',
      questionKey: event.proposal
        ? `engine-proposal:${event.proposal.proposalId}`
        : 'engine-approval',
    },
    createdAt: event.timestamp ?? Date.now(),
  };

  if (!runtimeCtx.interactionService) {
    runtimeCtx.eventBus.emit(
      interactionRequested(runtimeCtx.companyId, runtimeCtx.threadId, request, runScope),
    );
    throw new Error('Engine approval requested but no interaction service is available.');
  }

  const response = await runtimeCtx.interactionService.requestAndWait(request, {
    signal,
    runScope,
  });
  if (response.selectedOptionId !== 'approve') {
    throw new Error('Engine approval request was rejected.');
  }
}

async function mapEngineEvent(
  runtimeCtx: RuntimeContext,
  preflight: PreflightResult,
  runtimeBinding: Extract<EmployeeRuntimeBinding, { mode: 'engine' }>,
  runId: string,
  event: RuntimeActivityEvent,
  toolTimings: Map<string, ToolTiming>,
  proposalsSeen: Set<string>,
  signal?: AbortSignal,
  runScope: RunScope | null = null,
): Promise<EngineArtifact | null> {
  const { companyId, threadId, eventBus } = runtimeCtx;
  const employeeId = preflight.employee.employee_id;
  const employeeName = preflight.employee.name;
  const taskRunId = preflight.taskRunId ?? null;

  switch (event.kind) {
    case 'text_delta':
      if (event.content) {
        eventBus.emit(
          llmStreamChunk(
            companyId,
            threadId,
            'employee',
            event.content,
            event.channel ?? 'content',
            runScope,
          ),
        );
      }
      return null;
    case 'reasoning_delta':
      if (event.content) {
        eventBus.emit(
          llmStreamChunk(companyId, threadId, 'employee', event.content, 'reasoning', runScope),
        );
      }
      return null;
    case 'tool_started': {
      const startedAt = event.timestamp ?? Date.now();
      toolTimings.set(event.toolCallId, { startedAt });
      eventBus.emit(
        toolExecutionTelemetry(companyId, threadId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          toolType: event.toolType ?? 'builtin',
          threadId,
          nodeName: 'employee',
          employeeId,
          taskRunId,
          ...(event.serverName ? { serverName: event.serverName } : {}),
          startedAt,
          status: 'started',
          ...chatScopeFields(runScope),
        }),
      );
      return null;
    }
    case 'tool_completed': {
      const completedAt = event.timestamp ?? Date.now();
      const startedAt = toolTimings.get(event.toolCallId)?.startedAt ?? completedAt;
      eventBus.emit(
        toolExecutionTelemetry(companyId, threadId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          toolType: event.toolType ?? 'builtin',
          threadId,
          nodeName: 'employee',
          employeeId,
          taskRunId,
          ...(event.serverName ? { serverName: event.serverName } : {}),
          startedAt,
          completedAt,
          durationMs: Math.max(0, completedAt - startedAt),
          status: event.status ?? 'completed',
          ...(event.errorType ? { errorType: event.errorType } : {}),
          ...chatScopeFields(runScope),
        }),
      );
      return null;
    }
    case 'subagent_started':
    case 'subagent_completed':
      eventBus.emit(
        engineActivity(companyId, threadId, {
          runId,
          engineId: runtimeBinding.engineId,
          employeeId,
          employeeName,
          taskRunId,
          kind: 'subagent',
          status: event.kind === 'subagent_started' ? 'started' : 'completed',
          activityId: event.activityId,
          label: event.label,
          detail: event.detail,
        }),
      );
      return null;
    case 'artifact_ready':
      eventBus.emit(
        engineActivity(companyId, threadId, {
          runId,
          engineId: runtimeBinding.engineId,
          employeeId,
          employeeName,
          taskRunId,
          kind: 'artifact',
          status: 'ready',
          label: event.artifact.fileName ?? 'Artifact',
        }),
      );
      return event.artifact;
    case 'approval_requested':
      eventBus.emit(
        engineActivity(companyId, threadId, {
          runId,
          engineId: runtimeBinding.engineId,
          employeeId,
          employeeName,
          taskRunId,
          kind: 'approval',
          status: 'requested',
          label: event.title,
          detail: event.prompt,
          proposalId: event.proposal?.proposalId,
        }),
      );
      if (event.proposal && !proposalsSeen.has(event.proposal.proposalId)) {
        proposalsSeen.add(event.proposal.proposalId);
        eventBus.emit(
          engineProposalCreated(companyId, threadId, {
            proposal: proposalPayload(event.proposal, runtimeBinding, preflight),
          }),
        );
      }
      await requestEngineApproval(runtimeCtx, preflight, event, signal, runScope);
      return null;
    case 'proposal_created':
      if (!proposalsSeen.has(event.proposal.proposalId)) {
        proposalsSeen.add(event.proposal.proposalId);
        eventBus.emit(
          engineProposalCreated(companyId, threadId, {
            proposal: proposalPayload(event.proposal, runtimeBinding, preflight),
          }),
        );
      }
      eventBus.emit(
        engineActivity(companyId, threadId, {
          runId,
          engineId: runtimeBinding.engineId,
          employeeId,
          employeeName,
          taskRunId,
          kind: 'proposal',
          status: 'created',
          label: event.proposal.title,
          detail: event.proposal.description,
          proposalId: event.proposal.proposalId,
        }),
      );
      return null;
    case 'run_completed':
    case 'run_failed':
    case 'run_cancelled':
      eventBus.emit(
        engineActivity(companyId, threadId, {
          runId,
          engineId: runtimeBinding.engineId,
          employeeId,
          employeeName,
          taskRunId,
          kind: 'run',
          status:
            event.kind === 'run_completed'
              ? 'completed'
              : event.kind === 'run_cancelled'
                ? 'cancelled'
                : 'failed',
          detail: event.detail,
        }),
      );
      return null;
  }
}

export async function runEmployeeEngine(
  state: OffisimGraphState,
  runtimeCtx: RuntimeContext,
  preflight: PreflightResult,
  runtimeBinding: Extract<EmployeeRuntimeBinding, { mode: 'engine' }>,
  signal?: AbortSignal,
  runScope: RunScope | null = null,
): Promise<Partial<OffisimGraphState>> {
  const adapter = runtimeCtx.engineAdapters?.get(runtimeBinding.engineId);
  if (!adapter) {
    return finalizeEmployeeFailure({
      runtimeCtx,
      state,
      preflight,
      errorMessage: `Engine adapter "${runtimeBinding.engineId}" is unavailable in this runtime.`,
    });
  }

  let runId: string | null = null;
  try {
    const handle = await adapter.startRun(
      {
        companyId: runtimeCtx.companyId,
        threadId: runtimeCtx.threadId,
        employeeId: preflight.employee.employee_id,
        employeeName: preflight.employee.name,
        roleSlug: preflight.employee.role_slug,
        provider: preflight.resolved.provider,
        model: preflight.resolved.model,
        ...(preflight.taskRunId ? { taskRunId: preflight.taskRunId } : {}),
        taskType: preflight.assignment.taskType,
        taskDescription: preflight.taskDescription,
        requiredSkills: preflight.requiredSkills,
        assignment: preflight.assignment,
      },
      { signal },
    );
    runId = handle.runId;

    runtimeCtx.eventBus.emit(
      engineActivity(runtimeCtx.companyId, runtimeCtx.threadId, {
        runId,
        engineId: runtimeBinding.engineId,
        employeeId: preflight.employee.employee_id,
        employeeName: preflight.employee.name,
        taskRunId: preflight.taskRunId ?? null,
        kind: 'run',
        status: 'started',
        label: runtimeBinding.engineId,
      }),
    );

    const toolTimings = new Map<string, ToolTiming>();
    const proposalsSeen = new Set<string>();
    let latestArtifact: EngineArtifact | null = null;

    for await (const event of handle.events) {
      const artifact = await mapEngineEvent(
        runtimeCtx,
        preflight,
        runtimeBinding,
        runId,
        event,
        toolTimings,
        proposalsSeen,
        signal,
        runScope,
      );
      if (artifact) latestArtifact = artifact;
    }

    const result = await handle.result;
    for (const proposal of result.proposals ?? []) {
      if (proposalsSeen.has(proposal.proposalId)) continue;
      proposalsSeen.add(proposal.proposalId);
      runtimeCtx.eventBus.emit(
        engineProposalCreated(runtimeCtx.companyId, runtimeCtx.threadId, {
          proposal: proposalPayload(proposal, runtimeBinding, preflight),
        }),
      );
    }

    if (result.usage) {
      runtimeCtx.eventBus.emit(
        llmUsageRecorded(
          runtimeCtx.companyId,
          generateId('llm'),
          runtimeCtx.threadId,
          preflight.taskRunId ?? null,
          runtimeBinding.engineId,
          preflight.resolved.model,
          'employee',
          result.usage.inputTokens ?? 0,
          result.usage.outputTokens ?? 0,
          0,
        ),
      );
    }

    const artifact = result.artifact ?? latestArtifact ?? undefined;
    const llmResponse: LlmResponse = {
      content: result.content,
      reasoningContent: result.reasoningContent,
      toolCalls: [],
      usage: {
        inputTokens: result.usage?.inputTokens ?? 0,
        outputTokens: result.usage?.outputTokens ?? 0,
      },
    };

    return finalizeEmployeeSuccess({
      runtimeCtx,
      state,
      preflight,
      llmResponse,
      citationMap: [],
      source: 'normal',
      round: 0,
      signal,
      materializedDeliverableOverride: materializeEngineArtifact(artifact),
    });
  } catch (err) {
    if (runId) {
      await adapter.cancelRun(runId).catch(() => {});
    }
    return finalizeEmployeeFailure({
      runtimeCtx,
      state,
      preflight,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}
