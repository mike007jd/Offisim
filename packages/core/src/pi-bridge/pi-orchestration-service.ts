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

import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type ThinkingLevel,
} from '@offisim/pi-agent';
import type { StreamFn } from '@offisim/pi-agent';
import type { Message as PiMessage } from '@offisim/pi-ai';
import type { RunScope } from '@offisim/shared-types';
import { toErrorMessage } from '../errors.js';
import { executionAborted } from '../events/orchestration-events.js';
import type { ToolDef } from '../llm/gateway.js';
import type { ModelResolver } from '../llm/model-resolver.js';
import type { CompanyRow, EmployeeRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { ToolExecutor } from '../runtime/tool-executor.js';
import type { ConversationBudgetService } from '../services/conversation-budget-service.js';
import { Logger } from '../services/logger.js';
import { buildEmployeePrompt } from './employee-builder.js';
import type { PiAgentRegistry } from './pi-agent-registry.js';
import { createBudgetTransform } from './pi-budget.js';
import { createDelegateTool } from './pi-delegate-tool.js';
import { createPiEventListener } from './pi-event-bridge.js';
import type { PiMessageStore } from './pi-message-store.js';
import { buildPiModel } from './pi-model.js';
import { type PiToolContext, toolDefsToAgentTools } from './pi-tool-adapter.js';

const logger = new Logger('pi-orchestration');

/** Runaway backstop — the model is expected to stop emitting tool calls long before this. */
const MAX_TOOL_ROUNDS = 200;

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
  /**
   * Per-message transcript persistence. When set, the top-level turn loads its
   * prior transcript (with the dangling-toolCall resume patch) and every finished
   * message is appended. Delegated sub-agents do NOT persist to the thread.
   */
  readonly messageStore?: PiMessageStore;
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
  /** Resume an interrupted run by continuing the transcript instead of prompting. */
  readonly continueRun?: boolean;
}

