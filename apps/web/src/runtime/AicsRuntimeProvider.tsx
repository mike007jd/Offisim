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
} from '@aics/core';
import type { CompanyRow, EmployeeRow } from '@aics/core';
import { AicsRuntimeContext, type AicsRuntimeValue } from './aics-runtime-context';
import { type ProviderConfig, loadProviderConfig } from '../lib/provider-config';
import { isTauri } from '../lib/env';

const COMPANY_ID = 'company-001';
const THREAD_ID = 'thread-001';

type RuntimeBundle = {
  eventBus: InMemoryEventBus;
  graph: ReturnType<typeof buildAicsGraph>;
  runtimeCtx: ReturnType<typeof createRuntimeContext>;
};

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

  return { eventBus, graph, runtimeCtx };
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
    const runtime = getOrCreateRuntime();
    const eventBus = runtime?.eventBus ?? new InMemoryEventBus();
    return {
      eventBus,
      isReady: runtime !== null && !isInitializing,
      isRunning,
      error,
      sendMessage,
      clearError,
      reinitRuntime,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version forces reinit
  }, [isRunning, isInitializing, error, sendMessage, clearError, reinitRuntime, version]);

  return (
    <AicsRuntimeContext.Provider value={value}>
      {children}
    </AicsRuntimeContext.Provider>
  );
}
