import {
  DeliverablePersistenceService,
  MemoryUserPreferenceRepository,
  SkillInstallCommitter,
  SkillLoader,
  SkillStagingManager,
  bindingStateChanged,
  installStateChanged,
  marketListingInstalled,
  onVaultReadyForSkills,
  workspaceBindingUnavailable,
} from '@offisim/core/browser';
import type { EventBus, InMemoryEventBus, RuntimeRepositories } from '@offisim/core/browser';
// Heavy imports — direct dist paths to bypass the @offisim/core barrel alias.
import { buildOffisimGraph } from '@offisim/core/dist/graph/main-graph.js';
import { createGateway } from '@offisim/core/dist/llm/gateway-factory.js';
import type { LlmGateway } from '@offisim/core/dist/llm/gateway.js';
import type {
  ModelRegistry,
  ModelRegistryEntry,
} from '@offisim/core/dist/llm/model-registry.js';
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
import type {
  InteractionMode,
  LlmProvider,
  RuntimeEvent,
  WorkspaceBindingConsumer,
  WorkspaceBindingUnavailableMissingAt,
} from '@offisim/shared-types';
import {
  getInstallEnvironmentForExecutionMode,
  getTrustedHostProductStatus,
  resolveEffectiveRuntimePolicy,
  resolveProviderConfig,
  resolveProviderHostAvailability,
} from '@offisim/ui-office/web';
import type { ProviderConfig, ResolvedProviderConfig } from '@offisim/ui-office/web';
import { installAttachmentDeleteCascades } from './attachment-cascades';
import { BrowserMcpClientFactory } from './browser-mcp-client';
import type { RuntimeBundle } from './browser-runtime';
import { seedDefaultCostRatesIfEmpty } from './seed-default-cost-rates';
import { InMemoryUploadRefResolver, createTauriSkillInstallEnvironment } from './skill-install-env';
import { TauriAttachmentStore } from './tauri-attachment-store';
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

interface TauriProviderProfile {
  readonly id: string;
  readonly displayName: string;
  readonly provider: LlmProvider;
  readonly model: string;
  readonly baseUrl: string;
  readonly secretRef: string;
}

function isLlmProvider(value: string): value is LlmProvider {
  return value === 'openai' || value === 'anthropic' || value === 'openai-compat';
}

function isTauriProviderProfile(value: unknown): value is TauriProviderProfile {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.id === 'string' &&
    typeof raw.displayName === 'string' &&
    typeof raw.provider === 'string' &&
    isLlmProvider(raw.provider) &&
    typeof raw.model === 'string' &&
    typeof raw.baseUrl === 'string' &&
    typeof raw.secretRef === 'string'
  );
}

class TauriProviderModelRegistry {
  private readonly profiles: TauriProviderProfile[];
  private readonly gateways = new Map<string, LlmGateway>();

  constructor(profiles: TauriProviderProfile[]) {
    this.profiles = profiles;
  }

  getGateway(modelId: string): LlmGateway | null {
    const cached = this.gateways.get(modelId);
    if (cached) return cached;
    const profile = this.profiles.find((entry) => entry.model === modelId || entry.id === modelId);
    if (!profile) return null;
    const gateway = createGateway({
      provider: profile.provider,
      apiKey: 'ignored',
      baseURL: profile.baseUrl,
      dangerouslyAllowBrowser: true,
      fetch: createTauriLlmFetch(authSchemeFor(profile.provider, profile.baseUrl), {
        secretRef: profile.secretRef,
      }),
    });
    this.gateways.set(modelId, gateway);
    if (modelId !== profile.model) this.gateways.set(profile.model, gateway);
    return gateway;
  }

  findById(modelId: string): ModelRegistryEntry | null {
    const profile = this.profiles.find((entry) => entry.model === modelId || entry.id === modelId);
    if (!profile) return null;
    return {
      id: profile.model,
      displayName: profile.displayName,
      provider: profile.provider,
      model: profile.model,
      apiKey: '$RUST_SECRET_SLOT',
      baseURL: profile.baseUrl,
    };
  }

  listModels(): ModelRegistryEntry[] {
    return this.profiles.map((profile) => ({
      id: profile.model,
      displayName: profile.displayName,
      provider: profile.provider,
      model: profile.model,
      apiKey: '$RUST_SECRET_SLOT',
      baseURL: profile.baseUrl,
    }));
  }

