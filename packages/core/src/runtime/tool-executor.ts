import type { ToolDef } from '../llm/gateway.js';

export interface ToolCallRequest {
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  /** Graph node issuing the tool call. */
  readonly nodeName?: string;
  /** The employee that initiated this tool call (used for scene feedback). */
  readonly employeeId?: string;
  /** The task run that initiated this tool call, when available. */
  readonly taskRunId?: string;
  /** The plan step that initiated this tool call, when available. */
  readonly stepIndex?: number;
  /** Abort signal for tool waits, subprocesses, and permission prompts. */
  readonly signal?: AbortSignal;
}

export interface ToolCallResponse {
  readonly success: boolean;
  readonly result: unknown;
  readonly error?: string;
}

export interface ToolExecutor {
  execute(call: ToolCallRequest): Promise<ToolCallResponse>;
  /** List all MCP tools available company-wide (unscoped). */
  listAvailable(companyId: string): Promise<ToolDef[]>;
}

/**
 * Error code returned when an employee attempts to use a tool
 * they no longer have workstation access to.
 */
export const WORKSTATION_ACCESS_DENIED = 'WORKSTATION_ACCESS_DENIED';
export const TOOL_PERMISSION_DENIED = 'TOOL_PERMISSION_DENIED';
export const TOOL_PERMISSION_REQUIRED = 'TOOL_PERMISSION_REQUIRED';

/** Phase 2.0 mock — returns static results */
export class MockToolExecutor implements ToolExecutor {
  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    return {
      success: true,
      result: { mock: true, tool: call.name, args: call.arguments },
    };
  }

  async listAvailable(_companyId: string): Promise<ToolDef[]> {
    return [];
  }
}
