import type { SkillInstallConfirmOutcome } from '@offisim/core/browser';
import type { InteractionRequest } from '@offisim/shared-types';

export type InteractionFollowUp =
  | { mode: 'none' }
  | { mode: 'retry_last_message' }
  | { mode: 'resend_with_clarification' }
  | { mode: 'message'; message: string };

const SKILL_INSTALL_CANCELLED_MESSAGE = 'Skill install cancelled.';
const SKILL_CREATION_CANCELLED_MESSAGE = 'Skill creation cancelled.';

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
  if (selectedOptionId !== 'confirm') {
    return {
      mode: 'message',
      message:
        action === 'create' ? SKILL_CREATION_CANCELLED_MESSAGE : SKILL_INSTALL_CANCELLED_MESSAGE,
    };
  }
  switch (skillInstallOutcome?.kind) {
    case 'created':
      return { mode: 'message', message: 'Skill created.' };
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
      return {
        mode: 'message',
        message:
          action === 'create' ? SKILL_CREATION_CANCELLED_MESSAGE : SKILL_INSTALL_CANCELLED_MESSAGE,
      };
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
      return getSkillInstallConfirmFollowUp(
        request,
        response.selectedOptionId,
        skillInstallOutcome,
      );
    default:
      return { mode: 'none' };
  }
}
