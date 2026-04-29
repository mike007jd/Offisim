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
import type { LlmGateway } from '@offisim/core/dist/llm/gateway.js';
import { ModelResolver } from '@offisim/core/dist/llm/model-resolver.js';
import { OpenAiAgentsSdkAdapter } from '@offisim/core/dist/llm/openai-agents-sdk-adapter.js';
import { assertOpenAiAgentsSdkLaneSupported } from '@offisim/core/dist/llm/openai-agents-sdk-lane-policy.js';
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
import { AgentContextPackService } from '@offisim/core/dist/services/agent-context-pack-service.js';
import { ConversationBudgetService } from '@offisim/core/dist/services/conversation-budget-service.js';
import { createRuntimeRollingJournal } from '@offisim/core/dist/services/conversation-budget/rolling-journal-runtime.js';
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
import { type BuiltinTool, createBuiltinTools } from '@offisim/core/dist/tools/builtin/index.js';
import type {
  FsAdapter,
  ShellExec,
  ShellExecResult,
} from '@offisim/core/dist/tools/builtin/types.js';
import { CompositeToolExecutor } from '@offisim/core/dist/tools/composite-tool-executor.js';
import { InstallService } from '@offisim/install-core';
import type { InstallEventEmitter, InstallRepositories } from '@offisim/install-core';
import type { InteractionMode } from '@offisim/shared-types';
import {
  getInstallEnvironmentForExecutionMode,
  getTrustedHostProductStatus,
  resolveEffectiveRuntimePolicy,
  resolveProviderConfig,
  resolveProviderHostAvailability,
} from '@offisim/ui-office/web';
import type { ProviderConfig, ResolvedProviderConfig } from '@offisim/ui-office/web';
import { BrowserMcpClientFactory } from './browser-mcp-client';
import type { RuntimeBundle } from './browser-runtime';
import { seedDefaultCostRatesIfEmpty } from './seed-default-cost-rates';
import { InMemoryUploadRefResolver, createTauriSkillInstallEnvironment } from './skill-install-env';
import { TauriCheckpointSaver } from './tauri-checkpoint';
import { TauriClaudeAgentSdkGateway } from './tauri-claude-agent-sdk';
import { TauriCodexAgentSdkGateway } from './tauri-codex-agent-sdk';
import { createTauriDrizzleDb } from './tauri-drizzle';
import { createTauriEngineAdapterRegistry } from './tauri-engine-adapters';
import { TauriFileSnapshotAdapter } from './tauri-file-snapshot-adapter';
import { type AuthScheme, createTauriLlmFetch } from './tauri-llm-fetch';
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
// Credential-isolated transport: every Tauri LLM gateway gets a Rust-backed
// fetch. The auth scheme is decided once per gateway construction from the
// provider kind + baseURL; it does not change per-request within a gateway's
// lifetime (see openspec/specs/desktop-llm-credential-isolation/spec.md).
// ---------------------------------------------------------------------------

function authSchemeFor(provider: ResolvedProviderConfig['provider'], baseURL?: string): AuthScheme {
  if (provider === 'anthropic') {
    // Official api.anthropic.com uses the legacy `x-api-key` header. Every
    // third-party Anthropic-compatible endpoint (MiniMax et al.) expects a
    // standard Bearer token instead, matching what the adapter's old
    // buildBrowserCompatHeaders shim emitted.
    if (!baseURL) return 'x-api-key';
    try {
      const host = new URL(baseURL).host;
      return host.endsWith('api.anthropic.com') ? 'x-api-key' : 'bearer';
    } catch {
      return 'bearer';
    }
  }
  // OpenAI and every OpenAI-compatible endpoint (Kimi / OpenRouter / Gemini
  // compat / Zai / MiniMax openai-compat / LM Studio / etc.) use Bearer.
  return 'bearer';
}

