import type { InteractionRequest } from '@offisim/shared-types';

export type InteractionFollowUp =
  | { mode: 'none' }
  | { mode: 'retry_last_message' }
  | { mode: 'resend_with_clarification' }
  | { mode: 'message'; message: string };

export function getInteractionFollowUp(
  request: InteractionRequest,
  response: { selectedOptionId: string },
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
      return response.selectedOptionId === 'confirm'
        ? { mode: 'message', message: 'Skill installed.' }
        : { mode: 'message', message: 'Skill install cancelled.' };
    default:
      return { mode: 'none' };
  }
}
