import type { OffisimGraphState } from '../graph/state.js';
import type { LlmMessage, LlmResponse, ToolCallResult } from '../llm/gateway.js';
import type { RecentToolResult } from '../runtime/completion-verifier.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { WORKSTATION_ACCESS_DENIED } from '../runtime/tool-executor.js';
import { Logger } from '../services/logger.js';
import { runToolCallsInBatches } from '../tools/tool-orchestrator.js';
import { generateId } from '../utils/generate-id.js';
import { MEMORY_TOOL_NAMES, handleMemoryTool } from './employee-memory-tools.js';
import { MAX_CONTEXT_MESSAGES } from './employee-node-constants.js';
import type { PreflightResult } from './employee-preflight.js';
import {
  type SkillInstallToolName,
  handleSkillInstallTool,
  isSkillInstallTool,
} from './skill-install-tools.js';

const logger = new Logger('employee-tool-round');

export interface HandoffArgs {
  readonly targetEmployeeId: string;
  readonly reason: string;
  readonly completedWork: string;
  readonly remainingWork: string;
}

export type ToolRoundOutcome =
  | { kind: 'handoff'; args: HandoffArgs }
  | { kind: 'continue'; nextHistory: LlmMessage[]; recentToolResults: RecentToolResult[] };

export interface ToolRoundContext {
  readonly llmResponse: LlmResponse;
  readonly conversationHistory: LlmMessage[];
  readonly preflight: PreflightResult;
  readonly runtimeCtx: RuntimeContext;
  readonly state: OffisimGraphState;
  readonly allowedMcpToolNames: Set<string>;
  readonly signal?: AbortSignal;
}

/**
 * Execute one round of the multi-round tool-call loop.
 *
 * Behavior:
 *   1. If `llmResponse.toolCalls` contains a `handoff_to` call, return
 *      `{ kind: 'handoff', args }` immediately — NO handoff record is written,
 *      NO TaskRun is created, NO `handoff.initiated` event is emitted. Side
 *      effects are the orchestrator barrel's responsibility (`executeHandoff`).
 *   2. Otherwise execute all tool calls in parallel via `Promise.allSettled`:
 *      - Memory virtual tools → `handleMemoryTool`
 *      - MCP tools → `toolExecutor.execute`, with `WORKSTATION_ACCESS_DENIED` short-circuit
 *        when `workstationToolResolver` is set and the tool is not in `allowedMcpToolNames`
 *   3. Failed tools surface as `Tool execution failed: <message>` string content (no crash).
 *   4. Append assistant message + tool result messages to history, then trim if
 *      `history.length > MAX_CONTEXT_MESSAGES + 1` (keep first + last MAX_CONTEXT_MESSAGES).
 */
