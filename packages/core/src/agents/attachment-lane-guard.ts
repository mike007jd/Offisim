import { AIMessage } from '@langchain/core/messages';
import { ATTACHMENTS_REQUIRE_GATEWAY_LANE } from '@offisim/shared-types';
import type { OffisimGraphState, RunScope } from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';

export function attachmentsRequireGatewayLane(
  runtimeCtx: RuntimeContext,
  runScope?: RunScope | null,
): boolean {
  return (
    (runScope?.pendingAttachments?.length ?? 0) > 0 &&
    runtimeCtx.llmToolCallsEnabled === false
  );
}

export function attachmentGatewayLaneOutcomeState(
  state: Pick<OffisimGraphState, 'currentStepOutputs'>,
): Partial<OffisimGraphState> {
  return {
    routeDecision: 'direct_reply',
    pendingAssignments: [],
    currentStepOutputs: state.currentStepOutputs,
    messages: [new AIMessage({ content: ATTACHMENTS_REQUIRE_GATEWAY_LANE })],
  };
}
