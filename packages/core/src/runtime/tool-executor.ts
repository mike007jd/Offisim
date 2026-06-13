import type { RunScope } from '@offisim/shared-types';
import type { ToolDef } from '../llm/gateway.js';

export interface ToolCallRequest {
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  /** Graph node issuing the tool call. */
  readonly nodeName?: string;
  /** Runtime thread issuing the tool call. Project-scoped chats use the project thread. */
  readonly threadId?: string;
  /**
   * Active project whose bound `workspace_root` scopes workspace tools (`bash`).
   * Carried from `state.projectId` so the desktop shell sandbox knows which
   * project root to run inside; null/absent means no bound workspace.
   */
  readonly projectId?: string | null;
  /** The employee that initiated this tool call (used for scene feedback). */
  readonly employeeId?: string;
  /** The task run that initiated this tool call, when available. */
  readonly taskRunId?: string;
  /** The plan step that initiated this tool call, when available. */
  readonly stepIndex?: number;
  /** Preloaded employee config from the current turn, avoids repeated employee reads. */
  readonly employeeConfigJson?: string | null;
  /** Abort signal for tool waits, subprocesses, and permission prompts. */
  readonly signal?: AbortSignal;
  /**
   * Per-execution chat run scope from the requesting node's `config.configurable.runScope`.
   * Set when the tool call originates inside a chat-driven graph execution; absent for
   * background invocations. `tool.execution.telemetry` events stamp this on the payload.
   */
  readonly runScope?: RunScope | null;
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

export class UnconfiguredToolExecutor implements ToolExecutor {
  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    return {
      success: false,
      result: null,
      error: `No tool executor is configured for "${call.name}".`,
    };
  }

  async listAvailable(_companyId: string): Promise<ToolDef[]> {
    return [];
  }
}
