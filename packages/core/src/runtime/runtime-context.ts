import type { EventBus } from '../events/event-bus.js';
import type { LlmGateway } from '../llm/gateway.js';
import type { ModelResolver } from '../llm/model-resolver.js';
import type { RuntimeRepositories } from './repositories.js';
import type { ToolExecutor } from './tool-executor.js';

export interface RuntimeContext {
  readonly repos: RuntimeRepositories;
  readonly eventBus: EventBus;
  readonly llmGateway: LlmGateway;
  readonly modelResolver: ModelResolver;
  readonly toolExecutor: ToolExecutor;
  readonly companyId: string;
  readonly threadId: string;
}

export function createRuntimeContext(deps: {
  repos: RuntimeRepositories;
  eventBus: EventBus;
  llmGateway: LlmGateway;
  modelResolver: ModelResolver;
  toolExecutor: ToolExecutor;
  companyId: string;
  threadId: string;
}): RuntimeContext {
  return Object.freeze(deps);
}
