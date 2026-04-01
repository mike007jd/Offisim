import type { InteractionRequest } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import { getInteractionFollowUp } from './interaction-follow-up';

function makeRequest(
  overrides?: Partial<InteractionRequest> & { kind: InteractionRequest['kind'] },
): InteractionRequest {
  return {
    interactionId: overrides?.interactionId ?? 'ix-1',
    threadId: overrides?.threadId ?? 'thread-1',
    companyId: overrides?.companyId ?? 'company-1',
    kind: overrides?.kind ?? 'permission_request',
    severity: overrides?.severity ?? 'normal',
    title: overrides?.title ?? 'Decision',
    prompt: overrides?.prompt ?? 'What should happen next?',
    options: overrides?.options ?? [{ id: 'approve_once', label: 'Approve once' }],
    allowFreeformResponse: overrides?.allowFreeformResponse ?? true,
    createdAt: overrides?.createdAt ?? Date.now(),
  };
}

describe('getInteractionFollowUp', () => {
  it('does not auto-retry the full request after approving a permission prompt', () => {
    const outcome = getInteractionFollowUp(makeRequest({ kind: 'permission_request' }), {
      selectedOptionId: 'approve_once',
    });

    expect(outcome).toEqual({
      mode: 'message',
      message: 'Approval saved. Re-run the request when you are ready.',
    });
  });

  it('retries the blocked execution after plan review approval', () => {
    const outcome = getInteractionFollowUp(makeRequest({ kind: 'plan_review' }), {
      selectedOptionId: 'start_execution',
    });

    expect(outcome).toEqual({ mode: 'retry_last_message' });
  });

  it('resends the user message with clarification for agent questions', () => {
    const outcome = getInteractionFollowUp(makeRequest({ kind: 'agent_question' }), {
      selectedOptionId: 'answer_and_continue',
    });

    expect(outcome).toEqual({ mode: 'resend_with_clarification' });
  });
});
