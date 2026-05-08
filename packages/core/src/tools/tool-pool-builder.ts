import type { RuntimePolicyConfig } from '@offisim/shared-types';
import type { ToolDef } from '../llm/gateway.js';
import { canonicalJson } from '../utils/canonical-json.js';
import { globToRegex } from '../utils/glob-match.js';
import { sha256Text } from '../utils/hash.js';
import {
  type RegisteredTool,
  type RuntimeToolType,
  resolveRuntimeToolSource,
  runtimeToolRegistryRecord,
  virtualToolRegistryRecord,
} from './tool-registry.js';

export interface DroppedTool {
  readonly name: string;
  readonly identity: string;
  readonly reason: 'runtime_deny' | 'name_conflict';
  readonly shadowedBy?: string;
}

export interface ToolPoolBuildInput {
  readonly virtualTools: readonly ToolDef[];
  readonly mcpTools: readonly ToolDef[];
  readonly runtimePolicy?: RuntimePolicyConfig;
  readonly serverForTool?: (toolName: string) => string | undefined;
  readonly toolTypeForTool?: (toolName: string) => RuntimeToolType | undefined;
}

export interface ToolPoolBuildResult {
  readonly virtualTools: ToolDef[];
  readonly mcpTools: ToolDef[];
  readonly llmTools: ToolDef[];
  readonly toolRegistry: RegisteredTool[];
  readonly deniedTools: DroppedTool[];
  readonly toolsHash: string;
}

export async function buildToolPool(input: ToolPoolBuildInput): Promise<ToolPoolBuildResult> {
  const deniedTools: DroppedTool[] = [];
  const virtualTools = stableDedupe(input.virtualTools, deniedTools);
  const filteredMcp = input.mcpTools.filter((tool) => {
    const identity = runtimeIdentityForTool(tool.name, input.serverForTool);
    if (isRuntimeDeny(identity, input.runtimePolicy)) {
      deniedTools.push({ name: tool.name, identity, reason: 'runtime_deny' });
      return false;
    }
    return true;
  });
  const mcpTools = stableDedupe(
    filteredMcp,
    deniedTools,
    new Set(virtualTools.map((tool) => tool.name)),
  );
  const llmTools = [...virtualTools, ...mcpTools];
  const toolRegistry = [
    ...virtualTools.map(virtualToolRegistryRecord),
    ...mcpTools.map((tool) =>
      runtimeToolRegistryRecord(
        tool,
        resolveRuntimeToolSource(tool.name, {
          serverForTool: input.serverForTool,
          toolTypeForTool: input.toolTypeForTool,
        }),
      ),
    ),
  ];
  const toolsHash = await sha256Text(canonicalJson(llmTools));
  return { virtualTools, mcpTools, llmTools, toolRegistry, deniedTools, toolsHash };
}

function stableDedupe(
  tools: readonly ToolDef[],
  dropped: DroppedTool[],
  existing = new Set<string>(),
): ToolDef[] {
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const output: ToolDef[] = [];
  for (const tool of sorted) {
    if (existing.has(tool.name)) {
      dropped.push({
        name: tool.name,
        identity: tool.name,
        reason: 'name_conflict',
        shadowedBy: tool.name,
      });
      continue;
    }
    existing.add(tool.name);
    output.push(tool);
  }
  return output;
}

function runtimeIdentityForTool(
  toolName: string,
  serverForTool?: (toolName: string) => string | undefined,
): string {
  const serverName = serverForTool?.(toolName) ?? '*';
  return `mcp:${serverName}:${toolName}`;
}

function isRuntimeDeny(identity: string, runtimePolicy?: RuntimePolicyConfig): boolean {
  const policy = runtimePolicy?.toolPermissions;
  if (!policy?.enabled) return false;
  const matched = [...policy.rules]
    .filter((rule) => globToRegex(rule.pattern).test(identity))
    .sort((a, b) => b.pattern.length - a.pattern.length)[0];
  return (matched?.behavior ?? policy.defaultBehavior) === 'deny';
}
