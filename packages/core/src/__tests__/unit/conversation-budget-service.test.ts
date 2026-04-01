import type { RuntimeEvent } from '@offisim/shared-types';
import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { LlmGateway, LlmRequest, LlmStreamChunk } from '../../llm/gateway.js';
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

class ThrowingLlmGateway implements LlmGateway {
  private attempts = 0;

  get callCount(): number {
    return this.attempts;
  }

  async chat(): Promise<never> {
    this.attempts += 1;
    throw new Error('LLM unavailable');
  }

  chatStream(): AsyncIterable<LlmStreamChunk> {
    throw new Error('not implemented');
  }

  dispose(): void {}
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
    await expect(repos.compactSummaries.listByThread(TEST_THREAD_ID)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          compact_kind: 'thread_synopsis',
          summary_source: 'llm',
          messages_compacted: persistedSynopsis?.prunedMessageCount ?? 0,
        }),
      ]),
    );
    expect(runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'conversation.synopsis.updated',
          payload: expect.objectContaining({
            version: 1,
            prunedMessageCount: persistedSynopsis?.prunedMessageCount,
            totalMessageCount: persistedSynopsis?.totalMessageCount,
          }),
        }),
      ]),
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

  it('trims to keepRecentMessages even before synopsis generation kicks in', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    await repos.threads.create({
      thread_id: TEST_THREAD_ID,
      company_id: TEST_COMPANY_ID,
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
    });

    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus: new InMemoryEventBus(),
      llmGateway: new MockLlmGateway(),
      modelResolver: new ModelResolver(DEFAULT_MODEL_POLICY),
      toolExecutor: new MockToolExecutor(),
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      runtimePolicy: {
        executionMode: 'desktop-trusted',
        modelPolicy: DEFAULT_MODEL_POLICY,
        summarization: {
          enabled: true,
          triggerTokens: 999_999,
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

    const prepared = await new ConversationBudgetService().prepareRequest(runtimeCtx, {
      model: 'test',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        ...Array.from({ length: 12 }, (_, index) => ({
          role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
          content: `Turn ${index} about rollout safety`,
        })),
      ],
    });

    expect(prepared.messages.filter((message) => message.role !== 'system')).toHaveLength(4);
  });

  it('micro-compacts old tool results before request pruning', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    await repos.threads.create({
      thread_id: TEST_THREAD_ID,
      company_id: TEST_COMPANY_ID,
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
    });

    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus: new InMemoryEventBus(),
      llmGateway: new MockLlmGateway(),
      modelResolver: new ModelResolver(DEFAULT_MODEL_POLICY),
      toolExecutor: new MockToolExecutor(),
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      runtimePolicy: {
        executionMode: 'desktop-trusted',
        modelPolicy: DEFAULT_MODEL_POLICY,
        summarization: {
          enabled: true,
          triggerTokens: 999_999,
          keepRecentMessages: 12,
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

    const prepared = await new ConversationBudgetService({
      maxNonSystemMessages: 12,
      tailNonSystemMessages: 12,
      toolResultKeepRecent: 1,
      toolResultMaxContentChars: 32,
    }).prepareRequest(runtimeCtx, {
      model: 'test',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'assistant', content: 'Running tool batch' },
        { role: 'tool', content: 'A'.repeat(120), toolCallId: 'tool-old' },
        { role: 'user', content: 'continue' },
        { role: 'tool', content: 'B'.repeat(120), toolCallId: 'tool-new' },
      ],
    });

    const oldToolMessage = prepared.messages.find((message) => message.toolCallId === 'tool-old');
    const newToolMessage = prepared.messages.find((message) => message.toolCallId === 'tool-new');

    expect(oldToolMessage?.content).toContain('[tool result compacted');
    expect(newToolMessage?.content).toBe('B'.repeat(120));
  });

  it('triggers synopsis generation with a padded token estimate', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    await repos.threads.create({
      thread_id: TEST_THREAD_ID,
      company_id: TEST_COMPANY_ID,
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
    });

    const gateway = new MockLlmGateway();
    gateway.pushResponse({
      content: 'Padded token estimation should trigger this synopsis.',
    });

    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus: new InMemoryEventBus(),
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
          triggerTokens: 40,
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

    await new ConversationBudgetService({
      maxNonSystemMessages: 4,
      tailNonSystemMessages: 4,
      synopsisTriggerMessages: 4,
    }).prepareRequest(runtimeCtx, {
      model: 'test',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        ...Array.from({ length: 6 }, (_, index) => ({
          role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
          content: '123456789012345678901234',
        })),
      ],
    });

    const thread = await repos.threads.findById(TEST_THREAD_ID);
    expect(thread?.synopsis_json).toContain('Padded token estimation');
  });

  it('keeps fewer tail messages when node summaries already exist', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    await repos.threads.create({
      thread_id: TEST_THREAD_ID,
      company_id: TEST_COMPANY_ID,
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
    });
    for (let index = 0; index < 4; index++) {
      await repos.nodeSummaries.create({
        summary_id: `ns-${index}`,
        thread_id: TEST_THREAD_ID,
        company_id: TEST_COMPANY_ID,
        node_name: 'employee',
        employee_id: 'e-dev-1',
        step_index: index,
        summary_text: `Summary ${index}`,
        decisions_json: '[]',
        files_touched_json: '[]',
        tools_used_json: '[]',
        input_token_count: 0,
        output_token_count: 0,
        message_count: 1,
        duration_ms: 10,
        created_at: new Date(Date.UTC(2026, 3, 1, 0, index, 0)).toISOString(),
      });
    }

    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus: new InMemoryEventBus(),
      llmGateway: new MockLlmGateway(),
      modelResolver: new ModelResolver(DEFAULT_MODEL_POLICY),
      toolExecutor: new MockToolExecutor(),
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
      runtimePolicy: {
        executionMode: 'desktop-trusted',
        modelPolicy: DEFAULT_MODEL_POLICY,
        summarization: {
          enabled: true,
          triggerTokens: 999_999,
          keepRecentMessages: 30,
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

    const prepared = await new ConversationBudgetService({
      maxNonSystemMessages: 30,
      tailNonSystemMessages: 30,
    }).prepareRequest(runtimeCtx, {
      model: 'test',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        ...Array.from({ length: 28 }, (_, index) => ({
          role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
          content: `Turn ${index} about rollout safety`,
        })),
      ],
    });

    expect(prepared.messages.filter((message) => message.role !== 'system')).toHaveLength(20);
  });

  it('trims old node summaries after a full compact persists a synopsis artifact', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    await repos.threads.create({
      thread_id: TEST_THREAD_ID,
      company_id: TEST_COMPANY_ID,
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
    });
    for (let index = 0; index < 16; index++) {
      await repos.nodeSummaries.create({
        summary_id: `ns-cleanup-${index}`,
        thread_id: TEST_THREAD_ID,
        company_id: TEST_COMPANY_ID,
        node_name: 'employee',
        employee_id: 'e-dev-1',
        step_index: index,
        summary_text: `Summary ${index}`,
        decisions_json: '[]',
        files_touched_json: '[]',
        tools_used_json: '[]',
        input_token_count: 0,
        output_token_count: 0,
        message_count: 1,
        duration_ms: 10,
        created_at: new Date(Date.UTC(2026, 3, 1, 0, index, 0)).toISOString(),
      });
    }

    const gateway = new MockLlmGateway();
    gateway.pushResponse({
      content: 'Compact completed and should trim stale node summaries.',
    });
    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus: new InMemoryEventBus(),
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
          triggerTokens: 40,
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

    await new ConversationBudgetService({
      maxNonSystemMessages: 4,
      tailNonSystemMessages: 4,
      synopsisTriggerMessages: 4,
    }).prepareRequest(runtimeCtx, {
      model: 'test',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        ...Array.from({ length: 6 }, (_, index) => ({
          role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
          content: '123456789012345678901234',
        })),
      ],
    });

    const summaries = await repos.nodeSummaries.listByThread(TEST_THREAD_ID);
    expect(summaries).toHaveLength(12);
    expect(summaries[0]?.summary_id).toBe('ns-cleanup-15');
    expect(summaries.at(-1)?.summary_id).toBe('ns-cleanup-4');
    await expect(repos.compactSummaries.listByThread(TEST_THREAD_ID)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary_source: 'llm',
          messages_compacted: 6,
        }),
      ]),
    );
  });

  it('opens a synopsis circuit breaker after repeated failures and skips the fourth LLM attempt', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    await repos.threads.create({
      thread_id: TEST_THREAD_ID,
      company_id: TEST_COMPANY_ID,
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'running',
    });

    const gateway = new ThrowingLlmGateway();
    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus: new InMemoryEventBus(),
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

    const service = new ConversationBudgetService({
      maxNonSystemMessages: 4,
      tailNonSystemMessages: 4,
      synopsisTriggerMessages: 4,
      synopsisRefreshMinMessages: 1,
    });
    const request = {
      model: 'test',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        ...Array.from({ length: 6 }, (_, index) => ({
          role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
          content: `Failure loop message ${index} with enough text to trigger synopsis refresh.`,
        })),
      ],
    } satisfies LlmRequest;

    for (let attempt = 0; attempt < 4; attempt++) {
      await service.prepareRequest(runtimeCtx, request);
      await repos.threads.updateSynopsis(TEST_THREAD_ID, null);
    }

    expect(gateway.callCount).toBe(3);
    const compactRows = await repos.compactSummaries.listByThread(TEST_THREAD_ID);
    expect(compactRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary_source: 'circuit_breaker',
          failure_streak: 3,
        }),
      ]),
    );
  });
});