  disposeAll(): void {
    for (const gateway of this.gateways.values()) {
      gateway.dispose();
    }
    this.gateways.clear();
  }
}

async function createTauriProviderModelRegistry(): Promise<ModelRegistry | undefined> {
  const { invoke } = (await import('@tauri-apps/api/core')) as {
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
  const profiles = await invoke<unknown>('runtime_provider_profiles').catch(() => []);
  const valid = Array.isArray(profiles) ? profiles.filter(isTauriProviderProfile) : [];
  if (valid.length === 0) return undefined;
  return new TauriProviderModelRegistry(valid) as unknown as ModelRegistry;
}

const PERSISTED_RUNTIME_EVENT_PREFIXES = ['boss.', 'workspace-binding.'] as const;

const persistedRuntimeEventBuses = new WeakSet<EventBus>();

function runtimeEventId(event: RuntimeEvent): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `evt-${event.type.replace(/[^a-z0-9]+/giu, '-')}-${event.timestamp}-${suffix}`;
}

function runtimeEventSeverity(event: RuntimeEvent): 'info' | 'warn' | 'error' {
  if (event.type === 'workspace-binding.unavailable') return 'error';
  if (event.type === 'boss.employee-context.empty' || event.type === 'boss.roster-divergence') {
    return 'warn';
  }
  return 'info';
}

function persistSelectedRuntimeEvents(repos: RuntimeRepositories, eventBus: EventBus): void {
  if (persistedRuntimeEventBuses.has(eventBus)) return;
  persistedRuntimeEventBuses.add(eventBus);
  for (const prefix of PERSISTED_RUNTIME_EVENT_PREFIXES) {
    eventBus.on(prefix, (event: RuntimeEvent) => {
      void repos.events
        .insert({
          event_id: runtimeEventId(event),
          company_id: event.companyId,
          thread_id: event.threadId ?? null,
          event_type: event.type,
          severity: runtimeEventSeverity(event),
          payload_json: JSON.stringify(event.payload),
          created_at: new Date(event.timestamp).toISOString(),
        })
        .catch((err) => {
          console.error(`[tauri-runtime] failed to persist runtime event ${event.type}`, err);
        });
    });
  }
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

interface WorkspaceBinding {
  projectId: string | null;
  root: string;
}

async function workspaceBindingsFor(
  repos: RuntimeRepositories,
  companyId: string,
): Promise<WorkspaceBinding[]> {
  const roots = new Map<string, WorkspaceBinding>();
  const projects = await repos.projects.findActiveByCompany(companyId);
  for (const project of projects) {
    const root = project.workspace_root?.trim();
    if (root) roots.set(`project:${project.project_id}`, { projectId: project.project_id, root });
  }
  return [...roots.values()];
}

const WORKSPACE_BINDING_UNAVAILABLE_MESSAGE =
  'No project workspace root is bound for file/shell tools.';

interface WorkspaceRootResolverDeps {
  repos: RuntimeRepositories;
  eventBus: EventBus;
  companyId: string;
  emittedBindingMisses: Set<string>;
}

function emitWorkspaceBindingUnavailable(
  deps: WorkspaceRootResolverDeps,
  input: {
    projectId: string;
    expectedWorkspaceRoot: string | null;
    missingAt: WorkspaceBindingUnavailableMissingAt;
    consumer: WorkspaceBindingConsumer;
    threadId?: string;
  },
) {
  const key = `${deps.companyId}:${input.projectId}:${input.consumer}:${input.missingAt}`;
  if (deps.emittedBindingMisses.has(key)) return;
  deps.emittedBindingMisses.add(key);
  deps.eventBus.emit(
    workspaceBindingUnavailable(
      deps.companyId,
      input.projectId,
      {
        companyId: deps.companyId,
        projectId: input.projectId,
        expectedWorkspaceRoot: input.expectedWorkspaceRoot,
        missingAt: input.missingAt,
        consumer: input.consumer,
      },
      input.threadId,
    ),
  );
}

async function projectWorkspaceBindingForThread(
  deps: WorkspaceRootResolverDeps,
  threadId: string | undefined,
  consumer: WorkspaceBindingConsumer,
): Promise<WorkspaceBinding | null> {
  if (!threadId) return null;
  const thread = await deps.repos.threads.findById(threadId);
  const project = thread?.project_id ? await deps.repos.projects.findById(thread.project_id) : null;
  if (!project) return null;
  const root = project.workspace_root?.trim() || null;
  if (root) return { projectId: project.project_id, root };
  emitWorkspaceBindingUnavailable(deps, {
    projectId: project.project_id,
    expectedWorkspaceRoot: null,
    missingAt: 'runtime-context-read',
    consumer,
    threadId,
  });
  throw new Error(WORKSPACE_BINDING_UNAVAILABLE_MESSAGE);
}

async function optionalWorkspaceBindingForThread(
  deps: WorkspaceRootResolverDeps,
  threadId: string,
): Promise<WorkspaceBinding | undefined> {
  const binding = await projectWorkspaceBindingForThread(deps, threadId, 'skill-install').catch(
    (error) => {
      if (isWorkspaceBindingGuardError(error)) return null;
      throw error;
    },
  );
  if (binding?.root) return binding;

  const roots = await workspaceBindingsFor(deps.repos, deps.companyId);
  return roots.length === 1 ? roots[0] : undefined;
}

async function defaultWorkspaceBinding(
  deps: WorkspaceRootResolverDeps,
  consumer: WorkspaceBindingConsumer,
  threadId?: string,
): Promise<WorkspaceBinding> {
  const projectBinding = await projectWorkspaceBindingForThread(deps, threadId, consumer);
  if (projectBinding) return projectBinding;

  const { repos, companyId } = deps;
  const roots = await workspaceBindingsFor(repos, companyId);
  const projectRoots = roots.filter((binding) => binding.projectId !== null);
  if (projectRoots.length === 1 && projectRoots[0]) return projectRoots[0];
  if (roots.length === 1 && roots[0]) return roots[0];
  if (roots.length === 0) {
    const activeProjects = await repos.projects.findActiveByCompany(companyId);
    const [project] = activeProjects;
    if (activeProjects.length === 1 && project) {
      emitWorkspaceBindingUnavailable(deps, {
        projectId: project.project_id,
        expectedWorkspaceRoot: project.workspace_root?.trim() || null,
        missingAt: 'runtime-context-read',
        consumer,
        ...(threadId ? { threadId } : {}),
      });
    }
    throw new Error(WORKSPACE_BINDING_UNAVAILABLE_MESSAGE);
  }
  throw new Error('Multiple workspace roots are bound; pass an absolute path or cwd.');
}

function isWorkspaceBindingGuardError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('no project workspace_root is bound') ||
    message.includes('No project workspace root is bound')
  );
}

