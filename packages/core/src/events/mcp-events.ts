/**
 * MCP (Model Context Protocol) event factories.
 * Extracted from event-factories.ts for domain separation.
 */
import type {
  McpServerConnectedPayload,
  McpToolCalledPayload,
  McpToolResultPayload,
  RuntimeEvent,
} from '@offisim/shared-types';

export function mcpServerConnected(
  companyId: string,
  serverName: string,
  toolCount: number,
): RuntimeEvent<McpServerConnectedPayload> {
  return {
    type: 'mcp.server.connected',
    entityId: serverName,
    entityType: 'mcp',
    companyId,
    timestamp: Date.now(),
    payload: { serverName, toolCount },
  };
}

export function mcpToolCalled(
  companyId: string,
  serverName: string,
  toolName: string,
  employeeId: string,
  threadId?: string,
): RuntimeEvent<McpToolCalledPayload> {
  return {
    type: 'mcp.tool.called',
    entityId: `${serverName}/${toolName}`,
    entityType: 'mcp',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { serverName, toolName, employeeId },
  };
}

export function mcpToolResult(
  companyId: string,
  serverName: string,
  toolName: string,
  employeeId: string,
  toolCallId: string,
  success: boolean,
  latencyMs: number,
  error?: string,
): RuntimeEvent<McpToolResultPayload> {
  return {
    type: 'mcp.tool.result',
    entityId: `${serverName}/${toolName}`,
    entityType: 'mcp',
    companyId,
    timestamp: Date.now(),
    payload: { serverName, toolName, employeeId, toolCallId, success, latencyMs, error },
  };
}
