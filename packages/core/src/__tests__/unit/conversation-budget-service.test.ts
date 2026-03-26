import type { RuntimeEvent } from '@aics/shared-types';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { LlmRequest } from '../../llm/gateway.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import {
  ConversationBudgetService,
  type ThreadSynopsisRecord,
} from '../../services/conversation-budget-service.js';
import { TEST_COMPANY, TEST_COMPANY_ID, TEST_THREAD_ID } from '../helpers/fixtures.js';
import { MockLlmGateway } from '../helpers/mock-gateway.js';

const DEFAULT_MODEL_POLICY_JSON = TEST_COMPANY.default_model_policy_json;
if (!DEFAULT_MODEL_POLICY_JSON) {
  throw new Error('TEST_COMPANY.default_model_policy_json must be defined');
}
const DEFAULT_MODEL_POLICY = JSON.parse(DEFAULT_MODEL_POLICY_JSON);

function makeLongRequest(): LlmRequest {
  return {
    model: 'test',
    messages: [
      { role: 'system', content: 'You are helpful.' },
      ...Array.from({ length: 24 }, (_, index) => ({
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `Turn ${index} about auth rollout planning and deployment safety checks.`,
      })),
    ],
  };
}

describe('ConversationBudgetService', () => {
  it('stores a thread synopsis and injects it into the condensed request', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    await repos.threads.create({
      thread_id: TEST_THREAD_ID,
      company_id: TEST_COMPANY_ID,
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
    });

    const eventBus = new InMemoryEventBus();
    const gateway = new MockLlmGateway();
    gateway.pushResponse({
      content:
        'The earlier conversation established auth rollout sequencing, token expiry checks, and deployment guardrails.',
    });
    const runtimeEvents: RuntimeEvent[] = [];
    eventBus.on('', (event) => runtimeEvents.push(event));

    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus,
      llmGateway: gateway,
      modelResolver: new ModelResolver(DEFAULT_MODEL_POLICY),
      toolExecutor: new MockToolExecutor(),
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      runtimePolicy: {
        executionMode: 'desktop-trusted',
        modelPolicy: DEFAULT_MODEL_POLICY,
        summarization: {
          enabled: true,
          triggerTokens: 32,
          keepRecentMessages: 6,
        },
        memory: {
          enabled: true,
          injectionEnabled: true,
          maxFacts: 10,
          factConfidenceThreshold: 0.7,
        },
        toolSearch: { enabled: true },
      },
    });

    const service = new ConversationBudgetService({
      maxNonSystemMessages: 8,
      tailNonSystemMessages: 6,
      synopsisTriggerMessages: 10,
    });

    const prepared = await service.prepareRequest(runtimeCtx, makeLongRequest());
    const synopsisMessage = prepared.messages.find(
      (message) =>
        message.role === 'system' && message.content.includes('## Conversation synopsis'),
    );

    expect(prepared.messages.filter((message) => message.role !== 'system')).toHaveLength(6);
    expect(synopsisMessage?.content).toContain('auth rollout sequencing');

    const thread = await repos.threads.findById(TEST_THREAD_ID);
    const persistedSynopsis = JSON.parse(
      thread?.synopsis_json ?? 'null',
    ) as ThreadSynopsisRecord | null;
    expect(persistedSynopsis?.summary).toContain('deployment guardrails');
    expect(runtimeEvents.some((event) => event.type === 'conversation.synopsis.updated')).toBe(
      true,
    );
  });

  it('reuses an existing synopsis when the new overflow is below the refresh threshold', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    await repos.threads.create({
      thread_id: TEST_THREAD_ID,
      company_id: TEST_COMPANY_ID,
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
      synopsis_json: JSON.stringify({
        version: 1,
        summary: 'Existing summary',
        prunedMessageCount: 18,
        totalMessageCount: 24,
        updatedAt: new Date().toISOString(),
      } satisfies ThreadSynopsisRecord),
    });

    const eventBus = new InMemoryEventBus();
    const gateway = new MockLlmGateway();
    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus,
      llmGateway: gateway,
      modelResolver: new ModelResolver(DEFAULT_MODEL_POLICY),
      toolExecutor: new MockToolExecutor(),
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      runtimePolicy: {
        executionMode: 'desktop-trusted',
        modelPolicy: DEFAULT_MODEL_POLICY,
        summarization: {
          enabled: true,
          triggerTokens: 1,
          keepRecentMessages: 6,
        },
        memory: {
          enabled: true,
          injectionEnabled: true,
          maxFacts: 10,
          factConfidenceThreshold: 0.7,
        },
        toolSearch: { enabled: true },
      },
    });

    const service = new ConversationBudgetService({
      maxNonSystemMessages: 8,
      tailNonSystemMessages: 6,
      synopsisTriggerMessages: 10,
      synopsisRefreshMinMessages: 4,
    });

    const prepared = await service.prepareRequest(runtimeCtx, {
      model: 'test',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        ...Array.from({ length: 26 }, (_, index) => ({
          role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
          content: `Turn ${index}`,
        })),
      ],
    });

    expect(prepared.messages.some((message) => message.content.includes('Existing summary'))).toBe(
      true,
    );
    const thread = await repos.threads.findById(TEST_THREAD_ID);
    const persistedSynopsis = JSON.parse(
      thread?.synopsis_json ?? 'null',
    ) as ThreadSynopsisRecord | null;
    expect(persistedSynopsis?.version).toBe(1);
  });

  it('respects runtime policy when summarization is disabled', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    await repos.threads.create({
      thread_id: TEST_THREAD_ID,
      company_id: TEST_COMPANY_ID,
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
    });

    const eventBus = new InMemoryEventBus();
    const gateway = new MockLlmGateway();
    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus,
      llmGateway: gateway,
      modelResolver: new ModelResolver(DEFAULT_MODEL_POLICY),
      toolExecutor: new MockToolExecutor(),
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      runtimePolicy: {
        executionMode: 'desktop-trusted',
        modelPolicy: DEFAULT_MODEL_POLICY,
        summarization: {
          enabled: false,
          triggerTokens: 16,
          keepRecentMessages: 4,
        },
        memory: {
          enabled: true,
          injectionEnabled: true,
          maxFacts: 10,
          factConfidenceThreshold: 0.7,
        },
        toolSearch: { enabled: true },
      },
    });

    const prepared = await new ConversationBudgetService().prepareRequest(
      runtimeCtx,
      makeLongRequest(),
    );
    expect(prepared.messages.filter((message) => message.role !== 'system')).toHaveLength(4);
    expect(
      prepared.messages.some((message) => message.content.includes('Conversation synopsis')),
    ).toBe(false);

    const thread = await repos.threads.findById(TEST_THREAD_ID);
    expect(thread?.synopsis_json).toBeNull();
  });
});