function emitSandboxPreconditionMiss(
  deps: WorkspaceRootResolverDeps,
  binding: WorkspaceBinding,
  consumer: WorkspaceBindingConsumer,
  threadId?: string,
): void {
  if (!binding.projectId) return;
  emitWorkspaceBindingUnavailable(deps, {
    projectId: binding.projectId,
    expectedWorkspaceRoot: binding.root,
    missingAt: 'sandbox-precondition',
    consumer,
    ...(threadId ? { threadId } : {}),
  });
}

async function invokeProjectCommand<T>(
  deps: WorkspaceRootResolverDeps,
  binding: WorkspaceBinding,
  command: string,
  args: Record<string, unknown>,
  consumer: WorkspaceBindingConsumer,
  threadId?: string,
): Promise<T> {
  const { invoke } = (await import('@tauri-apps/api/core')) as {
    invoke: <TResult>(cmd: string, args?: Record<string, unknown>) => Promise<TResult>;
  };
  try {
    return await invoke<T>(command, {
      ...args,
      ...(binding.projectId ? { projectId: binding.projectId } : {}),
    });
  } catch (error) {
    if (isWorkspaceBindingGuardError(error)) {
      emitSandboxPreconditionMiss(deps, binding, consumer, threadId);
    }
    throw error;
  }
}

function createTauriBuiltinFs(deps: WorkspaceRootResolverDeps): FsAdapter {
  return {
    async readFile(path, options) {
      const binding = await defaultWorkspaceBinding(deps, 'builtin-sandbox', options?.threadId);
      const cwd = (await isAbsolutePath(path)) ? undefined : binding.root;
      return invokeProjectCommand<string>(
        deps,
        binding,
        'project_read_file',
        { path, cwd },
        'builtin-sandbox',
        options?.threadId,
      );
    },
    async writeFile(path, content, options) {
      const binding = await defaultWorkspaceBinding(deps, 'builtin-sandbox', options?.threadId);
      const cwd = (await isAbsolutePath(path)) ? undefined : binding.root;
      await invokeProjectCommand<void>(
        deps,
        binding,
        'project_write_file',
        { path, content, cwd },
        'builtin-sandbox',
        options?.threadId,
      );
    },
    async exists(path, options) {
      const binding = await defaultWorkspaceBinding(deps, 'builtin-sandbox', options?.threadId);
      const cwd = (await isAbsolutePath(path)) ? undefined : binding.root;
      try {
        await invokeProjectCommand<string>(
          deps,
          binding,
          'project_read_file',
          { path, cwd },
          'builtin-sandbox',
          options?.threadId,
        );
        return true;
      } catch {
        return false;
      }
    },
  };
}

