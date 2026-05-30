import type { InteractionRequest, RuntimePolicyConfig } from '@offisim/shared-types';
import type { EngineAdapterRegistry } from '../engine/engine-adapter.js';
import type { EventBus } from '../events/event-bus.js';
import type { MeetingInterrupt } from '../graph/state.js';
import type { LlmGateway } from '../llm/gateway.js';
import type { ModelRegistry } from '../llm/model-registry.js';
import type { ModelResolver } from '../llm/model-resolver.js';
import type { RecordedSystemLlmCaller } from '../llm/recorded-system-caller.js';
import type { LlmMiddlewareChain } from '../middleware/chain.js';
import type { RollingJournal } from '../services/conversation-budget/rolling-journal.js';
import type { FileHistoryService } from '../services/file-history-service.js';
import type { InteractionService } from '../services/interaction-service.js';
import type { MemoryService } from '../services/memory-service.js';
import type { ToolTelemetryService } from '../services/tool-telemetry-service.js';
import type { WorkstationToolResolver } from '../services/workstation-tool-resolver.js';
import type { SkillInstallEnvironment } from '../skills/skill-install-environment.js';
import type { SkillLoader } from '../skills/skill-loader.js';
import type { SkillStagingManager } from '../skills/skill-staging.js';
import type { BuiltinTool } from '../tools/builtin/types.js';
import type { AttachmentStoreBridge } from './attachment-store-bridge.js';
import { HookRegistry } from './hook-registry.js';
import type { RuntimeRepositories } from './repositories.js';
import type { ResumeCoordinator } from './resume-coordinator.js';
import { RunConversationState } from './run-conversation-state.js';
import type { RunConversationState as RunConversationStateType } from './run-conversation-state.js';
import { Scratchpad } from './scratchpad.js';
import type { ToolExecutor } from './tool-executor.js';

/**
 * Mutable container for meeting interrupts.
 * Set by boss via OrchestrationService.interruptMeeting(),
 * consumed by participantTurnNode after each LLM turn.
 */
export interface MeetingInterruptBox {
  pending: MeetingInterrupt | null;
}

export interface InteractionBox {
  pending: InteractionRequest | null;
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
  /** Mutable box for user-visible decision requests. */
  readonly interactionBox: InteractionBox;
  /** Optional middleware chain for LLM call pre/post processing. */
  readonly middlewareChain?: LlmMiddlewareChain;
  /** Config-driven model catalog. Registry owns gateway lifecycle for registered models. */
  readonly modelRegistry?: ModelRegistry;
  /** Recorded caller for system services — provides audit trail for background LLM calls. */
  readonly systemCaller?: RecordedSystemLlmCaller;
  /** Live tool execution telemetry buffer. */
  readonly toolTelemetryService?: ToolTelemetryService;
  /**
   * Whether the active LLM transport can execute Offisim tool calls for this
   * runtime. Unverified SDK-backed model transports are not tool-capable;
   * employee profiles need separate bridge evidence before schemas are exposed.
   */
  readonly llmToolCallsEnabled?: boolean;
  /** Desktop-trusted built-in file/shell tools exposed outside workstation MCP scoping. */
  readonly builtinTools?: ReadonlyMap<string, BuiltinTool>;
  /** File mutation snapshot and rewind support for desktop-trusted runtimes. */
  readonly fileHistoryService?: FileHistoryService;
  /** Trusted runtime engine adapters for per-employee engine mode. */
  readonly engineAdapters?: EngineAdapterRegistry;
  /** Human-in-the-loop interaction controller. */
  readonly interactionService?: InteractionService;
  /** Long-running thread journal with a stable first user objective anchor. */
  readonly rollingJournal?: RollingJournal;
  /** Reloads latest checkpoint snapshots after reconnects or host restarts. */
  readonly resumeCoordinator?: ResumeCoordinator;
  /** Optional lifecycle hook registry for graph/task/interaction instrumentation. */
  readonly hookRegistry: HookRegistry;
  /** Run-scoped conversation state for default harness turns. */
  readonly conversationState: RunConversationStateType;
  /** Shared in-memory scratchpad for cross-node planning notes. */
  readonly scratchpad: Scratchpad;
  /** Progressive-disclosure skill loader; optional until the skill foundation is available. */
  readonly skillLoader?: SkillLoader;
  /** Process-scoped staging for in-flight agent-mediated skill installs. */
  readonly skillStagingManager?: SkillStagingManager;
  /**
   * Runtime environment for the four skill-install tools (git / upload /
   * claude-code / codex). Web leaves `clone` / `localDir` undefined so
   * desktop-only paths gracefully return `not-supported-in-web`.
   */
  readonly skillInstallEnvironment?: SkillInstallEnvironment;
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
  readonly modelRegistry?: { disposeAll: () => void };
  readonly scratchpad?: { clear: () => void };
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
  d.scratchpad?.clear();
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
  interactionBox?: InteractionBox;
  middlewareChain?: LlmMiddlewareChain;
  modelRegistry?: ModelRegistry;
  systemCaller?: RecordedSystemLlmCaller;
  toolTelemetryService?: ToolTelemetryService;
  llmToolCallsEnabled?: boolean;
  builtinTools?: ReadonlyMap<string, BuiltinTool>;
  fileHistoryService?: FileHistoryService;
  engineAdapters?: EngineAdapterRegistry;
  interactionService?: InteractionService;
  rollingJournal?: RollingJournal;
  resumeCoordinator?: ResumeCoordinator;
  hookRegistry?: HookRegistry;
  conversationState?: RunConversationStateType;
  scratchpad?: Scratchpad;
  skillLoader?: SkillLoader;
  skillStagingManager?: SkillStagingManager;
  skillInstallEnvironment?: SkillInstallEnvironment;
  attachmentStoreBridge?: AttachmentStoreBridge;
  determinism?: RuntimeDeterminism;
}): RuntimeContext {
  const {
    meetingInterruptBox,
    interactionBox,
    hookRegistry,
    conversationState,
    scratchpad,
    determinism,
    ...rest
  } = deps;
  return Object.freeze({
    ...rest,
    meetingInterruptBox: meetingInterruptBox ?? { pending: null },
    interactionBox: interactionBox ?? { pending: null },
    hookRegistry: hookRegistry ?? new HookRegistry(),
    conversationState: conversationState ?? new RunConversationState(),
    scratchpad: scratchpad ?? new Scratchpad(),
    determinism: determinism ?? defaultDeterminism,
  });
}
