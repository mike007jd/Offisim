/**
 * Verified Missions domain model (PRD §17). Types-only contract for the M2
 * Mission core: a Mission is a verifiable unit of work whose status and
 * criteria truth live in Offisim SQLite (ADR 2026-06-25-truth-closure D4).
 *
 * This module is additive and consumer-free at MS-001 — the state machine and
 * loop controller (later slices) read these shapes; nothing references them yet.
 * Field names are camelCase (domain); the SQLite columns are snake_case and the
 * mapping lives in the repositories (`@offisim/core` runtime/repos/mission).
 */

// ---------------------------------------------------------------------------
// 17.1 Mission
// ---------------------------------------------------------------------------

export type MissionStatus =
  | 'draft'
  | 'ready'
  | 'running'
  | 'verifying'
  | 'repairing'
  | 'awaiting_user'
  | 'interrupted'
  | 'ready_to_resume'
  | 'blocked'
  | 'failed'
  | 'completed'
  | 'paused'
  | 'cancelled';

export interface Mission {
  missionId: string;
  companyId: string;
  projectId?: string;
  threadId: string;
  title: string;
  goal: string;
  status: MissionStatus;
  runtimeId: string;
  runtimePolicyJson: string;
  budgetJson: string;
  expectedArtifactsJson?: string;
  currentAttemptId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// 17.2 Criterion
// ---------------------------------------------------------------------------

export type MissionCriterionStatus = 'pending' | 'pass' | 'fail' | 'blocked' | 'error' | 'skip';

export interface MissionCriterion {
  criterionId: string;
  missionId: string;
  description: string;
  evaluatorId: string;
  evaluatorConfigJson: string;
  required: boolean;
  orderIndex: number;
  status: MissionCriterionStatus;
  lastEvaluationId?: string;
}

// ---------------------------------------------------------------------------
// 17.3 Attempt
// ---------------------------------------------------------------------------

export type MissionAttemptTrigger = 'initial' | 'repair' | 'resume' | 'manual_retry';

export type MissionAttemptStatus =
  | 'running'
  | 'verifying'
  | 'pass'
  | 'fail'
  | 'blocked'
  | 'interrupted'
  | 'cancelled';

export interface MissionAttempt {
  attemptId: string;
  missionId: string;
  attemptNumber: number;
  rootRunId?: string;
  runtimeSessionLinkId?: string;
  trigger: MissionAttemptTrigger;
  status: MissionAttemptStatus;
  failureSignature?: string;
  startedAt: string;
  finishedAt?: string;
}

// ---------------------------------------------------------------------------
// 17.4 Evaluation
// ---------------------------------------------------------------------------

export type MissionEvaluationVerdict = 'PASS' | 'FAIL' | 'BLOCKED' | 'ERROR' | 'SKIP';

export interface MissionEvaluation {
  evaluationId: string;
  missionId: string;
  criterionId: string;
  attemptId: string;
  evaluatorId: string;
  verdict: MissionEvaluationVerdict;
  summary: string;
  evidenceRefsJson: string;
  durationMs?: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 17.5 Runtime Session Link
// ---------------------------------------------------------------------------

export type RuntimeSessionLinkStatus =
  | 'active'
  | 'idle'
  | 'interrupted'
  | 'incompatible'
  | 'closed';

export interface RuntimeSessionLink {
  runtimeSessionLinkId: string;
  missionId: string;
  runtimeId: string;
  runtimeVersion?: string;
  opaqueSessionRefJson: string;
  compatibilityHash?: string;
  workspaceLeaseId?: string;
  lastSafeBoundary?: string;
  status: RuntimeSessionLinkStatus;
}

// ---------------------------------------------------------------------------
// Mission Event (append-only mission audit trail)
// ---------------------------------------------------------------------------

export interface MissionEvent {
  missionEventId: string;
  missionId: string;
  attemptId?: string;
  type: string;
  dataJson: string;
  createdAt: string;
}
