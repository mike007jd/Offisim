import {
  type RuntimeProviderProfile,
  findDefaultChatProviderProfile,
  loadRuntimeProviderProfiles,
} from '@/lib/provider-bridge.js';
import { createTauriLlmFetch } from '@/lib/tauri-llm-fetch.js';
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
  type ToolCallRequest,
  type ToolCallResponse,
  type ToolExecutor,
} from '@offisim/core/browser';
import type { ToolDef } from '@offisim/core/llm';
import { ModelResolver, createGateway } from '@offisim/core/llm';
import { AuditingToolExecutor } from '@offisim/core/mcp';
import {
  HumanMessage,
  buildOffisimGraph,
  createMemoryCheckpointSaver,
  createRuntimeContext,
} from '@offisim/core/runtime';
import { OrchestrationService } from '@offisim/core/services';
import { CompositeToolExecutor, createBuiltinTools } from '@offisim/core/tools';
import type {
  InteractionResponse,
  LlmProvider,
  ModelPolicyConfig,
  SkillInstallOutcomeKind,
} from '@offisim/shared-types';
import { getRepos, runtimeEventBus } from './repos.js';

/**
 * The real LangGraph agent runtime wired into desktop chat. This is now the
 * ONLY chat path on desktop — the single-shot direct-provider completion was
 * retired in slice 3 (flag removed; Office + Workspace both run through here).
 *
 * It assembles the same graph/orchestration/runtime-context stack the test
 * harness drives (`packages/core/src/testing/scenario-runner.ts`) but with the
 * real credential-isolated Tauri transport, the real Drizzle-backed repos, the
 * sandboxed `project_*` file tools, and the sandboxed `bash_execute` shell. A
 * direct chat to one employee enters at `employee_direct_setup → employee`, the
 * employee node resolves the active provider model and calls the gateway, and
 * the builtin read/write/bash/glob/grep tools are reachable. Every tool call is
 * recorded in `mcp_audit_log` via the AuditingToolExecutor wrapper.
 */

/**
 * No-op MCP executor. Slice 1 exposes only the desktop builtin tools (wired
 * through `runtimeCtx.builtinTools`); there is no external/MCP tool surface
 * yet (slice 5 replaces this with a real McpToolExecutor), so the executor
 * reports an empty catalog and refuses any call routed to it. The
 * `CompositeToolExecutor` dispatches builtins directly and only falls through
 * to this executor for unknown tool names.
 */
class NullToolExecutor implements ToolExecutor {
  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    return {
      success: false,
      result: null,
      error: `No external tools are available on desktop yet (requested "${call.name}").`,
    };
  }

  async listAvailable(_companyId: string): Promise<ToolDef[]> {
    return [];
  }
}

/** Map a (possibly wider) provider profile string onto the core LlmProvider union. */
function toCoreProvider(provider: string): LlmProvider {
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'openai') return 'openai';
  // Everything else (minimax, openrouter, kimi, gemini, local, …) speaks the
  // OpenAI-compatible chat shape via its own baseURL.
  return 'openai-compat';
}

export interface DesktopAgentRunInput {
  /** User message text for this turn. */
  text: string;
  /** Runtime/graph thread id (per-run, not per-singleton). */
  threadId: string;
  /** Employee that holds this direct chat. Routes the graph to its node. */
  employeeId: string | null;
  /** Active project id for workspace-scoped tools; null for unscoped chats. */
  projectId: string | null;
}

export interface DesktopAgentRuntime {
  /** Run one direct-chat turn through the graph; resolves to the assistant text. */
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
}

class DesktopAgentRuntimeImpl implements DesktopAgentRuntime {
  constructor(
    private readonly orchestration: OrchestrationService,
    private readonly interactionService: InteractionService,
  ) {}

  async resolveInteraction(response: InteractionResponse): Promise<SkillInstallOutcomeKind | null> {
    const result = await this.interactionService.resolve(response);
    return result?.skillInstallOutcome ?? null;
  }

