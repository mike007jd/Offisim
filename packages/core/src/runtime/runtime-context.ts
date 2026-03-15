import type { EventBus } from '../events/event-bus.js';
import type { MeetingInterrupt } from '../graph/state.js';
import type { LlmGateway } from '../llm/gateway.js';
import type { ModelResolver } from '../llm/model-resolver.js';
import type { MemoryService } from '../services/memory-service.js';
import type { RuntimeRepositories } from './repositories.js';
import type { ToolExecutor } from './tool-executor.js';

/**
 * Mutable container for meeting interrupts.
 * Set by boss via OrchestrationService.interruptMeeting(),
 * consumed by participantTurnNode after each LLM turn.
 */
export interface MeetingInterruptBox {
  pending: MeetingInterrupt | null;
}

export interface RuntimeContext {
  readonly repos: RuntimeRepositories;
  readonly eventBus: EventBus;
  readonly llmGateway: LlmGateway;
  readonly modelResolver: ModelResolver;
  readonly toolExecutor: ToolExecutor;
  readonly companyId: string;
  readonly threadId: string;
  readonly memoryService?: MemoryService;
  /** Mutable box for boss meeting interrupts. Nodes read + clear this. */
  readonly meetingInterruptBox: MeetingInterruptBox;
}

export function createRuntimeContext(deps: {
  repos: RuntimeRepositories;
  eventBus: EventBus;
  llmGateway: LlmGateway;
  modelResolver: ModelResolver;
  toolExecutor: ToolExecutor;
  companyId: string;
  threadId: string;
  memoryService?: MemoryService;
  meetingInterruptBox?: MeetingInterruptBox;
}): RuntimeContext {
  const { meetingInterruptBox, ...rest } = deps;
  return Object.freeze({
    ...rest,
    meetingInterruptBox: meetingInterruptBox ?? { pending: null },
  });
}
