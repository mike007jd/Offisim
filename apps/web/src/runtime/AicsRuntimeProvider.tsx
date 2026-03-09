import { useCallback, useMemo, useRef, useState } from 'react';
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

const COMPANY_ID = 'company-001';
const THREAD_ID = 'thread-001';

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

function createRuntime(config: ProviderConfig) {
  const eventBus = new InMemoryEventBus();
  const repos = createMemoryRepositories();
  seedCompany(repos);

  const gateway = createGateway({
    provider: config.provider,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: config.defaultHeaders,
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

  // Lazy-init runtime from localStorage config
  const runtimeRef = useRef<ReturnType<typeof createRuntime> | null>(null);

  function getOrCreateRuntime() {
    if (!runtimeRef.current) {
      const config = loadProviderConfig();
      if (!config) return null;
      runtimeRef.current = createRuntime(config);
    }
    return runtimeRef.current;
  }

  // Force re-init when config changes
  const reinitRuntime = useCallback(() => {
    runtimeRef.current = null;
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const runtime = getOrCreateRuntime();
    if (!runtime) {
      setError('No provider configured. Open Settings to configure.');
      return;
    }

    setIsRunning(true);
    setError(null);

    try {
      const orch = new OrchestrationService(runtime.graph, runtime.runtimeCtx);
      await orch.execute({
        entryMode: 'boss_chat',
        messages: [new HumanMessage(text)],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsRunning(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AicsRuntimeValue>(() => {
    const runtime = getOrCreateRuntime();
    const eventBus = runtime?.eventBus ?? new InMemoryEventBus();
    return {
      eventBus,
      isReady: runtime !== null,
      isRunning,
      error,
      sendMessage,
      clearError,
    };
  }, [isRunning, error, sendMessage, clearError]);

  // Expose reinit via a custom event so settings dialog can trigger it
  (window as Record<string, unknown>).__aicsReinitRuntime = reinitRuntime;

  return (
    <AicsRuntimeContext.Provider value={value}>
      {children}
    </AicsRuntimeContext.Provider>
  );
}
