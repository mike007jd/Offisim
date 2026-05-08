import { AIMessage } from '@langchain/core/messages';
import { LOCAL_TOOLS_REQUIRE_GATEWAY_LANE } from '@offisim/shared-types';
import type { OffisimGraphState } from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { TaskToolIntent } from './task-tool-intent.js';

export function localToolsRequireGatewayLane(
  runtimeCtx: RuntimeContext,
  taskToolIntent: TaskToolIntent,
): boolean {
  return taskToolIntent.requiresLocalTools && runtimeCtx.llmToolCallsEnabled === false;
}

export function localToolsGatewayLaneOutcomeState(
  state: Pick<OffisimGraphState, 'currentStepOutputs'>,
  taskToolIntent?: TaskToolIntent,
): Partial<OffisimGraphState> {
  return {
    routeDecision: 'direct_reply',
    pendingAssignments: [],
    currentStepOutputs: state.currentStepOutputs,
    messages: [
      new AIMessage({
        content: [
          LOCAL_TOOLS_REQUIRE_GATEWAY_LANE,
          'The selected SDK/provider lane is text/reasoning-only and cannot execute local file, shell, memory, todo, skill, MCP, or workspace tools. Use the default Offisim gateway harness or a verified gateway-capable employee profile for this task.',
        ].join('\n'),
      }),
    ],
    ...(taskToolIntent ? { taskToolIntent } : {}),
  };
}
