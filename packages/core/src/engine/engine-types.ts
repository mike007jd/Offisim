import type {
  EmployeeRuntimeBinding,
  EngineId,
  EngineProposalKind,
} from '@offisim/shared-types';
import type { PendingAssignment } from '../graph/state.js';

export type { EmployeeRuntimeBinding, EngineId, EngineProposalKind };

export interface EngineTaskEnvelope {
  readonly companyId: string;
  readonly threadId: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly roleSlug: string;
  readonly provider: string;
  readonly model: string;
  readonly taskRunId?: string;
  readonly taskType: string;
  readonly taskDescription: string;
  readonly requiredSkills: readonly string[];
  readonly assignment: PendingAssignment;
}

export interface EngineRunContext {
  readonly signal?: AbortSignal;
}

export interface EngineArtifact {
  readonly content: string;
  readonly fileName?: string | null;
  readonly mimeType?: string | null;
}

export interface EngineProposal {
  readonly proposalId: string;
  readonly kind: EngineProposalKind;
  readonly title: string;
  readonly description: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
}

export type RuntimeActivityEvent =
  | {
      readonly kind: 'text_delta';
      readonly content: string;
      readonly channel?: 'content' | 'reasoning';
      readonly timestamp?: number;
    }
  | {
      readonly kind: 'reasoning_delta';
      readonly content: string;
      readonly timestamp?: number;
    }
  | {
      readonly kind: 'tool_started';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly toolType?: 'builtin' | 'mcp' | 'workstation';
      readonly serverName?: string;
      readonly timestamp?: number;
    }
  | {
      readonly kind: 'tool_completed';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly toolType?: 'builtin' | 'mcp' | 'workstation';
      readonly serverName?: string;
      readonly status?: 'completed' | 'error' | 'denied';
      readonly errorType?: string;
      readonly timestamp?: number;
    }
  | {
      readonly kind: 'subagent_started' | 'subagent_completed';
      readonly activityId?: string;
      readonly label: string;
      readonly detail?: string;
      readonly timestamp?: number;
    }
  | {
      readonly kind: 'artifact_ready';
      readonly artifact: EngineArtifact;
      readonly timestamp?: number;
    }
  | {
      readonly kind: 'approval_requested';
      readonly title: string;
      readonly prompt: string;
      readonly proposal?: EngineProposal;
      readonly timestamp?: number;
    }
  | {
      readonly kind: 'proposal_created';
      readonly proposal: EngineProposal;
      readonly timestamp?: number;
    }
  | {
      readonly kind: 'run_completed' | 'run_failed' | 'run_cancelled';
      readonly detail?: string;
      readonly timestamp?: number;
    };

export interface EngineRunResult {
  readonly content: string;
  readonly reasoningContent?: string;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
  readonly artifact?: EngineArtifact;
  readonly proposals?: readonly EngineProposal[];
}

export interface EngineRunHandle {
  readonly runId: string;
  readonly events: AsyncIterable<RuntimeActivityEvent>;
  readonly result: Promise<EngineRunResult>;
}
