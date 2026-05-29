import type { ToolDef } from '../llm/gateway.js';
import type { ToolCallRequest, ToolCallResponse, ToolExecutor } from '../runtime/tool-executor.js';
import { Logger } from '../services/logger.js';
import type { BuiltinTool, BuiltinToolExecutionContext } from './builtin/types.js';
import type { RuntimeToolType } from './tool-registry.js';
import { capToolResultForModel } from './tool-result-size.js';
import { validateToolInput } from './tool-schema-validator.js';

const logger = new Logger('composite-tool');

/**
 * Routes tool calls to either built-in tools or MCP tools.
 * Built-in tools are checked first (direct dispatch, no MCP overhead).
 */
export class CompositeToolExecutor implements ToolExecutor {
  constructor(
    private readonly builtinTools: Map<string, BuiltinTool>,
    private readonly mcpExecutor: ToolExecutor,
    private readonly builtinContext: Pick<BuiltinToolExecutionContext, 'companyId'> = {},
  ) {}

  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    const builtin = this.builtinTools.get(call.name);
    if (builtin) {
      try {
        const validation = validateToolInput(builtin.def, call.arguments);
        if (!validation.success) {
          return {
            success: false,
            result: null,
            error: `[TOOL_INPUT_INVALID] ${validation.error}`,
          };
        }
        const result = await builtin.execute(validation.data ?? call.arguments, {
          ...this.builtinContext,
          ...(call.threadId ? { threadId: call.threadId } : {}),
          ...(call.employeeId ? { employeeId: call.employeeId } : {}),
          ...(call.runScope !== undefined ? { runScope: call.runScope } : {}),
        });
        return { success: true, result: await capToolResultForModel(builtin.def, result) };
      } catch (err) {
        return {
          success: false,
          result: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    // Fall through to MCP executor, then cap its result the same way builtin
    // results are capped: an MCP tool can return an unbounded payload that would
    // otherwise flood the model context / memory. (Input validation stays the
    // MCP executor's responsibility — it holds each tool's inputSchema.)
    const mcpResponse = await this.mcpExecutor.execute(call);
    if (!mcpResponse.success) return mcpResponse;
    return {
      ...mcpResponse,
      result: await capToolResultForModel({ name: call.name } as unknown as ToolDef, mcpResponse.result),
    };
  }

  async listAvailable(companyId: string): Promise<ToolDef[]> {
    const builtinDefs = [...this.builtinTools.values()].map((t) => t.def);
    const builtinNames = new Set(builtinDefs.map((d) => d.name));
    const mcpDefs = await this.mcpExecutor.listAvailable(companyId);

    // Warn about name conflicts — builtin silently shadows MCP tools
    for (const mcpDef of mcpDefs) {
      if (builtinNames.has(mcpDef.name)) {
        logger.warn(`Builtin tool "${mcpDef.name}" shadows MCP tool with the same name`);
      }
    }

    // Deduplicate: builtin wins, exclude shadowed MCP tools
    const deduped = mcpDefs.filter((d) => !builtinNames.has(d.name));
    return [...builtinDefs, ...deduped];
  }

  getServerForTool(toolName: string): string | undefined {
    if (this.builtinTools.has(toolName)) return 'builtin';
    const resolver = (this.mcpExecutor as unknown as Record<string, unknown>).getServerForTool;
    return typeof resolver === 'function'
      ? (resolver as (name: string) => string | undefined).call(this.mcpExecutor, toolName)
      : undefined;
  }

  getToolTypeForTool(toolName: string): RuntimeToolType | undefined {
    if (this.builtinTools.has(toolName)) return 'builtin';
    const resolver = (this.mcpExecutor as unknown as Record<string, unknown>).getToolTypeForTool;
    return typeof resolver === 'function'
      ? (resolver as (name: string) => RuntimeToolType | undefined).call(this.mcpExecutor, toolName)
      : 'mcp';
  }
}
