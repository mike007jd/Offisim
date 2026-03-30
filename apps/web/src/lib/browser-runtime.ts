/**
 * Browser-mode runtime factory.
 *
 * This module is dynamically imported (like tauri-runtime.ts) so that heavy
 * dependencies (@offisim/core full barrel — LangGraph, OpenAI SDK, etc.) are
 * code-split into a separate chunk and not included in the initial bundle.
 */

// Browser-safe imports — lightweight, no LLM/graph deps
import {
  DEFAULT_COST_RATES,
  bindingStateChanged,
  createMemoryRepositories,
  installStateChanged,
} from '@offisim/core/browser';
import type {
  EventBus,
  InMemoryEventBus,
  RuntimeRepositories,
} from '@offisim/core/browser';
import { createMemoryCheckpointSaver } from '@offisim/core/dist/graph/checkpoint-saver.js';
// Heavy imports — direct dist paths to bypass the @offisim/core barrel alias.
// These modules pull in @langchain/langgraph, openai SDK, etc.
import { buildOffisimGraph } from '@offisim/core/dist/graph/main-graph.js';
import { createGateway } from '@offisim/core/dist/llm/gateway-factory.js';
import { ModelResolver } from '@offisim/core/dist/llm/model-resolver.js';
import { AuditingToolExecutor } from '@offisim/core/dist/mcp/auditing-tool-executor.js';
import { McpToolExecutor } from '@offisim/core/dist/mcp/mcp-tool-executor.js';
import { createRuntimeContext } from '@offisim/core/dist/runtime/runtime-context.js';
import { MemoryService } from '@offisim/core/dist/services/memory-service.js';
import type { OrchestrationService } from '@offisim/core/dist/services/orchestration-service.js';
import { InstallService } from '@offisim/install-core';
import type { InstallEventEmitter, InstallRepositories } from '@offisim/install-core';
import {
  buildSubscriptionGatewayConfig,
  getInstallEnvironmentForExecutionMode,
  resolveEffectiveRuntimePolicy,
} from '@offisim/ui-office';
import type { ProviderConfig } from '@offisim/ui-office';
import { BrowserMcpClientFactory } from './browser-mcp-client';
import {
  createBrowserRuntimePersistence,
  loadBrowserRuntimeSnapshot,
} from './browser-runtime-storage';

// ---------------------------------------------------------------------------
// Adapters: bridge @offisim/core repos + EventBus to @offisim/install-core DI
// ---------------------------------------------------------------------------

function createInstallReposAdapter(repos: RuntimeRepositories): InstallRepositories {
  return {
    installTransactions: repos.installTransactions,
    installedPackages: repos.installedPackages,
    installedAssets: repos.installedAssets,
    assetBindings: repos.assetBindings,
    employees: repos.employees,
  };
}

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

async function ensureCostRates(repos: ReturnType<typeof createMemoryRepositories>) {
  const existing = await repos.costRates.findAll();
  if (existing.length > 0) return;

  const now = new Date().toISOString().slice(0, 10);
  for (const rate of DEFAULT_COST_RATES) {
    await repos.costRates.create({
      provider: rate.provider,
      model_pattern: rate.model_pattern,
      input_cost_per_mtok: rate.input_cost_per_mtok,
      output_cost_per_mtok: rate.output_cost_per_mtok,
      effective_from: now,
      effective_until: null,
    });
  }
}

const IS_DEV = import.meta.env.DEV;

export type RuntimeBundle = {
  eventBus: InMemoryEventBus;
  graph: ReturnType<typeof buildOffisimGraph>;
  runtimeCtx: ReturnType<typeof createRuntimeContext>;
  /**
   * Long-lived OrchestrationService instance — null in repos-only mode.
   * Stored here so threadLocks survive across sendMessage() calls and
   * thread serialization is actually effective.
   */
  orch: OrchestrationService | null;
  installService: InstallService | null;
  mcpToolExecutor: McpToolExecutor | null;
  repos: RuntimeRepositories;
  dispose?: () => void;
};

