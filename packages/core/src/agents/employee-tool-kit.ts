import type { OffisimGraphState } from '../graph/state.js';
import type { ToolDef } from '../llm/gateway.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { ToolExecutor } from '../runtime/tool-executor.js';
import { type DroppedTool, buildToolPool } from '../tools/tool-pool-builder.js';
import type { RegisteredTool, RuntimeToolType } from '../tools/tool-registry.js';
import { buildMemoryTools } from './employee-memory-tools.js';
import { MAX_HANDOFF_COUNT } from './employee-node-constants.js';
import type { PreflightResult } from './employee-preflight.js';
import { buildSkillInstallTools } from './skill-install-tools.js';

export interface ToolKit {
  readonly virtualTools: ToolDef[];
  readonly mcpTools: ToolDef[];
  readonly allTools: ToolDef[];
  readonly toolRegistry: readonly RegisteredTool[];
  readonly allowedRuntimeToolNames: Set<string>;
  readonly allowedMcpToolNames: Set<string>;
  readonly deniedTools: readonly DroppedTool[];
  readonly toolsHash: string;
}

/**
 * Compose the employee's available tools for this turn.
 *
 * Layers (in order):
 *   1. Memory virtual tools — when memoryService is present
 *   2. handoff_to virtual tool — gated on (NOT direct_chat) AND (handoffCount < MAX) AND (colleagues exist)
 *   3. Workstation-scoped MCP tools (or full toolExecutor.listAvailable fallback for system agents)
 *
 * Skills are surfaced via the "Available skills" system-prompt block
 * (progressive disclosure tier 1) — no activation tool is registered here.
 */
export async function assembleToolKit(
  preflight: PreflightResult,
  runtimeCtx: RuntimeContext,
  state: OffisimGraphState,
): Promise<ToolKit> {
  const { employee, isDirectChatTask } = preflight;
  const { repos, toolExecutor, workstationToolResolver, memoryService, companyId, builtinTools } =
    runtimeCtx;

  if (runtimeCtx.llmToolCallsEnabled === false) {
    const pool = await buildToolPool({
      virtualTools: [],
      mcpTools: [],
      runtimePolicy: runtimeCtx.runtimePolicy,
      serverForTool: serverResolverFromExecutor(toolExecutor),
      toolTypeForTool: toolTypeResolverFromExecutor(toolExecutor),
    });
    const allowedRuntimeToolNames = new Set(pool.mcpTools.map((t) => t.name));
    return {
      virtualTools: pool.virtualTools,
      mcpTools: pool.mcpTools,
      allTools: pool.llmTools,
      toolRegistry: pool.toolRegistry,
      allowedRuntimeToolNames,
      allowedMcpToolNames: allowedRuntimeToolNames,
      deniedTools: pool.deniedTools,
      toolsHash: pool.toolsHash,
    };
  }

  const virtualTools: ToolDef[] = [];

  if (memoryService) {
    virtualTools.push(...buildMemoryTools());
  }

  // Skill-mutation tools are exposed to every employee (internal + external /
  // A2A) regardless of role. The handlers return structured
  // `not-supported-in-web` errors when the runtime lacks desktop-only adapters,
  // so offering the tools on web is still useful — the LLM surfaces the
  // restriction conversationally. Fork / edit only require the staging manager
  // and skill loader; the install-family still requires the environment but
  // the gate below is permissive because the handlers self-check.
  if (runtimeCtx.skillStagingManager && runtimeCtx.skillLoader) {
    virtualTools.push(...buildSkillInstallTools());
  }

  if (!isDirectChatTask && state.handoffCount < MAX_HANDOFF_COUNT) {
    const employees = await repos.employees.findByCompany(companyId);
    const colleagues = employees.filter((e) => e.employee_id !== employee.employee_id);

    if (colleagues.length > 0) {
      virtualTools.push({
        name: 'handoff_to',
        description: 'Hand off this task to another employee who is better suited.',
        parameters: {
          type: 'object',
          properties: {
            targetEmployeeId: {
              type: 'string',
              enum: colleagues.map((e) => e.employee_id),
              description: `Colleagues: ${colleagues.map((e) => `${e.employee_id} (${e.name})`).join(', ')}`,
            },
            reason: { type: 'string', description: 'Why handoff is needed' },
            completedWork: { type: 'string', description: 'Summary of what you completed' },
            remainingWork: { type: 'string', description: 'What the next employee should do' },
          },
          required: ['targetEmployeeId', 'reason', 'completedWork', 'remainingWork'],
        },
      });
    }
  }

  // PRD 2.3: Workstation-scoped tools when resolver present (employee scope);
  // system agents (manager / hr / pm / boss) bypass and get full listAvailable.
  const scopedMcpTools = workstationToolResolver
    ? await workstationToolResolver.resolveForEmployee(companyId, employee.employee_id)
    : await toolExecutor.listAvailable(companyId);
  const builtinToolDefs = builtinTools ? [...builtinTools.values()].map((tool) => tool.def) : [];
  const mcpTools = [...builtinToolDefs, ...scopedMcpTools];
  const pool = await buildToolPool({
    virtualTools,
    mcpTools,
    runtimePolicy: runtimeCtx.runtimePolicy,
    serverForTool: serverResolverFromExecutor(toolExecutor),
    toolTypeForTool: toolTypeResolverFromExecutor(toolExecutor),
  });
  const allowedRuntimeToolNames = new Set(pool.mcpTools.map((t) => t.name));

  return {
    virtualTools: pool.virtualTools,
    mcpTools: pool.mcpTools,
    allTools: pool.llmTools,
    toolRegistry: pool.toolRegistry,
    allowedRuntimeToolNames,
    allowedMcpToolNames: allowedRuntimeToolNames,
    deniedTools: pool.deniedTools,
    toolsHash: pool.toolsHash,
  };
}

function serverResolverFromExecutor(
  toolExecutor: ToolExecutor,
): ((toolName: string) => string | undefined) | undefined {
  const maybeResolver = (toolExecutor as unknown as Record<string, unknown>).getServerForTool;
  return typeof maybeResolver === 'function'
    ? (toolName) =>
        (maybeResolver as (name: string) => string | undefined).call(toolExecutor, toolName)
    : undefined;
}

function toolTypeResolverFromExecutor(
  toolExecutor: ToolExecutor,
): ((toolName: string) => RuntimeToolType | undefined) | undefined {
  const maybeResolver = (toolExecutor as unknown as Record<string, unknown>).getToolTypeForTool;
  return typeof maybeResolver === 'function'
    ? (toolName) =>
        (maybeResolver as (name: string) => RuntimeToolType | undefined).call(
          toolExecutor,
          toolName,
        )
    : undefined;
}
