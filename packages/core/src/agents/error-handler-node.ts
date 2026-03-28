import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { errorOccurred, graphNodeEntered, taskStateChanged } from '../events/event-factories.js';
import type { OffisimGraphState } from '../graph/state.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { getRuntime } from '../utils/get-runtime.js';
import {
  type StructuredError,
  diagnoseAndRecover,
  recordRecoveryOutcome,
} from './recovery-agent.js';

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
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState>> {
  // Announce node entry (best-effort — error handler must not throw)
  const runtimeCtx = getRuntime(config, 'error_handler', { optional: true });
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
          taskStateChanged(
            companyId,
            taskRunId,
            'queued',
            'cancelled',
            state.threadId,
            assignment.employeeId,
          ),
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
      await appendAgentEvent(runtimeCtx, {
        projectId: state.projectId,
        threadId: state.threadId,
        agentName: 'error',
        eventType: 'error',
        payload: {
          errorCode: structured.errorCode,
          message: structured.message,
          recoverable: structured.recoverable,
          nodeName: structured.nodeName,
          employeeId: structured.employeeId,
          provider: structured.provider,
          model: structured.model,
        },
      });

      // --- Recovery Agent: attempt self-healing ---
      if (structured.recoverable) {
        try {
          const recovery = await diagnoseAndRecover(
            runtimeCtx,
            config,
            structured,
            state.threadId,
            state.projectId ?? null,
          );

          if (recovery && recovery.strategy !== 'escalate') {
            // Record recovery attempt
            await appendAgentEvent(runtimeCtx, {
              projectId: state.projectId,
              threadId: state.threadId,
              agentName: 'recovery',
              eventType: 'recovery',
              payload: {
                symptom: structured.errorCode,
                cause: recovery.cause,
                fix: recovery.strategy,
                confidence: recovery.confidence,
                prevented: false,
              },
            });

            // For now, record the knowledge and escalate.
            // Future: implement retry_with_backoff, switch_model, etc.
            // The knowledge base will learn and improve over time.
            await recordRecoveryOutcome(
              runtimeCtx,
              structured.errorCode,
              recovery.cause,
              recovery.strategy,
              false, // We can't actually retry in this graph position — mark as failed for now
              recovery.knowledgeId,
            );
          }
        } catch {
          // Recovery diagnosis itself failed — continue with normal error handling
        }
      }
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
    await appendAgentEvent(runtimeCtx, {
      projectId: state.projectId,
      threadId: state.threadId,
      agentName: 'error',
      eventType: 'error',
      payload: { errorCode: 'UNKNOWN_ERROR', message: reason, recoverable: true },
    });
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
