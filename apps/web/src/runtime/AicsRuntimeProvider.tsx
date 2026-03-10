import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HumanMessage } from '@langchain/core/messages';
import {
  buildAicsGraph,
  createMemoryCheckpointSaver,
  createMemoryRepositories,
  createRuntimeContext,
  createGateway,
  InMemoryEventBus,
  ModelResolver,
  MockToolExecutor,
  OrchestrationService,
  installStateChanged,
  bindingStateChanged,
} from '@aics/core';
import type { CompanyRow, EmployeeRow, RuntimeRepositories, EventBus } from '@aics/core';
import { InstallService } from '@aics/install-core';
import type { InstallRepositories, InstallEventEmitter } from '@aics/install-core';
import { AicsRuntimeContext, type AicsRuntimeValue } from './aics-runtime-context';
import { type ProviderConfig, loadProviderConfig } from '../lib/provider-config';
import { isTauri } from '../lib/env';

const COMPANY_ID = 'company-001';
const THREAD_ID = 'thread-001';

type RuntimeBundle = {
  eventBus: InMemoryEventBus;
  graph: ReturnType<typeof buildAicsGraph>;
  runtimeCtx: ReturnType<typeof createRuntimeContext>;
  installService: InstallService | null;
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
      eventBus.emit(installStateChanged(companyId, txnId, prev, next, undefined, packageId, errorCode));
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
      persona_json: JSON.stringify({ expertise: 'full-stack development', style: 'detail-oriented' }),
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

function createBrowserRuntime(config: ProviderConfig): RuntimeBundle {
  const eventBus = new InMemoryEventBus();
  const repos = createMemoryRepositories();
  seedCompany(repos);

  // In dev mode, route LLM calls through Vite proxy to avoid CORS.
  // The proxy reads the real target from X-LLM-Base-URL header.
  const proxyBaseURL = IS_DEV && config.baseURL
    ? `${window.location.origin}/api/llm-proxy`
    : undefined;
  const proxyHeaders = IS_DEV && config.baseURL
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

  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway: gateway,
    modelResolver,
    toolExecutor: new MockToolExecutor(),
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

  return { eventBus, graph, runtimeCtx, installService };
}

interface Props {
  children: React.ReactNode;
}

export function AicsRuntimeProvider({ children }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [isInitializing, setIsInitializing] = useState(false);

  const runtimeRef = useRef<RuntimeBundle | null>(null);
  const initPromiseRef = useRef<Promise<RuntimeBundle | null> | null>(null);

  // Async runtime init (for Tauri mode)
  const initRuntime = useCallback(async (): Promise<RuntimeBundle | null> => {
    const config = loadProviderConfig();
    if (!config) return null;

    if (isTauri()) {
      setIsInitializing(true);
      try {
        const { createTauriRuntime } = await import('../lib/tauri-runtime');
        const runtime = await createTauriRuntime(config);
        runtimeRef.current = runtime;
        return runtime;
      } finally {
        setIsInitializing(false);
      }
    }

    // Browser mode — synchronous
    const runtime = createBrowserRuntime(config);
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
    runtimeRef.current = createBrowserRuntime(config);
    return runtimeRef.current;
  }

  // Initialize Tauri runtime on mount / reinit
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

  const sendMessage = useCallback(async (text: string): Promise<string | undefined> => {
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

    try {
      const orch = new OrchestrationService(runtime.graph, runtime.runtimeCtx);
      const result = await orch.execute({
        entryMode: 'boss_chat',
        messages: [new HumanMessage(text)],
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
      return undefined;
    } finally {
      setIsRunning(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version ensures fresh runtime
  }, [version, initRuntime]);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AicsRuntimeValue>(() => {
    // NOTE: getOrCreateRuntime() lazily initializes the browser runtime and
    // assigns to runtimeRef. This is intentional — scene/event hooks need
    // the EventBus from the first render. The runtimeRef guard makes this
    // idempotent (safe under StrictMode). In Tauri mode it returns null
    // (async init handled by useEffect above).
    const runtime = getOrCreateRuntime();
    const eventBus = runtime?.eventBus ?? new InMemoryEventBus();

    // Expose debug bridge in dev mode (E2E smoke tests).
    // getSceneState starts with dummy values — SceneCanvas/useScene will
    // override it once the SceneManager is mounted.
    if (import.meta.env.DEV && runtime) {
      window.__AICS_DEBUG__ = {
        eventBus: runtime.eventBus,
        installService: runtime.installService,
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
      clearError,
      reinitRuntime,
      installService: runtime?.installService ?? null,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version forces reinit
  }, [isRunning, isInitializing, error, sendMessage, clearError, reinitRuntime, version]);

  return (
    <AicsRuntimeContext.Provider value={value}>
      {children}
    </AicsRuntimeContext.Provider>
  );
}
