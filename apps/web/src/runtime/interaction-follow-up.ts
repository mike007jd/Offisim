import type { SkillInstallConfirmOutcome } from '@offisim/core/browser';
import type { InteractionRequest } from '@offisim/shared-types';
import {
  ATTACHMENTS_REQUIRE_GATEWAY_LANE,
  type ChatRuntimeOutcomeKind,
  LOCAL_TOOLS_REQUIRE_GATEWAY_LANE,
} from '@offisim/shared-types';

export type InteractionFollowUp =
  | { mode: 'none' }
  | { mode: 'retry_last_message' }
  | { mode: 'resend_with_clarification' }
  | { mode: 'message'; message: string };

function getSkillInstallConfirmFollowUp(
  request: InteractionRequest,
  selectedOptionId: string,
  _skillInstallOutcome?: SkillInstallConfirmOutcome,
): InteractionFollowUp {
  const action =
    request.context?.type === 'skill_install_confirm' ? request.context.action : undefined;
  if (action === 'create' && selectedOptionId === 'retry') {
    return {
      mode: 'message',
      message: 'Retry requested. Ask the employee to generate a corrected SKILL.md.',
    };
  }
  return { mode: 'none' };
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

export function getChatRuntimeOutcomeFollowUp(
  outcome: ChatRuntimeOutcomeKind,
): InteractionFollowUp {
  switch (outcome) {
    case ATTACHMENTS_REQUIRE_GATEWAY_LANE:
      return {
        mode: 'message',
        message:
          'Attachments require the default Offisim harness/gateway attachment tool, or a verified tool-capable employee profile. Plain SDK provider lanes are text/reasoning-only; switch runtime, then resend the attachment.',
      };
    case LOCAL_TOOLS_REQUIRE_GATEWAY_LANE:
      return {
        mode: 'message',
        message:
          'Local files, shell commands, workspace tools, memory, todo, skills, and MCP tools require the default Offisim harness/gateway tools or a verified tool-capable employee profile. Plain SDK provider lanes are text/reasoning-only; switch runtime, then resend the request.',
      };
  }
}
