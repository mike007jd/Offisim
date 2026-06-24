import type { InteractionRequest, RuntimePolicyConfig } from '@offisim/shared-types';
import type { EventBus } from '../events/event-bus.js';
import type { LlmGateway } from '../llm/gateway.js';
import type { RecordedSystemLlmCaller } from '../llm/recorded-system-caller.js';
import type { LlmMiddlewareChain } from '../middleware/chain.js';
import type { RollingJournal } from '../services/conversation-budget/rolling-journal.js';
import type { MemoryService } from '../services/memory-service.js';
import type { WorkstationToolResolver } from '../services/workstation-tool-resolver.js';
import type { BuiltinTool } from '../tools/builtin/types.js';
import type { AttachmentStoreBridge } from './attachment-store-bridge.js';
import { HookRegistry } from './hook-registry.js';
import type { RuntimeRepositories } from './repositories.js';
import { RunConversationState } from './run-conversation-state.js';
import type { RunConversationState as RunConversationStateType } from './run-conversation-state.js';
import { Scratchpad } from './scratchpad.js';
import type { ToolExecutor } from './tool-executor.js';

export interface InteractionBox {
  pending: InteractionRequest | null;
}

export interface RuntimeSummaryModelSelector {
  resolve(companyId: string | null, roleSlug: string | null): { model: string };
}

export interface RuntimeModelRegistry {
  findById(modelId: string): { provider?: string; contextWindow?: number } | null;
  getGateway?(modelId: string): LlmGateway | null;
  recordCapacityError?(modelId: string): { id?: string; model: string } | null;
  recordSuccess?(modelId: string): void;
  disposeAll?(): void;
}

export interface RuntimeDeterminism {
  nowMs(): number;
  nowIso(): string;
  id(prefix: string): string;
  uuid(): string;
}

export const defaultDeterminism: RuntimeDeterminism = {
  nowMs: () => Date.now(),
  nowIso: () => new Date().toISOString(),
  id: (prefix) => `${prefix}-${crypto.randomUUID()}`,
  uuid: () => crypto.randomUUID(),
};

export interface RuntimeContext {
  readonly repos: RuntimeRepositories;
  readonly eventBus: EventBus;
  readonly llmGateway: LlmGateway;
  readonly summaryModelSelector?: RuntimeSummaryModelSelector;
  readonly toolExecutor: ToolExecutor;
  readonly companyId: string;
  readonly threadId: string;
  readonly runtimePolicy?: RuntimePolicyConfig;
  readonly memoryService?: MemoryService;
  /** PRD 2.3: Workstation-scoped tool resolver. */
  readonly workstationToolResolver?: WorkstationToolResolver;
  /** Mutable box for user-visible decision requests. */
  readonly interactionBox: InteractionBox;
  /** Optional middleware chain for LLM call pre/post processing. */
  readonly middlewareChain?: LlmMiddlewareChain;
  /** Legacy compatibility hook; active desktop model state is owned by Pi Agent. */
  readonly modelRegistry?: RuntimeModelRegistry;
  /** Recorded caller for system services — provides audit trail for background LLM calls. */
  readonly systemCaller?: RecordedSystemLlmCaller;
  /**
   * Whether the active LLM transport can execute Offisim tool calls for this
   * runtime. Unverified SDK-backed model transports are not tool-capable;
   * employee profiles need separate bridge evidence before schemas are exposed.
   */
  readonly llmToolCallsEnabled?: boolean;
  /** Desktop-trusted built-in file/shell tools exposed outside workstation MCP scoping. */
  readonly builtinTools?: ReadonlyMap<string, BuiltinTool>;
  /** Long-running thread journal with a stable first user objective anchor. */
  readonly rollingJournal?: RollingJournal;
  /** Optional lifecycle hook registry for task/interaction instrumentation. */
  readonly hookRegistry: HookRegistry;
  /** Run-scoped conversation state for default harness turns. */
  readonly conversationState: RunConversationStateType;
  /** Shared in-memory scratchpad for cross-node planning notes. */
  readonly scratchpad: Scratchpad;
  /**
   * Read-only bridge to the platform attachment store. When present AND
   * `llmToolCallsEnabled !== false`, the verified attachment-capable
   * `read_attachment` tool is registered on every employee + the boss tool kit.
   * SDK-backed model transports leave
   * this bound (so chat-send pre-flight can detect attachments) but the tool
   * stays unregistered because `llmToolCallsEnabled === false` short-circuits
   * the entire tool kit.
   */
  readonly attachmentStoreBridge?: AttachmentStoreBridge;
  readonly determinism: RuntimeDeterminism;
}

export interface DisposableRuntime {
  readonly llmGateway?: LlmGateway;
  readonly eventBus?: EventBus;
  readonly toolExecutor?: { dispose?: () => void | Promise<void> };
  readonly notificationBridge?: { deactivate: () => void };
  readonly modelRegistry?: { disposeAll?: () => void };
  readonly scratchpad?: { clear: () => void };
}

export function disposeRuntime(d: DisposableRuntime): void {
  d.llmGateway?.dispose();
  d.modelRegistry?.disposeAll?.();
  d.notificationBridge?.deactivate();
  if (d.toolExecutor && typeof d.toolExecutor.dispose === 'function') {
    // McpToolExecutor.dispose() is async but we fire-and-forget here —
    // the connections will be GC'd even if close() hasn't finished.
    void d.toolExecutor.dispose();
  }
  d.eventBus?.removeAll();
  d.scratchpad?.clear();
}

export function createRuntimeContext(deps: {
  repos: RuntimeRepositories;
  eventBus: EventBus;
  llmGateway: LlmGateway;
  summaryModelSelector?: RuntimeSummaryModelSelector;
  toolExecutor: ToolExecutor;
  companyId: string;
  threadId: string;
  runtimePolicy?: RuntimePolicyConfig;
  memoryService?: MemoryService;
  workstationToolResolver?: WorkstationToolResolver;
  interactionBox?: InteractionBox;
  middlewareChain?: LlmMiddlewareChain;
  modelRegistry?: RuntimeModelRegistry;
  systemCaller?: RecordedSystemLlmCaller;
  llmToolCallsEnabled?: boolean;
  builtinTools?: ReadonlyMap<string, BuiltinTool>;
  rollingJournal?: RollingJournal;
  hookRegistry?: HookRegistry;
  conversationState?: RunConversationStateType;
  scratchpad?: Scratchpad;
  attachmentStoreBridge?: AttachmentStoreBridge;
  determinism?: RuntimeDeterminism;
}): RuntimeContext {
  const { interactionBox, hookRegistry, conversationState, scratchpad, determinism, ...rest } =
    deps;
  return Object.freeze({
    ...rest,
    interactionBox: interactionBox ?? { pending: null },
    hookRegistry: hookRegistry ?? new HookRegistry(),
    conversationState: conversationState ?? new RunConversationState(),
    scratchpad: scratchpad ?? new Scratchpad(),
    determinism: determinism ?? defaultDeterminism,
  });
}
