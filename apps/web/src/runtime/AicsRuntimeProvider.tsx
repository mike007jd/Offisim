import {
  EmployeeVersionService,
  InMemoryEventBus,
} from '@aics/core/browser';
import type { McpServerConfig } from '@aics/core/browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AicsRuntimeContext, type AicsRuntimeValue, isTauri, loadProviderConfig } from '@aics/ui-office';
import type { RuntimeBundle } from '../lib/browser-runtime';

interface Props {
  children: React.ReactNode;
}

export function AicsRuntimeProvider({ children }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [isInitializing, setIsInitializing] = useState(false);
  const [connectedMcpServers, setConnectedMcpServers] = useState<ReadonlySet<string>>(new Set());

  const runtimeRef = useRef<RuntimeBundle | null>(null);
  const initPromiseRef = useRef<Promise<RuntimeBundle | null> | null>(null);

  // ---------------------------------------------------------------------------
  // Stable EventBus — created once, shared across runtime reinitializations.
  //
  // KEY DESIGN DECISION: The EventBus is the pub/sub backbone that connects
  // core graph execution → UI hooks (useEventStream, useScene, useAgentStates).
  // By sharing ONE instance across the Provider's lifetime:
  //   1. No "EventBus churn" — hooks subscribe once, never re-subscribe
  //   2. No SceneManager mount/destroy cycles during Tauri async init
  //   3. Debug bridge always has the correct bus reference
  //   4. Runtime reinit (e.g. user changes provider) reuses the same bus
  //      — old subscriptions automatically receive events from the new runtime
  // ---------------------------------------------------------------------------
  const eventBusRef = useRef(new InMemoryEventBus());

  // Async runtime init (Tauri + browser modes — both async due to seedCostRates)
  const initRuntime = useCallback(async (): Promise<RuntimeBundle | null> => {
    const config = loadProviderConfig();
    if (!config) return null;

    const eventBus = eventBusRef.current;

    if (isTauri()) {
      const { createTauriRuntime } = await import('../lib/tauri-runtime');
      const runtime = await createTauriRuntime(config, eventBus);
      runtimeRef.current = runtime;
      return runtime;
    }

    // Browser mode — dynamically import to code-split heavy deps (LangGraph, OpenAI SDK, etc.)
    const { createBrowserRuntime } = await import('../lib/browser-runtime');
    const runtime = await createBrowserRuntime(config, eventBus);
    runtimeRef.current = runtime;
    return runtime;
  }, []);

  function getRuntime(): RuntimeBundle | null {
    return runtimeRef.current ?? null;
  }

  // Initialize runtime on mount / reinit (both Tauri and browser modes)
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is intentional — reinitRuntime() bumps it to force re-init
  useEffect(() => {
    if (!runtimeRef.current && !initPromiseRef.current) {
      setIsInitializing(true);
      initPromiseRef.current = initRuntime()
        .then((runtime) => {
          // Trigger re-render so useMemo picks up the runtime
          setIsInitializing(false);
          return runtime;
        })
        .catch((err) => {
          console.error('[Runtime] init failed:', err);
          setError(err instanceof Error ? err.message : String(err));
          setIsInitializing(false);
          return null;
        });
    }
  }, [initRuntime, version]);

  const reinitRuntime = useCallback(() => {
    // TODO: In Tauri mode, the old TauriCheckpointSaver and TauriDrizzleDb hold
    // references to the shared DB connection. Since getTauriDb() is a module-level
    // singleton, the connection survives reinit. Old eventBus subscriptions are
    // cleaned up by consuming components' useEffect return functions.
    runtimeRef.current = null;
    initPromiseRef.current = null;
    setVersion((v) => v + 1);
  }, []);

  const lastFailedMessageRef = useRef<{ text: string; targetEmployeeId?: string } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version forces fresh runtime; getRuntime is a render-scoped function that reads refs
  const sendMessage = useCallback(
    async (text: string, options?: { targetEmployeeId?: string }): Promise<string | undefined> => {
      let runtime = runtimeRef.current;

      // Wait for async init if in progress (both Tauri and browser modes)
      if (!runtime) {
        if (initPromiseRef.current) {
          runtime = await initPromiseRef.current;
        } else {
          runtime = await initRuntime();
        }
      }

      if (!runtime) {
        setError('No provider configured. Open Settings to configure.');
        return undefined;
      }

      setIsRunning(true);
      setError(null);
      lastFailedMessageRef.current = null;

      try {
        // Dynamically import OrchestrationService + HumanMessage to keep them
        // out of the initial bundle (~200 KB+ savings combined).
        const [{ OrchestrationService }, { HumanMessage }] = await Promise.all([
          import('@aics/core/dist/services/orchestration-service.js'),
          import('@langchain/core/messages'),
        ]);
        const entryMode = options?.targetEmployeeId ? 'direct_chat' : 'boss_chat';
        const orch = new OrchestrationService(runtime.graph, runtime.runtimeCtx);
        const result = await orch.execute({
          entryMode,
          messages: [new HumanMessage(text)],
          targetEmployeeId: options?.targetEmployeeId ?? null,
        });
        // Extract last AI message content from graph result
        const msgs = result.messages ?? [];
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]!;
          if (m._getType() === 'ai' && typeof m.content === 'string' && m.content) {
            return m.content;
          }
        }
        return undefined;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        lastFailedMessageRef.current = { text, targetEmployeeId: options?.targetEmployeeId };
        return undefined;
      } finally {
        setIsRunning(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- version ensures fresh runtime
    },
    [version, initRuntime],
  );

  const retryLastMessage = useCallback(async (): Promise<string | undefined> => {
    const last = lastFailedMessageRef.current;
    if (!last) return undefined;
    return sendMessage(last.text, { targetEmployeeId: last.targetEmployeeId });
  }, [sendMessage]);

  const clearError = useCallback(() => setError(null), []);

  // --- MCP server management ---
  const connectMcpServer = useCallback(async (config: McpServerConfig): Promise<number> => {
    const runtime = runtimeRef.current;
    if (!runtime?.mcpToolExecutor) {
      throw new Error('Runtime not ready — cannot connect MCP server.');
    }
    await runtime.mcpToolExecutor.addServer(config);
    setConnectedMcpServers((prev) => new Set([...prev, config.name]));
    // Return tool count — serverCount is available but we want tool count
    // Approximation: return serverCount as a signal that connection succeeded
    return runtime.mcpToolExecutor.serverCount;
  }, []);

  const disconnectMcpServer = useCallback(async (name: string): Promise<void> => {
    const runtime = runtimeRef.current;
    if (!runtime?.mcpToolExecutor) return;
    await runtime.mcpToolExecutor.removeServer(name);
    setConnectedMcpServers((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }, []);

  // Auto-connect saved MCP servers on runtime init
  // biome-ignore lint/correctness/useExhaustiveDependencies: version triggers reconnect on reinit
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.mcpToolExecutor) return;

    // Read saved configs from localStorage (same key as McpConfigPanel)
    try {
      const raw = localStorage.getItem('aics:mcp-servers');
      if (!raw) return;
      const configs = JSON.parse(raw) as Array<{
        name: string;
        transport: string;
        commandOrUrl: string;
      }>;
      if (!Array.isArray(configs)) return;

      for (const cfg of configs) {
        const serverConfig: McpServerConfig = {
          name: cfg.name,
          transport: cfg.transport as 'stdio' | 'sse',
          url: cfg.transport === 'sse' ? cfg.commandOrUrl : undefined,
          command: cfg.transport === 'stdio' ? cfg.commandOrUrl : undefined,
        };
        runtime.mcpToolExecutor
          .addServer(serverConfig)
          .then(() => {
            setConnectedMcpServers((prev) => new Set([...prev, cfg.name]));
          })
          .catch((err) => {
            console.warn(`[MCP] Failed to auto-connect server '${cfg.name}':`, err);
          });
      }
    } catch {
      // Ignore parse errors
    }
  }, [version]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version forces reinit; getRuntime is a render-scoped function
  const value = useMemo<AicsRuntimeValue>(() => {
    // Runtime initialization is async (both browser and Tauri). On first render
    // getRuntime() returns null. The useEffect above kicks off initRuntime(),
    // which sets runtimeRef.current and bumps version to trigger a re-render.
    const runtime = getRuntime();

    // Always use the stable shared EventBus — never create a temporary one.
    // This is the same instance passed to createBrowserRuntime / createTauriRuntime,
    // so hooks subscribed to it will receive events from any runtime incarnation.
    const eventBus = eventBusRef.current;

    // Expose debug bridge in dev mode (E2E smoke tests).
    // Always set — even before runtime is ready — so tests can access the
    // EventBus for subscription-based assertions during async init.
    // Preserve existing getSceneState if SceneManager already mounted it.
    if (import.meta.env.DEV) {
      const existingGetSceneState = window.__AICS_DEBUG__?.getSceneState;
      window.__AICS_DEBUG__ = {
        eventBus,
        installService: runtime?.installService ?? null,
        getSceneState: existingGetSceneState ?? (() => ({
          employeeCount: 0,
          employeeIds: [] as string[],
        })),
      };
    }

    // Create shared EmployeeVersionService once per runtime lifecycle (I6)
    const employeeVersionService = runtime?.repos
      ? new EmployeeVersionService(
          runtime.repos.employeeVersions,
          runtime.repos.employees,
          eventBus,
        )
      : null;

    return {
      eventBus,
      isReady: runtime !== null && !isInitializing,
      isRunning,
      error,
      sendMessage,
      retryLastMessage,
      clearError,
      reinitRuntime,
      installService: runtime?.installService ?? null,
      repos: runtime?.repos ?? null,
      employeeVersionService,
      connectMcpServer,
      disconnectMcpServer,
      connectedMcpServers,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version forces reinit
  }, [
    isRunning,
    isInitializing,
    error,
    sendMessage,
    retryLastMessage,
    clearError,
    reinitRuntime,
    version,
    connectMcpServer,
    disconnectMcpServer,
    connectedMcpServers,
  ]);

  return <AicsRuntimeContext.Provider value={value}>{children}</AicsRuntimeContext.Provider>;
}
