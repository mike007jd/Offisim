/**
 * PiOrchestrationService — the agent-as-tool replacement for the LangGraph
 * orchestration. One AI worker = one pi agent (a turn-based tool loop); there is
 * no static graph and no deliverable-intent guessing.
 *
 * This is the bridge entry point the desktop runtime calls instead of
 * `OrchestrationService.execute`. It owns:
 *   - per-thread serialization (threadLock — replaces the graph's implicit
 *     single-stream serialization, now that N agents can run per thread),
 *   - the agent registry (whole-team abort),
 *   - the streamFn (credential seam) + transformContext (budget) + event bridge,
 *   - a runaway round guard (replaces MAX_TOOL_ROUNDS=200 / recursion limit 400).
 *
 * Boss delegation (boss agent + delegate tool + A2A branch) lands in Phase 5;
 * per-message SQLite persistence + dangling-toolCall resume patch land in
 * Phase 4. This file keeps explicit seams for both.
 */

import type { RunScope } from '@offisim/shared-types';
import { Agent, type AgentEvent, type AgentMessage, type AgentTool, type ThinkingLevel } from '@offisim/pi-agent';
import type { Message as PiMessage } from '@offisim/pi-ai';
import { executionAborted } from '../events/orchestration-events.js';
import type { ToolDef } from '../llm/gateway.js';
import type { ModelResolver } from '../llm/model-resolver.js';
import type { CompanyRow, EmployeeRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { ToolExecutor } from '../runtime/tool-executor.js';
import type { ConversationBudgetService } from '../services/conversation-budget-service.js';
import { Logger } from '../services/logger.js';
import { buildEmployeePrompt } from '../agents/employee-builder.js';
import { createBudgetTransform } from './pi-budget.js';
import { createDelegateTool } from './pi-delegate-tool.js';
import { createPiEventListener } from './pi-event-bridge.js';
import { buildPiModel } from './pi-model.js';
import type { PiAgentRegistry } from './pi-agent-registry.js';
import type { StreamFn } from '@offisim/pi-agent';
import { type PiToolContext, toolDefsToAgentTools } from './pi-tool-adapter.js';

const logger = new Logger('pi-orchestration');

/** Runaway backstop — the model is expected to stop emitting tool calls long before this. */
const DEFAULT_MAX_TOOL_ROUNDS = 200;

export interface PiModelMeta {
  /** Canonical endpoint base (the Rust transport rewrites the path per lane). */
  readonly baseUrl: string;
  /** Whether the bound model exposes thinking / reasoning content. */
  readonly reasoning?: boolean;
  /** Optional pi provider id override (affects compat auto-detection). */
  readonly piProvider?: string;
  /** Provider context window (tokens) for budget sizing. */
  readonly contextWindow?: number;
}

export interface PiOrchestrationDeps {
  readonly runtimeCtx: RuntimeContext;
  readonly registry: PiAgentRegistry;
  /** The streamFn produced by `createPiStreamFn(fetch)` (credential seam). */
  readonly streamFn: StreamFn;
  readonly budgetService: ConversationBudgetService;
  readonly modelResolver: ModelResolver;
  readonly modelMeta: PiModelMeta;
  /** Reasoning level for models that support it. Default 'off'. */
  readonly thinkingLevel?: ThinkingLevel;
  /** Runaway round guard. Default 200. */
  readonly maxToolRounds?: number;
  /** Give boss agents the `delegate` tool. Default true. */
  readonly enableDelegation?: boolean;
  /**
   * Virtual tools with their own `execute` (memory, submit_deliverable,
   * delegate) — these do NOT route through the AuditingToolExecutor's
   * builtin/MCP dispatch; they carry their own logic, matching pi's
   * agent-as-tool model. Receives the per-agent tool context. Phase 4/5 supply
   * submit_deliverable / delegate here.
   */
  readonly virtualToolProvider?: (ctx: PiToolContext, agentKind: PiAgentKind) => AgentTool[];
}

export type PiAgentKind = 'employee' | 'boss';

export interface PiExecuteInput {
  readonly companyId: string;
  readonly threadId: string;
  /** Target employee. Absent → boss direct reply. */
  readonly employeeId?: string;
  /** The user's message text. */
  readonly text: string;
  readonly projectId?: string | null;
  readonly runScope?: RunScope | null;
  readonly chatThreadId?: string | null;
  /** Prior transcript (Phase 4 loads this from SQLite; callers pass it for now). */
  readonly history?: readonly AgentMessage[];
}

export interface PiExecuteResult {
  readonly finalText: string;
  readonly messages: readonly AgentMessage[];
  readonly stopReason: 'completed' | 'aborted' | 'error' | 'round-limit';
}

/** Resolved inputs for a single worker run (top-level turn or delegated sub-agent). */
interface WorkerParams {
  readonly companyId: string;
  readonly threadId: string;
  readonly kind: PiAgentKind;
  readonly employee: EmployeeRow | null;
  readonly company: CompanyRow;
  readonly text: string;
  readonly projectId?: string | null;
  readonly runScope?: RunScope | null;
  readonly chatThreadId?: string | null;
  readonly history?: readonly AgentMessage[];
  /** When set, this is a delegated sub-agent; aborting it follows the parent. */
  readonly parentSignal?: AbortSignal;
}

export class PiOrchestrationService {
  private readonly threadLocks = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: PiOrchestrationDeps) {}

  /** Run one chat turn for the targeted worker; serialized per thread. */
  async execute(input: PiExecuteInput): Promise<PiExecuteResult> {
    return this.withThreadLock(input.threadId, () => this.runTurn(input));
  }

  /** Abort every agent on a thread (whole-team cancel). */
  abortThread(threadId: string, runScope?: RunScope | null): number {
    const count = this.deps.registry.abortThread(threadId);
    if (count > 0) {
      this.deps.runtimeCtx.eventBus.emit(
        executionAborted(this.deps.runtimeCtx.companyId, threadId, 'user', runScope ?? null),
      );
    }
    return count;
  }

  private async runTurn(input: PiExecuteInput): Promise<PiExecuteResult> {
    const { runtimeCtx } = this.deps;
    const kind: PiAgentKind = input.employeeId ? 'employee' : 'boss';
    const employee = input.employeeId
      ? await runtimeCtx.repos.employees.findById(input.employeeId)
      : null;
    const company = await runtimeCtx.repos.companies.findById(input.companyId);
    if (!company) {
      throw new Error(`Company ${input.companyId} not found`);
    }
    if (input.employeeId && !employee) {
      throw new Error(`Employee ${input.employeeId} not found`);
    }

    return this.runWorker({
      companyId: input.companyId,
      threadId: input.threadId,
      kind,
      employee,
      company,
      text: input.text,
      projectId: input.projectId ?? null,
      runScope: input.runScope ?? null,
      chatThreadId: input.chatThreadId ?? null,
      history: input.history,
    });
  }

  /**
   * Run one worker (boss or employee) as a pi agent to completion. Reused by the
   * top-level turn and recursively by `delegate` for local sub-agents — the
   * sub-agent registers under the SAME thread so whole-team abort reaches it, and
   * streams under the employee's identity.
   */
  private async runWorker(params: WorkerParams): Promise<PiExecuteResult> {
    const { runtimeCtx } = this.deps;
    const { kind, employee, company, threadId, companyId } = params;

    const roster =
      kind === 'boss' ? await runtimeCtx.repos.employees.findByCompany(companyId) : [];
    const systemPrompt = this.buildSystemPrompt(kind, employee, company, params.text, roster);
    const resolved = this.deps.modelResolver.resolve(null, employee?.role_slug);
    const model = buildPiModel({
      provider: resolved.provider,
      model: resolved.model,
      baseUrl: this.deps.modelMeta.baseUrl,
      contextWindow: this.deps.modelMeta.contextWindow ?? resolved.contextWindow,
      maxTokens: resolved.maxTokens,
      reasoning: this.deps.modelMeta.reasoning,
      piProvider: this.deps.modelMeta.piProvider,
    });

    const toolCtx: PiToolContext = {
      threadId,
      companyId,
      employeeId: employee?.employee_id,
      projectId: params.projectId ?? null,
      runScope: params.runScope ?? null,
    };
    const tools = await this.assembleTools(params, toolCtx, kind);

    const transformContext = createBudgetTransform({
      budgetService: this.deps.budgetService,
      runtimeCtx,
      model: resolved.model,
      systemPrompt,
      maxTokens: resolved.maxTokens,
    });

    const agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        thinkingLevel: this.deps.thinkingLevel ?? 'off',
        tools,
        messages: params.history ? [...params.history] : [],
      },
      streamFn: this.deps.streamFn,
      transformContext,
      toolExecution: 'sequential',
    });

    // Propagate the parent's abort to this sub-agent so cancelling the boss
    // (or whole-team abort) tears down the delegated employees too.
    if (params.parentSignal) {
      if (params.parentSignal.aborted) agent.abort();
      else params.parentSignal.addEventListener('abort', () => agent.abort(), { once: true });
    }

    // Round guard: count completed turns; abort on runaway. Replaces
    // MAX_TOOL_ROUNDS / recursion-limit, which vanished with the graph.
    const maxRounds = this.deps.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    let rounds = 0;
    let hitRoundLimit = false;

    const nodeName = kind === 'boss' ? 'boss_summary' : 'employee';
    const listener = createPiEventListener(
      runtimeCtx.eventBus,
      {
        companyId,
        threadId,
        nodeName,
        ...(employee?.employee_id ? { employeeId: employee.employee_id } : {}),
        runScope: params.runScope ?? null,
      },
      {
        onMessageEnd: (message) => this.persistMessage(params, message),
      },
    );
    const roundCounter = (event: AgentEvent) => {
      if (event.type === 'turn_end') {
        rounds += 1;
        if (rounds >= maxRounds && !hitRoundLimit) {
          hitRoundLimit = true;
          logger.warn('round guard tripped; aborting agent', { threadId, rounds });
          agent.abort();
        }
      }
    };
    const unsubscribe = agent.subscribe(async (event, _signal) => {
      await listener(event);
      roundCounter(event);
    });
    const unregister = this.deps.registry.register(threadId, agent);

    try {
      // Only the top-level turn owns the thread status; sub-agents share it.
      if (!params.parentSignal) {
        await runtimeCtx.repos.threads.updateStatus(threadId, 'running').catch(() => {});
      }
      await agent.prompt(params.text);
      await agent.waitForIdle();
    } finally {
      unsubscribe();
      unregister();
    }

    const messages = agent.state.messages;
    const finalText = extractFinalAssistantText(messages);
    const stopReason: PiExecuteResult['stopReason'] = hitRoundLimit
      ? 'round-limit'
      : agent.state.errorMessage
        ? agent.signal?.aborted
          ? 'aborted'
          : 'error'
        : 'completed';

    if (!params.parentSignal) {
      await runtimeCtx.repos.threads
        .updateStatus(threadId, stopReason === 'completed' ? 'completed' : 'blocked')
        .catch(() => {});
    }
    // Note: `chat_thread.updated` is a metadata event (title / archive), not a
    // per-message signal — the renderer streams via `llm.stream.chunk`. The
    // boss auto-title rewrite emits it with reason 'title'.

    return { finalText, messages, stopReason };
  }

  /** delegate → local employee sub-agent. Recurses into `runWorker`. */
  private async runDelegated(
    employeeId: string,
    task: string,
    parent: WorkerParams,
    parentSignal?: AbortSignal,
  ): Promise<string> {
    const employee = await this.deps.runtimeCtx.repos.employees.findById(employeeId);
    if (!employee) {
      throw new Error(`No employee with id ${employeeId}`);
    }
    const result = await this.runWorker({
      companyId: parent.companyId,
      threadId: parent.threadId,
      kind: 'employee',
      employee,
      company: parent.company,
      text: task,
      projectId: parent.projectId ?? null,
      runScope: parent.runScope ?? null,
      chatThreadId: parent.chatThreadId ?? null,
      history: [],
      ...(parentSignal ? { parentSignal } : {}),
    });
    return result.finalText;
  }

  private buildSystemPrompt(
    kind: PiAgentKind,
    employee: EmployeeRow | null,
    company: CompanyRow,
    taskInput: string,
    roster: readonly EmployeeRow[],
  ): string {
    if (kind === 'employee' && employee) {
      return buildEmployeePrompt(employee, company, taskInput);
    }
    // Boss prompt: the delegate tool dispatches to the roster employees.
    const rosterLines = roster
      .filter((e) => e.enabled === 1)
      .map(
        (e) =>
          `- ${e.name} (id: ${e.employee_id}, role: ${e.role_slug}${
            e.is_external === 1 ? ', external' : ''
          })`,
      );
    return [
      `You are the founder and boss of ${company.name}.`,
      'You can answer the user directly, or assign work to an employee with the',
      '`delegate` tool (pass the employee id and a clear, self-contained task). The',
      'employee does the work with its own tools and returns the result. Delegate',
      'real work; answer trivial questions yourself. Never fabricate results.',
      rosterLines.length
        ? `\nYour employees:\n${rosterLines.join('\n')}`
        : '\nYou have no employees yet — answer directly.',
      '',
      `User request:\n${taskInput}`,
    ].join('\n');
  }

  private async assembleTools(
    params: WorkerParams,
    toolCtx: PiToolContext,
    kind: PiAgentKind,
  ): Promise<AgentTool[]> {
    const { runtimeCtx } = this.deps;
    const toolExecutor: ToolExecutor = runtimeCtx.toolExecutor;
    const builtinDefs: ToolDef[] = [...(runtimeCtx.builtinTools?.values() ?? [])].map((t) => t.def);
    let mcpDefs: ToolDef[] = [];
    try {
      mcpDefs = await toolExecutor.listAvailable(params.companyId);
    } catch (error) {
      logger.warn('listAvailable failed; continuing with builtin tools only', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const virtualTools = [...(this.deps.virtualToolProvider?.(toolCtx, kind) ?? [])];
    // The delegate tool is orchestration-internal (it recurses into runWorker),
    // so it is added here rather than via the external virtualToolProvider.
    if (kind === 'boss' && this.deps.enableDelegation !== false) {
      virtualTools.push(
        createDelegateTool({
          runtimeCtx,
          toolCtx,
          runLocalEmployee: (employeeId, task, signal) =>
            this.runDelegated(employeeId, task, params, signal),
        }),
      );
    }
    const virtualNames = new Set(virtualTools.map((t) => t.name));
    // Virtual tools (their own execute) take precedence over any same-named
    // builtin/MCP tool; the rest route through the audited executor.
    const executorDefs = dedupeByName([...builtinDefs, ...mcpDefs]).filter(
      (def) => !virtualNames.has(def.name),
    );
    const executorTools = toolDefsToAgentTools(executorDefs, toolExecutor, toolCtx);
    return [...executorTools, ...virtualTools];
  }

  /**
   * Phase 4 seam: persist each finished pi message to SQLite (per-message
   * append granularity). Until the persistence layer lands this is a no-op so
   * the loop runs end-to-end with in-memory transcript only.
   */
  private async persistMessage(_params: WorkerParams, _message: PiMessage): Promise<void> {
    // intentionally empty until the per-message persistence layer wires PiMessageStore
  }

  private async withThreadLock<T>(threadId: string, run: () => Promise<T>): Promise<T> {
    const prev = this.threadLocks.get(threadId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => gate);
    this.threadLocks.set(threadId, chained);
    await prev.catch(() => {});
    try {
      return await run();
    } finally {
      release();
      // Only clear the map entry if no newer waiter has replaced ours.
      if (this.threadLocks.get(threadId) === chained) {
        this.threadLocks.delete(threadId);
      }
    }
  }
}

function extractFinalAssistantText(messages: readonly AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg && msg.role === 'assistant') {
      return msg.content
        .filter((c): c is Extract<typeof c, { type: 'text' }> => c.type === 'text')
        .map((c) => c.text)
        .join('');
    }
  }
  return '';
}

function dedupeByName(defs: ToolDef[]): ToolDef[] {
  const seen = new Set<string>();
  const out: ToolDef[] = [];
  for (const def of defs) {
    if (seen.has(def.name)) continue;
    seen.add(def.name);
    out.push(def);
  }
  return out;
}
