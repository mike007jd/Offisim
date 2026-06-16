import {
  type RuntimeProviderProfile,
  findDefaultChatProviderProfile,
  loadRuntimeProviderProfiles,
} from '@/lib/provider-bridge.js';
import { createTauriLlmFetch } from '@/lib/tauri-llm-fetch.js';
import { createTauriMcpClientFactory } from '@/lib/tauri-mcp-client-factory.js';
import { loadRegisteredStdioMcpConfigs } from '@/lib/tauri-mcp-config.js';
import { createTauriProjectFsAdapter } from '@/lib/tauri-project-fs-adapter.js';
import { createTauriShellExecAdapter } from '@/lib/tauri-shell-exec-adapter.js';
import { createTauriVaultFileSystem } from '@/lib/tauri-vault-fs.js';
import {
  InteractionService,
  type RuntimeRepositories,
  SkillInstallCommitter,
  type SkillInstallEnvironment,
  SkillLoader,
  SkillStagingManager,
} from '@offisim/core/browser';
import { ModelResolver, createGateway } from '@offisim/core/llm';
import { AuditingToolExecutor, McpToolExecutor } from '@offisim/core/mcp';
import { LlmMiddlewareChain, SummarizationMiddleware } from '@offisim/core/middleware';
import {
  PiAgentRegistry,
  PiMessageStore,
  PiOrchestrationService,
  createPiStreamFn,
  createRuntimeContext,
  createSkillInstallTools,
  createSubmitDeliverableTool,
} from '@offisim/core/runtime';
import { ConversationBudgetService, DeliverablePersistenceService } from '@offisim/core/services';
import { CompositeToolExecutor, createBuiltinTools } from '@offisim/core/tools';
import type {
  InteractionResponse,
  LlmProvider,
  ModelPolicyConfig,
  SkillInstallOutcomeKind,
} from '@offisim/shared-types';
import { ensureProjectBoundForRun } from './ensure-default-workspace.js';
import { piThinkingLevel } from './pi-kernel-flag.js';
import { getRepos, runtimeEventBus } from './repos.js';

/**
 * The pi agent-loop runtime that backs desktop chat. This is the ONLY chat path
 * on desktop — the LangGraph orchestration and the single-shot direct-provider
 * completion before it were both retired in the pi-kernel cut-over (P6).
 *
 * It assembles the runtime-context stack (credential-isolated Tauri transport,
 * Drizzle-backed repos, sandboxed `project_*` file tools, sandboxed
 * `bash_execute` shell) and drives one pi agent per worker: a boss agent
 * delegates to employee sub-agents via the explicit `delegate` tool; each
 * sub-agent resolves the active provider model, calls the gateway, and reaches
 * the builtin read/write/bash/glob/grep tools plus any registered stdio MCP
 * server. Deliverables are an explicit `submit_deliverable` tool (no intent
 * guessing). Every tool call — builtin and MCP — is recorded in `mcp_audit_log`
 * via the AuditingToolExecutor wrapper. Per-message transcripts persist to the
 * `pi_messages` table for multi-turn memory + resume.
 */

/** Map a (possibly wider) provider profile string onto the core LlmProvider union. */
function toCoreProvider(provider: string): LlmProvider {
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'openai') return 'openai';
  // Everything else (minimax, openrouter, zai, kimi, gemini, local, …) speaks the
  // OpenAI-compatible chat shape via its own baseURL.
  return 'openai-compat';
}

export interface DesktopAgentRunInput {
  /** User message text for this turn. */
  text: string;
  /** Runtime thread id (per-run, not per-singleton). */
  threadId: string;
  /** Employee that holds this direct chat; null routes the turn to the boss. */
  employeeId: string | null;
  /** Active project id for workspace-scoped tools; null for unscoped chats. */
  projectId: string | null;
}