function createTauriExecutionAdapter(
  config: ProviderConfig,
  resolved: ResolvedProviderConfig,
): LlmGateway {
  switch (resolved.executionLane) {
    case 'gateway':
      return createGateway({
        provider: resolved.provider,
        // Tauri runtime never sees the provider credential — it lives only in
        // Rust storage and is injected by the Rust-side bridge. The HTTP SDK
        // clients still demand a non-empty string, so we pass a sentinel.
        apiKey: 'ignored',
        baseURL: resolved.transport.baseURL,
        defaultHeaders: resolved.transport.defaultHeaders,
        dangerouslyAllowBrowser: true,
        fetch: createTauriLlmFetch(authSchemeFor(resolved.provider, resolved.transport.baseURL)),
      });
    case 'claude-agent-sdk':
      if (resolved.provider !== 'anthropic') {
        throw new Error(
          `Execution lane "claude-agent-sdk" currently requires provider "anthropic"; received "${resolved.provider}".`,
        );
      }
      return new TauriClaudeAgentSdkGateway({
        baseURL: resolved.transport.baseURL,
        credentialMode:
          resolved.transport.authStrategy === 'trusted-local-auth' ? 'local-auth' : 'api-key',
      });
    case 'codex-agent-sdk':
      if (resolved.provider !== 'openai') {
        throw new Error(
          `Execution lane "codex-agent-sdk" currently requires provider "openai"; received "${resolved.provider}".`,
        );
      }
      return new TauriCodexAgentSdkGateway();
    case 'openai-agents-sdk':
      assertOpenAiAgentsSdkLaneSupported({
        provider: resolved.provider,
        providerVariantId: resolved.variant?.providerVariantId ?? config.providerVariantId,
        allowExperimentalCompat: false,
      });
      return new OpenAiAgentsSdkAdapter('ignored', {
        baseURL: resolved.transport.baseURL,
        defaultHeaders: resolved.transport.defaultHeaders,
        dangerouslyAllowBrowser: true,
        fetch: createTauriLlmFetch('bearer'),
      });
    default:
      throw new Error(`Unknown execution lane: ${config.executionLane as string}`);
  }
}

type TauriPathModule = {
  isAbsolute: (path: string) => Promise<boolean>;
  join: (...paths: string[]) => Promise<string>;
};

let tauriPathPromise: Promise<TauriPathModule> | null = null;

function tauriPath(): Promise<TauriPathModule> {
  if (!tauriPathPromise) {
    tauriPathPromise = import('@tauri-apps/api/path') as unknown as Promise<TauriPathModule>;
  }
  return tauriPathPromise;
}

function fallbackIsAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/u.test(path);
}

async function isAbsolutePath(path: string): Promise<boolean> {
  try {
    const paths = await tauriPath();
    return paths.isAbsolute(path);
  } catch {
    return fallbackIsAbsolutePath(path);
  }
}

async function joinPath(root: string, rel: string): Promise<string> {
  if (!rel || rel === '.') return root;
  try {
    const paths = await tauriPath();
    return paths.join(root, rel);
  } catch {
    const normalized = rel.replace(/^[\\/]+/u, '');
    const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
    return root.endsWith('/') || root.endsWith('\\')
      ? `${root}${normalized}`
      : `${root}${separator}${normalized}`;
  }
}

async function workspaceRootsFor(
  repos: RuntimeRepositories,
  companyId: string,
  companyRoot: string | null,
): Promise<string[]> {
  const roots = new Set<string>();
  if (companyRoot?.trim()) roots.add(companyRoot.trim());
  const projects = await repos.projects.findActiveByCompany(companyId);
  for (const project of projects) {
    if (project.workspace_root?.trim()) roots.add(project.workspace_root.trim());
  }
  return [...roots];
}

async function defaultWorkspaceRoot(
  repos: RuntimeRepositories,
  companyId: string,
  companyRoot: string | null,
): Promise<string> {
  const roots = await workspaceRootsFor(repos, companyId, companyRoot);
  if (roots.length === 1 && roots[0]) return roots[0];
  if (roots.length === 0) {
    throw new Error('No project workspace root is bound for file/shell tools.');
  }
  throw new Error('Multiple workspace roots are bound; pass an absolute path or cwd.');
}

function createTauriBuiltinFs(
  repos: RuntimeRepositories,
  companyId: string,
  companyRoot: string | null,
): FsAdapter {
  return {
    async readFile(path) {
      const { invoke } = (await import('@tauri-apps/api/core')) as {
        invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      };
      const cwd = (await isAbsolutePath(path))
        ? undefined
        : await defaultWorkspaceRoot(repos, companyId, companyRoot);
      return invoke<string>('project_read_file', { path, cwd });
    },
    async writeFile(path, content) {
      const { invoke } = (await import('@tauri-apps/api/core')) as {
        invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      };
      const cwd = (await isAbsolutePath(path))
        ? undefined
        : await defaultWorkspaceRoot(repos, companyId, companyRoot);
      await invoke<void>('project_write_file', { path, content, cwd });
    },
    async exists(path) {
      const { invoke } = (await import('@tauri-apps/api/core')) as {
        invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      };
      const cwd = (await isAbsolutePath(path))
        ? undefined
        : await defaultWorkspaceRoot(repos, companyId, companyRoot);
      try {
        await invoke<string>('project_read_file', { path, cwd });
        return true;
      } catch {
        return false;
      }
    },
  };
}

