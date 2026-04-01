import type { RuntimeEvent } from '@offisim/shared-types';
import type { LlmRequest, LlmResponse } from '../llm/gateway.js';
import { compactToolResultMessages, pruneLlmMessages } from '../llm/prune-messages.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { generateId } from '../utils/generate-id.js';

export interface ThreadSynopsisRecord {
  version: number;
  summary: string;
  prunedMessageCount: number;
  totalMessageCount: number;
  updatedAt: string;
}

export interface ConversationBudgetServiceOptions {
  maxNonSystemMessages?: number;
  tailNonSystemMessages?: number;
  synopsisTriggerMessages?: number;
  synopsisRefreshMinMessages?: number;
  toolResultKeepRecent?: number;
  toolResultMaxContentChars?: number;
  synopsisFailureThreshold?: number;
  postCompactKeepNodeSummaries?: number;
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
}

const DEFAULT_TAIL_NON_SYSTEM_MESSAGES = 50;
const DEFAULT_SYNOPSIS_TRIGGER_MESSAGES = 80;
const DEFAULT_SYNOPSIS_REFRESH_MIN_MESSAGES = 6;
const DEFAULT_TOOL_RESULT_KEEP_RECENT = 4;
const DEFAULT_TOOL_RESULT_MAX_CONTENT_CHARS = 400;
const DEFAULT_SYNOPSIS_FAILURE_THRESHOLD = 3;
const DEFAULT_POST_COMPACT_KEEP_NODE_SUMMARIES = 12;

const SYNOPSIS_SYSTEM_PROMPT = `You condense long agent conversations for future continuation.
Write a concise summary that preserves decisions, constraints, open questions, and important user preferences.
Do not add speculation. Output plain text only.`;

export class ConversationBudgetService {
  private readonly synopsisFailureStreaks = new Map<string, number>();

  constructor(private readonly defaults: ConversationBudgetServiceOptions = {}) {}

  async prepareRequest(ctx: RuntimeContext, request: LlmRequest): Promise<LlmRequest> {
    const options = this.resolveOptions(ctx);
    const compactedMessages = compactToolResultMessages(request.messages, options);
    const nonSystemMessages = compactedMessages.filter((message) => message.role !== 'system');
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
        messages: pruneLlmMessages(compactedMessages, {
          maxNonSystemMessages: effectiveTailNonSystemMessages,
        }),
      };
    }

    if (nonSystemMessages.length <= effectiveMaxNonSystemMessages) {
      return compactedMessages === request.messages
        ? request
        : { ...request, messages: compactedMessages };
    }

    const thread = await ctx.repos.threads.findById(ctx.threadId);
    const existingSynopsis = this.parseSynopsis(thread?.synopsis_json ?? null);
    const approximateTokens = this.estimateTokens(nonSystemMessages);
    const overflowCount = Math.max(0, nonSystemMessages.length - effectiveTailNonSystemMessages);
    const newOverflowSinceSynopsis = existingSynopsis
      ? Math.max(0, overflowCount - existingSynopsis.prunedMessageCount)
      : overflowCount;
    const shouldGenerateSynopsis =
      nonSystemMessages.length >= options.synopsisTriggerMessages &&
      approximateTokens >= options.synopsisTriggerTokens &&
      (!existingSynopsis || newOverflowSinceSynopsis >= options.synopsisRefreshMinMessages);

    const synopsis = shouldGenerateSynopsis
      ? await this.generateSynopsis(ctx, nonSystemMessages, existingSynopsis)
      : existingSynopsis;

    const synopsisMessage = synopsis
      ? {
          role: 'system' as const,
          content: `## Conversation synopsis\n${synopsis.summary}`,
        }
      : null;

    return {
      ...request,
      messages: pruneLlmMessages(compactedMessages, {
        maxNonSystemMessages: effectiveTailNonSystemMessages,
        synopsisMessage,
      }),
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
    };
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
  ): Promise<ThreadSynopsisRecord | null> {
    const options = this.resolveOptions(ctx);
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
    if (!summary) return existing;

    const synopsis: ThreadSynopsisRecord = {
      version: (existing?.version ?? 0) + 1,
      summary,
      prunedMessageCount: sourceMessages.length,
      totalMessageCount: nonSystemMessages.length,
      updatedAt: new Date().toISOString(),
    };

    await ctx.repos.threads.updateSynopsis(ctx.threadId, JSON.stringify(synopsis));
    await ctx.repos.compactSummaries.create({
      compact_id: generateId('cs'),
      thread_id: ctx.threadId,
      company_id: ctx.companyId,
      compact_kind: 'thread_synopsis',
      summary_source: summarySource,
      summary_text: synopsis.summary,
      pre_compact_message_count: nonSystemMessages.length,
      pre_compact_token_count: this.estimateTokens(nonSystemMessages),
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
    await this.postCompactCleanup(ctx, options);
    ctx.eventBus.emit(this.makeSynopsisEvent(ctx, synopsis));
    return synopsis;
  }

  private async postCompactCleanup(
    ctx: RuntimeContext,
    options: ResolvedConversationBudgetOptions,
  ): Promise<void> {
    await ctx.repos.nodeSummaries.trimByThread(ctx.threadId, options.postCompactKeepNodeSummaries);
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

  private makeSynopsisEvent(
    ctx: RuntimeContext,
    synopsis: ThreadSynopsisRecord,
  ): RuntimeEvent<{
    summary: string;
    version: number;
    prunedMessageCount: number;
    totalMessageCount: number;
  }> {
    return {
      type: 'conversation.synopsis.updated',
      entityId: ctx.threadId,
      entityType: 'graph',
      companyId: ctx.companyId,
      threadId: ctx.threadId,
      timestamp: Date.now(),
      payload: {
        summary: synopsis.summary,
        version: synopsis.version,
        prunedMessageCount: synopsis.prunedMessageCount,
        totalMessageCount: synopsis.totalMessageCount,
      },
    };
  }
}