export interface DesktopAgentRuntime {
  /** Run one direct-chat turn through the pi kernel; resolves to the assistant text. */
  execute(input: DesktopAgentRunInput): Promise<string>;
  /** Abort the in-flight run on a thread (Stop). */
  abort(threadId: string): void;
  /**
   * Resolve a pending interaction (e.g. a `skill_install_confirm` preview). The
   * renderer calls this when the user clicks Confirm/Cancel on the confirm bar;
   * on confirm the staged skill is committed to the vault + skills table by the
   * InteractionService's SkillInstallCommitter handler. Returns the structured
   * skill-install outcome (for confirm) so the caller can surface the result.
   */
  resolveInteraction(response: InteractionResponse): Promise<SkillInstallOutcomeKind | null>;
  /**
   * Resume an interrupted turn on a thread from its persisted transcript.
   * Fire-and-forget from the ResumeBar; the pi loop continues the saved
   * transcript (dangling tool calls patched) rather than replaying from the
   * start. No-ops when there is nothing to resume.
   */
  resume(threadId: string): Promise<void>;
  /**
   * Tear down company-scoped resources: kill every MCP child process and stop
   * the skill-staging GC timer. Called on company switch / app teardown via
   * `disposeDesktopAgentRuntime` so a switched-away company leaks no processes.
   */
  dispose(): Promise<void>;
}

class DesktopAgentRuntimeImpl implements DesktopAgentRuntime {
  constructor(
    private readonly interactionService: InteractionService,
    private readonly mcpExecutor: McpToolExecutor,
    private readonly skillStagingManager: SkillStagingManager,
    private readonly companyId: string,
    private readonly repos: RuntimeRepositories,
    /** pi agent-loop orchestration; the only chat path on desktop. */
    private readonly pi: PiOrchestrationService,
    /** Persists deliverable.created events to the deliverables table. */
    private readonly deliverablePersistence: DeliverablePersistenceService,
  ) {}

  async resolveInteraction(response: InteractionResponse): Promise<SkillInstallOutcomeKind | null> {
    const result = await this.interactionService.resolve(response);
    return result?.skillInstallOutcome ?? null;
  }

  async dispose(): Promise<void> {
    await this.mcpExecutor.dispose().catch((err: unknown) => {
      console.warn('[desktop-agent-runtime] MCP executor dispose failed', { err });
    });
    this.skillStagingManager.dispose();
    this.deliverablePersistence.dispose();
  }

  async execute(input: DesktopAgentRunInput): Promise<string> {
    // Capability-first: make sure this run is scoped to a project with a real
    // workspace_root so file/shell tools work. Binds the requested project in
    // place when it is unbound (keeps thread scoping stable), else falls back to
    // the company default workspace project. In the common case the bootstrap
    // already selected a bound project, so this resolves to input.projectId.
    const projectId = await ensureProjectBoundForRun(this.repos, this.companyId, input.projectId);

    // The pi agent loop is the only chat path. One worker = one pi agent;
    // the boss delegates to employee sub-agents and deliverables are explicit
    // tools (no intent guessing). Per-message transcript persistence backs
    // multi-turn memory + resume via the pi_messages table.
    const result = await this.pi.execute({
      companyId: this.companyId,
      threadId: input.threadId,
      employeeId: input.employeeId ?? undefined,
      text: input.text,
      projectId,
      runScope: {
        // Convention: `<projectId>::<threadId>::<employeeId?>`.
        conversationKey: `${projectId ?? ''}::${input.threadId}::${input.employeeId ?? ''}`,
        runId: `run-${crypto.randomUUID()}`,
        threadId: input.threadId,
      },
    });
    return result.finalText;
  }

  abort(threadId: string): void {
    this.pi.abortThread(threadId);
  }

  async resume(threadId: string): Promise<void> {
    // Pi resume loads the persisted transcript (dangling-toolCall patched),
    // resumes as the worker that owned the thread, and continues the loop.
    // Returns null (clean no-op) when there is nothing to resume.
    await this.pi.resume({
      companyId: this.companyId,
      threadId,
      runScope: {
        conversationKey: `::${threadId}::`,
        runId: `resume-${crypto.randomUUID()}`,
        threadId,
      },
    });
  }
}

/**
 * Assemble the runtime for a company. The PiOrchestrationService is long-lived
 * across threads (it overrides `runtimeCtx.threadId` per `execute` call), so a
 * single instance per company is correct; the threadId is passed per run, not
 * baked into the context. The placeholder threadId in the base context is only
 * a default that `execute` always overrides.
 */