function createTauriShellExec(
  repos: RuntimeRepositories,
  companyId: string,
  companyRoot: string | null,
): ShellExec {
  return async (command, options): Promise<ShellExecResult> => {
    const { invoke } = (await import('@tauri-apps/api/core')) as {
      invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
    const root = await defaultWorkspaceRoot(repos, companyId, companyRoot);
    const cwd = options.cwd
      ? (await isAbsolutePath(options.cwd))
        ? options.cwd
        : await joinPath(root, options.cwd)
      : root;
    const result = await invoke<{
      stdout: string;
      stderr: string;
      exitCode: number;
      timedOut: boolean;
    }>('bash_execute', {
      cwd,
      cmd: command,
      timeoutMs: options.timeoutMs ?? 30_000,
      maxOutputBytes: options.maxOutputBytes ?? 1024 * 1024,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    };
  };
}

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
  const resolvedProvider = resolveProviderConfig(config);
  if (!resolvedProvider) {
    throw new Error('Unable to resolve the saved provider product configuration.');
  }
  const trustedHostStatus =
    resolvedProvider.transport.authStrategy === 'trusted-local-auth'
      ? await getTrustedHostProductStatus(config.productId, config.accessMode)
      : null;
  const hostAvailability = resolveProviderHostAvailability(resolvedProvider, {
    tauri: true,
    trustedHostStatus,
  });
  if (!hostAvailability.available) {
    throw new Error(hostAvailability.message ?? 'Selected product is unavailable on this host.');
  }

  const threadId = `thread-${companyId}`;
  const db = createTauriDrizzleDb();
  const repos = createTauriRepositories(db, eventBus);
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
  const deliverablePersistence = new DeliverablePersistenceService({
    eventBus,
    repo: repos.deliverables,
  });

  const gateway = createTauriExecutionAdapter(config, resolvedProvider);

  const runtimePolicy = resolveEffectiveRuntimePolicy(
    config.runtimePolicy,
    resolvedProvider.provider,
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
  const resumeCoordinator = new ResumeCoordinator(checkpointer);
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
  const builtinTools: Map<string, BuiltinTool> =
    resolvedProvider.executionLane === 'gateway'
      ? createBuiltinTools({
          executionMode: 'desktop-trusted',
          fs: createTauriBuiltinFs(repos, companyId, company.workspace_root),
          shellExec: createTauriShellExec(repos, companyId, company.workspace_root),
          bashTimeoutMs: 30_000,
          maxOutputBytes: 1024 * 1024,
        })
      : new Map();
  if (builtinTools.size > 0) {
    builtinTools.delete('web_search');
  }
  const fileHistoryService = new FileHistoryService(
    repos.fileHistory,
    new TauriFileSnapshotAdapter(),
  );
  const fileHistoryToolExecutor = new FileHistoryToolExecutor(mcpToolExecutor, fileHistoryService, {
    threadId,
    companyId,
  });
  const compositeToolExecutor = new CompositeToolExecutor(builtinTools, fileHistoryToolExecutor);
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
    permissionApprovals: repos.toolPermissionApprovals,
    hookRegistry,
    ...(skillInstallCommitter ? { skillInstallConfirmHandler: skillInstallCommitter } : {}),
  });
  await interactionService.restore();

  // Wrap with audit logging — writes to mcp_audit_log + emits mcp.tool.result events
  const toolExecutor = new AuditingToolExecutor(
    compositeToolExecutor,
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
    llmToolCallsEnabled: resolvedProvider.executionLane === 'gateway',
    ...(builtinTools.size > 0 ? { builtinTools } : {}),
    fileHistoryService,
    engineAdapters: createTauriEngineAdapterRegistry({ enableProviderHostPreviewAdapters: true }),
    interactionService,
    rollingJournal,
    resumeCoordinator,
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
    resumeCoordinator,
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
