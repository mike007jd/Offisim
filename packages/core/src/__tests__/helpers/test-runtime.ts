import type { RuntimeEvent } from '@aics/shared-types';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { buildAicsGraph } from '../../graph/main-graph.js';
import { OrchestrationService } from '../../services/orchestration-service.js';
import { MockLlmGateway } from './mock-gateway.js';
import { TEST_COMPANY, TEST_COMPANY_ID, TEST_THREAD_ID, makeEmployee, makeManager } from './fixtures.js';

export function createTestRuntime() {
  const repos = createMemoryRepositories();
  const eventBus = new InMemoryEventBus();
  const gateway = new MockLlmGateway();
  const resolver = new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json!));
  const toolExecutor = new MockToolExecutor();

  // Seed test data
  repos.seed.companies([TEST_COMPANY]);
  repos.seed.employees([makeManager(), makeEmployee()]);

  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway: gateway,
    modelResolver: resolver,
    toolExecutor,
    companyId: TEST_COMPANY_ID,
    threadId: TEST_THREAD_ID,
  });

  const graph = buildAicsGraph();
  const orchestrationService = new OrchestrationService(graph, runtimeCtx);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: RuntimeEvent<any>[] = [];
  eventBus.on('', (e) => events.push(e));

  return { graph, orchestrationService, repos, eventBus, gateway, events, runtimeCtx };
}

export function createTestRuntimeWithExtraEmployee() {
  const repos = createMemoryRepositories();
  const eventBus = new InMemoryEventBus();
  const gateway = new MockLlmGateway();
  const resolver = new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json!));
  const toolExecutor = new MockToolExecutor();

  repos.seed.companies([TEST_COMPANY]);
  repos.seed.employees([
    makeManager(),
    makeEmployee(),
    makeEmployee({
      employee_id: 'e-design-1',
      name: 'Design Bot',
      role_slug: 'designer',
      persona_json: JSON.stringify({ expertise: 'UI/UX design' }),
    }),
  ]);

  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway: gateway,
    modelResolver: resolver,
    toolExecutor,
    companyId: TEST_COMPANY_ID,
    threadId: TEST_THREAD_ID,
  });

  const graph = buildAicsGraph();
  const orchestrationService = new OrchestrationService(graph, runtimeCtx);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: RuntimeEvent<any>[] = [];
  eventBus.on('', (e) => events.push(e));

  return { graph, orchestrationService, repos, eventBus, gateway, events, runtimeCtx };
}
