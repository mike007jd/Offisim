import { toolExecutionTelemetry } from '@offisim/core/browser';
import type { AgentRunEvent, AiRuntimeStatus, WorkspaceProvenance } from '@offisim/shared-types';
import type { ResolvedRuntimeExecutionSelection } from './execution-selection.js';
import { runtimeEventBus } from './repos.js';

export function newRequestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function piRunScope(
  projectId: string | null,
  threadId: string,
  employeeId: string | null,
  runId?: string,
) {
  return {
    conversationKey: `${projectId ?? ''}::${threadId}::${employeeId ?? ''}`,
    runId: runId || `pi-${crypto.randomUUID()}`,
    threadId,
  };
}

export function createWorkspaceStatusEmitter({
  engineId,
  companyId,
  threadId,
  employeeId,
  runScope,
  rootRun,
  emitRootBus,
}: {
  engineId: string;
  companyId: string;
  threadId: string;
  employeeId: string | null;
  runScope: ReturnType<typeof piRunScope>;
  rootRun: (type: AgentRunEvent['type'], payload: AgentRunEvent['payload']) => AgentRunEvent;
  emitRootBus: (event: AgentRunEvent) => void;
}): (provenance: WorkspaceProvenance) => void {
  let emitted = false;
  return (workspaceProvenance) => {
    if (emitted) return;
    emitted = true;
    const toolCallId = `${runScope.runId}:workspace-status`;
    const startedAt = Date.now();
    for (const status of ['started', 'completed'] as const) {
      runtimeEventBus.emit(
        toolExecutionTelemetry(companyId, threadId, {
          toolCallId,
          toolName: 'Workspace',
          toolType: 'builtin',
          evidenceClass: 'offisim-gateway',
          threadId,
          nodeName: engineId,
          employeeId: employeeId ?? undefined,
          startedAt,
          ...(status === 'completed' ? { completedAt: startedAt, durationMs: 0 } : {}),
          status,
          workspaceProvenance,
          chatConversationKey: runScope.conversationKey,
          chatRunId: runScope.runId,
        }),
      );
      emitRootBus(
        rootRun(status === 'started' ? 'tool.started' : 'tool.completed', {
          toolCallId,
          toolName: 'Workspace',
          status,
        }),
      );
    }
  };
}

export function apiModelSupportsImageInput(
  status: AiRuntimeStatus | undefined,
  selection: ResolvedRuntimeExecutionSelection,
): boolean {
  if (!status) return false;
  return Boolean(
    status.models.find(
      (model) =>
        model.engineId === selection.target.engineId &&
        model.accountId === selection.target.accountId &&
        model.billingMode === selection.target.billingMode &&
        model.modelId === selection.target.modelId &&
        model.runtimeModelRef === selection.runtimeModelRef,
    )?.capabilities.imageInput,
  );
}

export function attachmentImageDowngradeNotice(engineId: string): string {
  return engineId === 'api'
    ? 'The selected API model does not support image input. Images remain visible in the timeline but were not sent to the employee.'
    : `${engineId} does not support image input in Offisim. Images remain visible in the timeline but were not sent to the employee.`;
}

export function throwIfRunAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Run was stopped before native work started.');
  error.name = 'AbortError';
  throw error;
}
