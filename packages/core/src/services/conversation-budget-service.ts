import type {
  ConversationCompactCompletedPayload,
  ConversationSynopsisUpdatedPayload,
} from '@offisim/shared-types';
import {
  conversationCompactCompleted,
  conversationSynopsisUpdated,
} from '../events/event-factories.js';
import type { LlmRequest, LlmResponse } from '../llm/gateway.js';
import { compactToolResultMessages, pruneLlmMessages } from '../llm/prune-messages.js';
import type { CompactBaselineState } from '../graph/state.js';
import { parseCompactBaseline } from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { generateId } from '../utils/generate-id.js';

export interface ThreadSynopsisRecord {
  version: number;
  summary: string;
  prunedMessageCount: number;
  totalMessageCount: number;
  updatedAt: string;
}

/** @deprecated Use CompactBaselineState from graph/state.ts */
export type CompactBaselineRecord = CompactBaselineState;

export interface ConversationBudgetServiceOptions {
  maxNonSystemMessages?: number;
  tailNonSystemMessages?: number;
  synopsisTriggerMessages?: number;
  synopsisRefreshMinMessages?: number;
  toolResultKeepRecent?: number;
  toolResultMaxContentChars?: number;
  synopsisFailureThreshold?: number;
  postCompactKeepNodeSummaries?: number;
  fullCompactTriggerTokens?: number;
  fullCompactTriggerMessages?: number;
  fullCompactFailureThreshold?: number;
  fullCompactRefreshMinMessages?: number;
}

interface ResolvedConversationBudgetOptions {
  enabled: boolean;
  maxNonSystemMessages: number;
  tailNonSystemMessages: number;
  synopsisTriggerMessages: number;
  synopsisRefreshMinMessages: number;
  synopsisTriggerTokens: number;
  toolResultKeepRecent: number;
  toolResultMaxContentChars: number;
  synopsisFailureThreshold: number;
  postCompactKeepNodeSummaries: number;
  fullCompactTriggerTokens: number;
  fullCompactTriggerMessages: number;
  fullCompactFailureThreshold: number;
  fullCompactRefreshMinMessages: number;
}

const DEFAULT_TAIL_NON_SYSTEM_MESSAGES = 50;
const DEFAULT_SYNOPSIS_TRIGGER_MESSAGES = 80;
const DEFAULT_SYNOPSIS_REFRESH_MIN_MESSAGES = 6;
const DEFAULT_TOOL_RESULT_KEEP_RECENT = 4;
const DEFAULT_TOOL_RESULT_MAX_CONTENT_CHARS = 400;
const DEFAULT_SYNOPSIS_FAILURE_THRESHOLD = 3;
const DEFAULT_POST_COMPACT_KEEP_NODE_SUMMARIES = 12;
const DEFAULT_FULL_COMPACT_TRIGGER_TOKENS = 90_000;
const DEFAULT_FULL_COMPACT_TRIGGER_MESSAGES = 120;
const DEFAULT_FULL_COMPACT_FAILURE_THRESHOLD = 3;
const DEFAULT_FULL_COMPACT_REFRESH_MIN_MESSAGES = 24;

const SYNOPSIS_SYSTEM_PROMPT = `You condense long agent conversations for future continuation.
Write a concise summary that preserves decisions, constraints, open questions, and important user preferences.
Do not add speculation. Output plain text only.`;

const FULL_COMPACT_SYSTEM_PROMPT = `You create a durable execution baseline for a long-running multi-agent coding session.
Summarize only the information needed to continue work safely and efficiently.
Focus on:
- user objective
- confirmed decisions
- important files or components touched
- progress or current execution state
- unresolved questions
- active constraints, risks, or warnings

Do not include chain-of-thought.
Do not invent facts.
Output plain text only.`;

export class ConversationBudgetService {
  private readonly synopsisFailureStreaks = new Map<string, number>();
  private readonly fullCompactFailureStreaks = new Map<string, number>();
  private readonly fullCompactFailureMessageCounts = new Map<string, number>();

  constructor(private readonly defaults: ConversationBudgetServiceOptions = {}) {}

