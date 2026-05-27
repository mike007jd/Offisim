import type { OffisimGraphState, RunScope } from '../graph/state.js';
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
const DUPLICATE_TOOL_CALL = 'DUPLICATE_TOOL_CALL';
const MISSING_TOOL_RESULT = 'MISSING_TOOL_RESULT';

export interface HandoffArgs {
  readonly targetEmployeeId: string;
  readonly reason: string;
  readonly completedWork: string;
  readonly remainingWork: string;
}

export type ToolRoundOutcome =
  | { kind: 'handoff'; args: HandoffArgs }
  | { kind: 'typed_reply'; content: string; recentToolResults: RecentToolResult[] }
  | { kind: 'continue'; nextHistory: LlmMessage[]; recentToolResults: RecentToolResult[] };

export interface ToolRoundContext {
  readonly llmResponse: LlmResponse;
  readonly conversationHistory: LlmMessage[];
  readonly preflight: PreflightResult;
  readonly runtimeCtx: RuntimeContext;
  readonly state: OffisimGraphState;
  readonly allowedMcpToolNames: Set<string>;
  readonly signal?: AbortSignal;
  readonly runScope?: RunScope | null;
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
  runtimeCtx.conversationState.recordPendingToolCalls(llmResponse.toolCalls);
  throwIfAborted(signal);

  const handoffCall = llmResponse.toolCalls.find((tc) => tc.name === 'handoff_to');
  if (handoffCall) {
    return { kind: 'handoff', args: handoffCall.arguments as unknown as HandoffArgs };
  }

  const executedToolCallIds = new Set<string>();
  const settled = await runToolCallsInBatches({
    calls: llmResponse.toolCalls,
    isConcurrencySafe: isConcurrencySafeToolCall,
    execute: async (toolCall) => {
      if (executedToolCallIds.has(toolCall.id)) {
        return {
          callId: toolCall.id,
          name: toolCall.name,
          result: {
            success: false,
            result: null,
            error: `[${DUPLICATE_TOOL_CALL}] Duplicate tool call id skipped to avoid repeating side effects.`,
          },
        };
      }
      executedToolCallIds.add(toolCall.id);

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
          ctx.state.projectId,
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
        threadId: ctx.state.threadId,
        employeeId: employee.employee_id,
        employeeConfigJson: employee.config_json,
        taskRunId: taskRunId ?? undefined,
        stepIndex: preflight.stepIndex,
        signal,
        runScope: ctx.runScope ?? null,
      });
      return { callId: toolCall.id, name: toolCall.name, result };
    },
  });

  // If cancellation arrives mid-round, keep going through result reconciliation
  // so every assistant tool_use receives a matching tool result in history.

  // Unwrap settled results — failed tools get an error string (not a crash).
  const toolResults = settled.map((s, i) => {
    const tc = llmResponse.toolCalls[i];
    if (!s) {
      const toolCallId = tc?.id ?? generateId('tool');
      return {
        callId: toolCallId,
        name: tc?.name ?? 'unknown_tool',
        result: {
          success: false,
          result: null,
          error: `[${MISSING_TOOL_RESULT}] Tool round ended without a result for ${toolCallId}.`,
        },
      };
    }
    if (s.status === 'fulfilled') return s.value;
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

  const typedReply = typedReplyFromToolResults(toolResults);
  const recentToolResults = toolResults.map((result) => ({
    toolName: result.name,
    success: toolResultSucceeded(result.result),
    bytes: toolResultBytes(result.result),
    taskRunId: taskRunId ?? null,
  }));
  runtimeCtx.conversationState.recordToolResults(
    toolResults.map((result) => ({
      toolCallId: result.callId,
      toolName: result.name,
      success: toolResultSucceeded(result.result),
      bytes: toolResultBytes(result.result),
      taskRunId: taskRunId ?? null,
    })),
  );
  for (const result of toolResults) {
    const denialReason = permissionDenialReason(result.result);
    if (denialReason) {
      runtimeCtx.conversationState.recordPermissionDenial({
        toolName: result.name,
        reason: denialReason,
      });
    }
  }
  if (typedReply) {
    return { kind: 'typed_reply', content: typedReply, recentToolResults };
  }

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
    recentToolResults,
  };
}

const CONCURRENCY_SAFE_TOOL_NAMES = new Set<string>(['read_file', 'web_search', 'recall']);

function isConcurrencySafeToolCall(toolCall: ToolCallResult): boolean {
  return CONCURRENCY_SAFE_TOOL_NAMES.has(toolCall.name);
}

const textEncoder = new TextEncoder();

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  if (typeof reason === 'string') throw new DOMException(reason, 'AbortError');
  throw new DOMException('Tool round aborted', 'AbortError');
}

function toolResultText(result: unknown): string {
  if (typeof result === 'string') return result;
  return JSON.stringify(result) ?? String(result);
}

function toolResultBytes(result: unknown): number {
  return textEncoder.encode(toolResultText(result)).byteLength;
}

function toolResultSucceeded(result: unknown): boolean {
  if (result && typeof result === 'object' && 'success' in result) {
    const response = result as { success?: unknown; result?: unknown };
    return (
      response.success === true && !toolResultTextIndicatesFailure(toolResultText(response.result))
    );
  }
  if (typeof result !== 'string') return true;
  return !toolResultTextIndicatesFailure(result);
}

function toolResultTextIndicatesFailure(result: string): boolean {
  if (
    /^(Tool execution failed:|Error (reading|writing) file:)/iu.test(result) ||
    /\[TIMEOUT: command exceeded time limit\]/iu.test(result) ||
    /Command timed out/iu.test(result)
  ) {
    return true;
  }
  const exitCodeMatch = /\[Exit code:\s*(-?\d+)\]/iu.exec(result);
  return !!exitCodeMatch && Number(exitCodeMatch[1]) !== 0;
}

function permissionDenialReason(result: unknown): string | null {
  const text = toolResultText(result);
  if (text.includes(WORKSTATION_ACCESS_DENIED)) return WORKSTATION_ACCESS_DENIED;
  if (/\b(permission|access)\s+denied\b/iu.test(text)) return 'permission-denied';
  return null;
}

function typedReplyFromToolResults(
  toolResults: readonly { name: string; result: unknown }[],
): string | null {
  for (const toolResult of toolResults) {
    const parsed = parseStructuredToolResult(toolResult.result);
    if (isSkillInstallTool(toolResult.name) && parsed?.status === 'pending-confirm') {
      return 'Waiting for your input to continue.';
    }
    if (toolResult.name === 'sync_from_claude_code' && parsed?.kind === 'desktop-only-tool') {
      return 'This skill source requires the desktop app.';
    }
    if (
      toolResult.name === 'create_skill_from_scratch' &&
      parsed?.kind === 'target-employee-mismatch'
    ) {
      return 'Skill author must match the active chat employee.';
    }
    if (isSkillInstallTool(toolResult.name) && parsed?.kind) {
      return toolResultText(toolResult.result);
    }
  }
  return null;
}

function parseStructuredToolResult(result: unknown): { kind?: unknown; status?: unknown } | null {
  const value =
    typeof result === 'string'
      ? (() => {
          try {
            return JSON.parse(result) as unknown;
          } catch {
            return null;
          }
        })()
      : result;
  return value && typeof value === 'object' ? (value as { kind?: unknown }) : null;
}
