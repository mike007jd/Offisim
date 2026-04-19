import {
  DeliverablePersistenceService,
  MemoryUserPreferenceRepository,
  SkillInstallCommitter,
  SkillLoader,
  SkillStagingManager,
  bindingStateChanged,
  installStateChanged,
  onVaultReadyForSkills,
} from '@offisim/core/browser';
import type { EventBus, InMemoryEventBus, RuntimeRepositories } from '@offisim/core/browser';
// Heavy imports — direct dist paths to bypass the @offisim/core barrel alias.
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
import { HookRegistry } from '@offisim/core/dist/runtime/hook-registry.js';
import { createRuntimeContext } from '@offisim/core/dist/runtime/runtime-context.js';
import { Scratchpad } from '@offisim/core/dist/runtime/scratchpad.js';
import { SessionCostTracker } from '@offisim/core/dist/runtime/session-cost-tracker.js';
import { AgentContextPackService } from '@offisim/core/dist/services/agent-context-pack-service.js';
import { ConversationBudgetService } from '@offisim/core/dist/services/conversation-budget-service.js';
import {
  FileHistoryService,
  FileHistoryToolExecutor,
} from '@offisim/core/dist/services/file-history-service.js';
import { GitAutoCommitService } from '@offisim/core/dist/services/git-auto-commit-service.js';
import type { GitExec } from '@offisim/core/dist/services/git-auto-commit-service.js';
import { InteractionService } from '@offisim/core/dist/services/interaction-service.js';
import { MemoryService } from '@offisim/core/dist/services/memory-service.js';
import { ToolTelemetryService } from '@offisim/core/dist/services/tool-telemetry-service.js';
import { UserMemoryService } from '@offisim/core/dist/services/user-memory-service.js';
import { InstallService } from '@offisim/install-core';
import type { InstallEventEmitter, InstallRepositories } from '@offisim/install-core';
import type { InteractionMode } from '@offisim/shared-types';
import {
  buildSubscriptionGatewayConfig,
  getInstallEnvironmentForExecutionMode,
  resolveEffectiveRuntimePolicy,
} from '@offisim/ui-office/web';
import type { ProviderConfig } from '@offisim/ui-office/web';
import { BrowserMcpClientFactory } from './browser-mcp-client';
import type { RuntimeBundle } from './browser-runtime';
import { seedDefaultCostRatesIfEmpty } from './seed-default-cost-rates';
import { InMemoryUploadRefResolver, createTauriSkillInstallEnvironment } from './skill-install-env';
import { TauriCheckpointSaver } from './tauri-checkpoint';
import { createTauriDrizzleDb } from './tauri-drizzle';
import { TauriFileSnapshotAdapter } from './tauri-file-snapshot-adapter';
import { TauriMcpClientFactory } from './tauri-mcp-client';
import { createTauriRepositories } from './tauri-repos';
import {
  createTauriGitCloneAdapter,
  createTauriGitLocalFsAdapter,
  createTauriLocalDirAdapter,
  prefetchTauriHomeDir,
} from './tauri-skill-install-adapters';
import { tryActivateTauriVault } from './vault-tauri-activation';

// ---------------------------------------------------------------------------
// Adapters: bridge @offisim/core repos + EventBus to @offisim/install-core DI
// ---------------------------------------------------------------------------

/** Adapts RuntimeRepositories to InstallRepositories (structurally identical). */
function createInstallReposAdapter(repos: RuntimeRepositories): InstallRepositories {
  return {
    installTransactions: repos.installTransactions,
    installedPackages: repos.installedPackages,
    installedAssets: repos.installedAssets,
    assetBindings: repos.assetBindings,
    employees: repos.employees,
  };
}

/** Adapts the core EventBus to InstallEventEmitter. */
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

/**
 * Create the full runtime stack for Tauri desktop mode.
 *
 * Differences from browser mode:
 * 1. Repos: Drizzle sqlite-proxy → persistent SQLite (not memory)
 * 2. Checkpointer: TauriCheckpointSaver → persistent (not MemorySaver)
 * 3. Gateway: Direct API calls, no Vite proxy (tauri-plugin-cors-fetch handles CORS)
 * 4. DB seed: Run once on first launch
 *
 * @param config - Provider configuration (API key, model, etc.)
 * @param eventBus - Shared EventBus instance from the Provider. Using a shared
 *   bus avoids the "EventBus churn" problem where async init would create a
 *   different bus than what UI hooks subscribe to.
 */
