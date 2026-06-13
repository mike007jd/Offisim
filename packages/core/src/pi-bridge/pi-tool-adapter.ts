/**
 * Adapt Offisim `ToolDef` + `ToolExecutor` into pi `AgentTool[]`.
 *
 * Every pi tool call is routed through the retained `AuditingToolExecutor`
 * (audit log, permission/approval gate, `tool.execution.telemetry`), so bash /
 * fs / MCP tools keep going through the exact same sandbox + audit path they did
 * under the graph. A failed `ToolCallResponse` is thrown so the pi loop encodes
 * it as a tool-result message (the error text reaches the model), matching pi's
 * "throw on failure" tool contract.
 */

import type { Static, TSchema } from '@offisim/pi-ai';
import type { RunScope } from '@offisim/shared-types';
import type { AgentTool, AgentToolResult } from '@offisim/pi-agent';
import type { ToolDef } from '../llm/gateway.js';
import type { ToolExecutor } from '../runtime/tool-executor.js';

/** Per-employee identity threaded into every tool call's audit/telemetry row. */
export interface PiToolContext {
  readonly threadId: string;
  readonly companyId: string;
  readonly employeeId?: string;
  readonly projectId?: string | null;
  readonly taskRunId?: string;
  readonly runScope?: RunScope | null;
}

function resultToText(result: unknown, maxChars?: number): string {
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? null);
  if (maxChars && maxChars > 0 && text.length > maxChars) {
    const head = text.slice(0, Math.floor(maxChars * 0.7));
    const tail = text.slice(text.length - Math.floor(maxChars * 0.2));
    return `${head}\n…[${text.length - head.length - tail.length} chars truncated]…\n${tail}`;
  }
  return text;
}

/** Convert one `ToolDef` into a pi `AgentTool` bound to the audit executor. */
export function toolDefToAgentTool(
  def: ToolDef,
  toolExecutor: ToolExecutor,
  ctx: PiToolContext,
): AgentTool {
  const readOnly = def.annotations?.readOnlyHint === true;
  return {
    name: def.name,
    label: def.name,
    description: def.description,
    // pi validates raw JSON Schemas natively (validation.ts coerceWithJsonSchema);
    // the cast crosses the vendored TypeBox boundary without a compiled schema.
    parameters: def.parameters as unknown as TSchema,
    executionMode: readOnly ? 'parallel' : 'sequential',
    execute: async (
      toolCallId: string,
      params: Static<TSchema>,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> => {
      const response = await toolExecutor.execute({
        toolCallId,
        name: def.name,
        arguments: (params ?? {}) as Record<string, unknown>,
        nodeName: 'employee',
        threadId: ctx.threadId,
        employeeId: ctx.employeeId,
        projectId: ctx.projectId,
        taskRunId: ctx.taskRunId,
        runScope: ctx.runScope,
        signal,
      });
      if (!response.success) {
        throw new Error(response.error ?? `Tool ${def.name} failed`);
      }
      return {
        content: [{ type: 'text', text: resultToText(response.result, def.maxResultSizeChars) }],
        details: response.result,
      };
    },
  };
}

export function toolDefsToAgentTools(
  defs: readonly ToolDef[],
  toolExecutor: ToolExecutor,
  ctx: PiToolContext,
): AgentTool[] {
  return defs.map((def) => toolDefToAgentTool(def, toolExecutor, ctx));
}
