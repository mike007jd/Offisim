import type {
  EmployeeVersionService,
  EventBus,
  McpServerConfig,
  MemoryRepositoriesSnapshot,
  RuntimeRepositories,
} from '@offisim/core/browser';
import type { InstallService } from '@offisim/install-core';
import type { InteractionMode, InteractionRequest, RuntimeEvent } from '@offisim/shared-types';
import { createContext, useContext } from 'react';
import type { SceneIntentBus } from './scene-intents.js';

// ---------------------------------------------------------------------------
// Stable context — values that change infrequently (repos, eventBus, etc.)
// ---------------------------------------------------------------------------

export interface OffisimRuntimeBootstrapState {
  reposSnapshot: MemoryRepositoriesSnapshot | null;
  eventHistory: RuntimeEvent[];
}

export interface OffisimRuntimeValue {
  eventBus: EventBus;
  sceneIntentBus?: SceneIntentBus;
  isReady: boolean;
  /** @deprecated Use `useOffisimRuntimeStatus().isRunning` for re-render optimization. */
  isRunning: boolean;
  error: string | null;
  sendMessage: (
    text: string,
    options?: {
      targetEmployeeId?: string;
      threadId?: string;
      entryMode?: 'boss_chat' | 'direct_chat' | 'meeting';
    },
  ) => Promise<string | undefined>;
  retryLastMessage: () => Promise<string | undefined>;
  clearError: () => void;
  /** Re-create runtime from current localStorage config. */
  reinitRuntime: () => void;
  /** Install service — null in Tauri mode or when runtime is not yet ready. */
  installService: InstallService | null;
  /** Runtime repositories — null when runtime is not yet ready. */
  repos: RuntimeRepositories | null;
  /**
   * Shared EmployeeVersionService instance — created once per runtime lifecycle
   * to avoid duplicating stateless service instances across hooks.
   */
  employeeVersionService: EmployeeVersionService | null;
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
  ) => Promise<string | undefined>;
}

export const OffisimRuntimeContext = createContext<OffisimRuntimeValue | null>(null);

export function useOffisimRuntime(): OffisimRuntimeValue {
  const ctx = useContext(OffisimRuntimeContext);
  if (!ctx) throw new Error('useOffisimRuntime must be used within <OffisimRuntimeProvider>');
  return ctx;
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
