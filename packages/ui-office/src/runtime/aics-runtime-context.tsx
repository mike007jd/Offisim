import type {
  EmployeeVersionService,
  EventBus,
  McpServerConfig,
  RuntimeRepositories,
} from '@aics/core/browser';
import type { InstallService } from '@aics/install-core';
import { createContext, useContext } from 'react';

export interface AicsRuntimeValue {
  eventBus: EventBus;
  isReady: boolean;
  isRunning: boolean;
  error: string | null;
  sendMessage: (
    text: string,
    options?: { targetEmployeeId?: string },
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
}

export const AicsRuntimeContext = createContext<AicsRuntimeValue | null>(null);

export function useAicsRuntime(): AicsRuntimeValue {
  const ctx = useContext(AicsRuntimeContext);
  if (!ctx) throw new Error('useAicsRuntime must be used within <AicsRuntimeProvider>');
  return ctx;
}
