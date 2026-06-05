import type { ToolExecutionTelemetryPayload } from '@offisim/shared-types';
import type { ToolDef } from '../llm/gateway.js';

export type RuntimeToolType = ToolExecutionTelemetryPayload['toolType'];
export type ToolRegistrySurface = 'virtual' | RuntimeToolType;

export interface RuntimeToolSource {
  readonly toolType: RuntimeToolType;
  readonly serverName: string;
  readonly permissionIdentity: string;
}

/**
 * Optional capability for a {@link ToolExecutor} to report where a tool routes.
 * Implemented by the MCP/auditing executors; consumers should narrow with a
 * runtime `typeof` check before calling, so a rename surfaces as a compile error
 * here instead of a silent structural-cast degradation at the call site.
 */
export interface ToolSourceResolver {
  getServerForTool(toolName: string): string | undefined;
  getToolTypeForTool(toolName: string): RuntimeToolType | undefined;
}

/**
 * Optional MCP capability for reporting whether a server's tool annotations may
 * be trusted to auto-approve read-only calls. Implemented by the MCP executor
 * (not the composite/builtin executors); consumers should narrow with a runtime
 * `typeof` check the same way they do for {@link ToolSourceResolver}, so a
 * rename surfaces as a compile error instead of a silent default-untrusted
 * degradation.
 */
export interface ServerAnnotationTrustResolver {
  isServerTrustedForAnnotations(serverName: string): boolean;
}

export interface RegisteredTool {
  readonly name: string;
  readonly surface: ToolRegistrySurface;
  readonly serverName: string | null;
  readonly permissionIdentity: string | null;
  readonly exposedToLlm: boolean;
  readonly def?: ToolDef;
}

export function resolveRuntimeToolSource(
  toolName: string,
  opts: {
    readonly serverForTool?: (toolName: string) => string | undefined;
    readonly toolTypeForTool?: (toolName: string) => RuntimeToolType | undefined;
  } = {},
): RuntimeToolSource {
  const serverName = opts.serverForTool?.(toolName) ?? toolName;
  const toolType = opts.toolTypeForTool?.(toolName) ?? classifyRuntimeToolType(serverName);
  return {
    toolType,
    serverName,
    permissionIdentity: runtimeToolPermissionIdentity(serverName, toolName),
  };
}

export function runtimeToolPermissionIdentity(serverName: string, toolName: string): string {
  return `mcp:${serverName}:${toolName}`;
}

export function virtualToolRegistryRecord(tool: ToolDef): RegisteredTool {
  return {
    name: tool.name,
    surface: 'virtual',
    serverName: null,
    permissionIdentity: null,
    exposedToLlm: true,
    def: tool,
  };
}

export function runtimeToolRegistryRecord(
  tool: ToolDef,
  source: RuntimeToolSource,
  exposedToLlm = true,
): RegisteredTool {
  return {
    name: tool.name,
    surface: source.toolType,
    serverName: source.serverName,
    permissionIdentity: source.permissionIdentity,
    exposedToLlm,
    def: tool,
  };
}

function classifyRuntimeToolType(serverName: string): RuntimeToolType {
  if (serverName === 'builtin') return 'builtin';
  if (serverName === 'runtime-profile') return 'runtime-profile';
  if (serverName === 'workstation' || serverName.startsWith('workstation:')) {
    return 'workstation';
  }
  return 'mcp';
}