  async prepareRequest(ctx: RuntimeContext, request: LlmRequest): Promise<LlmRequest> {
    const options = this.resolveOptions(ctx);
    const thread = await ctx.repos.threads.findById(ctx.threadId);
    let compactBaseline = parseCompactBaseline(thread?.compact_baseline_json ?? null);
    const compactedMessages = compactToolResultMessages(request.messages, options);
    const systemMessages = compactedMessages.filter((message) => message.role === 'system');
    const rawNonSystemMessages = compactedMessages.filter((message) => message.role !== 'system');
    let nonSystemMessages = compactBaseline
      ? rawNonSystemMessages.slice(
          Math.min(compactBaseline.compactedNonSystemMessageCount, rawNonSystemMessages.length),
        )
      : rawNonSystemMessages;
    const summaryCount = await ctx.repos.nodeSummaries.countByThread(ctx.threadId);
    const effectiveTailNonSystemMessages =
      summaryCount > 3
        ? Math.max(options.tailNonSystemMessages - 10, 20)
        : options.tailNonSystemMessages;
    const effectiveMaxNonSystemMessages = Math.min(
      options.maxNonSystemMessages,
      effectiveTailNonSystemMessages,
    );

    if (!options.enabled) {
      return {
        ...request,
        messages: pruneLlmMessages(
          this.buildRequestMessages(systemMessages, compactBaseline, nonSystemMessages),
          {
            maxNonSystemMessages: effectiveTailNonSystemMessages,
          },
        ),
      };
    }

    if (nonSystemMessages.length <= effectiveMaxNonSystemMessages) {
      const preparedMessages = this.buildRequestMessages(
        systemMessages,
        compactBaseline,
        nonSystemMessages,
      );
      return compactedMessages === request.messages && !compactBaseline
        ? request
        : { ...request, messages: preparedMessages };
    }

    const existingSynopsis = compactBaseline
      ? null
      : this.parseSynopsis(thread?.synopsis_json ?? null);
    const approximateTokens = this.estimateTokens(nonSystemMessages);
    const wantsInitialFullCompact =
      !compactBaseline &&
      rawNonSystemMessages.length >= options.fullCompactTriggerMessages &&
      approximateTokens >= options.fullCompactTriggerTokens;
    const overflowCount = Math.max(0, nonSystemMessages.length - effectiveTailNonSystemMessages);
    const newOverflowSinceSynopsis = existingSynopsis
      ? Math.max(0, overflowCount - existingSynopsis.prunedMessageCount)
      : overflowCount;
    const shouldGenerateSynopsis =
      !compactBaseline &&
      !wantsInitialFullCompact &&
      nonSystemMessages.length >= options.synopsisTriggerMessages &&
      approximateTokens >= options.synopsisTriggerTokens &&
      (!existingSynopsis || newOverflowSinceSynopsis >= options.synopsisRefreshMinMessages);

    const synopsisResult = shouldGenerateSynopsis
      ? await this.generateSynopsis(ctx, nonSystemMessages, existingSynopsis, options)
      : existingSynopsis
        ? {
            synopsis: existingSynopsis,
            summarySource: 'existing' as const,
            failureStreak: 0,
          }
        : null;
    const synopsis = synopsisResult?.synopsis ?? null;

    if (wantsInitialFullCompact) {
      const failureStreak = this.fullCompactFailureStreaks.get(ctx.threadId) ?? 0;
      const lastFailureMessageCount = this.fullCompactFailureMessageCounts.get(ctx.threadId) ?? 0;
      const meaningfulGrowth =
        rawNonSystemMessages.length - lastFailureMessageCount >=
        options.fullCompactRefreshMinMessages;
      const circuitOpen = failureStreak >= options.fullCompactFailureThreshold && !meaningfulGrowth;

      const fullCompactSummary = !circuitOpen
        ? await this.generateFullCompactSummary(ctx, {
            priorSummaryText: existingSynopsis?.summary ?? null,
            sourceMessages: rawNonSystemMessages,
          })
        : null;

      if (!circuitOpen && fullCompactSummary) {
        compactBaseline = await this.persistCompactBaseline(
          ctx,
          rawNonSystemMessages,
          fullCompactSummary.summary,
          fullCompactSummary.updatedAt,
          effectiveTailNonSystemMessages,
          0,
          0,
          approximateTokens,
        );
        this.fullCompactFailureStreaks.delete(ctx.threadId);
        this.fullCompactFailureMessageCounts.delete(ctx.threadId);
        nonSystemMessages = rawNonSystemMessages.slice(
          Math.min(compactBaseline.compactedNonSystemMessageCount, rawNonSystemMessages.length),
        );
      } else {
        const fallbackSynopsis =
          synopsis ??
          (await this.generateSynopsis(ctx, nonSystemMessages, existingSynopsis, options))?.synopsis ??
          null;
        const nextFailureStreak = circuitOpen ? failureStreak : failureStreak + 1;
        this.fullCompactFailureStreaks.set(ctx.threadId, nextFailureStreak);
        this.fullCompactFailureMessageCounts.set(ctx.threadId, rawNonSystemMessages.length);
        await ctx.repos.compactSummaries.create({
          compact_id: generateId('fcbskip'),
          thread_id: ctx.threadId,
          company_id: ctx.companyId,
          compact_kind: 'full_thread_skip',
          summary_source: circuitOpen ? 'circuit_breaker' : 'llm_error',
          summary_text: fallbackSynopsis?.summary ?? existingSynopsis?.summary ?? '',
          pre_compact_message_count: rawNonSystemMessages.length,
          pre_compact_token_count: approximateTokens,
          messages_compacted: 0,
          failure_streak: nextFailureStreak,
          created_at: new Date().toISOString(),
        });
      }
    }

    if (
      compactBaseline &&
      nonSystemMessages.length >= options.fullCompactTriggerMessages &&
      approximateTokens >= options.fullCompactTriggerTokens
    ) {
      const failureStreak = this.fullCompactFailureStreaks.get(ctx.threadId) ?? 0;
      const lastFailureMessageCount = this.fullCompactFailureMessageCounts.get(ctx.threadId) ?? 0;
      const meaningfulGrowth =
        rawNonSystemMessages.length - lastFailureMessageCount >=
        options.fullCompactRefreshMinMessages;
      const circuitOpen = failureStreak >= options.fullCompactFailureThreshold && !meaningfulGrowth;
      const refreshedCompactSummary = !circuitOpen
        ? await this.generateFullCompactSummary(ctx, {
            priorSummaryText: compactBaseline.summaryText,
            sourceMessages: nonSystemMessages,
          })
        : null;

      if (!circuitOpen && refreshedCompactSummary) {
        compactBaseline = await this.persistCompactBaseline(
          ctx,
          rawNonSystemMessages,
          refreshedCompactSummary.summary,
          refreshedCompactSummary.updatedAt,
          effectiveTailNonSystemMessages,
          compactBaseline.compactedNonSystemMessageCount,
          compactBaseline.compactVersion,
          approximateTokens,
        );
        this.fullCompactFailureStreaks.delete(ctx.threadId);
        this.fullCompactFailureMessageCounts.delete(ctx.threadId);
        nonSystemMessages = rawNonSystemMessages.slice(
          Math.min(compactBaseline.compactedNonSystemMessageCount, rawNonSystemMessages.length),
        );
      } else {
        const nextFailureStreak = circuitOpen ? failureStreak : failureStreak + 1;
        this.fullCompactFailureStreaks.set(ctx.threadId, nextFailureStreak);
        this.fullCompactFailureMessageCounts.set(ctx.threadId, rawNonSystemMessages.length);
        await ctx.repos.compactSummaries.create({
          compact_id: generateId('fcbskip'),
          thread_id: ctx.threadId,
          company_id: ctx.companyId,
          compact_kind: 'full_thread_skip',
          summary_source: circuitOpen ? 'circuit_breaker' : 'llm_error',
          summary_text: compactBaseline.summaryText,
          pre_compact_message_count: rawNonSystemMessages.length,
          pre_compact_token_count: approximateTokens,
          messages_compacted: 0,
          failure_streak: nextFailureStreak,
          created_at: new Date().toISOString(),
        });
      }
    }

    const synopsisMessage = synopsis
      ? compactBaseline
        ? null
        : {
            role: 'system' as const,
            content: `## Conversation synopsis\n${synopsis.summary}`,
          }
      : null;

    return {
      ...request,
      messages: pruneLlmMessages(
        this.buildRequestMessages(
          systemMessages,
          compactBaseline,
          nonSystemMessages,
          synopsisMessage,
        ),
        {
          maxNonSystemMessages: effectiveTailNonSystemMessages,
        },
      ),
    };
  }

