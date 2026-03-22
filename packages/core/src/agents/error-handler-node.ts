import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { errorOccurred, graphNodeEntered, taskStateChanged } from '../events/event-factories.js';
import type { AicsGraphState } from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';

/** Shape of structured error JSON stored in interruptReason */
interface StructuredError {
  errorCode: string;
  message: string;
  recoverable: boolean;
  nodeName: string;
  employeeId?: string;
  taskRunId?: string;
  provider?: string;
  model?: string;
}

function tryParseStructuredError(raw: string): StructuredError | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.errorCode === 'string' && typeof parsed.message === 'string') {
      return {
        errorCode: parsed.errorCode as string,
        message: parsed.message as string,
        recoverable: typeof parsed.recoverable === 'boolean' ? parsed.recoverable : true,
        nodeName: typeof parsed.nodeName === 'string' ? parsed.nodeName : 'unknown',
        employeeId: typeof parsed.employeeId === 'string' ? parsed.employeeId : undefined,
        taskRunId: typeof parsed.taskRunId === 'string' ? parsed.taskRunId : undefined,
        provider: typeof parsed.provider === 'string' ? parsed.provider : undefined,
        model: typeof parsed.model === 'string' ? parsed.model : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function errorHandlerNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  // Announce node entry (best-effort — error handler must not throw)
  const runtimeCtx = (config.configurable as { runtimeCtx?: RuntimeContext })?.runtimeCtx;
  if (runtimeCtx) {
    runtimeCtx.eventBus.emit(
      graphNodeEntered(runtimeCtx.companyId, state.threadId, 'error_handler'),
    );
  }

  const reason = state.interruptReason ?? 'An unknown error occurred';

  // Cancel any remaining queued tasks that will never be executed.
  // Without this, tasks stay 'queued' in the DB forever after an LLM failure.
  if (runtimeCtx && state.pendingAssignments.length > 0) {
    const { repos, eventBus, companyId } = runtimeCtx;
    for (const assignment of state.pendingAssignments) {
      const taskRunId = assignment.inputJson?.taskRunId as string | undefined;
      if (taskRunId) {
        await repos.taskRuns.updateStatus(taskRunId, 'cancelled');
        eventBus.emit(
          taskStateChanged(companyId, taskRunId, 'queued', 'cancelled', state.threadId, assignment.employeeId),
        );
      }
    }
  }

  // Try to parse structured error from interruptReason
  const structured = tryParseStructuredError(reason);

  if (structured) {
    // Emit structured error event
    if (runtimeCtx) {
      runtimeCtx.eventBus.emit(
        errorOccurred(
          runtimeCtx.companyId,
          structured.errorCode,
          structured.message,
          structured.recoverable,
          structured.nodeName,
          {
            employeeId: structured.employeeId,
            taskRunId: structured.taskRunId,
            provider: structured.provider,
            model: structured.model,
            threadId: state.threadId,
          },
        ),
      );
    }

    const recoverableHint = structured.recoverable
      ? ' This error may be recoverable — you can retry the request.'
      : ' This error is not recoverable.';

    if (runtimeCtx) {
      await runtimeCtx.repos.threads.updateStatus(state.threadId, 'failed');
    }
    return {
      completed: true,
      interruptReason: null,
      pendingAssignments: [],
      messages: [
        new AIMessage({
          content: `[Error Handler] ${structured.errorCode}: ${structured.message}.${recoverableHint}`,
        }),
      ],
    };
  }

  // Plain string interruptReason — emit as UNKNOWN_ERROR
  if (runtimeCtx) {
    runtimeCtx.eventBus.emit(
      errorOccurred(runtimeCtx.companyId, 'UNKNOWN_ERROR', reason, true, 'unknown', {
        threadId: state.threadId,
      }),
    );
    await runtimeCtx.repos.threads.updateStatus(state.threadId, 'failed');
  }

  return {
    completed: true,
    interruptReason: null,
    pendingAssignments: [],
    messages: [
      new AIMessage({
        content: `[Error Handler] The workflow encountered an issue: ${reason}. This error may be recoverable — you can retry the request.`,
      }),
    ],
  };
}
