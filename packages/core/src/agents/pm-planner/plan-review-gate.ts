import { PLAN_REVIEW_REQUIRED } from '@offisim/shared-types';
import { generateId } from '../../utils/generate-id.js';
import type { LlmPlan, PmPreflightReady } from '../pm-planner-types.js';
import { buildPlanReviewPayload } from './plan-review-payload.js';

function formatPlanReviewPrompt(plan: LlmPlan): string {
  const stepPreview = plan.steps
    .slice(0, 4)
    .map((step) => `${step.stepIndex + 1}. ${step.description} (${step.tasks.length} tasks)`)
    .join('\n');
  const extraSteps =
    plan.steps.length > 4
      ? `\n+ ${plan.steps.length - 4} more step${plan.steps.length === 5 ? '' : 's'}`
      : '';
  return `Review the plan before execution.\nSummary: ${plan.summary}\n${stepPreview}${extraSteps}`;
}

function buildRevisedPlanReviewReason(): string {
  return 'The updated plan reflects your requested changes and is ready to run.';
}

function buildInitialPlanReviewReason(plan: LlmPlan): string {
  return `The plan is structured into ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'} and looks ready to execute.`;
}

/**
 * Gate the plan through human review when interactionMode is human_in_loop and the
 * player has not yet approved this plan. Throws PLAN_REVIEW_REQUIRED to interrupt
 * the graph; subsequent resumes carry the reviewed payload via planReviewDecision.
 */
export async function awaitPlanReview(plan: LlmPlan, prep: PmPreflightReady): Promise<void> {
  const { runtimeCtx, interactionMode, approvedToExecute, planRevisionNote } = prep;
  const interactionService = runtimeCtx.interactionService;
  if (!interactionService) return;
  if (interactionMode !== 'human_in_loop') return;
  if (approvedToExecute) return;

  await interactionService.request(
    {
      interactionId: generateId('ix'),
      threadId: runtimeCtx.threadId,
      companyId: runtimeCtx.companyId,
      kind: 'plan_review',
      severity: 'normal',
      title: 'Review plan before execution',
      prompt: formatPlanReviewPrompt(plan),
      options: [
        { id: 'start_execution', label: 'Start execution', recommended: true },
        { id: 'revise_plan', label: 'Revise plan' },
        { id: 'cancel', label: 'Cancel' },
      ],
      recommendation: {
        optionId: 'start_execution',
        reason: planRevisionNote
          ? buildRevisedPlanReviewReason()
          : buildInitialPlanReviewReason(plan),
      },
      allowFreeformResponse: true,
      placeholder: 'Tell Offisim what to change in the plan',
      requestedByNode: 'pm_planner',
      context: {
        type: 'plan_review',
        planId: null,
      },
      createdAt: Date.now(),
    },
    { payload: await buildPlanReviewPayload(plan) },
  );
  throw new Error(PLAN_REVIEW_REQUIRED);
}