export async function runToolRound(ctx: ToolRoundContext): Promise<ToolRoundOutcome> {
  const { llmResponse, conversationHistory, preflight, runtimeCtx, allowedMcpToolNames, signal } =
    ctx;
  const { employee, taskRunId } = preflight;
  const { toolExecutor, workstationToolResolver, memoryService, companyId, threadId } = runtimeCtx;

  const handoffCall = llmResponse.toolCalls.find((tc) => tc.name === 'handoff_to');
  if (handoffCall) {
    return { kind: 'handoff', args: handoffCall.arguments as unknown as HandoffArgs };
  }

  const settled = await runToolCallsInBatches({
    calls: llmResponse.toolCalls,
    isConcurrencySafe: isConcurrencySafeToolCall,
    execute: async (toolCall) => {
      if (
        memoryService &&
        MEMORY_TOOL_NAMES.includes(toolCall.name as (typeof MEMORY_TOOL_NAMES)[number])
      ) {
        const result = await handleMemoryTool(
          toolCall.name as (typeof MEMORY_TOOL_NAMES)[number],
          toolCall.arguments,
          employee.employee_id,
          companyId,
          threadId,
          runtimeCtx,
        );
        return { callId: toolCall.id, name: toolCall.name, result };
      }

      if (isSkillInstallTool(toolCall.name)) {
        const result = await handleSkillInstallTool(
          toolCall.name as SkillInstallToolName,
          toolCall.arguments,
          runtimeCtx,
          employee.employee_id,
          `${preflight.resolved.provider}/${preflight.resolved.model}`,
        );
        return { callId: toolCall.id, name: toolCall.name, result };
      }

      // PRD 2.3: Verify workstation access using pre-resolved tool set (avoids N+1 queries).
      // Workstation gating only applies when a resolver is present (employee scope);
      // system agents bypass.
      if (workstationToolResolver && !allowedMcpToolNames.has(toolCall.name)) {
        return {
          callId: toolCall.id,
          name: toolCall.name,
          result: {
            success: false,
            result: null,
            error: `[${WORKSTATION_ACCESS_DENIED}] Employee '${employee.name}' is not assigned to a workstation with access to tool '${toolCall.name}'.`,
          },
        };
      }

      const result = await toolExecutor.execute({
        toolCallId: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
        nodeName: 'employee',
        employeeId: employee.employee_id,
        employeeConfigJson: employee.config_json,
        taskRunId: taskRunId ?? undefined,
        stepIndex: preflight.stepIndex,
        signal,
      });
      return { callId: toolCall.id, name: toolCall.name, result };
    },
  });

  // Unwrap settled results — failed tools get an error string (not a crash).
  const toolResults = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    const tc = llmResponse.toolCalls[i];
    if (!tc) {
      const errMsg = s.reason instanceof Error ? s.reason.message : String(s.reason);
      logger.warn('Tool call failed without matching tool call metadata', { error: errMsg });
      return {
        callId: generateId('tool'),
        name: 'unknown_tool',
        result: `Tool execution failed: ${errMsg}`,
      };
    }
    const errMsg = s.reason instanceof Error ? s.reason.message : String(s.reason);
    logger.warn('Tool call failed', { toolName: tc.name, error: errMsg });
    return { callId: tc.id, name: tc.name, result: `Tool execution failed: ${errMsg}` };
  });

  const nextHistory: LlmMessage[] = [...conversationHistory];
  nextHistory.push({
    role: 'assistant',
    content: llmResponse.content || '',
    ...(llmResponse.reasoningContent ? { reasoningContent: llmResponse.reasoningContent } : {}),
    toolCalls: llmResponse.toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
    })),
  });
  for (const tr of toolResults) {
    nextHistory.push({
      role: 'tool',
      content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
      toolCallId: tr.callId,
    });
  }

  // Trim — keep system message (first) + the last MAX_CONTEXT_MESSAGES messages.
  const [firstMessage] = nextHistory;
  const trimmedHistory =
    nextHistory.length > MAX_CONTEXT_MESSAGES + 1 && firstMessage
      ? [firstMessage, ...nextHistory.slice(-MAX_CONTEXT_MESSAGES)]
      : nextHistory;

  return {
    kind: 'continue',
    nextHistory: trimmedHistory,
    recentToolResults: toolResults.map((result) => ({
      toolName: result.name,
      success: toolResultSucceeded(result.result),
      bytes: toolResultBytes(result.result),
    })),
  };
}

const CONCURRENCY_SAFE_TOOL_NAMES = new Set<string>(['read_file', 'web_search', 'recall']);

function isConcurrencySafeToolCall(toolCall: ToolCallResult): boolean {
  return CONCURRENCY_SAFE_TOOL_NAMES.has(toolCall.name);
}

const textEncoder = new TextEncoder();

function toolResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  return JSON.stringify(result) ?? String(result);
}

function toolResultBytes(result: unknown): number {
  return textEncoder.encode(toolResultText(result)).byteLength;
}

function toolResultSucceeded(result: unknown): boolean {
  if (result && typeof result === 'object' && 'success' in result) {
    return (result as { success?: unknown }).success === true;
  }
  return !(typeof result === 'string' && result.startsWith('Tool execution failed:'));
}