  private resolveOptions(ctx: RuntimeContext): ResolvedConversationBudgetOptions {
    const summarization = ctx.runtimePolicy?.summarization;
    const keepRecentMessages = Math.max(
      0,
      summarization?.keepRecentMessages ?? DEFAULT_TAIL_NON_SYSTEM_MESSAGES,
    );
    return {
      enabled: summarization?.enabled ?? true,
      maxNonSystemMessages: this.defaults.maxNonSystemMessages ?? keepRecentMessages,
      tailNonSystemMessages: this.defaults.tailNonSystemMessages ?? keepRecentMessages,
      synopsisTriggerMessages:
        this.defaults.synopsisTriggerMessages ??
        Math.max(DEFAULT_SYNOPSIS_TRIGGER_MESSAGES, keepRecentMessages + 10),
      synopsisRefreshMinMessages:
        this.defaults.synopsisRefreshMinMessages ?? DEFAULT_SYNOPSIS_REFRESH_MIN_MESSAGES,
      synopsisTriggerTokens: summarization?.triggerTokens ?? 60_000,
      toolResultKeepRecent: this.defaults.toolResultKeepRecent ?? DEFAULT_TOOL_RESULT_KEEP_RECENT,
      toolResultMaxContentChars:
        this.defaults.toolResultMaxContentChars ?? DEFAULT_TOOL_RESULT_MAX_CONTENT_CHARS,
      synopsisFailureThreshold:
        this.defaults.synopsisFailureThreshold ?? DEFAULT_SYNOPSIS_FAILURE_THRESHOLD,
      postCompactKeepNodeSummaries:
        this.defaults.postCompactKeepNodeSummaries ?? DEFAULT_POST_COMPACT_KEEP_NODE_SUMMARIES,
      fullCompactTriggerTokens:
        this.defaults.fullCompactTriggerTokens ?? DEFAULT_FULL_COMPACT_TRIGGER_TOKENS,
      fullCompactTriggerMessages:
        this.defaults.fullCompactTriggerMessages ?? DEFAULT_FULL_COMPACT_TRIGGER_MESSAGES,
      fullCompactFailureThreshold:
        this.defaults.fullCompactFailureThreshold ?? DEFAULT_FULL_COMPACT_FAILURE_THRESHOLD,
      fullCompactRefreshMinMessages:
        this.defaults.fullCompactRefreshMinMessages ?? DEFAULT_FULL_COMPACT_REFRESH_MIN_MESSAGES,
    };
  }

