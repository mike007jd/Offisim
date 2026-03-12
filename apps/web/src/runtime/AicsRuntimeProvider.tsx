import {
  AuditingToolExecutor,
  InMemoryEventBus,
  McpToolExecutor,
  ModelResolver,
  OrchestrationService,
  bindingStateChanged,
  buildAicsGraph,
  createGateway,
  createMemoryCheckpointSaver,
  createMemoryRepositories,
  createRuntimeContext,
  installStateChanged,
} from '@aics/core';
import type { CompanyRow, EmployeeRow, EventBus, McpServerConfig, RuntimeRepositories } from '@aics/core';
import { InstallService } from '@aics/install-core';
import type { InstallEventEmitter, InstallRepositories } from '@aics/install-core';
import { HumanMessage } from '@langchain/core/messages';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMcpClientFactory } from '../lib/browser-mcp-client';
import { isTauri } from '../lib/env';
import { COMPANY_ID, THREAD_ID } from '../lib/constants';
import { type ProviderConfig, loadProviderConfig } from '../lib/provider-config';
import { AicsRuntimeContext, type AicsRuntimeValue } from './aics-runtime-context';

type RuntimeBundle = {
  eventBus: InMemoryEventBus;
  graph: ReturnType<typeof buildAicsGraph>;
  runtimeCtx: ReturnType<typeof createRuntimeContext>;
  installService: InstallService | null;
  mcpToolExecutor: McpToolExecutor | null;
  repos: RuntimeRepositories;
};

// ---------------------------------------------------------------------------
// Adapters: bridge @aics/core repos + EventBus to @aics/install-core DI
// ---------------------------------------------------------------------------

/**
 * Adapts RuntimeRepositories (from @aics/core) to InstallRepositories
 * (from @aics/install-core). The interface shapes are structurally identical,
 * so this is a simple projection.
 */
function createInstallReposAdapter(repos: RuntimeRepositories): InstallRepositories {
  return {
    installTransactions: repos.installTransactions,
    installedPackages: repos.installedPackages,
    installedAssets: repos.installedAssets,
    assetBindings: repos.assetBindings,
    employees: repos.employees,
  };
}

/**
 * Adapts the core EventBus to InstallEventEmitter. Each method constructs
 * the appropriate RuntimeEvent via event-factory helpers and emits it.
 */
function createEventEmitterAdapter(eventBus: EventBus): InstallEventEmitter {
  return {
    emitInstallState(companyId, txnId, prev, next, packageId, errorCode) {
      eventBus.emit(
        installStateChanged(companyId, txnId, prev, next, undefined, packageId, errorCode),
      );
    },
    emitBindingState(companyId, bindingId, txnId, type, key, prev, next) {
      eventBus.emit(bindingStateChanged(companyId, bindingId, txnId, type, key, prev, next));
    },
  };
}

function seedCompany(repos: ReturnType<typeof createMemoryRepositories>) {
  const now = new Date().toISOString();

  const company: CompanyRow = {
    company_id: COMPANY_ID,
    name: 'AICS Demo Company',
    status: 'active',
    workspace_root: null,
    default_model_policy_json: null,
    created_at: now,
    updated_at: now,
  };

  const employees: EmployeeRow[] = [
    {
      employee_id: 'emp-alice',
      company_id: COMPANY_ID,
      source_asset_id: null,
      source_package_id: null,
      name: 'Alice',
      role_slug: 'engineering_manager',
      workstation_id: null,
      persona_json: JSON.stringify({ expertise: 'engineering management', style: 'collaborative' }),
      config_json: null,
      enabled: 1,
      created_at: now,
      updated_at: now,
    },
    {
      employee_id: 'emp-bob',
      company_id: COMPANY_ID,
      source_asset_id: null,
      source_package_id: null,
      name: 'Bob',
      role_slug: 'developer',
      workstation_id: null,
      persona_json: JSON.stringify({
        expertise: 'full-stack development',
        style: 'detail-oriented',
      }),
      config_json: null,
      enabled: 1,
      created_at: now,
      updated_at: now,
    },
    {
      employee_id: 'emp-carol',
      company_id: COMPANY_ID,
      source_asset_id: null,
      source_package_id: null,
      name: 'Carol',
      role_slug: 'designer',
      workstation_id: null,
      persona_json: JSON.stringify({ expertise: 'UI/UX design', style: 'creative' }),
      config_json: null,
      enabled: 1,
      created_at: now,
      updated_at: now,
    },
  ];

  repos.seed.companies([company]);
  repos.seed.employees(employees);
}

