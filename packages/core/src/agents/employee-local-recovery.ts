/**
 * Local recovery logic for the employee node.
 *
 * When an LLM call fails, this module consults the recovery knowledge base
 * and attempts fix strategies (retry with backoff, model switch, skip)
 * before escalating to the error_handler node.
 *
 * Extracted from employee-node.ts to isolate high-risk catch-path logic.
 */
import type { RunnableConfig } from '@langchain/core/runnables';
import type { LlmResponse, ToolDef } from '../llm/gateway.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { appendAgentEvent } from '../utils/append-agent-event.js';
import { getConfigSignal } from '../utils/get-signal.js';
import {
  type RecoveryDecision,
  diagnoseAndRecover,
  recordRecoveryOutcome,
} from './recovery-agent.js';

/** Maximum local recovery retries before escalating to error_handler. */
const MAX_RECOVERY_RETRIES = 2;

/**
 * Sleep for `ms`, resolving early (false) if the signal aborts. Lets recovery
 * backoff honor run cancellation instead of blocking the full delay.
 * Returns true if the full delay elapsed, false if aborted.
 */
async function abortableDelay(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return false;
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export interface RecoveryCallArgs {
  systemPrompt: string;
  taskDescription: string;
  model: string;
  provider: string;
  temperature: number;
  maxTokens: number;
  tools: ToolDef[] | undefined;
  taskRunId: string | undefined;
}

/**
 * Attempt local recovery when an LLM call fails.
 * Consults the recovery knowledge base, then tries the suggested fix strategy.
 *
 * Returns the LLM response if recovery succeeded, null if it failed.
 */
export async function attemptLocalRecovery(
  runtimeCtx: RuntimeContext,
  config: RunnableConfig,
  errorMessage: string,
  callArgs: RecoveryCallArgs,
): Promise<LlmResponse | null> {
  const { repos, modelResolver } = runtimeCtx;
  if (!repos.recoveryKnowledge) return null;

  // Diagnose
  let recovery: RecoveryDecision | null = null;
  try {
    recovery = await diagnoseAndRecover(
      runtimeCtx,
      config,
      {
        errorCode: 'LLM_CALL_FAILED',
        message: errorMessage,
        recoverable: true,
        nodeName: 'employee',
        provider: callArgs.provider,
        model: callArgs.model,
      },
      runtimeCtx.threadId,
      null,
    );
  } catch {
    return null; // Diagnosis itself failed
  }

  if (!recovery || recovery.strategy === 'escalate') return null;

  const signal = getConfigSignal(config);

  // Execute fix strategy
  for (let attempt = 0; attempt < MAX_RECOVERY_RETRIES; attempt++) {
    try {
      let retryModel = callArgs.model;
      let retryProvider = callArgs.provider;

      if (recovery.strategy === 'retry_with_backoff') {
        // Exponential backoff: 2s, 4s — abort early if the run is cancelled.
        const delayMs = 2000 * 2 ** attempt;
        if (!(await abortableDelay(delayMs, signal))) break;
      } else if (recovery.strategy === 'switch_model') {
        // Fall back to the system default model. The fallback is identical on
        // every attempt, so back off before re-issuing instead of busy-retrying
        // the same model immediately; bail if the run is cancelled.
        if (attempt > 0) {
          const delayMs = 2000 * 2 ** (attempt - 1);
          if (!(await abortableDelay(delayMs, signal))) break;
        }
        const fallback = modelResolver.resolve(null);
        retryModel = fallback.model;
        retryProvider = fallback.provider;
      } else if (recovery.strategy === 'skip_and_continue') {
        // Mark as recovered with a skip message — don't retry the LLM call
        await recordRecoveryOutcome(
          runtimeCtx,
          'LLM_CALL_FAILED',
          recovery.cause,
          recovery.strategy,
          true,
          recovery.knowledgeId,
        );
        return {
          content:
            '[Task skipped due to error — recovery agent determined this task is non-critical]',
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      } else {
        // replan_step or unknown — can't handle locally
        return null;
      }

      const response = await recordedLlmCall(
        runtimeCtx,
        {
          messages: [
            { role: 'system', content: callArgs.systemPrompt },
            { role: 'user', content: callArgs.taskDescription },
          ],
          model: retryModel,
          temperature: callArgs.temperature,
          maxTokens: callArgs.maxTokens,
          tools: callArgs.tools,
          signal: getConfigSignal(config),
        },
        {
          nodeName: 'employee',
          provider: retryProvider,
          model: retryModel,
          taskRunId: callArgs.taskRunId,
        },
      );

      // Recovery succeeded
      await recordRecoveryOutcome(
        runtimeCtx,
        'LLM_CALL_FAILED',
        recovery.cause,
        recovery.strategy,
        true,
        recovery.knowledgeId,
      );

      await appendAgentEvent(runtimeCtx, {
        threadId: runtimeCtx.threadId,
        agentName: 'recovery',
        eventType: 'recovery',
        payload: {
          symptom: 'LLM_CALL_FAILED',
          cause: recovery.cause,
          fix: recovery.strategy,
          attempt: attempt + 1,
          succeeded: true,
          retryModel,
        },
      });

      return response;
    } catch {
      // This retry attempt also failed — continue to next attempt
    }
  }

  // All retries exhausted
  await recordRecoveryOutcome(
    runtimeCtx,
    'LLM_CALL_FAILED',
    recovery.cause,
    recovery.strategy,
    false,
    recovery.knowledgeId,
  );
  return null;
}
