export interface WorkspaceStalenessDetectedPayload {
  readonly status: 'warn' | 'block' | 'unavailable';
  readonly reason:
    | 'baseline_matches'
    | 'git_worktree_changed'
    | 'git_head_changed'
    | 'missing_workspace_root'
    | 'missing_baseline'
    | 'not_git_repository'
    | 'capture_failed';
  readonly baselineGitHead: string | null;
  readonly currentGitHead: string | null;
  readonly baselineDirty: boolean | null;
  readonly currentDirty: boolean | null;
  readonly currentStatusLines: number | null;
}

export interface GitAutoCommittedPayload {
  readonly stepIndex: number;
  readonly fileCount: number;
  readonly commitMessage: string;
}

export interface KnowledgeIndexStartedPayload {
  readonly knowledgeBaseRef: string;
  readonly documentCount: number;
}

export interface KnowledgeIndexCompletedPayload {
  readonly knowledgeBaseRef: string;
  readonly indexedCount: number;
  readonly durationMs: number;
}

export interface KnowledgeIndexFailedPayload {
  readonly knowledgeBaseRef: string;
  readonly error: string;
}

export interface KnowledgeSearchStartedPayload {
  readonly knowledgeBaseRef: string;
  readonly query: string;
  readonly employeeId: string;
}

export interface KnowledgeSearchCompletedPayload {
  readonly knowledgeBaseRef: string;
  readonly resultCount: number;
  readonly employeeId: string;
  readonly durationMs: number;
}