async function assembleRuntime(companyId: string): Promise<DesktopAgentRuntime> {
  const profiles = await loadRuntimeProviderProfiles();
  const profile: RuntimeProviderProfile | null = findDefaultChatProviderProfile(profiles);
  if (!profile) {
    throw new Error(
      'Cannot start the agent runtime: no provider profile with a stored credential.',
    );
  }

  const repos: RuntimeRepositories = await getRepos();
  // Fail loud rather than silently degrade — the pi agents read the full repo
  // set (employees, threads, llm_calls, deliverables, …) and tool execution now
  // audits every call through `mcpAudit`, so it is required, not optional.
  for (const required of [
    'employees',
    'threads',
    'companies',
    'llmCalls',
    'taskRuns',
    'mcpAudit',
    'projects',
  ] as const) {
    if (!repos[required]) {
      throw new Error(`Cannot start the agent runtime: repos.${required} is unavailable.`);
    }
  }

  // Placeholder thread id for the company-scoped runtime context / audit
  // executor / interaction service. PiOrchestrationService.execute() overrides
  // the per-run ctx threadId; the interaction service routes by the request's
  // own threadId, so this only labels company-scoped scaffolding.
  const baseThreadId = `desktop-agent-${companyId}`;

  const coreProvider = toCoreProvider(profile.provider);
  const transportFetch = createTauriLlmFetch(profile);
  const llmGateway = createGateway({
    provider: coreProvider,
    // The real secret is injected Rust-side and the SDK auth header is stripped;
    // this sentinel only satisfies the SDK constructor's non-empty key check.
    apiKey: 'tauri-managed',
    // Always pass the profile baseURL — including for the anthropic lane. The
    // AnthropicAdapter needs the real host to detect a third-party endpoint
    // (Bearer auth + CORS-friendly shim + prompt-caching capability); omitting
    // it left the SDK defaulting to api.anthropic.com, which broke any
    // anthropic-compatible provider on a custom host (e.g. z.ai's Claude-Code
    // endpoint https://api.z.ai/api/anthropic).
    baseURL: profile.baseUrl,
    dangerouslyAllowBrowser: true,
    fetch: transportFetch,
  });

  // Resolve every employee/role to the active profile's provider+model so the
  // employee node does not fall back to the SYSTEM_FALLBACK ('default') model
  // that would fail at the gateway.
  const modelPolicy: ModelPolicyConfig = {
    default: {
      profileName: profile.displayName || profile.id,
      provider: coreProvider,
      model: profile.model,
    },
  };
  const modelResolver = new ModelResolver(modelPolicy);

  const builtinTools = createBuiltinTools({
    executionMode: 'desktop-trusted',
    fs: createTauriProjectFsAdapter(),
    // Real shell now runs through the sandboxed `bash_execute` command. It fails
    // closed when no project workspace is bound (no widening of the Rust
    // sandbox) and defaults cwd to the bound project root.
    shellExec: createTauriShellExecAdapter({
      resolveProjectRoot: async (projectId) => {
        const project = await repos.projects.findById(projectId);
        return project?.workspace_root ?? null;
      },
    }),
  });

  // MCP fallback: a real McpToolExecutor over the desktop stdio bridge. We spawn
  // every registered stdio server up front; a single server's spawn/list failure
  // is swallowed (logged) so one bad server can't sink the whole runtime —
  // mirrors `mcp-config-loader`. The executor is disposed on company switch so
  // child processes are killed (`disposeDesktopAgentRuntime`).
  const mcpExecutor = new McpToolExecutor({
    eventBus: runtimeEventBus,
    companyId,
    clientFactory: createTauriMcpClientFactory(),
  });
  try {
    // Servers are independent (addServer keys by name + rolls back only its own
    // entries), so spawn + handshake them concurrently — runtime assembly waits
    // on the slowest server, not the sum. Each failure is swallowed per-server so
    // one bad server can't sink the rest (mirrors dispose()'s parallel teardown).
    const serverConfigs = await loadRegisteredStdioMcpConfigs();
    await Promise.all(
      serverConfigs.map((serverConfig) =>
        mcpExecutor.addServer(serverConfig).catch((err: unknown) => {
          console.warn('[desktop-agent-runtime] MCP server failed to start', {
            server: serverConfig.name,
            err,
          });
        }),
      ),
    );
  } catch (err) {
    // Listing the registry itself failed — run without MCP rather than aborting.
    console.warn('[desktop-agent-runtime] could not list registered MCP servers', { err });
  }

  // The tool executor must DISPATCH the builtin tools, not just leave them in
  // the offered list. CompositeToolExecutor runs builtins (read_file etc.) by
  // name and falls through to the MCP executor for any registered MCP tool.
  const compositeExecutor = new CompositeToolExecutor(builtinTools, mcpExecutor, {
    companyId,
  });
  // The AuditingToolExecutor wraps the composite so EVERY tool call lands in
  // `mcp_audit_log`, AND routes the shell classifier's destructive-command gate
  // through the InteractionService for a real HITL approval. It is constructed
  // below — after the InteractionService it depends on.

  // --- Skill subsystem (fork / edit / create_skill_from_scratch) ---
  // The skill-mutation tools unlock as soon as a staging manager + loader are
  // on the context (employee-tool-kit gates on those two). fork/create stage a
  // preview through the InteractionService as a `skill_install_confirm`
  // interaction; the renderer renders a confirm bar and calls
  // `resolveInteraction`, which drives the SkillInstallCommitter to write the
  // SKILL.md to the vault + insert the skills row.
  const skillLoader = SkillLoader.forRepos(repos);
  if (!skillLoader) {
    throw new Error('Cannot start the agent runtime: repos.skills is unavailable.');
  }
  // The loader starts with an "unavailable" vault fs; swap in the real Tauri
  // vault filesystem (synchronous construct, backed by `runtime_vault_*`).
  skillLoader.setFs(createTauriVaultFileSystem());
  const skillStagingManager = new SkillStagingManager();

  // Skill install environment: a real `httpFetch` (honest HTTP for git/GitHub
  // tarball sources) but no clone / gitFs / localDir adapters — those sources
  // return a structured `not-supported` error rather than a faked clone. fork /
  // edit / create never touch this env (they run off the loader + staging).
  const skillInstallEnvironment: SkillInstallEnvironment = {
    runtime: 'desktop',
    httpFetch: (url, init) =>
      fetch(url, {
        ...(init?.headers ? { headers: init.headers } : {}),
        ...(init?.signal ? { signal: init.signal } : {}),
      }),
  };

  // One InteractionService per company runtime. The desktop chat is
  // single-active-thread, so a single pending slot is correct; the renderer
  // routes the confirm bar by `request.threadId` (carried in the request), not
  // the service's placeholder threadId. The SkillInstallCommitter handler
  // commits the staged skill on confirm.
  const interactionService = new InteractionService({
    eventBus: runtimeEventBus,
    companyId,
    threadId: baseThreadId,
    // Desktop is a single human-present session: surface a HITL approval for
    // genuinely destructive shell commands (the shell classifier only asks for
    // rm -rf / git push / dd / mkfs / …). Everything else runs uninterrupted.
    defaultMode: 'human_in_loop',
    permissionApprovals: repos.toolPermissionApprovals,
    skillInstallConfirmHandler: new SkillInstallCommitter({
      companyId,
      threadId: baseThreadId,
      skillLoader,
      staging: skillStagingManager,
      eventBus: runtimeEventBus,
    }),
  });

  // Wrap the composite in the AuditingToolExecutor so EVERY tool call — builtin
  // included — lands in `mcp_audit_log`. The InteractionService is passed in so
  // the shell classifier's destructive-command gate surfaces a real HITL
  // approval bar via `requestAndWait` on the pi loop; without it the 'ask' path
  // silently short-circuits. No permissionAuthorizer: MCP tools are not
  // permission-gated here, so only genuinely destructive bash prompts —
  // non-destructive work never interrupts the flow. hookRegistry stays unset.
  const toolExecutor = new AuditingToolExecutor(
    compositeExecutor,
    repos.mcpAudit,
    runtimeEventBus,
    companyId,
    baseThreadId,
    undefined,
    interactionService,
    undefined,
  );

  // Long-horizon context management. Without a middleware chain the runtime
  // fell back to a crude fixed message trim AND rethrew any context-overflow
  // (413) with no recovery. Wiring the ConversationBudgetService activates
  // micro-compaction of bloated tool results, a running thread synopsis, full
  // compaction near the context window, and the 413 self-heal path in
  // recorded-call.ts. Defaults only trigger synopsis/full-compaction on long
  // conversations (≥80 messages / ≥60k tokens), so short chats pay no extra LLM
  // call. This is desktop-only — the deterministic harness (scenario-runner)
  // intentionally runs without it, so the contract replay is unaffected.
  // One budget service shared by the gateway middleware chain and the pi
  // orchestration — it is stateless (per-thread compaction state lives in the DB).
  const budgetService = new ConversationBudgetService();
  const middlewareChain = new LlmMiddlewareChain();
  middlewareChain.register(new SummarizationMiddleware(budgetService));

  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus: runtimeEventBus,
    llmGateway,
    modelResolver,
    toolExecutor,
    middlewareChain,
    companyId,
    // Placeholder — PiOrchestrationService.execute() overrides this per run.
    threadId: baseThreadId,
    builtinTools,
    llmToolCallsEnabled: true,
    skillLoader,
    skillStagingManager,
    skillInstallEnvironment,
    interactionService,
  });

  // Persist `deliverable.created` events to the deliverables table. Serves the
  // pi path's explicit submit_deliverable tool. Idempotent insert keyed on
  // deliverable_id.
  const deliverablePersistence = new DeliverablePersistenceService({
    eventBus: runtimeEventBus,
    repo: repos.deliverables,
  });

  // pi agent-loop orchestration (the only chat kernel). Owns the runtimeCtx,
  // repos, eventBus, audited toolExecutor, and modelResolver; uses its own
  // streamFn (the credential-isolated transport fetch the gateway uses) and the
  // shared budget service. Per-message transcript persistence (multi-turn
  // memory + resume) is backed by the pi_messages table via repos.piMessages.
  const piMessageStore = repos.piMessages ? new PiMessageStore(repos.piMessages) : undefined;

  const piOrchestration = new PiOrchestrationService({
    runtimeCtx,
    registry: new PiAgentRegistry(),
    streamFn: createPiStreamFn({ fetch: transportFetch }),
    budgetService,
    modelResolver,
    ...(piMessageStore ? { messageStore: piMessageStore } : {}),
    modelMeta: {
      baseUrl: profile.baseUrl,
      // The model may expose thinking; `thinkingLevel` gates whether it is
      // actually requested (level 'off' sends no thinking params).
      reasoning: true,
      piProvider: coreProvider === 'anthropic' ? 'anthropic' : profile.provider,
    },
    thinkingLevel: piThinkingLevel(),
    // Employee-turn virtual tools (boss is delegate-only). The explicit
    // deliverable tool replaces the deleted intent-guessing materialization, and
    // the skill-mutation tools (create/fork/edit/install/sync) route through the
    // InteractionService's `skill_install_confirm` approval path — without them
    // the employee prompt asks the model to call skill tools that do not exist.
    virtualToolProvider: (toolCtx, kind) =>
      kind === 'employee'
        ? [
            createSubmitDeliverableTool(runtimeCtx, toolCtx),
            ...createSkillInstallTools(runtimeCtx, toolCtx, `${coreProvider}/${profile.model}`),
          ]
        : [],
  });

  return new DesktopAgentRuntimeImpl(
    interactionService,
    mcpExecutor,
    skillStagingManager,
    companyId,
    repos,
    piOrchestration,
    deliverablePersistence,
  );
}

