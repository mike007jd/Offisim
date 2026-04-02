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
  MemoryUserPreferenceRepository,
  bindingStateChanged,
  createMemoryRepositories,
  installStateChanged,
} from '@offisim/core/browser';
import type { EventBus, InMemoryEventBus, RuntimeRepositories } from '@offisim/core/browser';
import { createMemoryCheckpointSaver } from '@offisim/core/dist/graph/checkpoint-saver.js';
// Heavy imports — direct dist paths to bypass the @offisim/core barrel alias.
// These modules pull in @langchain/langgraph, openai SDK, etc.
import { buildOffisimGraph } from '@offisim/core/dist/graph/main-graph.js';
import { createGateway } from '@offisim/core/dist/llm/gateway-factory.js';
import { ModelResolver } from '@offisim/core/dist/llm/model-resolver.js';
import { RecordedSystemLlmCaller } from '@offisim/core/dist/llm/recorded-system-caller.js';
import { AuditingToolExecutor } from '@offisim/core/dist/mcp/auditing-tool-executor.js';
import { McpToolExecutor } from '@offisim/core/dist/mcp/mcp-tool-executor.js';
import { NodeContextMiddleware } from '@offisim/core/dist/middleware/builtin/node-context-middleware.js';
import { SummarizationMiddleware } from '@offisim/core/dist/middleware/builtin/summarization-middleware.js';
import { UserPreferenceMiddleware } from '@offisim/core/dist/middleware/builtin/user-preference-middleware.js';
import { LlmMiddlewareChain } from '@offisim/core/dist/middleware/chain.js';
import { ToolPermissionEngine } from '@offisim/core/dist/permissions/tool-permission-engine.js';
import { createRuntimeContext } from '@offisim/core/dist/runtime/runtime-context.js';
import { SessionCostTracker } from '@offisim/core/dist/runtime/session-cost-tracker.js';
import { ConversationBudgetService } from '@offisim/core/dist/services/conversation-budget-service.js';
import { InteractionService } from '@offisim/core/dist/services/interaction-service.js';
import { MemoryService } from '@offisim/core/dist/services/memory-service.js';
import type { OrchestrationService } from '@offisim/core/dist/services/orchestration-service.js';
import { ToolTelemetryService } from '@offisim/core/dist/services/tool-telemetry-service.js';
import { UserMemoryService } from '@offisim/core/dist/services/user-memory-service.js';
import { InstallService } from '@offisim/install-core';
import type { InstallEventEmitter, InstallRepositories } from '@offisim/install-core';
import type { InteractionMode } from '@offisim/shared-types';
import {
  buildSubscriptionGatewayConfig,
  getInstallEnvironmentForExecutionMode,
  resolveEffectiveRuntimePolicy,
} from '@offisim/ui-office';
import type { ProviderConfig } from '@offisim/ui-office';
import { BrowserMcpClientFactory } from './browser-mcp-client';
import { assertBrowserProviderAllowed } from './browser-provider-guard';
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
  userMemoryService?: UserMemoryService;
  sessionCostTracker?: SessionCostTracker;
  toolTelemetryService?: ToolTelemetryService;
  interactionService?: InteractionService;
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
  opts?: { defaultInteractionMode?: InteractionMode },
): Promise<RuntimeBundle> {
  assertBrowserProviderAllowed(config.provider, IS_DEV);

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
  const interactionBox = { pending: null };
  const interactionService = new InteractionService({
    eventBus,
    companyId,
    threadId,
    defaultMode: opts?.defaultInteractionMode,
    pendingStore: interactionBox,
    threadRepo: repos.threads,
    activeRepo: repos.activeInteractions,
    historyRepo: repos.interactionHistory,
  });
  await interactionService.restore();

  const toolExecutor = new AuditingToolExecutor(
    mcpToolExecutor,
    repos.mcpAudit,
    eventBus,
    companyId,
    threadId,
    new ToolPermissionEngine({
      employees: repos.employees,
      mcpAudit: repos.mcpAudit,
      runtimePolicy,
      grants: interactionService,
    }),
    interactionService,
  );
  const systemCaller = new RecordedSystemLlmCaller({
    llmGateway: gateway,
    llmCalls: repos.llmCalls,
    eventBus,
    companyId,
    threadId,
  });

  const memoryService = runtimePolicy.memory.enabled
    ? new MemoryService(repos.memories, gateway, eventBus, {
        policy: runtimePolicy.memory,
        systemCaller,
      })
    : undefined;
  let userPrefRepo = repos.userPreferences;
  if (!userPrefRepo) {
    userPrefRepo = new MemoryUserPreferenceRepository();
    repos.userPreferences = userPrefRepo;
  }
  const userMemoryService = new UserMemoryService(
    userPrefRepo,
    gateway,
    'gpt-4o-mini',
    systemCaller,
  );
  const middlewareChain = new LlmMiddlewareChain();
  middlewareChain.register(new SummarizationMiddleware(new ConversationBudgetService()));
  middlewareChain.register(new NodeContextMiddleware(repos.nodeSummaries));
  middlewareChain.register(new UserPreferenceMiddleware(userPrefRepo));
  const toolTelemetryService = new ToolTelemetryService(eventBus);
  const sessionCostTracker = await SessionCostTracker.create({
    eventBus,
    repos,
    companyId,
    threadId,
  });

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
    interactionBox,
    middlewareChain,
    systemCaller,
    sessionCostTracker,
    toolTelemetryService,
    interactionService,
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
  const orch = new OrchestrationService(graph, runtimeCtx, {
    checkpointSaver: checkpointer,
  });

  return {
    eventBus,
    graph,
    runtimeCtx,
    orch,
    installService,
    mcpToolExecutor,
    repos,
    userMemoryService,
    sessionCostTracker,
    toolTelemetryService,
    interactionService,
    dispose: () => {
      sessionCostTracker.dispose();
      toolTelemetryService.dispose();
      persistence.dispose();
    },
  };
}

/**
 * Lightweight runtime: repos + eventBus only, no LLM/graph.
 * Used when no provider is configured — allows company creation, browsing,
 * and editing without requiring an API key.
 */
export async function createBrowserRuntimeReposOnly(
  eventBus: InMemoryEventBus,
  companyId = 'company-unknown',
  opts?: { defaultInteractionMode?: InteractionMode },
): Promise<RuntimeBundle> {
  const threadId = `thread-${companyId}`;
  const repos = createMemoryRepositories(loadBrowserRuntimeSnapshot() ?? undefined);
  await ensureCostRates(repos);
  const persistence = createBrowserRuntimePersistence(repos, eventBus);
  const interactionBox = { pending: null };
  const interactionService = new InteractionService({
    eventBus,
    companyId,
    threadId,
    defaultMode: opts?.defaultInteractionMode,
    pendingStore: interactionBox,
    threadRepo: repos.threads,
    activeRepo: repos.activeInteractions,
    historyRepo: repos.interactionHistory,
  });
  await interactionService.restore();

  return {
    eventBus,
    graph: null as unknown as RuntimeBundle['graph'],
    runtimeCtx: createRuntimeContext({
      repos,
      eventBus,
      llmGateway: null as never,
      modelResolver: null as never,
      toolExecutor: {
        execute: async () => ({ success: false, result: null }),
        listAvailable: async () => [],
      },
      companyId,
      threadId,
      interactionBox,
      interactionService,
    }),
    orch: null,
    installService: null,
    mcpToolExecutor: null,
    repos,
    userMemoryService: undefined,
    sessionCostTracker: undefined,
    toolTelemetryService: undefined,
    interactionService,
    dispose: persistence.dispose,
  };
}

export { ensureCostRates };
