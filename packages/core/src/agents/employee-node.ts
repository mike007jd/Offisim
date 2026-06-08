import type { RunnableConfig } from '@langchain/core/runnables';
import type { Command } from '@langchain/langgraph';
import { resolveEmployeeRuntimeBinding } from '../engine/runtime-binding.js';
import { toErrorMessage } from '../errors.js';
import type { OffisimGraphState } from '../graph/state.js';
import type { LlmMessage } from '../llm/gateway.js';
import type { RecentToolResult } from '../runtime/completion-verifier.js';
import { Logger } from '../services/logger.js';
import { isAbortLikeError } from '../utils/abort-detection.js';
import { getRunScope, getRuntime } from '../utils/get-runtime.js';
import { getConfigSignal } from '../utils/get-signal.js';
import { runEmployeeA2A } from './employee-a2a-executor.js';
import { finalizeEmployeeSuccess } from './employee-completion.js';
import { runEmployeeEngine } from './employee-engine-executor.js';
import {
  finalizeEmployeeCancellation,
  finalizeEmployeeFailure,
} from './employee-error-finalize.js';
import { executeHandoff } from './employee-handoff.js';
import { attemptLocalRecovery } from './employee-local-recovery.js';
import { MAX_CONTEXT_MESSAGES, MAX_TOOL_ROUNDS } from './employee-node-constants.js';
import { runPreflight } from './employee-preflight.js';
import { assemblePrompt } from './employee-prompt-assembly.js';
import { assembleToolKit } from './employee-tool-kit.js';
import { runToolRound } from './employee-tool-round.js';
import { buildTurnRunner } from './employee-turn-runner.js';
import { resolveToolLoopMaxRounds } from './tool-loop-policy.js';

export { extractUsedCitations } from './employee-completion.js';

const logger = new Logger('employee');
const MAX_RECENT_TOOL_RESULTS = 32;

function appendRecentToolResults(
  existing: readonly RecentToolResult[],
  next: readonly RecentToolResult[],
): RecentToolResult[] {
  return [...existing, ...next].slice(-MAX_RECENT_TOOL_RESULTS);
}