const IS_DEV = import.meta.env.DEV;

/**
 * Create the browser-mode runtime stack.
 *
 * @param config - Provider configuration
 * @param eventBus - Shared EventBus instance from the Provider. Using a shared
 *   bus ensures UI hooks always subscribe to the same instance, avoiding the
 *   "EventBus churn" problem during initialization.
 */
function createBrowserRuntime(config: ProviderConfig, eventBus: InMemoryEventBus): RuntimeBundle {
  const repos = createMemoryRepositories();
  seedCompany(repos);

  // In dev mode, route LLM calls through Vite proxy to avoid CORS.
  // The proxy reads the real target from X-LLM-Base-URL header.
  const proxyBaseURL =
    IS_DEV && config.baseURL ? `${window.location.origin}/api/llm-proxy` : undefined;
  const proxyHeaders =
    IS_DEV && config.baseURL
      ? { ...config.defaultHeaders, 'X-LLM-Base-URL': config.baseURL }
      : config.defaultHeaders;

  const gateway = createGateway({
    provider: config.provider,
    apiKey: config.apiKey,
    baseURL: proxyBaseURL ?? config.baseURL,
    defaultHeaders: proxyHeaders,
    dangerouslyAllowBrowser: true,
  });

  const modelResolver = new ModelResolver(null, {
    provider: config.provider,
    model: config.model,
    temperature: 0.7,
    maxTokens: 4096,
  });

  const checkpointer = createMemoryCheckpointSaver();
  const graph = buildAicsGraph({ checkpointer });

  // --- MCP Tool Executor (real, SSE-only in browser) ---
  const mcpToolExecutor = new McpToolExecutor({
    eventBus,
    companyId: COMPANY_ID,
    clientFactory: new BrowserMcpClientFactory(),
  });

  // Wrap with audit logging — writes to mcp_audit_log + emits mcp.tool.result events
  const toolExecutor = new AuditingToolExecutor(
    mcpToolExecutor, repos.mcpAudit, eventBus, COMPANY_ID, THREAD_ID,
  );

  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway: gateway,
    modelResolver,
    toolExecutor,
    companyId: COMPANY_ID,
    threadId: THREAD_ID,
  });

  // --- Install Service ---
  const installService = new InstallService({
    repos: createInstallReposAdapter(repos),
    events: createEventEmitterAdapter(eventBus),
    companyId: COMPANY_ID,
    environment: {
      runtimeVersion: '0.1.0',
      environment: 'desktop',
      schemaVersion: '2026-03',
    },
  });

  return { eventBus, graph, runtimeCtx, installService, mcpToolExecutor, repos };
}

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

  // Async runtime init (for Tauri mode)
  const initRuntime = useCallback(async (): Promise<RuntimeBundle | null> => {
    const config = loadProviderConfig();
    if (!config) return null;

    const eventBus = eventBusRef.current;

    if (isTauri()) {
      setIsInitializing(true);
      try {
        const { createTauriRuntime } = await import('../lib/tauri-runtime');
        const runtime = await createTauriRuntime(config, eventBus);
        runtimeRef.current = runtime;
        return runtime;
      } finally {
        setIsInitializing(false);
      }
    }

    // Browser mode — synchronous
    const runtime = createBrowserRuntime(config, eventBus);
    runtimeRef.current = runtime;
    return runtime;
  }, []);

  function getOrCreateRuntime(): RuntimeBundle | null {
    if (runtimeRef.current) return runtimeRef.current;

    if (isTauri()) {
      // Tauri: async init handled by useEffect / sendMessage
      return null;
    }

    // Browser: sync init
    const config = loadProviderConfig();
    if (!config) return null;
    runtimeRef.current = createBrowserRuntime(config, eventBusRef.current);
    return runtimeRef.current;
  }

  // Initialize Tauri runtime on mount / reinit
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is intentional — reinitRuntime() bumps it to force re-init
  useEffect(() => {
    if (isTauri() && !runtimeRef.current) {
      initPromiseRef.current = initRuntime().catch((err) => {
        console.error('[TauriRuntime] init failed:', err);
        setError(err instanceof Error ? err.message : String(err));
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: version forces fresh runtime; getOrCreateRuntime is a render-scoped function that reads refs
  const sendMessage = useCallback(
    async (text: string, options?: { targetEmployeeId?: string }): Promise<string | undefined> => {
      let runtime = runtimeRef.current;

      // For Tauri: wait for async init if in progress
      if (!runtime && isTauri()) {
        if (initPromiseRef.current) {
          runtime = await initPromiseRef.current;
        } else {
          runtime = await initRuntime();
        }
      }

      // For Browser: sync init
      if (!runtime) {
        runtime = getOrCreateRuntime();
      }

      if (!runtime) {
        setError('No provider configured. Open Settings to configure.');
        return undefined;
      }

      setIsRunning(true);
      setError(null);
      lastFailedMessageRef.current = null;

      try {
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
  const connectMcpServer = useCallback(
    async (config: McpServerConfig): Promise<number> => {
      const runtime = runtimeRef.current;
      if (!runtime?.mcpToolExecutor) {
        throw new Error('Runtime not ready — cannot connect MCP server.');
      }
      await runtime.mcpToolExecutor.addServer(config);
      setConnectedMcpServers((prev) => new Set([...prev, config.name]));
      // Return tool count — serverCount is available but we want tool count
      // Approximation: return serverCount as a signal that connection succeeded
      return runtime.mcpToolExecutor.serverCount;
    },
    [],
  );

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: version forces reinit; getOrCreateRuntime is a render-scoped function
  const value = useMemo<AicsRuntimeValue>(() => {
    // NOTE: getOrCreateRuntime() lazily initializes the browser runtime and
    // assigns to runtimeRef. This is intentional — scene/event hooks need
    // the EventBus from the first render. The runtimeRef guard makes this
    // idempotent (safe under StrictMode). In Tauri mode it returns null
    // (async init handled by useEffect above).
    const runtime = getOrCreateRuntime();

    // Always use the stable shared EventBus — never create a temporary one.
    // This is the same instance passed to createBrowserRuntime / createTauriRuntime,
    // so hooks subscribed to it will receive events from any runtime incarnation.
    const eventBus = eventBusRef.current;

    // Expose debug bridge in dev mode (E2E smoke tests).
    // Always set — even before runtime is ready — so tests can access the
    // EventBus for subscription-based assertions during async init.
    // getSceneState starts with dummy values — SceneCanvas/useScene will
    // override it once the SceneManager is mounted.
    if (import.meta.env.DEV) {
      window.__AICS_DEBUG__ = {
        eventBus,
        installService: runtime?.installService ?? null,
        getSceneState: () => ({
          employeeCount: 0,
          employeeIds: [] as string[],
        }),
      };
    }

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
      connectMcpServer,
      disconnectMcpServer,
      connectedMcpServers,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version forces reinit
  }, [isRunning, isInitializing, error, sendMessage, retryLastMessage, clearError, reinitRuntime, version, connectMcpServer, disconnectMcpServer, connectedMcpServers]);

  return <AicsRuntimeContext.Provider value={value}>{children}</AicsRuntimeContext.Provider>;
}
