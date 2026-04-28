/**
 * Browser-mode runtime factory.
 *
 * This module is dynamically imported (like tauri-runtime.ts) so that heavy
 * dependencies (@offisim/core full barrel — LangGraph, OpenAI SDK, etc.) are
 * code-split into a separate chunk and not included in the initial bundle.
 */

// Browser-safe imports — lightweight, no LLM/graph deps
import {
  AgentContextPackService,
  DeliverablePersistenceService,
  MemoryUserPreferenceRepository,
  SkillInstallCommitter,
  SkillLoader,
  SkillStagingManager,
  bindingStateChanged,
  createMemoryRepositories,
  installStateChanged,
  onVaultReadyForSkills,
} from '@offisim/core/browser';
import type {
  EventBus,
  InMemoryEventBus,
  MemoryRepositoriesSnapshot,
  RuntimeRepositories,
} from '@offisim/core/browser';
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
import { ensureYoloMasterForActiveCompanies } from '@offisim/core/dist/runtime/ensure-yolo-master.js';
import { HookRegistry } from '@offisim/core/dist/runtime/hook-registry.js';
import { ResumeCoordinator } from '@offisim/core/dist/runtime/resume-coordinator.js';
import { createRuntimeContext } from '@offisim/core/dist/runtime/runtime-context.js';
import { Scratchpad } from '@offisim/core/dist/runtime/scratchpad.js';
import { SessionCostTracker } from '@offisim/core/dist/runtime/session-cost-tracker.js';
import { ConversationBudgetService } from '@offisim/core/dist/services/conversation-budget-service.js';
import { createRuntimeRollingJournal } from '@offisim/core/dist/services/conversation-budget/rolling-journal-runtime.js';
import { InteractionService } from '@offisim/core/dist/services/interaction-service.js';
import { MemoryService } from '@offisim/core/dist/services/memory-service.js';
import type { OrchestrationService } from '@offisim/core/dist/services/orchestration-service.js';
import { ToolTelemetryService } from '@offisim/core/dist/services/tool-telemetry-service.js';
import { UserMemoryService } from '@offisim/core/dist/services/user-memory-service.js';
import { InstallService } from '@offisim/install-core';
import type { InstallEventEmitter, InstallRepositories } from '@offisim/install-core';
import type { InteractionMode } from '@offisim/shared-types';
import {
  DEFAULT_EXECUTION_LANE,
  getInstallEnvironmentForExecutionMode,
  resolveEffectiveRuntimePolicy,
  resolveProviderConfig,
  resolveProviderHostAvailability,
} from '@offisim/ui-office/web';
import type { ProviderConfig } from '@offisim/ui-office/web';
import { BrowserMcpClientFactory } from './browser-mcp-client';
import {
  createBrowserRuntimePersistence,
  createDeliverableContentBridge,
  extractLegacyDeliverableContent,
  loadBrowserRuntimeSnapshot,
} from './browser-runtime-storage';
import {
  getDeliverableContent,
  openDeliverableContentDb,
  putDeliverableContent,
} from './deliverable-content-idb';
import { seedDefaultCostRatesIfEmpty } from './seed-default-cost-rates';
import { InMemoryUploadRefResolver, createWebSkillInstallEnvironment } from './skill-install-env';
import type { VaultActivation } from './vault-activation';
import type { BrowserVaultController } from './vault-browser-activation';
import { createDefaultBrowserVaultController } from './vault-browser-activation';

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
  await seedDefaultCostRatesIfEmpty(repos);
}

function wireDeliverableContentStore(snapshot: MemoryRepositoriesSnapshot | null): {
  dbPromise: Promise<IDBDatabase | null>;
  contentLoader: (id: string) => Promise<string | null>;
} {
  const dbPromise = openDeliverableContentDb();
  const legacyRows = extractLegacyDeliverableContent(snapshot);
  if (legacyRows.length > 0) {
    void dbPromise.then((db) => {
      if (!db) return;
      return Promise.all(
        legacyRows.map((row) =>
          putDeliverableContent(db, row.id, row.content).catch((err) => {
            console.warn(
              `[browser-runtime] legacy deliverable content migration failed for ${row.id}`,
              err,
            );
          }),
        ),
      );
    });
  }
  const contentLoader = async (id: string): Promise<string | null> => {
    const db = await dbPromise;
    return db ? getDeliverableContent(db, id) : null;
  };
  return { dbPromise, contentLoader };
}

const IS_DEV = import.meta.env.DEV;