  async execute(input: DesktopAgentRunInput): Promise<string> {
    const finalState = await this.orchestration.execute({
      entryMode: 'direct_chat',
      messages: [new HumanMessage(input.text)],
      targetEmployeeId: input.employeeId ?? null,
      threadId: input.threadId,
      projectId: input.projectId,
      runScope: {
        // Convention: `<projectId>::<threadId>::<employeeId?>`.
        conversationKey: `${input.projectId ?? ''}::${input.threadId}::${input.employeeId ?? ''}`,
        runId: `run-${crypto.randomUUID()}`,
        threadId: input.threadId,
      },
    });

    // The direct-chat path ends at boss_summary, which (for a single employee
    // result) short-circuits and emits the employee's own reply as the last
    // AIMessage — no extra LLM call. Prefer that message; fall back to the
    // employee step output if message extraction comes up empty.
    const fromMessages = lastAiText(finalState.messages);
    if (fromMessages) return fromMessages;
    const outputs = finalState.currentStepOutputs ?? [];
    const lastOutput = outputs[outputs.length - 1];
    return lastOutput?.content?.trim() ?? '';
  }

  abort(threadId: string): void {
    this.orchestration.abortExecution(threadId);
  }
}

function lastAiText(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { _getType?: () => string; content?: unknown } | undefined;
    if (message?._getType?.() !== 'ai') continue;
    const content = message.content;
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

/**
 * Assemble the runtime for a company. The OrchestrationService is long-lived
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
  // Fail loud rather than silently degrade — the graph nodes read the full repo
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
  // executor / interaction service. OrchestrationService.execute() overrides
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
    ...(coreProvider === 'anthropic' ? {} : { baseURL: profile.baseUrl }),
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

  // The tool executor must DISPATCH the builtin tools, not just leave them in
  // the offered list. CompositeToolExecutor runs builtins (read_file etc.) by
  // name and falls through to the MCP executor (NullToolExecutor — none yet on
  // desktop) for anything else.
  const compositeExecutor = new CompositeToolExecutor(builtinTools, new NullToolExecutor(), {
    companyId,
  });
  // Wrap the composite in the AuditingToolExecutor so EVERY tool call — builtin
  // included — lands in `mcp_audit_log` (the Slice-1 gap: the composite
  // dispatched builtins directly, bypassing the audit decorator). Audit-only for
  // now: no authorizer / interactionService / hookRegistry — builtins run as
  // they do today, but recorded. The bash-tool's own shell classifier still
  // gates destructive commands. Mirrors `scenario-runner.ts` wiring.
  const toolExecutor = new AuditingToolExecutor(
    compositeExecutor,
    repos.mcpAudit,
    runtimeEventBus,
    companyId,
    baseThreadId,
    undefined,
    undefined,
    undefined,
  );

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
    permissionApprovals: repos.toolPermissionApprovals,
    skillInstallConfirmHandler: new SkillInstallCommitter({
      companyId,
      threadId: baseThreadId,
      skillLoader,
      staging: skillStagingManager,
      eventBus: runtimeEventBus,
    }),
  });

  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus: runtimeEventBus,
    llmGateway,
    modelResolver,
    toolExecutor,
    companyId,
    // Placeholder — OrchestrationService.execute() overrides this per run.
    threadId: baseThreadId,
    builtinTools,
    llmToolCallsEnabled: true,
    skillLoader,
    skillStagingManager,
    skillInstallEnvironment,
    interactionService,
  });

  const graph = buildOffisimGraph({ checkpointer: createMemoryCheckpointSaver() });
  const orchestration = new OrchestrationService(graph, runtimeCtx);
  return new DesktopAgentRuntimeImpl(orchestration, interactionService);
}

const runtimeCache = new Map<string, Promise<DesktopAgentRuntime>>();

/**
 * Get (or lazily assemble) the desktop agent runtime for a company. Cached per
 * companyId so the OrchestrationService + its per-thread locks/aborts persist
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
