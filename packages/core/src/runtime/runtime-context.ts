import type { RuntimePolicyConfig } from '@aics/shared-types';
import type { EventBus } from '../events/event-bus.js';
import type { MeetingInterrupt } from '../graph/state.js';
import type { LlmGateway } from '../llm/gateway.js';
import type { ModelRegistry } from '../llm/model-registry.js';
import type { ModelResolver } from '../llm/model-resolver.js';
import type { LlmMiddlewareChain } from '../middleware/chain.js';
import type { MemoryService } from '../services/memory-service.js';
import type { WorkstationToolResolver } from '../services/workstation-tool-resolver.js';
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
  readonly runtimePolicy?: RuntimePolicyConfig;
  readonly memoryService?: MemoryService;
  /** PRD 2.3: Workstation-scoped tool resolver. */
  readonly workstationToolResolver?: WorkstationToolResolver;
  /** Mutable box for boss meeting interrupts. Nodes read + clear this. */
  readonly meetingInterruptBox: MeetingInterruptBox;
  /** Optional middleware chain for LLM call pre/post processing. */
  readonly middlewareChain?: LlmMiddlewareChain;
  /** Config-driven model catalog. Registry owns gateway lifecycle for registered models. */
  readonly modelRegistry?: ModelRegistry;
}

export interface DisposableRuntime {
  readonly llmGateway?: LlmGateway;
  readonly eventBus?: EventBus;
  readonly toolExecutor?: { dispose?: () => void | Promise<void> };
  readonly notificationBridge?: { deactivate: () => void };
  readonly modelRegistry?: { disposeAll: () => void };
}

export function disposeRuntime(d: DisposableRuntime): void {
  d.llmGateway?.dispose();
  d.modelRegistry?.disposeAll();
  d.notificationBridge?.deactivate();
  if (d.toolExecutor && typeof d.toolExecutor.dispose === 'function') {
    // McpToolExecutor.dispose() is async but we fire-and-forget here —
    // the connections will be GC'd even if close() hasn't finished.
    void d.toolExecutor.dispose();
  }
  d.eventBus?.removeAll();
}

export function createRuntimeContext(deps: {
  repos: RuntimeRepositories;
  eventBus: EventBus;
  llmGateway: LlmGateway;
  modelResolver: ModelResolver;
  toolExecutor: ToolExecutor;
  companyId: string;
  threadId: string;
  runtimePolicy?: RuntimePolicyConfig;
  memoryService?: MemoryService;
  workstationToolResolver?: WorkstationToolResolver;
  meetingInterruptBox?: MeetingInterruptBox;
  middlewareChain?: LlmMiddlewareChain;
  modelRegistry?: ModelRegistry;
}): RuntimeContext {
  const { meetingInterruptBox, ...rest } = deps;
  return Object.freeze({
    ...rest,
    meetingInterruptBox: meetingInterruptBox ?? { pending: null },
  });
}