export type RuntimeBundle = {
  eventBus: InMemoryEventBus;
  graph: ReturnType<typeof buildOffisimGraph>;
  runtimeCtx: ReturnType<typeof createRuntimeContext>;
  skillLoader: SkillLoader | null;
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
  packService?: AgentContextPackService;
  resumeCoordinator?: ResumeCoordinator;
  vaultActivation?: VaultActivation;
  desktopVaultRoot?: string | null;
  browserVault?: BrowserVaultController;
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
  const resolvedProvider = resolveProviderConfig(config);
  if (!resolvedProvider) {
    throw new Error('Unable to resolve the saved provider product configuration.');
  }
  const hostAvailability = resolveProviderHostAvailability(resolvedProvider, { tauri: false });
  if (!hostAvailability.available) {
    throw new Error(hostAvailability.message ?? 'Selected product is unavailable on this host.');
  }
  if (resolvedProvider.executionLane !== DEFAULT_EXECUTION_LANE) {
    throw new Error(
      `Execution lane "${resolvedProvider.executionLane}" is not available in browser-limited runtime. Switch back to "gateway" or move to a trusted backend host.`,
    );
  }
  if (
    resolvedProvider.transport.authStrategy === 'api-key' &&
    (!config.apiKey || !config.apiKey.trim())
  ) {
    throw new Error('API Key is required for this product in browser-limited runtime.');
  }

  const threadId = `thread-${companyId}`;
  const snapshot = loadBrowserRuntimeSnapshot();
  const { dbPromise, contentLoader } = wireDeliverableContentStore(snapshot);
  const repos = createMemoryRepositories(snapshot ?? undefined, contentLoader, eventBus);
  await ensureYoloMasterForActiveCompanies(repos);
  const company = await repos.companies.findById(companyId);
  if (!company) {
    throw new Error(`Active company "${companyId}" no longer exists. Select a company again.`);
  }
  const existingThread = await repos.threads.findById(threadId);
  if (!existingThread) {
    await repos.threads.create({
      thread_id: threadId,
      company_id: companyId,
      entry_mode: 'boss_chat',
      root_task_id: null,
      status: 'queued',
    });
  }
  await ensureCostRates(repos);
  const persistence = createBrowserRuntimePersistence(repos, eventBus);
  const skillLoader = SkillLoader.forRepos(repos);
  const browserVault = await createDefaultBrowserVaultController(eventBus, repos, companyId, {
    onActivate: (activation) => {
      void onVaultReadyForSkills(skillLoader, repos, activation.fs);
    },
  });
  const skillStagingManager = new SkillStagingManager();
  const uploadRefResolver = new InMemoryUploadRefResolver();
  const skillInstallEnvironment = createWebSkillInstallEnvironment({
    uploadResolver: uploadRefResolver,
  });
  const skillInstallCommitter = skillLoader
    ? new SkillInstallCommitter({
        companyId,
        threadId,
        skillLoader,
        staging: skillStagingManager,
        eventBus,
      })
    : null;
  const deliverablePersistence = new DeliverablePersistenceService({
    eventBus,
    repo: repos.deliverables,
  });
  const deliverableContentBridge = createDeliverableContentBridge({ eventBus, dbPromise });

  const proxyBaseURL =
    IS_DEV && resolvedProvider.transport.baseURL
      ? `${window.location.origin}/api/llm-proxy`
      : undefined;
  const proxyHeaders =
    IS_DEV && resolvedProvider.transport.baseURL
      ? {
          ...resolvedProvider.transport.defaultHeaders,
          'X-LLM-Base-URL': resolvedProvider.transport.baseURL,
        }
      : resolvedProvider.transport.defaultHeaders;

  const gateway = createGateway({
    provider: resolvedProvider.provider,
    apiKey: config.apiKey ?? '',
    baseURL: proxyBaseURL ?? resolvedProvider.transport.baseURL,
    defaultHeaders: proxyHeaders,
    dangerouslyAllowBrowser: true,
  });

  const runtimePolicy = resolveEffectiveRuntimePolicy(
    config.runtimePolicy,
    resolvedProvider.provider,
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
  const resumeCoordinator = new ResumeCoordinator(checkpointer);
  const graph = buildOffisimGraph({ checkpointer });

  const mcpToolExecutor = new McpToolExecutor({
    eventBus,
    companyId,
    clientFactory: new BrowserMcpClientFactory(),
  });
  const interactionBox = { pending: null };
  const hookRegistry = new HookRegistry();
  const scratchpad = new Scratchpad();
  const interactionService = new InteractionService({
    eventBus,
    companyId,
    threadId,
    defaultMode: opts?.defaultInteractionMode,
    pendingStore: interactionBox,
    threadRepo: repos.threads,
    activeRepo: repos.activeInteractions,
    historyRepo: repos.interactionHistory,
    permissionApprovals: repos.toolPermissionApprovals,
    hookRegistry,
    ...(skillInstallCommitter ? { skillInstallConfirmHandler: skillInstallCommitter } : {}),
  });
  await interactionService.restore();

  const toolExecutor = new AuditingToolExecutor(
    mcpToolExecutor,
    repos.mcpAudit,
    eventBus,
    companyId,
    threadId,
    new ToolPermissionEngine({
      companyId,
      employees: repos.employees,
      mcpAudit: repos.mcpAudit,
      approvals: repos.toolPermissionApprovals,
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
    runtimePolicy.modelPolicy.default.model,
    systemCaller,
  );
  const packService = new AgentContextPackService({
    threadId,
    companyId,
    getPendingInteraction: () => interactionService.getPending(),
    listNodeSummaries: (tid, opts) => repos.nodeSummaries.listByThread(tid, opts),
    listTaskRuns: (tid) => repos.taskRuns.findByThread(tid),
  });
  const middlewareChain = new LlmMiddlewareChain();
  middlewareChain.register(new SummarizationMiddleware(new ConversationBudgetService()));
  middlewareChain.register(new NodeContextMiddleware(repos.nodeSummaries, {}, packService));
  middlewareChain.register(new UserPreferenceMiddleware(userPrefRepo));
  const toolTelemetryService = new ToolTelemetryService(eventBus);
  const sessionCostTracker = await SessionCostTracker.create({
    eventBus,
    repos,
    companyId,
    threadId,
  });

  let runtimeCtx: ReturnType<typeof createRuntimeContext> | null = null;
  const rollingJournal = createRuntimeRollingJournal(() => {
    if (!runtimeCtx) {
      throw new Error('Runtime context is not ready for rolling journal.');
    }
    return runtimeCtx;
  });

  runtimeCtx = createRuntimeContext({
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
    hookRegistry,
    scratchpad,
    middlewareChain,
    systemCaller,
    sessionCostTracker,
    toolTelemetryService,
    interactionService,
    rollingJournal,
    resumeCoordinator,
    ...(skillLoader ? { skillLoader } : {}),
    skillStagingManager,
    skillInstallEnvironment,
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
    packService,
    resumeCoordinator,
    skillLoader,
    vaultActivation: browserVault.activation ?? undefined,
    desktopVaultRoot: null,
    browserVault,
    dispose: () => {
      browserVault.dispose();
      sessionCostTracker.dispose();
      toolTelemetryService.dispose();
      deliverablePersistence.dispose();
      deliverableContentBridge.dispose();
      persistence.dispose();
      installService.dispose();
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
  const snapshot = loadBrowserRuntimeSnapshot();
  const { dbPromise, contentLoader } = wireDeliverableContentStore(snapshot);
  const repos = createMemoryRepositories(snapshot ?? undefined, contentLoader, eventBus);
  await ensureYoloMasterForActiveCompanies(repos);
  await ensureCostRates(repos);
  const persistence = createBrowserRuntimePersistence(repos, eventBus);
  const liteSkillLoader = SkillLoader.forRepos(repos);
  const browserVault = await createDefaultBrowserVaultController(eventBus, repos, companyId, {
    onActivate: (activation) => {
      void onVaultReadyForSkills(liteSkillLoader, repos, activation.fs);
    },
  });
  const deliverablePersistence = new DeliverablePersistenceService({
    eventBus,
    repo: repos.deliverables,
  });
  const deliverableContentBridge = createDeliverableContentBridge({ eventBus, dbPromise });
  const interactionBox = { pending: null };
  const hookRegistry = new HookRegistry();
  const scratchpad = new Scratchpad();
  const interactionService = new InteractionService({
    eventBus,
    companyId,
    threadId,
    defaultMode: opts?.defaultInteractionMode,
    pendingStore: interactionBox,
    threadRepo: repos.threads,
    activeRepo: repos.activeInteractions,
    historyRepo: repos.interactionHistory,
    permissionApprovals: repos.toolPermissionApprovals,
    hookRegistry,
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
      hookRegistry,
      scratchpad,
      interactionService,
      ...(liteSkillLoader ? { skillLoader: liteSkillLoader } : {}),
    }),
    orch: null,
    installService: null,
    mcpToolExecutor: null,
    repos,
    userMemoryService: undefined,
    sessionCostTracker: undefined,
    toolTelemetryService: undefined,
    interactionService,
    skillLoader: liteSkillLoader,
    vaultActivation: browserVault.activation ?? undefined,
    desktopVaultRoot: null,
    browserVault,
    dispose: () => {
      browserVault.dispose();
      deliverablePersistence.dispose();
      deliverableContentBridge.dispose();
      persistence.dispose();
    },
  };
}

export { ensureCostRates };
