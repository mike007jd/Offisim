import type { SkillInstallConfirmOutcome } from '@offisim/core/browser';
import type { InteractionRequest } from '@offisim/shared-types';
import { skillInstallOutcomeLabel } from '@offisim/shared-types';

export type InteractionFollowUp =
  | { mode: 'none' }
  | { mode: 'retry_last_message' }
  | { mode: 'resend_with_clarification' }
  | { mode: 'message'; message: string };

function getSkillInstallConfirmFollowUp(
  request: InteractionRequest,
  selectedOptionId: string,
  skillInstallOutcome?: SkillInstallConfirmOutcome,
): InteractionFollowUp {
  const action =
    request.context?.type === 'skill_install_confirm' ? request.context.action : undefined;
  if (action === 'create' && selectedOptionId === 'retry') {
    return {
      mode: 'message',
      message: 'Retry requested. Ask the employee to generate a corrected SKILL.md.',
    };
  }
  // The committer is the source of truth — use its outcome whenever it
  // returned one. Fall back to a synthesized cancelled outcome only when the
  // user dismissed without ever invoking the committer (e.g., resolver said
  // no handler was wired).
  const outcome: SkillInstallConfirmOutcome =
    skillInstallOutcome ?? { kind: 'cancelled' };
  return { mode: 'message', message: skillInstallOutcomeLabel(outcome) };
}

export function getInteractionFollowUp(
  request: InteractionRequest,
  response: { selectedOptionId: string },
  skillInstallOutcome?: SkillInstallConfirmOutcome,
): InteractionFollowUp {
  switch (request.kind) {
    case 'permission_request':
      return response.selectedOptionId.startsWith('approve')
        ? {
            mode: 'message',
            message: 'Approval saved. Re-run the request when you are ready.',
          }
        : { mode: 'none' };
    case 'plan_review':
      return response.selectedOptionId !== 'cancel'
        ? { mode: 'retry_last_message' }
        : { mode: 'none' };
    case 'agent_question':
      return response.selectedOptionId !== 'cancel'
        ? { mode: 'resend_with_clarification' }
        : { mode: 'none' };
    case 'skill_install_confirm':
      return getSkillInstallConfirmFollowUp(
        request,
        response.selectedOptionId,
        skillInstallOutcome,
      );
    default:
      return { mode: 'none' };
  }
}