const runtimeCache = new Map<string, Promise<DesktopAgentRuntime>>();

/**
 * Get (or lazily assemble) the desktop agent runtime for a company. Cached per
 * companyId so the PiOrchestrationService + its per-thread locks/aborts persist
 * across turns. A failed assembly is not cached, so the next call retries.
 */
export function getDesktopAgentRuntime(companyId: string): Promise<DesktopAgentRuntime> {
  const cached = runtimeCache.get(companyId);
  if (cached) return cached;
  const promise = assembleRuntime(companyId).catch((err) => {
    runtimeCache.delete(companyId);
    throw err;
  });
  runtimeCache.set(companyId, promise);
  return promise;
}

/**
 * Dispose and evict a company's runtime — kills its MCP child processes and
 * stops the skill-staging GC timer. Called when the active company changes (or
 * the app unmounts) so a switched-away company leaks no processes; the next
 * `getDesktopAgentRuntime` for that company reassembles from scratch. No-op when
 * the company was never assembled.
 */
export async function disposeDesktopAgentRuntime(companyId: string): Promise<void> {
  const cached = runtimeCache.get(companyId);
  if (!cached) return;
  runtimeCache.delete(companyId);
  try {
    const runtime = await cached;
    await runtime.dispose();
  } catch (err) {
    console.warn('[desktop-agent-runtime] dispose failed', { companyId, err });
  }
}
