import type { RuntimeEvidenceClass } from '../models.js';

export interface McpServerConnectedPayload {
  readonly serverName: string;
  readonly toolCount: number;
}

export interface McpToolCalledPayload {
  readonly serverName: string;
  readonly toolName: string;
  readonly employeeId: string;
}

export interface McpToolResultPayload {
  readonly serverName: string;
  readonly toolName: string;
  readonly employeeId: string;
  readonly toolCallId: string;
  readonly success: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

export interface ToolExecutionTelemetryPayload {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolType: 'builtin' | 'mcp' | 'workstation' | 'runtime-profile';
  readonly evidenceClass: RuntimeEvidenceClass;
  readonly threadId: string;
  readonly nodeName?: string;
  readonly employeeId?: string;
  readonly taskRunId?: string | null;
  readonly serverName?: string;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly durationMs?: number;
  readonly status: 'started' | 'completed' | 'error' | 'denied';
  readonly errorType?: string;
  readonly concurrentWith?: readonly string[];
  readonly chatConversationKey?: string;
  readonly chatRunId?: string;
}
