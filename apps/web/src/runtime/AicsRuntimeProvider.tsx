import { EmployeeVersionService, InMemoryEventBus } from '@aics/core/browser';
import type { McpServerConfig } from '@aics/core/browser';
import { disposeRuntime } from '@aics/core/dist/runtime/runtime-context.js';
import { NotificationBridge } from '@aics/core/dist/services/notification-bridge.js';
import {
  AicsRuntimeContext,
  AicsRuntimeStatusContext,
  type AicsRuntimeStatusValue,
  type AicsRuntimeValue,
  isTauri,
  loadStoredBrowserMcpServers,
  loadProviderConfig,
} from '@aics/ui-office';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeBundle } from '../lib/browser-runtime';
import { listDesktopMcpServers } from '../lib/desktop-mcp-registry';
import { initializeRuntimeBundle } from './initialize-runtime';

export interface UnfinishedThread {
  threadId: string;
  projectName: string;
}

interface Props {
  companyId: string;
  children: React.ReactNode;
}

type DesktopMcpServerConfig = McpServerConfig & {
  registeredServerId?: string;
};

export function AicsRuntimeProvider({ companyId, children }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const isRunningRef = useRef(false);
  isRunningRef.current = isRunning;
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [isInitializing, setIsInitializing] = useState(false);
  const [connectedMcpServers, setConnectedMcpServers] = useState<ReadonlySet<string>>(new Set());
  const [unfinishedThreads, setUnfinishedThreads] = useState<UnfinishedThread[]>([]);

  const runtimeRef = useRef<RuntimeBundle | null>(null);
  const initPromiseRef = useRef<Promise<RuntimeBundle | null> | null>(null);
  const detectionDoneRef = useRef(false);

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
  const notificationBridgeRef = useRef<NotificationBridge | null>(null);

  // Activate NotificationBridge once — subscribes to runtime events on the
  // stable EventBus and emits `notification.created` for the UI.
  useEffect(() => {
    const bridge = new NotificationBridge(eventBusRef.current, companyId);
    bridge.activate();
    notificationBridgeRef.current = bridge;
    return () => {
      bridge.deactivate();
      notificationBridgeRef.current = null;
    };
  }, [companyId]);

  // Full dispose on unmount — release gateway, MCP connections, EventBus subs.
  useEffect(() => {
    return () => {
      const runtime = runtimeRef.current;
      if (runtime) {
        disposeRuntime({
          llmGateway: runtime.runtimeCtx?.llmGateway,
          eventBus: eventBusRef.current,
          toolExecutor: runtime.mcpToolExecutor ?? undefined,
          notificationBridge: notificationBridgeRef.current ?? undefined,
        });
      }
    };
  }, []);

  // Async runtime init (Tauri + browser modes — both async due to seedCostRates)
  const initRuntime = useCallback(async (): Promise<RuntimeBundle | null> => {
    const config = loadProviderConfig();
    const eventBus = eventBusRef.current;
    const runtime = await initializeRuntimeBundle(config, eventBus, isTauri(), companyId);
    runtimeRef.current = runtime;
    return runtime;
  }, [companyId]);

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
    // Dispose the OLD runtime's disposable resources (gateway, MCP connections)
    // before creating a new one. The EventBus is intentionally NOT disposed here
    // — it's shared across reinits so UI hooks stay subscribed.
    const oldRuntime = runtimeRef.current;
    if (oldRuntime) {
      disposeRuntime({
        llmGateway: oldRuntime.runtimeCtx?.llmGateway,
        // eventBus intentionally omitted: keep shared EventBus alive across reinits
        toolExecutor: oldRuntime.mcpToolExecutor ?? undefined,
        notificationBridge: notificationBridgeRef.current ?? undefined,
      });
    }
    runtimeRef.current = null;
    initPromiseRef.current = null;
    setVersion((v) => v + 1);
  }, []);

  const lastFailedMessageRef = useRef<{
    text: string;
    targetEmployeeId?: string;
    threadId?: string;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version forces fresh runtime; getRuntime is a render-scoped function that reads refs
  const sendMessage = useCallback(
    async (
      text: string,
      options?: { targetEmployeeId?: string; threadId?: string },
    ): Promise<string | undefined> => {
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
        // HumanMessage is still dynamically imported to avoid including
        // @langchain/core/messages in the initial bundle.
        const { HumanMessage } = await import('@langchain/core/messages');
        if (!runtime.orch) {
          setError('Runtime not fully initialized (no orchestration service).');
          return undefined;
        }
        const entryMode = options?.targetEmployeeId ? 'direct_chat' : 'boss_chat';
        const result = await runtime.orch.execute({
          entryMode,
          messages: [new HumanMessage(text)],
          targetEmployeeId: options?.targetEmployeeId ?? null,
          threadId: options?.threadId,
        });
        // Extract last AI message content from graph result
        const msgs = result.messages ?? [];
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          if (!m) continue;
          if (m._getType() === 'ai' && typeof m.content === 'string' && m.content) {
            return m.content;
          }
        }
        return undefined;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        lastFailedMessageRef.current = {
          text,
          targetEmployeeId: options?.targetEmployeeId,
          threadId: options?.threadId,
        };
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
    return sendMessage(last.text, {
      targetEmployeeId: last.targetEmployeeId,
      threadId: last.threadId,
    });
  }, [sendMessage]);

  const clearError = useCallback(() => setError(null), []);

  const dismissUnfinishedThreads = useCallback(() => setUnfinishedThreads([]), []);

  const resumeThread = useCallback(async (threadId: string): Promise<void> => {
    const runtime = runtimeRef.current;
    if (!runtime?.orch) return;

    setIsRunning(true);
    setError(null);

    const { HumanMessage } = await import('@langchain/core/messages');
    try {
      await runtime.orch.execute({
        entryMode: 'background_sync' as const,
        messages: [new HumanMessage('Resume from last checkpoint')],
        threadId,
      });
      // Clear the resumed thread from the unfinished list
      setUnfinishedThreads((prev) => prev.filter((t) => t.threadId !== threadId));
    } catch (err) {
      console.error('Failed to resume thread:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsRunning(false);
    }
  }, []);

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

  const abortExecution = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.orch) return;
    runtime.orch.abortExecution(runtime.runtimeCtx.threadId);
  }, []);

  // Auto-connect saved MCP servers on runtime init
  // biome-ignore lint/correctness/useExhaustiveDependencies: version triggers reconnect on reinit
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.mcpToolExecutor) return;

    const connectSavedServers = async () => {
      if (isTauri()) {
        const configs = await listDesktopMcpServers();
        const executor = runtime.mcpToolExecutor;
        if (!executor) return;
        for (const cfg of configs) {
          const serverConfig: DesktopMcpServerConfig = {
            name: cfg.name,
            transport: cfg.transport,
            registeredServerId: cfg.serverId,
            url: cfg.url,
          };
          executor
            .addServer(serverConfig)
            .then(() => {
              setConnectedMcpServers((prev) => new Set([...prev, cfg.name]));
            })
            .catch((err) => {
              console.warn(`[MCP] Failed to auto-connect server '${cfg.name}':`, err);
            });
        }
        return;
      }

      try {
        const configs = loadStoredBrowserMcpServers();
        if (configs.length === 0) return;

        const executor = runtime.mcpToolExecutor;
        if (!executor) return;
        for (const cfg of configs) {
          const serverConfig: McpServerConfig = {
            name: cfg.name,
            transport: cfg.transport,
            url: cfg.url,
            command: cfg.command,
            args: cfg.args,
          };
          executor
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
    };

    void connectSavedServers();
  }, [version]);

  // Startup detection — find threads that were left in 'running' status
  // (e.g. app crashed or was closed mid-execution). Runs once per mount.
  useEffect(() => {
    if (detectionDoneRef.current) return;
    const runtime = runtimeRef.current;
    if (!runtime?.repos) return;

    detectionDoneRef.current = true;

    (async () => {
      try {
        const threads = await runtime.repos.threads.findByCompany(companyId, { status: 'running' });
        if (threads.length === 0) {
          setUnfinishedThreads([]);
          return;
        }
        // Enrich with project names — single query, no N+1.
        const allProjects = await runtime.repos.projects.findByCompany(companyId);
        const enriched: UnfinishedThread[] = threads.map((t) => {
          const project = allProjects.find((p) => p.thread_id === t.thread_id);
          return {
            threadId: t.thread_id,
            projectName: project?.name ?? t.thread_id,
          };
        });
        setUnfinishedThreads(enriched);
      } catch {
        // Silent fail — startup detection must never block the UI
      }
    })();
  }, [companyId]);

  // ---------------------------------------------------------------------------
  // Volatile status — changes on every task execution (isRunning toggle).
  // Separated so that consumers of stable values (repos, eventBus) don't
  // re-render when isRunning flips.
  // ---------------------------------------------------------------------------
  const statusValue = useMemo<AicsRuntimeStatusValue>(
    () => ({ isRunning, version }),
    [isRunning, version],
  );

  // ---------------------------------------------------------------------------
  // Stable context — repos, eventBus, sendMessage, etc.
  // Only rebuilds when the runtime itself changes (version/init), error changes,
  // or MCP server set changes. NOT on isRunning toggles.
  // ---------------------------------------------------------------------------
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
        getSceneState:
          existingGetSceneState ??
          (() => ({
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
          runtime.repos.transact,
        )
      : null;

    return {
      eventBus,
      isReady: runtime !== null && !isInitializing,
      // isRunning lives in AicsRuntimeStatusContext — use useAicsRuntimeStatus().
      // Kept here as a getter for backward compat (does NOT trigger re-render).
      get isRunning() {
        return isRunningRef.current;
      },
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
      abortExecution,
      unfinishedThreads,
      dismissUnfinishedThreads,
      resumeThread,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version forces reinit
  }, [
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
    abortExecution,
    unfinishedThreads,
    dismissUnfinishedThreads,
    resumeThread,
  ]);

  return (
    <AicsRuntimeStatusContext.Provider value={statusValue}>
      <AicsRuntimeContext.Provider value={value}>{children}</AicsRuntimeContext.Provider>
    </AicsRuntimeStatusContext.Provider>
  );
}
