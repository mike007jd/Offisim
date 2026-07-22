import type { ConversationCompactCompletedPayload } from '@offisim/shared-types';
import { conversationCompactCompleted } from '../../events/event-factories.js';
import type { LlmRequest } from '../../llm/gateway.js';
import type { RuntimeContext } from '../../runtime/runtime-context.js';
import { generateId } from '../../utils/generate-id.js';
import type { CompactBaselineState } from './compact-baseline.js';
import { setTrackedThread } from './failure-tracking.js';
import { normalizeSummary } from './message-utils.js';
import type { ResolvedConversationBudgetOptions } from './options-resolver.js';
import type { SynopsisGenerator, ThreadSynopsisRecord } from './synopsis-generator.js';

type LlmMessage = LlmRequest['messages'][number];

export interface CompactAttemptResult {
  baseline: CompactBaselineState;
  nonSystemMessages: LlmMessage[];
}

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

export function toolPairSafeCutIndex(
  messages: readonly LlmMessage[],
  requestedCut: number,
): number {
  let cut = Math.min(Math.max(0, requestedCut), messages.length);
  while (cut > 0 && messages[cut]?.role === 'tool') {
    cut -= 1;
  }
  return cut;
}

function sliceAfterCompactionBoundary(
  messages: readonly LlmMessage[],
  requestedCut: number,
): LlmMessage[] {
  return messages.slice(toolPairSafeCutIndex(messages, requestedCut));
}

export class FullCompactOrchestrator {
  // Insertion-ordered: the first key is the least-recently-updated thread, so
  // we can evict it when MAX_TRACKED_THREADS is exceeded.
  private readonly fullCompactFailureStreaks = new Map<string, number>();
  private readonly fullCompactFailureMessageCounts = new Map<string, number>();

  constructor(private readonly synopsisGenerator: SynopsisGenerator) {}

  dispose(): void {
    this.fullCompactFailureStreaks.clear();
    this.fullCompactFailureMessageCounts.clear();
  }

  // Recompute the streak from the live map right before the write so an
  // interleaved same-thread prepareRequest cannot clobber the increment with a
  // pre-await snapshot, and re-insert with insertion-order eviction so the maps
  // stay bounded.
  private recordFailure(threadId: string, circuitOpen: boolean, rawMessageCount: number): number {
    const currentStreak = this.fullCompactFailureStreaks.get(threadId) ?? 0;
    const nextFailureStreak = circuitOpen ? currentStreak : currentStreak + 1;
    setTrackedThread(this.fullCompactFailureStreaks, threadId, nextFailureStreak);
    setTrackedThread(this.fullCompactFailureMessageCounts, threadId, rawMessageCount);
    return nextFailureStreak;
  }

  private clearFailure(threadId: string): void {
    this.fullCompactFailureStreaks.delete(threadId);
    this.fullCompactFailureMessageCounts.delete(threadId);
  }

  async tryInitialCompact(
    ctx: RuntimeContext,
    input: {
      rawNonSystemMessages: readonly LlmMessage[];
      nonSystemMessages: readonly LlmMessage[];
      existingSynopsis: ThreadSynopsisRecord | null;
      priorSynopsis: ThreadSynopsisRecord | null;
      options: ResolvedConversationBudgetOptions;
      effectiveTailNonSystemMessages: number;
      approximateTokens: number;
    },
  ): Promise<CompactAttemptResult | null> {
    const {
      rawNonSystemMessages,
      nonSystemMessages,
      existingSynopsis,
      priorSynopsis,
      options,
      effectiveTailNonSystemMessages,
      approximateTokens,
    } = input;
    const circuitOpen = this.checkCircuit(ctx, rawNonSystemMessages.length, options);

    const summary = !circuitOpen
      ? await this.generateSummary(ctx, {
          priorSummaryText: existingSynopsis?.summary ?? null,
          sourceMessages: rawNonSystemMessages,
        })
      : null;

    if (!circuitOpen && summary) {
      const baseline = await this.persistBaseline(ctx, {
        nonSystemMessages: rawNonSystemMessages,
        summaryText: summary.summary,
        compactedAt: summary.updatedAt,
        keepTailNonSystemMessages: effectiveTailNonSystemMessages,
        priorCompactedNonSystemMessageCount: 0,
        priorCompactVersion: 0,
        cachedTokenCount: approximateTokens,
      });
      this.clearFailure(ctx.threadId);
      return {
        baseline,
        nonSystemMessages: sliceAfterCompactionBoundary(
          rawNonSystemMessages,
          baseline.compactedNonSystemMessageCount,
        ),
      };
    }

    const fallbackSynopsis =
      priorSynopsis ??
      (
        await this.synopsisGenerator.generate(ctx, {
          nonSystemMessages,
          existing: existingSynopsis,
          options,
        })
      )?.synopsis ??
      null;
    const nextFailureStreak = this.recordFailure(
      ctx.threadId,
      circuitOpen,
      rawNonSystemMessages.length,
    );
    await this.recordSkip(ctx, {
      summaryText: fallbackSynopsis?.summary ?? existingSynopsis?.summary ?? '',
      summarySource: circuitOpen ? 'circuit_breaker' : 'llm_error',
      preCompactMessageCount: rawNonSystemMessages.length,
      preCompactTokenCount: approximateTokens,
      failureStreak: nextFailureStreak,
    });
    return null;
  }

