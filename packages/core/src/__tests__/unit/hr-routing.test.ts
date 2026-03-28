import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { beforeEach, describe, expect, it } from 'vitest';
import { bossNode } from '../../agents/boss-node.js';
import { managerNode } from '../../agents/manager-node.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { OffisimGraphState } from '../../graph/state.js';
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
    projectId: null,
    meetingInterrupt: null,
    dispatchedStepIndices: [],
    completedStepIndices: [],
    ...overrides,
  };
}

describe('HR routing — boss → manager → HR', () => {
  let gateway: MockLlmGateway;
  let config: RunnableConfig;

  beforeEach(() => {
    gateway = new MockLlmGateway();
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([makeManager(), makeEmployee()]);

    const eventBus = new InMemoryEventBus();
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

  describe('bossNode — hire_or_assess intent', () => {
    it('routes to delegate_manager when LLM returns hire_or_assess', async () => {
      gateway.pushResponse({
        content: JSON.stringify({
          action: 'hire_or_assess',
          reason: 'user wants to hire a designer',
        }),
      });

      const state = makeState({
        messages: [new HumanMessage('I need to hire a new designer')],
      });
      const result = await bossNode(state, config);

      expect(result.routeDecision).toBe('delegate_manager');
    });

    it('still routes delegate for non-hiring delegate requests', async () => {
      gateway.pushResponse({
        content: JSON.stringify({ action: 'delegate', reason: 'needs coding' }),
      });

      const state = makeState();
      const result = await bossNode(state, config);

      expect(result.routeDecision).toBe('delegate_manager');
    });
  });

  describe('managerNode — hire/assess_team constraints', () => {
    it('sets constraints=hire when LLM returns hire intent', async () => {
      gateway.pushResponse({
        content: JSON.stringify({
          intent: 'hire',
          assignments: [],
        }),
      });

      const state = makeState({
        messages: [new HumanMessage('Hire a new frontend developer')],
      });
      const result = await managerNode(state, config);

      expect(result.managerDirective).toBeDefined();
      expect(result.managerDirective?.constraints).toBe('hire');
    });

    it('sets constraints=assess_team when LLM returns assess_team intent', async () => {
      gateway.pushResponse({
        content: JSON.stringify({
          intent: 'assess_team',
          assignments: [],
        }),
      });

      const state = makeState({
        messages: [new HumanMessage('What roles are we missing on our team?')],
      });
      const result = await managerNode(state, config);

      expect(result.managerDirective).toBeDefined();
      expect(result.managerDirective?.constraints).toBe('assess_team');
    });

    it('leaves constraints undefined for normal work intent', async () => {
      gateway.pushResponse({
        content: JSON.stringify({
          intent: 'work',
          assignments: [
            {
              taskType: 'code',
              employeeId: 'emp-alice',
              description: 'Build a website',
            },
          ],
        }),
      });

      const state = makeState();
      const result = await managerNode(state, config);

      expect(result.managerDirective).toBeDefined();
      expect(result.managerDirective?.constraints).toBeUndefined();
    });

    it('defaults to work intent when intent field is missing', async () => {
      gateway.pushResponse({
        content: JSON.stringify({
          assignments: [
            {
              taskType: 'general',
              employeeId: 'emp-alice',
              description: 'Do something',
            },
          ],
        }),
      });

      const state = makeState();
      const result = await managerNode(state, config);

      expect(result.managerDirective).toBeDefined();
      expect(result.managerDirective?.constraints).toBeUndefined();
    });

    it('hire intent works even without assignments array', async () => {
      gateway.pushResponse({
        content: JSON.stringify({
          intent: 'hire',
        }),
      });

      const state = makeState({
        messages: [new HumanMessage('We need to recruit more engineers')],
      });
      const result = await managerNode(state, config);

      expect(result.managerDirective).toBeDefined();
      expect(result.managerDirective?.constraints).toBe('hire');
    });
  });
});
