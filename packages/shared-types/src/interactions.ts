export type InteractionMode = 'boss_proxy' | 'human_in_loop';

export type InteractionKind =
  | 'permission_request'
  | 'plan_review'
  | 'agent_question'
  | 'skill_install_confirm';

export type InteractionSeverity = 'normal' | 'high';

export type InteractionScope = 'once' | 'thread' | 'session';

export const PLAN_REVIEW_REQUIRED = 'PLAN_REVIEW_REQUIRED';
export const AGENT_QUESTION_REQUIRED = 'AGENT_QUESTION_REQUIRED';

export interface InteractionOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly scope?: InteractionScope;
  readonly recommended?: boolean;
}

export interface BossRecommendation {
  readonly optionId: string;
  readonly reason: string;
}

export interface PermissionInteractionContext {
  readonly type: 'permission_request';
  readonly serverName: string;
  readonly toolName: string;
  readonly employeeId?: string | null;
}

export interface PlanReviewInteractionContext {
  readonly type: 'plan_review';
  readonly planId?: string | null;
}

export interface AgentQuestionInteractionContext {
  readonly type: 'agent_question';
  readonly questionKey?: string | null;
}

export type SkillInstallSourceKind = 'git' | 'upload' | 'claude-code' | 'codex';

export interface SkillInstallConfirmInteractionContext {
  readonly type: 'skill_install_confirm';
  readonly stagingRef: string;
  readonly skillName: string;
  readonly skillDescription: string;
  readonly allowedTools: readonly string[];
  readonly sourceKind: SkillInstallSourceKind;
  readonly sourceRef: string;
  readonly resolvedScope: 'company' | 'employee';
  readonly resolvedEmployeeId: string | null;
  readonly resolvedEmployeeName?: string | null;
  readonly assetPaths: readonly string[];
  readonly skillMdBody?: string;
}

export type InteractionContext =
  | PermissionInteractionContext
  | PlanReviewInteractionContext
  | AgentQuestionInteractionContext
  | SkillInstallConfirmInteractionContext;

export interface InteractionRequest {
  readonly interactionId: string;
  readonly threadId: string;
  readonly companyId: string;
  readonly kind: InteractionKind;
  readonly severity: InteractionSeverity;
  readonly title: string;
  readonly prompt: string;
  readonly options: readonly InteractionOption[];
  readonly recommendation?: BossRecommendation;
  readonly allowFreeformResponse: boolean;
  readonly placeholder?: string;
  readonly requestedByNode?: string;
  readonly employeeId?: string | null;
  readonly taskRunId?: string | null;
  readonly context?: InteractionContext;
  readonly createdAt: number;
}

export interface InteractionResponse {
  readonly interactionId: string;
  readonly selectedOptionId: string;
  readonly freeformResponse?: string;
  readonly respondedAt: number;
}