function createTauriShellExec(deps: WorkspaceRootResolverDeps): ShellExec {
  return async (command, options): Promise<ShellExecResult> => {
    const binding = await defaultWorkspaceBinding(deps, 'builtin-sandbox', options.threadId);
    const cwd = options.cwd
      ? (await isAbsolutePath(options.cwd))
        ? options.cwd
        : await joinPath(binding.root, options.cwd)
      : binding.root;
    const result = await invokeProjectCommand<{
      stdout: string;
      stderr: string;
      exitCode: number;
      timedOut: boolean;
    }>(
      deps,
      binding,
      'bash_execute',
      {
        cwd,
        cmd: command,
        timeoutMs: options.timeoutMs ?? 30_000,
        maxOutputBytes: options.maxOutputBytes ?? 1024 * 1024,
      },
      'builtin-sandbox',
      options.threadId,
    );
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
    emitMarketListingInstalled(companyId, listingId, kind, extras) {
      eventBus.emit(marketListingInstalled(companyId, listingId, kind, extras));
    },
  };
}

function createSkillMarketEmitter(eventBus: EventBus) {
  return {
    emitMarketListingInstalled(
      companyId: string,
      listingId: string,
      kind: 'skill',
      extras?: { skillId?: string },
    ) {
      eventBus.emit(marketListingInstalled(companyId, listingId, kind, extras));
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
  persistSelectedRuntimeEvents(repos, eventBus);
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
  const modelRegistry = await createTauriProviderModelRegistry();

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
  const workspaceRootResolverDeps: WorkspaceRootResolverDeps = {
    repos,
    eventBus,
    companyId,
    emittedBindingMisses: new Set(),
  };
  const attachmentStore = new TauriAttachmentStore();
  installAttachmentDeleteCascades({ repos, attachmentStore, eventBus });
  const builtinTools: Map<string, BuiltinTool> =
    resolvedProvider.executionLane === 'gateway'
      ? createBuiltinTools({
          executionMode: 'desktop-trusted',
          fs: createTauriBuiltinFs(workspaceRootResolverDeps),
          shellExec: createTauriShellExec(workspaceRootResolverDeps),
          bashTimeoutMs: 30_000,
          maxOutputBytes: 1024 * 1024,
          attachmentStoreBridge: attachmentStore,
          eventBus,
          companyId,
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
  const compositeToolExecutor = new CompositeToolExecutor(builtinTools, fileHistoryToolExecutor, {
    companyId,
  });
  const interactionBox = { pending: null };
  const hookRegistry = new HookRegistry();
  const scratchpad = new Scratchpad();
  const skillLoader = SkillLoader.forRepos(repos, createSkillMarketEmitter(eventBus));
  const skillStagingManager = new SkillStagingManager();
  const uploadRefResolver = new InMemoryUploadRefResolver();
  await prefetchTauriHomeDir();
  const skillInstallBinding = await optionalWorkspaceBindingForThread(
    workspaceRootResolverDeps,
    threadId,
  );
  const skillInstallEnvironment = createTauriSkillInstallEnvironment({
    clone: createTauriGitCloneAdapter(),
    gitFs: createTauriGitLocalFsAdapter(),
    localDir: createTauriLocalDirAdapter(
      skillInstallBinding
        ? {
            projectRoot: skillInstallBinding.root,
            ...(skillInstallBinding.projectId ? { projectId: skillInstallBinding.projectId } : {}),
          }
        : undefined,
    ),
    uploadResolver: uploadRefResolver,
    ...(skillInstallBinding ? { repoRoot: skillInstallBinding.root } : {}),
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
    ...(modelRegistry ? { modelRegistry } : {}),
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
    attachmentStoreBridge: attachmentStore,
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
    attachmentStore,
    dispose: () => {
      sessionCostTracker.dispose();
      toolTelemetryService.dispose();
      modelRegistry?.disposeAll();
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
