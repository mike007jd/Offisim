export type InteractionMode = 'boss_proxy' | 'human_in_loop' | 'direct_to_employee' | 'yolo';

export const INTERACTION_MODES = [
  'boss_proxy',
  'human_in_loop',
  'direct_to_employee',
  'yolo',
] as const;

export const DEFAULT_INTERACTION_MODE: InteractionMode = 'boss_proxy';

export const INTERACTION_MODE_LABEL: Record<InteractionMode, string> = {
  boss_proxy: 'Plan',
  human_in_loop: 'Human-in-loop',
  direct_to_employee: 'Direct',
  yolo: 'YOLO',
};

export const INTERACTION_MODE_DESCRIPTION: Record<InteractionMode, string> = {
  boss_proxy: 'Boss routes work through the standard manager and planner chain.',
  human_in_loop: 'Boss routes work through the planner with explicit human approval gates.',
  direct_to_employee: 'Work enters the planner and employee loop without boss ceremony.',
  yolo: 'A single autonomous YOLO Master owns the task end to end.',
};

export function isInteractionMode(value: string): value is InteractionMode {
  return (INTERACTION_MODES as readonly string[]).includes(value);
}

export type InteractionKind =
  | 'permission_request'
  | 'plan_review'
  | 'agent_question'
  | 'skill_install_confirm';

export type InteractionSeverity = 'normal' | 'high';

type InteractionScope = 'once' | 'thread' | 'session';

interface InteractionOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly scope?: InteractionScope;
  readonly recommended?: boolean;
}

interface BossRecommendation {
  readonly optionId: string;
  readonly reason: string;
}

interface PermissionInteractionContext {
  readonly type: 'permission_request';
  readonly serverName: string;
  readonly toolName: string;
  readonly employeeId?: string | null;
  readonly policyHash?: string;
}

interface PlanReviewInteractionContext {
  readonly type: 'plan_review';
  readonly planId?: string | null;
}

interface AgentQuestionInteractionContext {
  readonly type: 'agent_question';
  readonly questionKey?: string | null;
}

type SkillInstallSourceKind = 'git' | 'upload' | 'claude-code' | 'codex' | 'fork' | 'self-authored';

/** Mutation discriminator. Absent value = legacy install. */
type SkillMutationAction = 'install' | 'fork' | 'edit' | 'create';

interface SkillInstallConfirmParent {
  readonly skillId: string;
  readonly slug: string;
  readonly name: string;
  readonly version: string;
}

interface SkillInstallConfirmBodyDiff {
  readonly oldPreview: string;
  readonly newPreview: string;
}

type SkillFrontmatterErrorReason =
  | 'missing-required'
  | 'forbidden-namespace'
  | 'unknown-field'
  | 'invalid-yaml';

interface SkillFrontmatterErrorPayload {
  readonly reason: SkillFrontmatterErrorReason;
  readonly detail: string;
  readonly field?: string;
}

interface SkillInstallConfirmInteractionContext {
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
  /** Full SKILL.md text. Used by self-authoring create previews. */
  readonly skillMdText?: string;
  readonly slug?: string;
  readonly modelKey?: string;
  readonly frontmatterError?: SkillFrontmatterErrorPayload;
  /**
   * install | fork | edit discriminator. Optional for backwards-compat with
   * T2.2 callers that only produced install requests; consumers SHALL treat
   * an absent value as `'install'`.
   */
  readonly action?: SkillMutationAction;
  /** Required iff `action === 'fork'`. Carries parent skill metadata. */
  readonly parent?: SkillInstallConfirmParent;
  /**
   * Required iff `action === 'edit'`. Each preview is ≤ 160 UTF-16 code units
   * with `…` appended when the source exceeded 160 — the full body lives in
   * staging and never rides on the wire.
   */
  readonly bodyDiff?: SkillInstallConfirmBodyDiff;
}

type InteractionContext =
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