/**
 * Create the browser-mode runtime stack.
 *
 * @param config - Provider configuration
 * @param eventBus - Shared EventBus instance from the Provider.
 */
export async function createBrowserRuntime(
  config: ProviderConfig,
  eventBus: InMemoryEventBus,
  companyId: string,
): Promise<RuntimeBundle> {
  const threadId = `thread-${companyId}`;
  const repos = createMemoryRepositories(loadBrowserRuntimeSnapshot() ?? undefined);
  await ensureCostRates(repos);
  const persistence = createBrowserRuntimePersistence(repos, eventBus);

  const proxyBaseURL =
    IS_DEV && config.baseURL ? `${window.location.origin}/api/llm-proxy` : undefined;
  const proxyHeaders =
    IS_DEV && config.baseURL
      ? { ...config.defaultHeaders, 'X-LLM-Base-URL': config.baseURL }
      : config.defaultHeaders;

  const gateway = createGateway({
    provider: config.provider,
    apiKey: config.apiKey ?? '',
    baseURL: proxyBaseURL ?? config.baseURL,
    defaultHeaders: proxyHeaders,
    dangerouslyAllowBrowser: true,
    subscription: buildSubscriptionGatewayConfig(config),
  });

  const runtimePolicy = resolveEffectiveRuntimePolicy(
    config.runtimePolicy,
    config.provider,
    config.model,
    { tauri: false },
  );

  const modelResolver = new ModelResolver(runtimePolicy, {
    provider: runtimePolicy.modelPolicy.default.provider,
    model: runtimePolicy.modelPolicy.default.model,
    temperature: runtimePolicy.modelPolicy.default.temperature ?? 0.7,
    maxTokens: runtimePolicy.modelPolicy.default.maxTokens ?? 4096,
  });

  const checkpointer = createMemoryCheckpointSaver();
  const graph = buildOffisimGraph({ checkpointer });

  const mcpToolExecutor = new McpToolExecutor({
    eventBus,
    companyId,
    clientFactory: new BrowserMcpClientFactory(),
  });

  const toolExecutor = new AuditingToolExecutor(
    mcpToolExecutor,
    repos.mcpAudit,
    eventBus,
    companyId,
    threadId,
  );
  const memoryService = runtimePolicy.memory.enabled
    ? new MemoryService(repos.memories, gateway, eventBus, {
        policy: runtimePolicy.memory,
      })
    : undefined;

  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway: gateway,
    modelResolver,
    toolExecutor,
    companyId,
    threadId,
    runtimePolicy,
    memoryService,
  });

  const installService = new InstallService({
    repos: createInstallReposAdapter(repos),
    events: createEventEmitterAdapter(eventBus),
    companyId,
    environment: {
      runtimeVersion: '0.1.0',
      environment: getInstallEnvironmentForExecutionMode(runtimePolicy.executionMode),
      schemaVersion: '2026-03',
    },
  });

  const { OrchestrationService } = await import(
    '@offisim/core/dist/services/orchestration-service.js'
  );
  const orch = new OrchestrationService(graph, runtimeCtx);

  return {
    eventBus,
    graph,
    runtimeCtx,
    orch,
    installService,
    mcpToolExecutor,
    repos,
    dispose: persistence.dispose,
  };
}

/**
 * Lightweight runtime: repos + eventBus only, no LLM/graph.
 * Used when no provider is configured — allows company creation, browsing,
 * and editing without requiring an API key.
 */
export async function createBrowserRuntimeReposOnly(
  eventBus: InMemoryEventBus,
  _companyId?: string,
): Promise<RuntimeBundle> {
  const repos = createMemoryRepositories(loadBrowserRuntimeSnapshot() ?? undefined);
  await ensureCostRates(repos);
  const persistence = createBrowserRuntimePersistence(repos, eventBus);

  return {
    eventBus,
    graph: null as unknown as RuntimeBundle['graph'],
    runtimeCtx: null as unknown as RuntimeBundle['runtimeCtx'],
    orch: null,
    installService: null,
    mcpToolExecutor: null,
    repos,
    dispose: persistence.dispose,
  };
}

export { ensureCostRates };
