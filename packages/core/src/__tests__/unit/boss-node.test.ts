import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { beforeEach, describe, expect, it } from 'vitest';
import { bossNode } from '../../agents/boss-node.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { AicsGraphState } from '../../graph/state.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import {
  TEST_COMPANY,
  TEST_COMPANY_ID,
  TEST_THREAD_ID,
  makeEmployee,
  makeManager,
} from '../helpers/fixtures.js';
import { MockLlmGateway } from '../helpers/mock-gateway.js';

function makeState(overrides?: Partial<AicsGraphState>): AicsGraphState {
  return {
    threadId: TEST_THREAD_ID,
    companyId: TEST_COMPANY_ID,
    entryMode: 'boss_chat' as const,
    targetEmployeeId: null,
    messages: [new HumanMessage('Build me a website')],
    routeDecision: null,
    currentTaskRunId: null,
    currentEmployeeId: null,
    pendingAssignments: [],
    completed: false,
    interruptReason: null,
    meetingId: null,
    managerDirective: null,
    taskPlan: null,
    currentStepIndex: 0,
    stepResults: [],
    currentStepOutputs: [],
    handoffCount: 0,
    meetingActionItems: [],
    hrAssessment: null,
    meetingInterrupt: null,
    ...overrides,
  };
}

describe('bossNode', () => {
  let gateway: MockLlmGateway;
  let config: RunnableConfig;

  beforeEach(() => {
    gateway = new MockLlmGateway();
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([makeManager(), makeEmployee()]);

    const eventBus = new InMemoryEventBus();
    const resolver = new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json!));
    const toolExecutor = new MockToolExecutor();

    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus,
      llmGateway: gateway,
      modelResolver: resolver,
      toolExecutor,
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
    });

    config = { configurable: { runtimeCtx } };
  });

  it('routes to delegate_manager when LLM returns delegate', async () => {
    gateway.pushResponse({
      content: JSON.stringify({ action: 'delegate', reason: 'needs developer work' }),
    });

    const state = makeState();
    const result = await bossNode(state, config);

    expect(result.routeDecision).toBe('delegate_manager');
    expect(result.messages).toHaveLength(1);
  });

  it('routes to direct_reply for simple questions', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'direct_reply',
        reason: 'simple greeting',
        reply: 'Hello!',
      }),
    });

    const state = makeState({
      messages: [new HumanMessage('Hello!')],
    });
    const result = await bossNode(state, config);

    expect(result.routeDecision).toBe('direct_reply');
    expect(result.messages).toHaveLength(1);
  });

  it('routes to start_meeting when LLM returns meeting', async () => {
    gateway.pushResponse({
      content: JSON.stringify({ action: 'meeting', reason: 'requires discussion' }),
    });

    const state = makeState({
      messages: [new HumanMessage('Lets have a team meeting about architecture')],
    });
    const result = await bossNode(state, config);

    expect(result.routeDecision).toBe('start_meeting');
  });

  it('falls back to delegate_manager on unparseable LLM response', async () => {
    gateway.pushResponse({
      content: 'Sure, I can help with that.',
    });

    const state = makeState();
    const result = await bossNode(state, config);

    expect(result.routeDecision).toBe('delegate_manager');
  });
});