export async function createTauriRuntime(
  config: ProviderConfig,
  eventBus: InMemoryEventBus,
  companyId: string,
  opts?: { defaultInteractionMode?: InteractionMode },
): Promise<RuntimeBundle> {
  const threadId = `thread-${companyId}`;
  const db = createTauriDrizzleDb();
  const repos = createTauriRepositories(db);
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
  const deliverablePersistence = new DeliverablePersistenceService({
    eventBus,
    repo: repos.deliverables,
  });

  const gateway = createGateway({
    provider: config.provider,
    apiKey: '',
    baseURL: config.baseURL,
    defaultHeaders: config.defaultHeaders,
    dangerouslyAllowBrowser: true,
    subscription: buildSubscriptionGatewayConfig(config),
  });

  const runtimePolicy = resolveEffectiveRuntimePolicy(
    config.runtimePolicy,
    config.provider,
    config.model,
    { tauri: true },
  );

  const modelResolver = new ModelResolver(runtimePolicy, {
    provider: runtimePolicy.modelPolicy.default.provider,
    model: runtimePolicy.modelPolicy.default.model,
    temperature: runtimePolicy.modelPolicy.default.temperature ?? 0.7,
    maxTokens: runtimePolicy.modelPolicy.default.maxTokens ?? 4096,
  });

  const checkpointer = new TauriCheckpointSaver();
  const graph = buildOffisimGraph({ checkpointer });

  // MCP tool executor — TauriMcpClientFactory supports both stdio (via Rust bridge) and SSE
  const mcpToolExecutor = new McpToolExecutor({
    eventBus,
    companyId,
    clientFactory:
      runtimePolicy.executionMode === 'browser-limited'
        ? new BrowserMcpClientFactory()
        : new TauriMcpClientFactory(),
  });
  const fileHistoryService = new FileHistoryService(
    repos.fileHistory,
    new TauriFileSnapshotAdapter(),
  );
  const fileHistoryToolExecutor = new FileHistoryToolExecutor(mcpToolExecutor, fileHistoryService, {
    threadId,
    companyId,
  });
  const interactionBox = { pending: null };
  const hookRegistry = new HookRegistry();
  const scratchpad = new Scratchpad();
  const skillLoader = SkillLoader.forRepos(repos);
  const skillStagingManager = new SkillStagingManager();
  const uploadRefResolver = new InMemoryUploadRefResolver();
  void prefetchTauriHomeDir();
  const skillInstallEnvironment = createTauriSkillInstallEnvironment({
    clone: createTauriGitCloneAdapter(),
    gitFs: createTauriGitLocalFsAdapter(),
    localDir: createTauriLocalDirAdapter(),
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
  const interactionService = new InteractionService({
    eventBus,
    companyId,
    threadId,
    defaultMode: opts?.defaultInteractionMode,
    pendingStore: interactionBox,
    threadRepo: repos.threads,
    activeRepo: repos.activeInteractions,
    historyRepo: repos.interactionHistory,
    hookRegistry,
    ...(skillInstallCommitter ? { skillInstallConfirmHandler: skillInstallCommitter } : {}),
  });
  await interactionService.restore();

  // Wrap with audit logging — writes to mcp_audit_log + emits mcp.tool.result events
  const toolExecutor = new AuditingToolExecutor(
    fileHistoryToolExecutor,
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
    hookRegistry,
    scratchpad,
    middlewareChain,
    systemCaller,
    sessionCostTracker,
    toolTelemetryService,
    fileHistoryService,
    interactionService,
    ...(skillLoader ? { skillLoader } : {}),
    skillStagingManager,
    skillInstallEnvironment,
  });

  // Git auto-commit service (desktop only — uses Tauri git_exec bridge)
  const tauriGitExec: GitExec = async (args, cwd) => {
    const { invoke } = (await import('@tauri-apps/api/core')) as {
      invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
    return invoke<{ ok: boolean; stdout: string; stderr: string }>('git_exec', { args, cwd });
  };
  const gitAutoCommitService = new GitAutoCommitService(
    {
      companies: repos.companies,
      fileHistory: repos.fileHistory,
      nodeSummaries: repos.nodeSummaries,
    },
    eventBus,
    tauriGitExec,
  );
  hookRegistry.register({
    event: 'task.completed',
    name: 'git-auto-commit',
    handler: async (payload) => {
      if (runtimePolicy.gitAutoCommit === false) return;
      const p = payload as { threadId: string; companyId: string; stepIndex: number };
      await gitAutoCommitService.commitStepChanges(p.threadId, p.companyId, p.stepIndex);
    },
    timeout: 15_000,
  });

  // Seed default cost rates (idempotent — skips if rates already exist)
  await seedCostRates(repos);

  // Install service — Drizzle-backed repos for persistent install state.
  // sqlite-proxy repos are async, so they intentionally do not expose the
  // synchronous transact() contract used by the better-sqlite3 runtime.
  const installService = new InstallService({
    repos: createInstallReposAdapter(repos),
    events: createEventEmitterAdapter(eventBus),
    companyId,
    environment: {
      runtimeVersion: '0.1.0',
      environment: getInstallEnvironmentForExecutionMode(runtimePolicy.executionMode),
      schemaVersion: '2026-03',
    },
    transact: undefined,
  });

  const { OrchestrationService } = await import(
    '@offisim/core/dist/services/orchestration-service.js'
  );
  const orch = new OrchestrationService(graph, runtimeCtx, {
    checkpointSaver: checkpointer,
  });

  const vaultActivation = await tryActivateTauriVault({ eventBus, repos, companyId });
  if (vaultActivation) {
    void onVaultReadyForSkills(skillLoader, repos, vaultActivation.fs);
  }

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
    skillLoader,
    vaultActivation: vaultActivation ?? undefined,
    desktopVaultRoot: vaultActivation?.root ?? null,
    dispose: () => {
      sessionCostTracker.dispose();
      toolTelemetryService.dispose();
      installService.dispose();
      deliverablePersistence.dispose();
      vaultActivation?.dispose();
    },
  };
}

/**
 * Seed default LLM cost rates into the Tauri runtime's persistent DB.
 * Idempotent: skips if rates already exist.
 */
async function seedCostRates(repos: RuntimeRepositories): Promise<void> {
  await seedDefaultCostRatesIfEmpty(repos);
}