export class PiOrchestrationService {
  private readonly threadLocks = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: PiOrchestrationDeps) {}

  /** Run one chat turn for the targeted worker; serialized per thread. */
  async execute(input: PiExecuteInput): Promise<PiExecuteResult> {
    return this.withThreadLock(input.threadId, () => this.runTurn(input));
  }

  /**
   * Resume an interrupted run: load the persisted transcript (dangling-toolCall
   * patched) and continue the loop if it ends mid-turn. Returns null when there
   * is no persisted transcript or the last turn already completed (so a caller
   * can fall back to an honest "nothing to resume").
   */
  async resume(input: {
    companyId: string;
    threadId: string;
    employeeId?: string;
    projectId?: string | null;
    runScope?: RunScope | null;
  }): Promise<PiExecuteResult | null> {
    const store = this.deps.messageStore;
    if (!store) return null;
    const transcript = await store.loadTranscript(input.threadId);
    const last = transcript[transcript.length - 1];
    // Empty, or a completed turn (ends with an assistant message) → nothing to resume.
    if (!last || last.role === 'assistant') return null;
    return this.withThreadLock(input.threadId, async () => {
      const { runtimeCtx } = this.deps;
      // Resume as the worker that owned this thread (persisted per row); the
      // caller's employeeId hint wins when provided.
      const ownerId = input.employeeId ?? (await store.threadOwnerEmployeeId(input.threadId));
      const kind: PiAgentKind = ownerId ? 'employee' : 'boss';
      const employee = ownerId ? await runtimeCtx.repos.employees.findById(ownerId) : null;
      const company = await runtimeCtx.repos.companies.findById(input.companyId);
      if (!company) throw new Error(`Company ${input.companyId} not found`);
      return this.runWorker({
        companyId: input.companyId,
        threadId: input.threadId,
        kind,
        employee,
        company,
        text: '',
        projectId: input.projectId ?? null,
        runScope: input.runScope ?? null,
        history: transcript,
        continueRun: true,
      });
    });
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

    const toolCtx: PiToolContext = {
      threadId,
      companyId,
      employeeId: employee?.employee_id,
      projectId: params.projectId ?? null,
      runScope: params.runScope ?? null,
    };

    // Three independent I/O sources — the boss roster (for the system prompt),
    // the tool set (builtin defs + MCP listAvailable), and the prior transcript
    // (top-level turns rehydrate with the dangling-toolCall patch; delegated
    // sub-agents always start fresh). Run them concurrently rather than serially.
    const [roster, tools, history] = await Promise.all([
      kind === 'boss'
        ? runtimeCtx.repos.employees.findByCompany(companyId)
        : Promise.resolve<readonly EmployeeRow[]>([]),
      this.assembleTools(params, toolCtx, kind),
      params.history !== undefined
        ? Promise.resolve(params.history)
        : this.deps.messageStore && !params.parentSignal
          ? this.deps.messageStore.loadTranscript(threadId)
          : Promise.resolve(undefined),
    ]);

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

    // The budget service keys compaction/synopsis state on ctx.threadId — pass
    // the PER-RUN thread, not the company-level placeholder baked into the base
    // runtimeCtx, or every thread shares one synopsis/baseline row.
    const transformContext = createBudgetTransform({
      budgetService: this.deps.budgetService,
      runtimeCtx: { ...runtimeCtx, threadId },
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
        messages: history ? [...history] : [],
      },
      streamFn: this.deps.streamFn,
      transformContext,
      toolExecution: 'sequential',
    });

    // Propagate the parent's abort to this sub-agent so cancelling the boss
    // (or whole-team abort) tears down the delegated employees too. The handler
    // is removed in the finally block so a completed sub-agent does not stay
    // pinned to the parent signal.
    const onParentAbort = () => agent.abort();
    if (params.parentSignal) {
      if (params.parentSignal.aborted) agent.abort();
      else params.parentSignal.addEventListener('abort', onParentAbort);
    }

    // Round guard: count completed turns; abort on runaway. Replaces
    // MAX_TOOL_ROUNDS / recursion-limit, which vanished with the graph.
    let rounds = 0;
    let hitRoundLimit = false;
    // First transcript-persistence failure on a top-level turn. A failed append
    // means multi-turn memory + resume lose this turn's history, so we surface it
    // as a failed run (thread → blocked) rather than swallowing it as a warning.
    let persistError: unknown = null;

    // A delegated sub-agent (parentSignal set) must NOT stream into the boss's
    // chat bubble — its output reaches the user only through the boss's summary.
    // Give it a nodeName the renderer's STREAM_REPLY_NODES does not surface.
    const nodeName =
      kind === 'boss' ? 'boss_summary' : params.parentSignal ? 'employee_subtask' : 'employee';
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
        onMessageEnd: async (message) => {
          try {
            await this.persistMessage(params, message);
          } catch (error) {
            persistError ??= error;
          }
        },
      },
    );
    const roundCounter = (event: AgentEvent) => {
      if (event.type === 'turn_end') {
        rounds += 1;
        if (rounds >= MAX_TOOL_ROUNDS && !hitRoundLimit) {
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
      // Ensure the graph_threads row exists — pi threads otherwise have no row,
      // and mcp_audit_log.thread_id REFERENCES graph_threads(thread_id), so every
      // tool audit insert (e.g. a delegated sub-agent's bash) would fail the FK.
      if (!params.parentSignal) {
        // The graph_threads row is a hard precondition: mcp_audit_log.thread_id
        // REFERENCES graph_threads(thread_id), so without it every audited tool
        // call would fail the FK and the "tool ran → audit row" contract would
        // silently break. Fail the whole turn loudly rather than swallowing it
        // and running tools whose audit inserts cannot land.
        try {
          await this.ensureThreadRow(params);
        } catch (error) {
          throw new Error(
            `Cannot start run: failed to create the thread row required for tool audit (${toErrorMessage(error)})`,
          );
        }
      }
      if (params.continueRun) {
        // Resume: the transcript (loaded as history, dangling-toolCalls patched)
        // already ends with a user/toolResult, so continue the interrupted loop.
        await agent.continue();
      } else {
        await agent.prompt(params.text);
      }
      await agent.waitForIdle();
    } finally {
      unsubscribe();
      unregister();
      params.parentSignal?.removeEventListener('abort', onParentAbort);
    }

    const messages = agent.state.messages;
    const finalText = extractFinalAssistantText(messages);
    let stopReason: PiExecuteResult['stopReason'] = 'completed';
    if (hitRoundLimit) {
      stopReason = 'round-limit';
    } else if (agent.state.errorMessage) {
      stopReason = agent.signal?.aborted ? 'aborted' : 'error';
    } else if (persistError) {
      stopReason = 'error';
    }

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

  /**
   * Ensure a graph_threads row exists for this thread before any audited tool
   * runs. pi reuses graph_threads as the session/thread registry (status reads,
   * the audit FK, ResumeBar). `updateStatus` is a bare UPDATE that no-ops on a
   * missing row, so a fresh pi thread must be created here.
   */
  private async ensureThreadRow(params: WorkerParams): Promise<void> {
    const { runtimeCtx } = this.deps;
    const existing = await runtimeCtx.repos.threads.findById(params.threadId);
    if (existing) {
      await runtimeCtx.repos.threads.updateStatus(params.threadId, 'running');
      return;
    }
    await runtimeCtx.repos.threads.create({
      thread_id: params.threadId,
      company_id: params.companyId,
      entry_mode: params.kind === 'boss' ? 'boss_chat' : 'direct_chat',
      root_task_id: null,
      status: 'running',
      project_id: params.projectId ?? null,
    });
  }

  /**
   * delegate → local employee sub-agent. Recurses into `runWorker`. The employee
   * row is resolved + validated by the delegate tool, so it is passed in here
   * rather than re-fetched.
   */
  private async runDelegated(
    employee: EmployeeRow,
    task: string,
    parent: WorkerParams,
    parentSignal?: AbortSignal,
  ): Promise<string> {
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
    // Boss prompt: an orchestrator that assigns work via the `delegate` tool.
    // The hard tool-use discipline below mirrors the employee prompt's "use the
    // tool, do not narrate" rules — without it a compat model will fabricate a
    // delegation result instead of calling `delegate` (the disease this kernel
    // exists to kill). The user's request is NOT embedded here; it arrives as
    // the user message, so the system prompt stays stable across turns.
    const rosterLines = roster
      .filter((e) => e.enabled === 1)
      .map(
        (e) =>
          `- ${e.name} (id: ${e.employee_id}, role: ${e.role_slug}${
            e.is_external === 1 ? ', external' : ''
          })`,
      );
    const hasRoster = rosterLines.length > 0;
    return [
      `You are the founder and boss of ${company.name}. You run the company by`,
      'assigning work to your employees — you do NOT do hands-on work yourself.',
      '',
      'Rules you must follow exactly:',
      '- When the request needs ANY real work — running commands, reading or writing',
      '  files, producing a document, searching, analysis — you MUST assign it to an',
      '  employee by calling the `delegate` tool with that employee id and a clear,',
      '  self-contained task. Example: delegate(employee_id: "<id from the roster>",',
      '  task: "Run `ls` in the project and report the file names").',
      '- You may state that an employee did something ONLY AFTER its `delegate` tool',
      '  result has come back, and you must report what that result actually said.',
      '  NEVER write that an employee "completed", "ran", "found", or produced any',
      '  result unless a `delegate` tool result for it exists in this conversation.',
      '  Inventing or guessing a result is strictly forbidden.',
      '- Answer directly (without delegating) ONLY for trivial conversational',
      '  questions that need no command, no file, and no employee.',
      hasRoster
        ? `\nYour employees (delegate by id):\n${rosterLines.join('\n')}`
        : '\nYou have no employees yet — answer directly and say so.',
    ].join('\n');
  }

  private async assembleTools(
    params: WorkerParams,
    toolCtx: PiToolContext,
    kind: PiAgentKind,
  ): Promise<AgentTool[]> {
    const { runtimeCtx } = this.deps;
    const isBoss = kind === 'boss';
    const virtualTools = [...(this.deps.virtualToolProvider?.(toolCtx, kind) ?? [])];
    // The delegate tool is orchestration-internal (it recurses into runWorker),
    // so it is added here rather than via the external virtualToolProvider.
    if (isBoss) {
      virtualTools.push(
        createDelegateTool({
          runtimeCtx,
          toolCtx,
          runLocalEmployee: (employee, task, signal) =>
            this.runDelegated(employee, task, params, signal),
        }),
      );
      return virtualTools;
    }
    const virtualNames = new Set(virtualTools.map((t) => t.name));
    const toolExecutor: ToolExecutor = runtimeCtx.toolExecutor;
    const builtinDefs: ToolDef[] = [...(runtimeCtx.builtinTools?.values() ?? [])].map((t) => t.def);
    let mcpDefs: ToolDef[] = [];
    try {
      mcpDefs = await toolExecutor.listAvailable(params.companyId);
    } catch (error) {
      logger.warn('listAvailable failed; continuing with builtin tools only', {
        error: toErrorMessage(error),
      });
    }
    // The boss is a pure orchestrator: it gets `delegate` only, NOT bash / write /
    // MCP execution tools. Those belong to the employee that does the work — and
    // a boss has no employeeId, so any direct executor call would mis-attribute
    // its audit row to 'unknown' and dilute the model away from delegating. The
    // employee gets the full audited executor set.
    const executorDefs = dedupeByName([...builtinDefs, ...mcpDefs]).filter(
      (def) => !virtualNames.has(def.name),
    );
    const executorTools = toolDefsToAgentTools(executorDefs, toolExecutor, toolCtx);
    return [...executorTools, ...virtualTools];
  }

  /** Persist top-level pi messages to the thread transcript. */
  private async persistMessage(params: WorkerParams, message: PiMessage): Promise<void> {
    // Only the top-level turn owns the thread transcript; a delegated sub-agent's
    // internal messages must not interleave into the boss thread's history.
    if (params.parentSignal || !this.deps.messageStore) return;
    try {
      await this.deps.messageStore.append(
        params.threadId,
        params.companyId,
        [message],
        new Date().toISOString(),
        params.employee?.employee_id ?? null,
      );
    } catch (error) {
      logger.warn('persistMessage failed', {
        threadId: params.threadId,
        error: toErrorMessage(error),
      });
      // Rethrow so the run records the failure (see `persistError` in runWorker)
      // and marks the thread blocked — losing transcript history silently would
      // corrupt multi-turn memory + resume.
      throw error;
    }
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
