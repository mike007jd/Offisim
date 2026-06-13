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
  /**
   * Extra virtual tools to expose to every agent (memory, submit_deliverable,
   * delegate). Receives the per-agent tool context so tools can scope writes.
   * Phase 4/5 supply submit_deliverable / delegate here.
   */
  readonly virtualToolProvider?: (ctx: PiToolContext, agentKind: PiAgentKind) => ToolDef[];
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

    const systemPrompt = this.buildSystemPrompt(kind, employee, company, input.text);
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
      threadId: input.threadId,
      companyId: input.companyId,
      employeeId: input.employeeId,
      projectId: input.projectId ?? null,
      runScope: input.runScope ?? null,
    };
    const tools = await this.assembleTools(input, toolCtx, kind);

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
        messages: input.history ? [...input.history] : [],
      },
      streamFn: this.deps.streamFn,
      transformContext,
      toolExecution: 'sequential',
    });

    // Round guard: count completed turns; abort on runaway. Replaces
    // MAX_TOOL_ROUNDS / recursion-limit, which vanished with the graph.
    const maxRounds = this.deps.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    let rounds = 0;
    let hitRoundLimit = false;

    const nodeName = kind === 'boss' ? 'boss_summary' : 'employee';
    const listener = createPiEventListener(
      runtimeCtx.eventBus,
      {
        companyId: input.companyId,
        threadId: input.threadId,
        nodeName,
        employeeId: input.employeeId,
        runScope: input.runScope ?? null,
      },
      {
        onMessageEnd: (message) => this.persistMessage(input, message),
      },
    );
    const roundCounter = (event: AgentEvent) => {
      if (event.type === 'turn_end') {
        rounds += 1;
        if (rounds >= maxRounds && !hitRoundLimit) {
          hitRoundLimit = true;
          logger.warn('round guard tripped; aborting agent', {
            threadId: input.threadId,
            rounds,
          });
          agent.abort();
        }
      }
    };
    const unsubscribe = agent.subscribe(async (event, _signal) => {
      await listener(event);
      roundCounter(event);
    });
    const unregister = this.deps.registry.register(input.threadId, agent);

    try {
      await runtimeCtx.repos.threads.updateStatus(input.threadId, 'running').catch(() => {});
      await agent.prompt(input.text);
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

    await runtimeCtx.repos.threads
      .updateStatus(input.threadId, stopReason === 'completed' ? 'completed' : 'blocked')
      .catch(() => {});
    // Note: `chat_thread.updated` is a metadata event (title / archive), not a
    // per-message signal — the renderer streams via `llm.stream.chunk`. The
    // boss auto-title rewrite (Phase 4) emits it with reason 'title'.

    return { finalText, messages, stopReason };
  }

  private buildSystemPrompt(
    kind: PiAgentKind,
    employee: EmployeeRow | null,
    company: CompanyRow,
    taskInput: string,
  ): string {
    if (kind === 'employee' && employee) {
      return buildEmployeePrompt(employee, company, taskInput);
    }
    // Boss direct-reply prompt. Phase 5 layers the delegate tool on top so the
    // boss can dispatch to employees; here it answers directly.
    return [
      `You are the founder and boss of ${company.name}.`,
      'Answer the user directly, helpfully, and concisely. Use the available tools',
      'when a task requires real work (reading or writing files, running commands,',
      'searching). Never fabricate results you did not produce with a tool.',
      '',
      `User request:\n${taskInput}`,
    ].join('\n');
  }

  private async assembleTools(
    input: PiExecuteInput,
    toolCtx: PiToolContext,
    kind: PiAgentKind,
  ): Promise<AgentTool[]> {
    const { runtimeCtx } = this.deps;
    const toolExecutor: ToolExecutor = runtimeCtx.toolExecutor;
    const builtinDefs: ToolDef[] = [...(runtimeCtx.builtinTools?.values() ?? [])].map((t) => t.def);
    let mcpDefs: ToolDef[] = [];
    try {
      mcpDefs = await toolExecutor.listAvailable(input.companyId);
    } catch (error) {
      logger.warn('listAvailable failed; continuing with builtin tools only', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const virtualDefs = this.deps.virtualToolProvider?.(toolCtx, kind) ?? [];
    const allDefs = dedupeByName([...builtinDefs, ...mcpDefs, ...virtualDefs]);
    return toolDefsToAgentTools(allDefs, toolExecutor, toolCtx);
  }

  /**
   * Phase 4 seam: persist each finished pi message to SQLite (per-message
   * append granularity). Until the persistence layer lands this is a no-op so
   * the loop runs end-to-end with in-memory transcript only.
   */
  private async persistMessage(_input: PiExecuteInput, _message: PiMessage): Promise<void> {
    // intentionally empty until Phase 4 wires PiMessageStore
  }

  private async withThreadLock<T>(threadId: string, run: () => Promise<T>): Promise<T> {
    const prev = this.threadLocks.get(threadId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.threadLocks.set(
      threadId,
      prev.then(() => gate),
    );
    await prev.catch(() => {});
    try {
      return await run();
    } finally {
      release();
      if (this.threadLocks.get(threadId) === prev.then(() => gate)) {
        // best-effort cleanup; a newer waiter may have replaced the entry
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