  private buildRequestMessages(
    systemMessages: readonly LlmRequest['messages'][number][],
    compactBaseline: CompactBaselineRecord | null,
    nonSystemMessages: readonly LlmRequest['messages'][number][],
    synopsisMessage?: LlmRequest['messages'][number] | null,
  ): LlmRequest['messages'] {
    return [
      ...systemMessages,
      ...(compactBaseline
        ? [
            {
              role: 'system' as const,
              content: `## Compact baseline\n${compactBaseline.summaryText}`,
            },
          ]
        : []),
      ...(synopsisMessage ? [synopsisMessage] : []),
      ...nonSystemMessages,
    ];
  }

  private estimateTokens(messages: readonly LlmRequest['messages'][number][]): number {
    const rawEstimate = messages.reduce((total, message) => {
      const contentTokens = Math.ceil(message.content.length / 4);
      const toolTokens = message.toolCalls
        ? Math.ceil(JSON.stringify(message.toolCalls).length / 4)
        : 0;
      return total + contentTokens + toolTokens;
    }, 0);
    return Math.ceil(rawEstimate * (4 / 3));
  }

  private async generateSynopsis(
    ctx: RuntimeContext,
    nonSystemMessages: readonly LlmRequest['messages'][number][],
    existing: ThreadSynopsisRecord | null,
    preResolved?: ResolvedConversationBudgetOptions,
  ): Promise<{
    synopsis: ThreadSynopsisRecord;
    summarySource: 'llm' | 'heuristic' | 'circuit_breaker';
    failureStreak: number;
  } | null> {
    const options = preResolved ?? this.resolveOptions(ctx);
    const summaryCount = await ctx.repos.nodeSummaries.countByThread(ctx.threadId);
    const effectiveTailNonSystemMessages =
      summaryCount > 3
        ? Math.max(options.tailNonSystemMessages - 10, 20)
        : options.tailNonSystemMessages;
    const overflowCount = Math.max(0, nonSystemMessages.length - effectiveTailNonSystemMessages);
    const sourceMessages =
      overflowCount > 0 ? nonSystemMessages.slice(0, overflowCount) : nonSystemMessages;
    const transcript = sourceMessages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n');

    let failureStreak = this.synopsisFailureStreaks.get(ctx.threadId) ?? 0;
    let summary: string | null = null;
    let summarySource: 'llm' | 'heuristic' | 'circuit_breaker' = 'llm';
    if (failureStreak >= options.synopsisFailureThreshold) {
      summarySource = 'circuit_breaker';
      summary = this.buildHeuristicSummary(existing, sourceMessages);
    } else {
      try {
        // Use the boss-role model for synopsis (cheap system-level call).
        // Falls back to whatever the policy default is.
        const synopsisModel = ctx.modelResolver.resolve(null, 'boss').model;
        const chatRequest: LlmRequest = {
          model: synopsisModel,
          temperature: 0.2,
          maxTokens: 256,
          messages: [
            { role: 'system', content: SYNOPSIS_SYSTEM_PROMPT },
            {
              role: 'user',
              content: existing
                ? `Existing synopsis:\n${existing.summary}\n\nNew conversation to condense:\n${transcript}`
                : `Conversation to condense:\n${transcript}`,
            },
          ],
        };
        const response = ctx.systemCaller
          ? await ctx.systemCaller.chat('conversation_budget', chatRequest)
          : await ctx.llmGateway.chat(chatRequest);
        summary = this.normalizeSummary(response);
        failureStreak = 0;
        this.synopsisFailureStreaks.delete(ctx.threadId);
      } catch (error) {
        failureStreak += 1;
        this.synopsisFailureStreaks.set(ctx.threadId, failureStreak);
        summarySource =
          failureStreak >= options.synopsisFailureThreshold ? 'circuit_breaker' : 'heuristic';
        summary = this.buildHeuristicSummary(existing, sourceMessages);
        void error;
      }
    }
    if (!summary) {
      return existing
        ? {
            synopsis: existing,
            summarySource: 'heuristic',
            failureStreak,
          }
        : null;
    }

    const synopsis: ThreadSynopsisRecord = {
      version: (existing?.version ?? 0) + 1,
      summary,
      prunedMessageCount: sourceMessages.length,
      totalMessageCount: nonSystemMessages.length,
      updatedAt: new Date().toISOString(),
    };

    const synopsisTokenCount = this.estimateTokens(nonSystemMessages);
    await ctx.repos.threads.updateSynopsis(ctx.threadId, JSON.stringify(synopsis));
    await ctx.repos.compactSummaries.create({
      compact_id: generateId('cs'),
      thread_id: ctx.threadId,
      company_id: ctx.companyId,
      compact_kind: 'thread_synopsis',
      summary_source: summarySource,
      summary_text: synopsis.summary,
      pre_compact_message_count: nonSystemMessages.length,
      pre_compact_token_count: synopsisTokenCount,
      messages_compacted: sourceMessages.length,
      failure_streak: summarySource === 'llm' ? 0 : failureStreak,
      created_at: synopsis.updatedAt,
    });
    await ctx.repos.events.insert({
      event_id: `evt-${ctx.threadId}-${synopsis.version}`,
      company_id: ctx.companyId,
      thread_id: ctx.threadId,
      event_type: 'conversation.synopsis.updated',
      severity: 'info',
      payload_json: JSON.stringify({
        summary: synopsis.summary,
        version: synopsis.version,
        prunedMessageCount: synopsis.prunedMessageCount,
        totalMessageCount: synopsis.totalMessageCount,
      }),
      created_at: synopsis.updatedAt,
    });
    await this.postCompactCleanup(ctx, options, synopsis.updatedAt);
    ctx.eventBus.emit(this.makeSynopsisEvent(ctx, synopsis));
    return {
      synopsis,
      summarySource,
      failureStreak,
    };
  }

