import type { RoleSlug } from '../roles.js';

export interface HrAssessmentStartedPayload {
  readonly action: 'hire' | 'assess_team';
  readonly threadId: string;
}

export interface HrAssessmentCompletedPayload {
  readonly action: 'hire' | 'assess_team';
  readonly assessment: string;
  readonly threadId: string;
}

export interface HrRecommendationPayload {
  readonly recommendation: string;
  readonly suggestedRoles: readonly RoleSlug[];
  readonly threadId: string;
}
