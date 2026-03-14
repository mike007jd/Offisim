import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { beforeEach, describe, expect, it } from 'vitest';
import { hrNode } from '../../agents/hr-node.js';
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
    messages: [new HumanMessage('We need to hire a designer')],
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
    ...overrides,
  };
}

describe('hrNode', () => {
  let gateway: MockLlmGateway;
  let config: RunnableConfig;
  let eventBus: InMemoryEventBus;

  beforeEach(() => {
    gateway = new MockLlmGateway();
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([makeManager(), makeEmployee()]);

    eventBus = new InMemoryEventBus();
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

  it('returns HR assessment for hire intent', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        assessment: 'The team lacks visual design capability. Recommend hiring a UI designer.',
        suggestedRoles: ['designer', 'ui_designer'],
      }),
    });

    const state = makeState({
      managerDirective: {
        intent: 'We need to hire a designer',
        recommendedEmployees: [],
        constraints: 'hire',
      },
    });
    const result = await hrNode(state, config);

    expect(result.hrAssessment).toContain('visual design');
    expect(result.messages).toHaveLength(1);
  });

  it('returns HR assessment for team analysis', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        assessment: 'Current team has strong development but needs QA coverage.',
        suggestedRoles: ['reviewer'],
      }),
    });

    const state = makeState({
      messages: [new HumanMessage('Analyze our team composition')],
      managerDirective: {
        intent: 'Analyze our team composition',
        recommendedEmployees: [],
        constraints: 'assess_team',
      },
    });
    const result = await hrNode(state, config);

    expect(result.hrAssessment).toContain('QA coverage');
    expect(result.messages).toHaveLength(1);
  });

  it('emits hr.assessment.started and hr.assessment.completed events', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        assessment: 'Team looks balanced.',
        suggestedRoles: [],
      }),
    });

    const events: string[] = [];
    eventBus.on('hr.', (e) => events.push(e.type));

    const state = makeState();
    await hrNode(state, config);

    expect(events).toContain('hr.assessment.started');
    expect(events).toContain('hr.assessment.completed');
  });

  it('emits hr.recommendation when suggestedRoles are present', async () => {
    gateway.pushResponse({
      content: JSON.stringify({
        assessment: 'Need a designer.',
        suggestedRoles: ['designer'],
      }),
    });

    const events: string[] = [];
    eventBus.on('hr.', (e) => events.push(e.type));

    const state = makeState({
      managerDirective: {
        intent: 'hire',
        recommendedEmployees: [],
        constraints: 'hire',
      },
    });
    await hrNode(state, config);

    expect(events).toContain('hr.recommendation');
  });

  it('handles unparseable LLM response gracefully', async () => {
    gateway.pushResponse({
      content: 'I think you need more developers on the team.',
    });

    const state = makeState();
    const result = await hrNode(state, config);

    // Falls back to raw content
    expect(result.hrAssessment).toContain('more developers');
    expect(result.messages).toHaveLength(1);
  });
});