  private async generateFullCompactSummary(
    ctx: RuntimeContext,
    input: {
      priorSummaryText: string | null;
      sourceMessages: readonly LlmRequest['messages'][number][];
    },
  ): Promise<{ summary: string; updatedAt: string } | null> {
    const recentNodeSummaries = await ctx.repos.nodeSummaries.listByThread(ctx.threadId, {
      limit: 6,
    });
    const nodeSummaryBlock =
      recentNodeSummaries.length > 0
        ? recentNodeSummaries
            .reverse()
            .map((summary) => `- [${summary.node_name}] ${summary.summary_text}`)
            .join('\n')
        : 'None';
    const transcript = input.sourceMessages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n');
    const compactModel = ctx.modelResolver.resolve(null, 'boss').model;
    const chatRequest: LlmRequest = {
      model: compactModel,
      temperature: 0.2,
      maxTokens: 384,
      messages: [
        { role: 'system', content: FULL_COMPACT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            input.priorSummaryText
              ? `Prior durable summary:\n${input.priorSummaryText}`
              : 'Prior durable summary:\nNone',
            `Recent node summaries:\n${nodeSummaryBlock}`,
            `Conversation slice to compact:\n${transcript}`,
          ].join('\n\n'),
        },
      ],
    };
    try {
      const response = ctx.systemCaller
        ? await ctx.systemCaller.chat('conversation_full_compact', chatRequest)
        : await ctx.llmGateway.chat(chatRequest);
      const summary = this.normalizeSummary(response);
      if (!summary) return null;
      return {
        summary,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  private async persistCompactBaseline(
    ctx: RuntimeContext,
    nonSystemMessages: readonly LlmRequest['messages'][number][],
    summaryText: string,
    compactedAt: string,
    keepTailNonSystemMessages: number,
    priorCompactedNonSystemMessageCount = 0,
    priorCompactVersion = 0,
    cachedTokenCount?: number,
  ): Promise<CompactBaselineRecord> {
    const effectiveKeepTailNonSystemMessages = Math.min(
      Math.max(0, keepTailNonSystemMessages),
      nonSystemMessages.length,
    );
    const compactedNonSystemMessageCount = Math.max(
      priorCompactedNonSystemMessageCount,
      Math.max(0, nonSystemMessages.length - effectiveKeepTailNonSystemMessages),
    );
    const compactVersion = Math.max(
      priorCompactVersion > 0 ? priorCompactVersion + 1 : 1,
      (
        await ctx.repos.compactSummaries.listByThread(ctx.threadId, {
          limit: 50,
        })
      ).filter((row) => row.compact_kind === 'full_thread').length + 1,
    );
    const tokenCount = cachedTokenCount ?? this.estimateTokens(nonSystemMessages);
    const baseline: CompactBaselineRecord = {
      compactId: generateId('fcb'),
      compactVersion,
      compactedAt,
      summaryText,
      compactedNonSystemMessageCount,
      keptTailNonSystemMessageCount: effectiveKeepTailNonSystemMessages,
    };

    await ctx.repos.threads.updateCompactBaseline(ctx.threadId, JSON.stringify(baseline));
    await ctx.repos.compactSummaries.create({
      compact_id: baseline.compactId,
      thread_id: ctx.threadId,
      company_id: ctx.companyId,
      compact_kind: 'full_thread',
      summary_source: 'llm',
      summary_text: baseline.summaryText,
      pre_compact_message_count: nonSystemMessages.length,
      pre_compact_token_count: tokenCount,
      messages_compacted: baseline.compactedNonSystemMessageCount,
      failure_streak: 0,
      created_at: baseline.compactedAt,
    });
    await ctx.repos.events.insert({
      event_id: `evt-${baseline.compactId}`,
      company_id: ctx.companyId,
      thread_id: ctx.threadId,
      event_type: 'conversation.compact.completed',
      severity: 'info',
      payload_json: JSON.stringify({
        compactId: baseline.compactId,
        compactVersion: baseline.compactVersion,
        compactedNonSystemMessageCount: baseline.compactedNonSystemMessageCount,
        keptTailNonSystemMessageCount: baseline.keptTailNonSystemMessageCount,
        preCompactMessageCount: nonSystemMessages.length,
        preCompactTokenCount: tokenCount,
      } satisfies ConversationCompactCompletedPayload),
      created_at: baseline.compactedAt,
    });
    ctx.eventBus.emit(
      this.makeCompactCompletedEvent(ctx, baseline, nonSystemMessages.length, tokenCount),
    );
    return baseline;
  }

  private async postCompactCleanup(
    ctx: RuntimeContext,
    options: ResolvedConversationBudgetOptions,
    compactedAtIso: string,
  ): Promise<void> {
    await ctx.repos.nodeSummaries.trimByThread(ctx.threadId, options.postCompactKeepNodeSummaries);
    const compactedAt = Date.parse(compactedAtIso);
    if (!Number.isFinite(compactedAt)) return;
    if (ctx.interactionService) {
      await ctx.interactionService.clearPendingBefore(compactedAt);
    } else if (ctx.interactionBox.pending && ctx.interactionBox.pending.createdAt < compactedAt) {
      ctx.interactionBox.pending = null;
    }
  }

  private normalizeSummary(response: LlmResponse): string | null {
    const summary = response.content.replace(/\s+/g, ' ').trim();
    return summary.length > 0 ? summary : null;
  }

  private buildHeuristicSummary(
    existing: ThreadSynopsisRecord | null,
    messages: readonly LlmRequest['messages'][number][],
  ): string | null {
    const snippet = messages
      .slice(-8)
      .map((message) => `${message.role}: ${message.content}`)
      .join(' | ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!snippet) return existing?.summary ?? null;
    return existing ? `${existing.summary} | ${snippet}`.slice(0, 900) : snippet.slice(0, 900);
  }

  private parseSynopsis(raw: string | null): ThreadSynopsisRecord | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<ThreadSynopsisRecord>;
      if (
        typeof parsed.summary !== 'string' ||
        typeof parsed.version !== 'number' ||
        typeof parsed.prunedMessageCount !== 'number' ||
        typeof parsed.totalMessageCount !== 'number' ||
        typeof parsed.updatedAt !== 'string'
      ) {
        return null;
      }
      return {
        version: parsed.version,
        summary: parsed.summary,
        prunedMessageCount: parsed.prunedMessageCount,
        totalMessageCount: parsed.totalMessageCount,
        updatedAt: parsed.updatedAt,
      };
    } catch {
      return null;
    }
  }

  private makeSynopsisEvent(ctx: RuntimeContext, synopsis: ThreadSynopsisRecord) {
    const payload: ConversationSynopsisUpdatedPayload = {
      summary: synopsis.summary,
      version: synopsis.version,
      prunedMessageCount: synopsis.prunedMessageCount,
      totalMessageCount: synopsis.totalMessageCount,
    };
    return conversationSynopsisUpdated(ctx.companyId, ctx.threadId, payload);
  }

  private makeCompactCompletedEvent(
    ctx: RuntimeContext,
    baseline: CompactBaselineRecord,
    preCompactMessageCount: number,
    preCompactTokenCount: number,
  ) {
    const payload: ConversationCompactCompletedPayload = {
      compactId: baseline.compactId,
      compactVersion: baseline.compactVersion,
      compactedNonSystemMessageCount: baseline.compactedNonSystemMessageCount,
      keptTailNonSystemMessageCount: baseline.keptTailNonSystemMessageCount,
      preCompactMessageCount,
      preCompactTokenCount,
    };
    return conversationCompactCompleted(ctx.companyId, ctx.threadId, payload);
  }
}
