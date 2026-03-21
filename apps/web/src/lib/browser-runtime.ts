/**
 * Browser-mode runtime factory.
 *
 * This module is dynamically imported (like tauri-runtime.ts) so that heavy
 * dependencies (@aics/core full barrel — LangGraph, OpenAI SDK, etc.) are
 * code-split into a separate chunk and not included in the initial bundle.
 */

// Browser-safe imports — lightweight, no LLM/graph deps
import {
  DEFAULT_COST_RATES,
  bindingStateChanged,
  createMemoryRepositories,
  installStateChanged,
} from '@aics/core/browser';
import type {
  CompanyRow,
  EventBus,
  InMemoryEventBus,
  RuntimeRepositories,
} from '@aics/core/browser';
// Heavy imports — direct dist paths to bypass the @aics/core barrel alias.
// These modules pull in @langchain/langgraph, openai SDK, etc.
import { buildAicsGraph } from '@aics/core/dist/graph/main-graph.js';
import { createMemoryCheckpointSaver } from '@aics/core/dist/graph/checkpoint-saver.js';
import { createGateway } from '@aics/core/dist/llm/gateway-factory.js';
import { ModelResolver } from '@aics/core/dist/llm/model-resolver.js';
import { McpToolExecutor } from '@aics/core/dist/mcp/mcp-tool-executor.js';
import { AuditingToolExecutor } from '@aics/core/dist/mcp/auditing-tool-executor.js';
import { createRuntimeContext } from '@aics/core/dist/runtime/runtime-context.js';
import { InstallService } from '@aics/install-core';
import type { InstallEventEmitter, InstallRepositories } from '@aics/install-core';
import { COMPANY_ID, THREAD_ID, type ProviderConfig } from '@aics/ui-office';
import { BrowserMcpClientFactory } from './browser-mcp-client';

// ---------------------------------------------------------------------------
// Adapters: bridge @aics/core repos + EventBus to @aics/install-core DI
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

async function seedCompany(repos: ReturnType<typeof createMemoryRepositories>): Promise<void> {
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

  repos.seed.companies([company]);
  await seedCostRates(repos);
}

async function seedCostRates(repos: ReturnType<typeof createMemoryRepositories>) {
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
  graph: ReturnType<typeof buildAicsGraph>;
  runtimeCtx: ReturnType<typeof createRuntimeContext>;
  installService: InstallService | null;
  mcpToolExecutor: McpToolExecutor | null;
  repos: RuntimeRepositories;
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
): Promise<RuntimeBundle> {
  const repos = createMemoryRepositories();
  await seedCompany(repos);

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

  const mcpToolExecutor = new McpToolExecutor({
    eventBus,
    companyId: COMPANY_ID,
    clientFactory: new BrowserMcpClientFactory(),
  });

  const toolExecutor = new AuditingToolExecutor(
    mcpToolExecutor,
    repos.mcpAudit,
    eventBus,
    COMPANY_ID,
    THREAD_ID,
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

/**
 * Lightweight runtime: repos + eventBus only, no LLM/graph.
 * Used when no provider is configured — allows company creation, browsing,
 * and editing without requiring an API key.
 */
export async function createBrowserRuntimeReposOnly(
  eventBus: InMemoryEventBus,
): Promise<RuntimeBundle> {
  const repos = createMemoryRepositories();
  await seedCompany(repos);

  // Minimal stubs — no LLM, no graph, no MCP
  const checkpointer = createMemoryCheckpointSaver();
  const graph = buildAicsGraph({ checkpointer });

  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway: null as unknown as ReturnType<typeof createGateway>,
    modelResolver: null as unknown as InstanceType<typeof ModelResolver>,
    toolExecutor: null,
    companyId: COMPANY_ID,
    threadId: THREAD_ID,
  });

  return { eventBus, graph, runtimeCtx, installService: null, mcpToolExecutor: null, repos };
}
