import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AGENT_QUESTION_REQUIRED } from '@offisim/shared-types';
import { beforeEach, describe, expect, it } from 'vitest';
import { bossNode } from '../../agents/boss-node.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { OffisimGraphState } from '../../graph/state.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { InteractionService } from '../../services/interaction-service.js';
import {
  TEST_COMPANY,
  TEST_COMPANY_ID,
  TEST_THREAD_ID,
  makeEmployee,
  makeManager,
} from '../helpers/fixtures.js';
import { MockLlmGateway } from '../helpers/mock-gateway.js';

function makeState(overrides?: Partial<OffisimGraphState>): OffisimGraphState {
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
    replanCount: 0,
    meetingInterrupt: null,
    dispatchedStepIndices: [],
    completedStepIndices: [],
    projectId: null,
    ...overrides,
  };
}

describe('bossNode', () => {
  let gateway: MockLlmGateway;
  let config: RunnableConfig;
  let eventBus: InMemoryEventBus;
  let repos: ReturnType<typeof createMemoryRepositories>;

  beforeEach(() => {
    gateway = new MockLlmGateway();
    repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([makeManager(), makeEmployee()]);

    eventBus = new InMemoryEventBus();
    const resolver = new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json));
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

  it('streams the final boss direct reply after routing decision', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'direct_reply',
        reason: 'simple greeting',
        reply: 'Hello there.',
      }),
    });
    gateway.pushStreamResponse({
      content: 'Hello! How can I help today?',
      usage: { inputTokens: 20, outputTokens: 7 },
    });

    const streamedChunks: string[] = [];
    eventBus.on('llm.stream.chunk', (event) => {
      if (event.payload.nodeName === 'boss') {
        streamedChunks.push(event.payload.content);
      }
    });

    const result = await bossNode(
      makeState({
        messages: [new HumanMessage('Hello!')],
      }),
      config,
    );

    expect(result.routeDecision).toBe('direct_reply');
    expect(result.messages?.[0]?.content).toBe('[Boss]: Hello! How can I help today?');
    expect(streamedChunks.length).toBeGreaterThan(0);

    const llmCalls = await repos.llmCalls.findByThread(TEST_THREAD_ID);
    const bossCalls = llmCalls.filter((call) => call.node_name === 'boss');
    expect(bossCalls).toHaveLength(2);
    expect(bossCalls[1]?.input_tokens).toBe(20);
    expect(bossCalls[1]?.output_tokens).toBe(7);
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

  it('routes to direct_delegate for simple single-employee tasks', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'direct_delegate',
        reason: 'simple task for one employee',
        targetEmployeeId: 'e-dev-1',
      }),
    });

    const state = makeState({
      messages: [new HumanMessage('Write a short summary of our latest report')],
    });
    const result = await bossNode(state, config);

    expect(result.routeDecision).toBe('direct_delegate');
    expect(result.targetEmployeeId).toBe('e-dev-1');
  });

  it('falls back to delegate_manager when direct_delegate has invalid employee ID', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'direct_delegate',
        reason: 'simple task',
        targetEmployeeId: 'nonexistent-employee',
      }),
    });

    const state = makeState();
    const result = await bossNode(state, config);

    expect(result.routeDecision).toBe('delegate_manager');
  });

  it('falls back to delegate_manager when direct_delegate has no employee ID', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'direct_delegate',
        reason: 'simple task',
      }),
    });

    const state = makeState();
    const result = await bossNode(state, config);

    expect(result.routeDecision).toBe('delegate_manager');
  });

  it('falls back to delegate_manager on unparseable LLM response', async () => {
    gateway.pushResponse({
      content: 'Sure, I can help with that.',
    });

    const state = makeState();
    const result = await bossNode(state, config);

    expect(result.routeDecision).toBe('delegate_manager');
  });

  it('requests an agent question in human-in-loop mode when clarification is needed', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'delegate',
        reason: 'Need a bit more detail before planning',
        needsClarification: true,
        clarificationQuestion: 'What kind of website do you want us to build?',
      }),
    });

    const interactionService = new InteractionService({
      eventBus,
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      defaultMode: 'human_in_loop',
    });
    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus,
      llmGateway: gateway,
      modelResolver: new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json)),
      toolExecutor: new MockToolExecutor(),
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      interactionService,
    });

    await expect(
      bossNode(
        makeState({
          messages: [new HumanMessage('Build me something for our startup')],
        }),
        { configurable: { runtimeCtx } },
      ),
    ).rejects.toThrow(AGENT_QUESTION_REQUIRED);

    expect(interactionService.getPending()).toMatchObject({
      kind: 'agent_question',
      prompt: 'What kind of website do you want us to build?',
      requestedByNode: 'boss',
    });
  });

  it('asks the clarification question directly in boss-proxy mode', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'delegate',
        reason: 'Need a bit more detail before planning',
        needsClarification: true,
        clarificationQuestion: 'What kind of website do you want us to build?',
      }),
    });
    gateway.pushStreamResponse({
      content: 'What kind of website do you want us to build?',
      usage: { inputTokens: 16, outputTokens: 8 },
    });

    const result = await bossNode(
      makeState({
        messages: [new HumanMessage('Build me something for our startup')],
      }),
      config,
    );

    expect(result.routeDecision).toBe('direct_reply');
    expect(result.messages?.[0]?.content).toContain(
      'What kind of website do you want us to build?',
    );
  });

  // --- Defensive route override tests ---

  it('overrides direct_reply to delegate_manager when employee name + task in message', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'direct_reply',
        reply: "I'll relay this to Dev Bot.",
        reason: 'user request',
      }),
    });

    const result = await bossNode(
      makeState({
        messages: [new HumanMessage('Ask Dev Bot to implement a login page')],
      }),
      config,
    );

    expect(result.routeDecision).toBe('delegate_manager');
  });

  it('overrides direct_reply to delegate_manager when task keywords present', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'direct_reply',
        reply: 'Sure, here is how to build a website...',
        reason: 'can answer directly',
      }),
    });

    const result = await bossNode(
      makeState({
        messages: [new HumanMessage('Build me a website with a shopping cart')],
      }),
      config,
    );

    expect(result.routeDecision).toBe('delegate_manager');
  });

  it('does NOT override direct_reply for genuine greetings', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'direct_reply',
        reply: 'Hello!',
        reason: 'greeting',
      }),
    });
    gateway.pushStreamResponse({
      content: 'Hello! How can I help?',
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const result = await bossNode(
      makeState({
        messages: [new HumanMessage('Hello!')],
      }),
      config,
    );

    expect(result.routeDecision).toBe('direct_reply');
  });

  it('does NOT override direct_reply for status questions', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'direct_reply',
        reply: 'We have 8 employees.',
        reason: 'status inquiry',
      }),
    });
    gateway.pushStreamResponse({
      content: 'We currently have 8 team members.',
      usage: { inputTokens: 12, outputTokens: 6 },
    });

    const result = await bossNode(
      makeState({
        messages: [new HumanMessage('How many employees do we have?')],
      }),
      config,
    );

    expect(result.routeDecision).toBe('direct_reply');
  });
});
