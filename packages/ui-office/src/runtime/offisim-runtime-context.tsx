import type {
  EmployeeVersionService,
  EventBus,
  McpServerConfig,
  MemoryRepositoriesSnapshot,
  RuntimeRepositories,
  SkillLoader,
  ToolTelemetryService,
} from '@offisim/core/browser';
import type { InstallService } from '@offisim/install-core';
import type {
  EmployeeRuntimeBinding,
  EngineId,
  InteractionMode,
  InteractionRequest,
  RuntimeEvent,
} from '@offisim/shared-types';
import { createContext, useContext } from 'react';
import type { RunScope } from '../components/chat/chat-session-store';
import type { AttachmentStore } from '../lib/attachment-store.js';
import type { DeliverableHookRow } from '../lib/deliverable-artifacts.js';
import type { SceneIntentBus } from './scene-intents.js';

// ---------------------------------------------------------------------------
// Stable context — values that change infrequently (repos, eventBus, etc.)
// ---------------------------------------------------------------------------

export interface OffisimRuntimeBootstrapState {
  reposSnapshot: MemoryRepositoriesSnapshot | null;
  eventHistory: RuntimeEvent[];
}

export interface FailedRunErrorState {
  message: string;
  targetEmployeeId?: string;
  threadId?: string;
  conversationKey: string;
}

export type SendMessageResult =
  | { kind: 'assistant'; content: string }
  | { kind: 'system'; content: string };

export type VaultDirectoryMode =
  | 'unsupported'
  | 'unmounted'
  | 'needs-permission'
  | 'error'
  | 'mounted';

export interface VaultDirectoryStatus {
  supported: boolean;
  mode: VaultDirectoryMode;
  directoryName: string | null;
  root?: string | null;
  errorMessage?: string | null;
}

export interface OffisimRuntimeValue {
  eventBus: EventBus;
  sceneIntentBus?: SceneIntentBus;
  isReady: boolean;
  /** For re-render optimization prefer `useOffisimRuntimeStatus().isRunning` (dedicated volatile context). */
  isRunning: boolean;
  error: string | null;
  failedRunError: FailedRunErrorState | null;
  sendMessage: (
    text: string,
    options?: {
      targetEmployeeId?: string;
      threadId?: string;
      /** Active project id; written into graph_threads.project_id + OffisimGraphState.projectId. */
      projectId?: string | null;
      entryMode?: 'boss_chat' | 'direct_chat' | 'meeting';
      conversationKey?: string;
      /** Per-execution chat run scope; threaded into graph config.configurable.runScope. */
      runScope?: RunScope;
    },
  ) => Promise<SendMessageResult | undefined>;
  retryLastMessage: (options?: { runScope?: RunScope }) => Promise<SendMessageResult | undefined>;
  clearError: () => void;
  /** Re-create runtime from current localStorage config. */
  reinitRuntime: () => void;
  /** Install service — null only during bootstrap / in tauri-runtime-lite mode. */
  installService: InstallService | null;
  /** Runtime repositories — null when runtime is not yet ready. */
  repos: RuntimeRepositories | null;
  /**
   * Shared EmployeeVersionService instance — created once per runtime lifecycle
   * to avoid duplicating stateless service instances across hooks.
   */
  employeeVersionService: EmployeeVersionService | null;
  /** Tool execution telemetry service — null when runtime not ready. */
  toolTelemetryService: ToolTelemetryService | null;
  /** Progressive-disclosure skill loader — null when runtime not ready or vault not activated. */
  skillLoader: SkillLoader | null;
  /** Connect an MCP server. Returns tool count on success; throws on failure. */
  connectMcpServer: (config: McpServerConfig) => Promise<number>;
  /** Disconnect an MCP server by name. */
  disconnectMcpServer: (name: string) => Promise<void>;
  /** Set of currently connected MCP server names. */
  connectedMcpServers: ReadonlySet<string>;
  /** Abort the currently-running execution for the active thread. No-op if nothing is running. */
  abortExecution: () => void;
  /** Threads detected as 'running' on startup (app crashed mid-execution). */
  unfinishedThreads: ReadonlyArray<{ threadId: string; projectName: string }>;
  /** Dismiss the unfinished-thread banner without resuming. */
  dismissUnfinishedThreads: () => void;
  /**
   * Resume a thread that was left in 'running' status.
   * Re-invokes the graph with background_sync entryMode on the given threadId.
   */
  resumeThread: (threadId: string) => Promise<void>;
  /** Synchronous browser bootstrap data used before async runtime init finishes. */
  bootstrapState?: OffisimRuntimeBootstrapState | null;
  /** Active interaction mode for the current thread. */
  interactionMode?: InteractionMode;
  /** Pending human-in-the-loop request, if any. */
  pendingInteraction?: InteractionRequest | null;
  /** Switch interaction mode for future requests. */
  setInteractionMode?: (mode: InteractionMode) => void;
  /** Resolve the currently pending interaction request. */
  respondToInteraction?: (
    selectedOptionId: string,
    freeformResponse?: string,
    options?: { runScope?: RunScope },
  ) => Promise<SendMessageResult | undefined>;
  /**
   * List persisted deliverables for the active company, newest first.
   * Summary-shape rows: `content` is empty until `loadDeliverableContent(id)` hydrates it.
   * Returns `[]` when `repos.deliverables` is unavailable (e.g. browser-only session).
   */
  listRecentDeliverables?: (opts?: {
    threadId?: string;
    limit?: number;
  }) => Promise<DeliverableHookRow[]>;
  /**
   * Lazy-load full content for a summary-shape deliverable row.
   * Returns `null` when the row is absent from storage.
   */
  loadDeliverableContent?: (deliverableId: string) => Promise<DeliverableHookRow | null>;
  /** Desktop-only local vault root. Null in browser mode. */
  desktopVaultRoot?: string | null;
  /** Browser-only live vault status / controls. Undefined in desktop mode. */
  getVaultDirectoryStatus?: () => Promise<VaultDirectoryStatus>;
  mountVaultDirectory?: (handle?: FileSystemDirectoryHandle) => Promise<VaultDirectoryStatus>;
  unmountVaultDirectory?: () => Promise<VaultDirectoryStatus>;
  exportVaultSnapshotZip?: () => Promise<void>;
  /**
   * Engine adapter IDs registered in the active runtime. Empty in browser; trusted
   * desktop runtime publishes the IDs whose adapter is reachable. UI binding
   * surfaces gate engine choices on this set rather than branching on platform.
   */
  availableEngineAdapters: ReadonlySet<EngineId>;
  /**
   * Company-level employee runtime default surfaced from the active runtime
   * policy. `null` when the policy omits it (resolver falls through to provider).
   */
  companyEmployeeRuntimeDefault: EmployeeRuntimeBinding | null;
  /**
   * Per-platform chat attachment persistence + read backend. Wired by the
   * runtime factories (`browser-runtime.ts` → `WebAttachmentStore`,
   * `tauri-runtime.ts` → `TauriAttachmentStore`); shared by composer staging,
   * the gateway-lane `read_attachment` tool, the bubble eviction probe, and
   * the boot-time GC sweeper. Null in `tauri-runtime-lite` mode and during
   * pre-runtime bootstrap.
   */
  attachmentStore: AttachmentStore | null;
}

