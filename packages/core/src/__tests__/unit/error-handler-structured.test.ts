import type { RuntimeEvent } from '@aics/shared-types';
import { HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import { beforeEach, describe, expect, it } from 'vitest';
import { errorHandlerNode } from '../../agents/error-handler-node.js';
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
    replanCount: 0,
    projectId: null,
    meetingInterrupt: null,
    dispatchedStepIndices: [],
    completedStepIndices: [],
    ...overrides,
  };
}

describe('errorHandlerNode — structured error parsing', () => {
  let config: RunnableConfig;
  // biome-ignore lint/suspicious/noExplicitAny: event collector captures all payload types
  let events: RuntimeEvent<any>[];

  beforeEach(() => {
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    repos.seed.employees([makeManager(), makeEmployee()]);

    const eventBus = new InMemoryEventBus();
    events = [];
    eventBus.on('', (e) => events.push(e));

    const gateway = new MockLlmGateway();
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

  it('parses structured JSON interruptReason and emits error.occurred event', async () => {
    const structuredError = JSON.stringify({
      errorCode: 'LLM_CALL_FAILED',
      message: 'Rate limit exceeded',
      recoverable: true,
      nodeName: 'employee',
      employeeId: 'e-dev-1',
      taskRunId: 'tr-test-1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    });

    const state = makeState({ interruptReason: structuredError });
    const result = await errorHandlerNode(state, config);

    // Should complete and clear interruptReason
    expect(result.completed).toBe(true);
    expect(result.interruptReason).toBeNull();

    // Message should include the error code and recoverability hint
    const msg = result.messages![0]!.content as string;
    expect(msg).toContain('LLM_CALL_FAILED');
    expect(msg).toContain('Rate limit exceeded');
    expect(msg).toContain('recoverable');

    // Should emit error.occurred event
    const errorEvents = events.filter((e) => e.type === 'error.occurred');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.payload.errorCode).toBe('LLM_CALL_FAILED');
    expect(errorEvents[0]!.payload.message).toBe('Rate limit exceeded');
    expect(errorEvents[0]!.payload.recoverable).toBe(true);
    expect(errorEvents[0]!.payload.nodeName).toBe('employee');
    expect(errorEvents[0]!.payload.employeeId).toBe('e-dev-1');
    expect(errorEvents[0]!.payload.taskRunId).toBe('tr-test-1');
    expect(errorEvents[0]!.payload.provider).toBe('anthropic');
    expect(errorEvents[0]!.payload.model).toBe('claude-sonnet-4-20250514');
  });

  it('handles non-recoverable structured error', async () => {
    const structuredError = JSON.stringify({
      errorCode: 'INVALID_API_KEY',
      message: 'Authentication failed',
      recoverable: false,
      nodeName: 'employee',
    });

    const state = makeState({ interruptReason: structuredError });
    const result = await errorHandlerNode(state, config);

    const msg = result.messages![0]!.content as string;
    expect(msg).toContain('not recoverable');

    const errorEvents = events.filter((e) => e.type === 'error.occurred');
    expect(errorEvents[0]!.payload.recoverable).toBe(false);
  });

  it('falls back to UNKNOWN_ERROR for plain string interruptReason', async () => {
    const state = makeState({ interruptReason: 'Something went wrong unexpectedly' });
    const result = await errorHandlerNode(state, config);

    expect(result.completed).toBe(true);
    expect(result.interruptReason).toBeNull();

    const msg = result.messages![0]!.content as string;
    expect(msg).toContain('Something went wrong unexpectedly');
    expect(msg).toContain('recoverable');

    // Should emit error.occurred with UNKNOWN_ERROR
    const errorEvents = events.filter((e) => e.type === 'error.occurred');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.payload.errorCode).toBe('UNKNOWN_ERROR');
    expect(errorEvents[0]!.payload.recoverable).toBe(true);
    expect(errorEvents[0]!.payload.nodeName).toBe('unknown');
  });

  it('falls back to UNKNOWN_ERROR for invalid JSON interruptReason', async () => {
    const state = makeState({ interruptReason: '{ broken json here' });
    await errorHandlerNode(state, config);

    const errorEvents = events.filter((e) => e.type === 'error.occurred');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.payload.errorCode).toBe('UNKNOWN_ERROR');
  });

  it('falls back to UNKNOWN_ERROR for JSON without errorCode field', async () => {
    const state = makeState({ interruptReason: JSON.stringify({ foo: 'bar' }) });
    await errorHandlerNode(state, config);

    const errorEvents = events.filter((e) => e.type === 'error.occurred');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.payload.errorCode).toBe('UNKNOWN_ERROR');
  });

  it('handles null interruptReason gracefully', async () => {
    const state = makeState({ interruptReason: null });
    const result = await errorHandlerNode(state, config);

    expect(result.completed).toBe(true);
    // Falls through to plain string path with 'An unknown error occurred'
    const errorEvents = events.filter((e) => e.type === 'error.occurred');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]!.payload.errorCode).toBe('UNKNOWN_ERROR');
  });
});
