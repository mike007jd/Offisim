import type { ConversationSynopsisUpdatedPayload } from '@offisim/shared-types';
import { conversationSynopsisUpdated } from '../../events/event-factories.js';
import type { LlmRequest, LlmResponse } from '../../llm/gateway.js';
import type { RuntimeContext } from '../../runtime/runtime-context.js';
import { generateId } from '../../utils/generate-id.js';
import { estimateTokens } from './message-utils.js';
import type { ResolvedConversationBudgetOptions } from './options-resolver.js';

type LlmMessage = LlmRequest['messages'][number];

export interface ThreadSynopsisRecord {
  version: number;
  summary: string;
  prunedMessageCount: number;
  totalMessageCount: number;
  updatedAt: string;
}

export interface SynopsisGenerateResult {
  synopsis: ThreadSynopsisRecord;
  summarySource: 'llm' | 'heuristic' | 'circuit_breaker';
  failureStreak: number;
}

const SYNOPSIS_SYSTEM_PROMPT = `You condense long agent conversations for future continuation.
Write a concise summary that preserves decisions, constraints, open questions, and important user preferences.
Do not add speculation. Output plain text only.`;

export class SynopsisGenerator {
  private readonly synopsisFailureStreaks = new Map<string, number>();

  parseExisting(raw: string | null): ThreadSynopsisRecord | null {
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

  async summarizeMessages(
    ctx: RuntimeContext,
    input: {
      messages: readonly LlmMessage[];
      existing: ThreadSynopsisRecord | null;
    },
  ): Promise<string | null> {
    const transcript = this.formatTranscript(input.messages);
    if (!transcript) return input.existing?.summary ?? null;
    try {
      return await this.generateSummaryText(ctx, input.existing, transcript);
    } catch {
      return this.buildHeuristicSummary(input.existing, input.messages);
    }
  }

  async generate(
    ctx: RuntimeContext,
    input: {
      nonSystemMessages: readonly LlmMessage[];
      existing: ThreadSynopsisRecord | null;
      options: ResolvedConversationBudgetOptions;
    },
  ): Promise<SynopsisGenerateResult | null> {
    const { nonSystemMessages, existing, options } = input;
    const summaryCount = await ctx.repos.nodeSummaries.countByThread(ctx.threadId);
    const effectiveTailNonSystemMessages =
      summaryCount > 3
        ? Math.max(options.tailNonSystemMessages - 10, 20)
        : options.tailNonSystemMessages;
    const overflowCount = Math.max(0, nonSystemMessages.length - effectiveTailNonSystemMessages);
    const sourceMessages =
      overflowCount > 0 ? nonSystemMessages.slice(0, overflowCount) : nonSystemMessages;
    const transcript = this.formatTranscript(sourceMessages);

    let failureStreak = this.synopsisFailureStreaks.get(ctx.threadId) ?? 0;
    let summary: string | null = null;
    let summarySource: 'llm' | 'heuristic' | 'circuit_breaker' = 'llm';
    if (failureStreak >= options.synopsisFailureThreshold) {
      summarySource = 'circuit_breaker';
      summary = this.buildHeuristicSummary(existing, sourceMessages);
    } else {
      try {
        summary = await this.generateSummaryText(ctx, existing, transcript);
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
      return existing ? { synopsis: existing, summarySource: 'heuristic', failureStreak } : null;
    }

    const synopsis: ThreadSynopsisRecord = {
      version: (existing?.version ?? 0) + 1,
      summary,
      prunedMessageCount: sourceMessages.length,
      totalMessageCount: nonSystemMessages.length,
      updatedAt: new Date().toISOString(),
    };

    const synopsisTokenCount = estimateTokens(nonSystemMessages);
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
    // D/C4: use a freshly-generated id rather than a deterministic
    // `evt-${threadId}-${version}` key. Two successive compactions at the same
    // synopsis.version (which can happen when a retry repeats a previously
    // failed pass) would otherwise hit the runtime_events UNIQUE(event_id)
    // constraint. The version is now stored in payload_json, where it belongs.
    await ctx.repos.events.insert({
      event_id: generateId('evt'),
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
    return { synopsis, summarySource, failureStreak };
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

  private formatTranscript(messages: readonly LlmMessage[]): string {
    return messages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n');
  }

  private async generateSummaryText(
    ctx: RuntimeContext,
    existing: ThreadSynopsisRecord | null,
    transcript: string,
  ): Promise<string | null> {
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
    return this.normalizeSummary(response);
  }

  private buildHeuristicSummary(
    existing: ThreadSynopsisRecord | null,
    messages: readonly LlmMessage[],
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

  private makeSynopsisEvent(ctx: RuntimeContext, synopsis: ThreadSynopsisRecord) {
    const payload: ConversationSynopsisUpdatedPayload = {
      summary: synopsis.summary,
      version: synopsis.version,
      prunedMessageCount: synopsis.prunedMessageCount,
      totalMessageCount: synopsis.totalMessageCount,
    };
    return conversationSynopsisUpdated(ctx.companyId, ctx.threadId, payload);
  }
}