export async function employeeNode(
  state: OffisimGraphState,
  config: RunnableConfig,
): Promise<Partial<OffisimGraphState> | Command> {
  const runtimeCtx = getRuntime(config, 'employee');

  const preflightOutcome = await runPreflight(state, runtimeCtx, getRunScope(config));
  if (preflightOutcome.kind === 'early-return') {
    return preflightOutcome.stateUpdate;
  }
  const { remaining, employee, taskRunId, resolved, taskDescription } = preflightOutcome.preflight;

  logger.info('dispatch branch', {
    employeeId: employee.employee_id,
    name: employee.name,
    is_external: employee.is_external,
    a2a_url: employee.a2a_url,
  });

  if (employee.is_external === 1) {
    return runEmployeeA2A(state, runtimeCtx, preflightOutcome.preflight, getConfigSignal(config));
  }

  const runtimeBinding = resolveEmployeeRuntimeBinding(employee, runtimeCtx.runtimePolicy);
  logger.info('employee runtime binding resolved', {
    employeeId: employee.employee_id,
    mode: runtimeBinding.mode,
    engineId: runtimeBinding.mode === 'engine' ? runtimeBinding.engineId : undefined,
  });

  if (runtimeBinding.mode === 'engine') {
    return runEmployeeEngine(
      state,
      runtimeCtx,
      preflightOutcome.preflight,
      runtimeBinding,
      getConfigSignal(config),
      getRunScope(config),
    );
  }

  const streamEmployeeReplies = true;

  const { companyId, threadId } = runtimeCtx;
  const signal = getConfigSignal(config);
  const runScope = getRunScope(config);
  runtimeCtx.conversationState.beginRun({
    runId: taskRunId ?? runtimeCtx.determinism.id('run'),
    threadId,
    checkpointIdentity: {
      graphThreadId: state.threadId,
      ...(taskRunId ? { taskRunId } : {}),
      ...(runScope?.threadId ? { runScopeThreadId: runScope.threadId } : {}),
    },
  });
  runtimeCtx.conversationState.recordActiveContext({
    companyId,
    threadId,
    projectId: state.projectId ?? null,
    chatThreadId: state.chatThreadId ?? null,
    employeeId: employee.employee_id,
    ...(taskRunId ? { taskRunId } : {}),
    ...(runScope?.threadId ? { runScopeThreadId: runScope.threadId } : {}),
  });
  if (signal?.aborted) {
    const reason = 'aborted-before-employee-turn';
    runtimeCtx.conversationState.recordCancellation(reason);
    return finalizeEmployeeCancellation({
      runtimeCtx,
      state,
      preflight: preflightOutcome.preflight,
      reason,
    });
  }

  const { systemPrompt, citationMap } = await assemblePrompt(
    preflightOutcome.preflight,
    runtimeCtx,
    runScope,
  );

  const { allTools, toolRegistry, allowedRuntimeToolNames, allowedMcpToolNames } =
    await assembleToolKit(preflightOutcome.preflight, runtimeCtx, state);
  runtimeCtx.conversationState.recordDiscoveredTools({
    allToolNames: allTools.map((tool) => tool.name),
    allowedRuntimeToolNames: [...allowedRuntimeToolNames],
    allowedMcpToolNames: [...allowedMcpToolNames],
    toolRegistry: toolRegistry.map((tool) => ({
      name: tool.name,
      surface: tool.surface,
      serverName: tool.serverName,
      permissionIdentity: tool.permissionIdentity,
      exposedToLlm: tool.exposedToLlm,
    })),
  });
  const maxToolRounds = resolveToolLoopMaxRounds(
    runtimeCtx.runtimePolicy?.toolLoop,
    {
      roleSlug: employee.role_slug,
      provider: resolved.provider,
      model: resolved.model,
    },
    MAX_TOOL_ROUNDS,
  );
  runtimeCtx.conversationState.recordBudget({
    maxToolRounds,
    maxContextMessages: MAX_CONTEXT_MESSAGES,
  });

  const runEmployeeTurn = buildTurnRunner({
    runtimeCtx,
    threadId,
    projectId: state.projectId,
    employeeId: employee.employee_id,
    resolved,
    allTools,
    streamEnabled: streamEmployeeReplies,
    signal: getConfigSignal(config),
    runScope,
  });

  // Hoisted out of try scope so the recovery catch handler can report the
  // tool round count reached before the failure.
  let round = 0;
  let recentToolResults = state.recentToolResults ?? [];

  try {
    // Initial LLM call
    // Accumulate conversation history across tool-call rounds so later rounds
    // can see earlier tool results (fixes lost-context bug).
    const conversationHistory: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: taskDescription },
    ];
    runtimeCtx.conversationState.recordMessages(conversationHistory);
    let llmResponse = await runEmployeeTurn(conversationHistory, { taskRunId });
    runtimeCtx.conversationState.recordUsage(llmResponse.usage);
    runtimeCtx.conversationState.recordPendingToolCalls(llmResponse.toolCalls);

    // Multi-round tool calling loop. The real exit is "model stopped calling
    // tools"; maxToolRounds is only a high runaway guard (see
    // MAX_TOOL_ROUNDS) so long agentic tasks run to natural completion.
    let workingHistory = conversationHistory;

    while (llmResponse.toolCalls.length > 0 && round < maxToolRounds) {
      round++;
      runtimeCtx.conversationState.recordBudget({ roundsUsed: round });

      const outcome = await runToolRound({
        llmResponse,
        conversationHistory: workingHistory,
        preflight: preflightOutcome.preflight,
        runtimeCtx,
        state,
        allowedMcpToolNames,
        signal: getConfigSignal(config),
        runScope,
      });

      if (outcome.kind === 'handoff') {
        const command = await executeHandoff(outcome.args, {
          state,
          remaining,
          employee,
          taskRunId,
          stepIndex: preflightOutcome.preflight.stepIndex,
          runtimeCtx,
          companyId,
          threadId,
          signal,
        });
        if (command) return command;
        // Target employee gone — fall back to completing the task ourselves.
        workingHistory.push({
          role: 'user',
          content: 'Handoff target employee no longer exists. Please complete the task yourself.',
        });
        break;
      }

      if (outcome.kind === 'typed_reply') {
        recentToolResults = appendRecentToolResults(recentToolResults, outcome.recentToolResults);
        llmResponse = {
          content: outcome.content,
          toolCalls: [],
          usage: { inputTokens: 0, outputTokens: 0 },
        };
        break;
      }

      workingHistory = outcome.nextHistory;
      runtimeCtx.conversationState.recordMessages(workingHistory);
      recentToolResults = appendRecentToolResults(recentToolResults, outcome.recentToolResults);
      llmResponse = await runEmployeeTurn(workingHistory, { taskRunId });
      runtimeCtx.conversationState.recordUsage(llmResponse.usage);
      runtimeCtx.conversationState.recordPendingToolCalls(llmResponse.toolCalls);
    }

    if (round >= maxToolRounds && llmResponse.toolCalls.length > 0) {
      const pendingNames = llmResponse.toolCalls.map((toolCall) => toolCall.name).join(', ');
      const partialMessage = `[MAX_TOOL_ROUNDS_PARTIAL] Stopped after ${maxToolRounds} tool rounds with partial work preserved. Pending tool calls: ${pendingNames}.`;
      logger.warn(partialMessage, { employeeName: employee.name });
      llmResponse = {
        content: partialMessage,
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: 'unknown',
      };
    }

    return await finalizeEmployeeSuccess({
      runtimeCtx,
      state: { ...state, recentToolResults },
      preflight: preflightOutcome.preflight,
      llmResponse,
      citationMap,
      source: 'normal',
      round,
      signal: getConfigSignal(config),
    });
  } catch (err) {
    const message = toErrorMessage(err);
    if (isAbortLikeError(err, signal)) {
      runtimeCtx.conversationState.recordCancellation(message);
      return finalizeEmployeeCancellation({
        runtimeCtx,
        state: { ...state, recentToolResults },
        preflight: preflightOutcome.preflight,
        reason: message,
      });
    }
    runtimeCtx.conversationState.recordRetry(message);

    // --- Recovery-aware retry: try to fix locally before escalating ---
    const recovered = await attemptLocalRecovery(runtimeCtx, config, message, {
      systemPrompt,
      taskDescription,
      model: resolved.model,
      provider: resolved.provider,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
      tools: allTools.length > 0 ? allTools : undefined,
      taskRunId,
    }).catch(() => null); // recovery itself must not throw

    if (recovered) {
      return await finalizeEmployeeSuccess({
        runtimeCtx,
        state: { ...state, recentToolResults },
        preflight: preflightOutcome.preflight,
        llmResponse: recovered,
        citationMap,
        source: 'recovery',
        round,
        signal: getConfigSignal(config),
      });
    }

    // --- Recovery failed or not available — escalate to error_handler ---
    return await finalizeEmployeeFailure({
      runtimeCtx,
      state,
      preflight: preflightOutcome.preflight,
      errorMessage: message,
    });
  }
}