  async tryRefreshCompact(
    ctx: RuntimeContext,
    input: {
      rawNonSystemMessages: readonly LlmMessage[];
      nonSystemMessages: readonly LlmMessage[];
      compactBaseline: CompactBaselineState;
      options: ResolvedConversationBudgetOptions;
      effectiveTailNonSystemMessages: number;
      approximateTokens: number;
    },
  ): Promise<CompactAttemptResult | null> {
    const {
      rawNonSystemMessages,
      nonSystemMessages,
      compactBaseline,
      options,
      effectiveTailNonSystemMessages,
      approximateTokens,
    } = input;
    const circuitOpen = this.checkCircuit(ctx, rawNonSystemMessages.length, options);

    const summary = !circuitOpen
      ? await this.generateSummary(ctx, {
          priorSummaryText: compactBaseline.summaryText,
          sourceMessages: nonSystemMessages,
        })
      : null;

    if (!circuitOpen && summary) {
      const baseline = await this.persistBaseline(ctx, {
        nonSystemMessages: rawNonSystemMessages,
        summaryText: summary.summary,
        compactedAt: summary.updatedAt,
        keepTailNonSystemMessages: effectiveTailNonSystemMessages,
        priorCompactedNonSystemMessageCount: compactBaseline.compactedNonSystemMessageCount,
        priorCompactVersion: compactBaseline.compactVersion,
        cachedTokenCount: approximateTokens,
      });
      this.clearFailure(ctx.threadId);
      return {
        baseline,
        nonSystemMessages: sliceAfterCompactionBoundary(
          rawNonSystemMessages,
          baseline.compactedNonSystemMessageCount,
        ),
      };
    }

    const nextFailureStreak = this.recordFailure(
      ctx.threadId,
      circuitOpen,
      rawNonSystemMessages.length,
    );
    await this.recordSkip(ctx, {
      summaryText: compactBaseline.summaryText,
      summarySource: circuitOpen ? 'circuit_breaker' : 'llm_error',
      preCompactMessageCount: rawNonSystemMessages.length,
      preCompactTokenCount: approximateTokens,
      failureStreak: nextFailureStreak,
    });
    return null;
  }

  private checkCircuit(
    ctx: RuntimeContext,
    rawMessageCount: number,
    options: ResolvedConversationBudgetOptions,
  ): boolean {
    const failureStreak = this.fullCompactFailureStreaks.get(ctx.threadId) ?? 0;
    const lastFailureMessageCount = this.fullCompactFailureMessageCounts.get(ctx.threadId) ?? 0;
    const meaningfulGrowth =
      rawMessageCount - lastFailureMessageCount >= options.fullCompactRefreshMinMessages;
    return failureStreak >= options.fullCompactFailureThreshold && !meaningfulGrowth;
  }

  private async generateSummary(
    ctx: RuntimeContext,
    input: {
      priorSummaryText: string | null;
      sourceMessages: readonly LlmMessage[];
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
    const compactModel = ctx.summaryModelSelector?.resolve(null, 'boss').model;
    if (!compactModel) return null;
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
      const response = await ctx.llmGateway.chat(chatRequest);
      const summary = normalizeSummary(response);
      if (!summary) return null;
      return { summary, updatedAt: new Date().toISOString() };
    } catch {
      return null;
    }
  }

  private async persistBaseline(
    ctx: RuntimeContext,
    input: {
      nonSystemMessages: readonly LlmMessage[];
      summaryText: string;
      compactedAt: string;
      keepTailNonSystemMessages: number;
      priorCompactedNonSystemMessageCount: number;
      priorCompactVersion: number;
      cachedTokenCount: number;
    },
  ): Promise<CompactBaselineState> {
    const {
      nonSystemMessages,
      summaryText,
      compactedAt,
      keepTailNonSystemMessages,
      priorCompactedNonSystemMessageCount,
      priorCompactVersion,
      cachedTokenCount,
    } = input;
    const effectiveKeepTailNonSystemMessages = Math.min(
      Math.max(0, keepTailNonSystemMessages),
      nonSystemMessages.length,
    );
    const targetCompactedNonSystemMessageCount = Math.max(
      priorCompactedNonSystemMessageCount,
      Math.max(0, nonSystemMessages.length - effectiveKeepTailNonSystemMessages),
    );
    const compactedNonSystemMessageCount = toolPairSafeCutIndex(
      nonSystemMessages,
      targetCompactedNonSystemMessageCount,
    );
    const compactVersion = priorCompactVersion > 0 ? priorCompactVersion + 1 : 1;
    const tokenCount = cachedTokenCount;
    const baseline: CompactBaselineState = {
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

  private async recordSkip(
    ctx: RuntimeContext,
    input: {
      summaryText: string;
      summarySource: 'circuit_breaker' | 'llm_error';
      preCompactMessageCount: number;
      preCompactTokenCount: number;
      failureStreak: number;
    },
  ): Promise<void> {
    await ctx.repos.compactSummaries.create({
      compact_id: generateId('fcbskip'),
      thread_id: ctx.threadId,
      company_id: ctx.companyId,
      compact_kind: 'full_thread_skip',
      summary_source: input.summarySource,
      summary_text: input.summaryText,
      pre_compact_message_count: input.preCompactMessageCount,
      pre_compact_token_count: input.preCompactTokenCount,
      messages_compacted: 0,
      failure_streak: input.failureStreak,
      created_at: new Date().toISOString(),
    });
  }

  private makeCompactCompletedEvent(
    ctx: RuntimeContext,
    baseline: CompactBaselineState,
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
