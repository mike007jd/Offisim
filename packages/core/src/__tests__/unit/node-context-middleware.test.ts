import { describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { NodeContextMiddleware } from '../../middleware/builtin/node-context-middleware.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { TEST_COMPANY, TEST_COMPANY_ID, TEST_THREAD_ID } from '../helpers/fixtures.js';
import { MockLlmGateway } from '../helpers/mock-gateway.js';

const DEFAULT_MODEL_POLICY_JSON = TEST_COMPANY.default_model_policy_json;
if (!DEFAULT_MODEL_POLICY_JSON) {
  throw new Error('TEST_COMPANY.default_model_policy_json must be defined');
}

describe('NodeContextMiddleware', () => {
  it('injects recent node summaries into the first system message', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    await repos.nodeSummaries.create({
      summary_id: 'ns-1',
      thread_id: TEST_THREAD_ID,
      company_id: TEST_COMPANY_ID,
      node_name: 'boss',
      employee_id: null,
      step_index: null,
      summary_text: 'Boss routed to manager.',
      decisions_json: '[]',
      files_touched_json: '[]',
      tools_used_json: '[]',
      input_token_count: 4,
      output_token_count: 3,
      message_count: 1,
      duration_ms: 20,
      created_at: '2026-04-01T00:00:00.000Z',
    });

    const runtimeCtx = createRuntimeContext({
      repos,
      eventBus: new InMemoryEventBus(),
      llmGateway: new MockLlmGateway(),
      modelResolver: new ModelResolver(JSON.parse(DEFAULT_MODEL_POLICY_JSON)),
      toolExecutor: new MockToolExecutor(),
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
    });

    const middleware = new NodeContextMiddleware(repos.nodeSummaries);
    const result = await middleware.before({
      request: {
        model: 'test-model',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'What happened earlier?' },
        ],
      },
      runtimeCtx,
      meta: { nodeName: 'boss', provider: 'test', model: 'test-model' },
      extras: {},
    });

    expect(result.request.messages[0]?.content).toContain('## Execution Context');
    expect(result.request.messages[0]?.content).toContain('Boss routed to manager.');
  });

  it('caps injected node context length', async () => {
    const repos = createMemoryRepositories();
    repos.seed.companies([TEST_COMPANY]);
    for (let index = 0; index < 8; index++) {
      await repos.nodeSummaries.create({
        summary_id: `ns-${index}`,
        thread_id: TEST_THREAD_ID,
        company_id: TEST_COMPANY_ID,
        node_name: 'employee',
        employee_id: 'e-dev-1',
        step_index: index,
        summary_text: `Summary ${index}: ${'detail '.repeat(40)}`,
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
      modelResolver: new ModelResolver(JSON.parse(DEFAULT_MODEL_POLICY_JSON)),
      toolExecutor: new MockToolExecutor(),
      companyId: TEST_COMPANY_ID,
      threadId: TEST_THREAD_ID,
    });

    const middleware = new NodeContextMiddleware(repos.nodeSummaries, {
      maxSummaries: 6,
      maxChars: 300,
    });
    const result = await middleware.before({
      request: {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Continue the task.' }],
      },
      runtimeCtx,
      meta: { nodeName: 'employee', provider: 'test', model: 'test-model' },
      extras: {},
    });

    expect(result.request.messages[0]?.role).toBe('system');
    expect(result.request.messages[0]?.content.length).toBeLessThanOrEqual(320);
    expect(result.request.messages[0]?.content).not.toContain('Summary 0');
  });
});
