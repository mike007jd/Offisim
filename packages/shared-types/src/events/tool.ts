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

export type WorkspaceBoundProvenance =
  | {
      readonly availability: 'bound';
      readonly source: 'project_catalog';
      readonly reasonCode: 'current_project_folder';
      readonly displayPath: string;
    }
  | {
      readonly availability: 'bound';
      readonly source: 'conversation_history';
      readonly reasonCode: 'recent_successful_workspace';
      readonly displayPath: string;
    }
  | {
      readonly availability: 'bound';
      readonly source: 'known_root_recovery';
      readonly reasonCode: 'renamed_same_filesystem_object' | 'unique_name_repo_identity_match';
      readonly displayPath: string;
    }
  | {
      readonly availability: 'bound';
      readonly source: 'resume_history';
      readonly reasonCode: 'resume_history_identity_match';
      readonly displayPath: string;
    };

export interface WorkspaceUnavailableProvenance {
  readonly availability: 'unavailable';
  readonly source: 'workspace_recovery';
  readonly reasonCode: 'none' | 'ambiguous';
  readonly requirement: 'optional' | 'required';
}

export type WorkspaceProvenance = WorkspaceBoundProvenance | WorkspaceUnavailableProvenance;

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
  readonly detail?: string;
  readonly errorType?: string;
  readonly concurrentWith?: readonly string[];
  readonly chatConversationKey?: string;
  readonly chatRunId?: string;
  /** Typed workspace provenance. Product copy is derived only in the renderer. */
  readonly workspaceProvenance?: WorkspaceProvenance;
}
