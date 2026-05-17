import type { ConversationCompactCompletedPayload } from '@offisim/shared-types';
import { conversationCompactCompleted } from '../../events/event-factories.js';
import type { CompactBaselineState } from '../../graph/state.js';
import type { LlmRequest, LlmResponse } from '../../llm/gateway.js';
import type { RuntimeContext } from '../../runtime/runtime-context.js';
import { generateId } from '../../utils/generate-id.js';
import { estimateTokens } from './message-utils.js';
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

export function toolPairSafeCutIndex(messages: readonly LlmMessage[], requestedCut: number): number {
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
  private readonly fullCompactFailureStreaks = new Map<string, number>();
  private readonly fullCompactFailureMessageCounts = new Map<string, number>();

  constructor(private readonly synopsisGenerator: SynopsisGenerator) {}

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
      this.fullCompactFailureStreaks.delete(ctx.threadId);
      this.fullCompactFailureMessageCounts.delete(ctx.threadId);
      return {
        baseline,
        nonSystemMessages: sliceAfterCompactionBoundary(
          rawNonSystemMessages,
          baseline.compactedNonSystemMessageCount,
        ),
      };
    }

    const failureStreak = this.fullCompactFailureStreaks.get(ctx.threadId) ?? 0;
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
    const nextFailureStreak = circuitOpen ? failureStreak : failureStreak + 1;
    this.fullCompactFailureStreaks.set(ctx.threadId, nextFailureStreak);
    this.fullCompactFailureMessageCounts.set(ctx.threadId, rawNonSystemMessages.length);
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
      this.fullCompactFailureStreaks.delete(ctx.threadId);
      this.fullCompactFailureMessageCounts.delete(ctx.threadId);
      return {
        baseline,
        nonSystemMessages: sliceAfterCompactionBoundary(
          rawNonSystemMessages,
          baseline.compactedNonSystemMessageCount,
        ),
      };
    }

    const failureStreak = this.fullCompactFailureStreaks.get(ctx.threadId) ?? 0;
    const nextFailureStreak = circuitOpen ? failureStreak : failureStreak + 1;
    this.fullCompactFailureStreaks.set(ctx.threadId, nextFailureStreak);
    this.fullCompactFailureMessageCounts.set(ctx.threadId, rawNonSystemMessages.length);
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
      return { summary, updatedAt: new Date().toISOString() };
    } catch {
      return null;
    }
  }

  private normalizeSummary(response: LlmResponse): string | null {
    const summary = response.content.replace(/\s+/g, ' ').trim();
    return summary.length > 0 ? summary : null;
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
    const compactVersion = Math.max(
      priorCompactVersion > 0 ? priorCompactVersion + 1 : 1,
      (await ctx.repos.compactSummaries.listByThread(ctx.threadId, { limit: 50 })).filter(
        (row) => row.compact_kind === 'full_thread',
      ).length + 1,
    );
    const tokenCount = cachedTokenCount ?? estimateTokens(nonSystemMessages);
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
