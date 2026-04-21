import type { SkillInstallConfirmOutcome } from '@offisim/core/browser';
import type { InteractionRequest } from '@offisim/shared-types';

export type InteractionFollowUp =
  | { mode: 'none' }
  | { mode: 'retry_last_message' }
  | { mode: 'resend_with_clarification' }
  | { mode: 'message'; message: string };

const SKILL_INSTALL_CANCELLED_MESSAGE = 'Skill install cancelled.';

function getSkillInstallConfirmFollowUp(
  selectedOptionId: string,
  skillInstallOutcome?: SkillInstallConfirmOutcome,
): InteractionFollowUp {
  if (selectedOptionId !== 'confirm') {
    return { mode: 'message', message: SKILL_INSTALL_CANCELLED_MESSAGE };
  }
  switch (skillInstallOutcome?.kind) {
    case 'edited':
      return { mode: 'message', message: 'Skill updated.' };
    case 'staging-expired':
      return {
        mode: 'message',
        message: 'That skill preview expired. Ask again to generate a fresh preview.',
      };
    case 'error':
      return {
        mode: 'message',
        message: `Skill change failed: ${skillInstallOutcome.message}`,
      };
    case 'cancelled':
      return { mode: 'message', message: SKILL_INSTALL_CANCELLED_MESSAGE };
    case 'installed':
    default:
      return { mode: 'message', message: 'Skill installed.' };
  }
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
      return getSkillInstallConfirmFollowUp(response.selectedOptionId, skillInstallOutcome);
    default:
      return { mode: 'none' };
  }
}