export const OffisimRuntimeContext = createContext<OffisimRuntimeValue | null>(null);

export function useOffisimRuntime(): OffisimRuntimeValue {
  const ctx = useContext(OffisimRuntimeContext);
  if (!ctx) throw new Error('useOffisimRuntime must be used within <OffisimRuntimeProvider>');
  return ctx;
}

export const EMPTY_ENGINE_ADAPTERS: ReadonlySet<EngineId> = Object.freeze(new Set<EngineId>());

/**
 * Available engine adapter IDs in the current runtime. Safe to call before
 * the runtime is ready — returns an empty set instead of throwing. The
 * provider keeps the underlying Set referentially stable across runtime
 * recomputes when the adapter list is unchanged, so no `useMemo` wrapper is
 * needed here.
 */
export function useAvailableEngineAdapters(): ReadonlySet<EngineId> {
  const ctx = useContext(OffisimRuntimeContext);
  return ctx?.availableEngineAdapters ?? EMPTY_ENGINE_ADAPTERS;
}

/**
 * Company-level employee runtime default. `null` when the runtime is not yet
 * ready or the policy omits the field.
 */
export function useCompanyEmployeeRuntimeDefault(): EmployeeRuntimeBinding | null {
  const ctx = useContext(OffisimRuntimeContext);
  return ctx?.companyEmployeeRuntimeDefault ?? null;
}

// ---------------------------------------------------------------------------
// Volatile status context — values that change on every task execution.
// Components that only need isRunning/version should use this context
// to avoid re-rendering when stable values are unchanged.
// ---------------------------------------------------------------------------

export interface OffisimRuntimeStatusValue {
  isRunning: boolean;
  /** Internal version counter — bumped on reinitRuntime(). */
  version: number;
}

export const OffisimRuntimeStatusContext = createContext<OffisimRuntimeStatusValue>({
  isRunning: false,
  version: 0,
});

/**
 * Returns volatile runtime status (isRunning, version).
 * Prefer this over `useOffisimRuntime().isRunning` in components that don't need
 * repos/eventBus/sendMessage — it avoids unnecessary re-renders when those
 * stable values haven't changed.
 */
export function useOffisimRuntimeStatus(): OffisimRuntimeStatusValue {
  return useContext(OffisimRuntimeStatusContext);
}
