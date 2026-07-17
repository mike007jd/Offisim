import type { LlmRequest } from '../llm/gateway.js';
import { pruneLlmMessages } from '../llm/prune-messages.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { CompactBaselineState } from './conversation-budget/compact-baseline.js';
import { parseCompactBaseline } from './conversation-budget/compact-baseline.js';
import { FullCompactOrchestrator } from './conversation-budget/full-compact-orchestrator.js';
import { buildRequestMessages, estimateTokens } from './conversation-budget/message-utils.js';
import { microCompactMessages } from './conversation-budget/micro-compact.js';
import type { ConversationBudgetServiceOptions } from './conversation-budget/options-resolver.js';
import { resolveOptions } from './conversation-budget/options-resolver.js';
import { SynopsisGenerator } from './conversation-budget/synopsis-generator.js';
import { resolveEffectiveTailNonSystemMessages } from './conversation-budget/tail-window.js';

export type { ConversationBudgetServiceOptions } from './conversation-budget/options-resolver.js';
export type { ThreadSynopsisRecord } from './conversation-budget/synopsis-generator.js';

export class ConversationBudgetService {
  private readonly synopsisGenerator = new SynopsisGenerator();
  private readonly fullCompactOrchestrator = new FullCompactOrchestrator(this.synopsisGenerator);

  constructor(private readonly defaults: ConversationBudgetServiceOptions = {}) {}

  async prepareRequest(
    ctx: RuntimeContext,
    request: LlmRequest,
    preparation: { forceFullCompact?: boolean } = {},
  ): Promise<LlmRequest> {
    const registryContextWindow = ctx.modelRegistry?.findById(request.model)?.contextWindow;
    const resolvedContextWindow =
      this.defaults.resolvedContextWindowTokens ??
      registryContextWindow ??
      this.defaults.contextWindowResolver?.(request.model);
    const options = resolveOptions(ctx, {
      ...this.defaults,
      resolvedContextWindowTokens: resolvedContextWindow,
      reservedOutputTokens: this.defaults.reservedOutputTokens ?? request.maxTokens,
    });
    const thread = await ctx.repos.threads.findById(ctx.threadId);
    let compactBaseline: CompactBaselineState | null = parseCompactBaseline(
      thread?.compact_baseline_json ?? null,
    );
    const existingSynopsis = compactBaseline
      ? null
      : this.synopsisGenerator.parseExisting(thread?.synopsis_json ?? null);
    const systemMessages = request.messages.filter((message) => message.role === 'system');
    let rawNonSystemMessages = request.messages.filter((message) => message.role !== 'system');
    let nonSystemMessages = compactBaseline
      ? rawNonSystemMessages.slice(
          Math.min(compactBaseline.compactedNonSystemMessageCount, rawNonSystemMessages.length),
        )
      : rawNonSystemMessages;
    const summaryCount = await ctx.repos.nodeSummaries.countByThread(ctx.threadId);
    const effectiveTailNonSystemMessages = resolveEffectiveTailNonSystemMessages(
      options,
      summaryCount,
    );
    const effectiveMaxNonSystemMessages = Math.min(
      options.maxNonSystemMessages,
      effectiveTailNonSystemMessages,
    );

    const forceFullCompact = preparation.forceFullCompact === true;
    let requestMessagesChanged = false;
    if (options.enabled && !forceFullCompact && !compactBaseline && !existingSynopsis) {
      const preMicroCompactTokens = estimateTokens(nonSystemMessages);
      if (preMicroCompactTokens >= options.microCompactTriggerTokens) {
        const microCompact = microCompactMessages(nonSystemMessages, {
          maxToolResultBytes: options.microMaxToolResultBytes,
          snippetBytes: options.microSnippetBytes,
          preserveLastN: options.microPreserveLastN,
        });
        if (microCompact.compacted > 0) {
          nonSystemMessages = [...microCompact.messages];
          rawNonSystemMessages = nonSystemMessages;
          requestMessagesChanged = true;
          await this.recordMicroCompact(ctx, {
            compactedToolCallIds: microCompact.compactedToolCallIds,
            bytesSaved: microCompact.bytesSaved,
            preCompactMessageCount: nonSystemMessages.length,
            preCompactTokenCount: preMicroCompactTokens,
            postCompactTokenCount: estimateTokens(nonSystemMessages),
          });
        }
      }
    }

    if (!options.enabled && !forceFullCompact) {
      return {
        ...request,
        messages: pruneLlmMessages(
          buildRequestMessages(systemMessages, compactBaseline, nonSystemMessages),
          {
            maxNonSystemMessages: effectiveTailNonSystemMessages,
            toolResultKeepRecent: options.toolResultKeepRecent,
            toolResultMaxContentChars: options.toolResultMaxContentChars,
          },
        ),
      };
    }

    if (!forceFullCompact && nonSystemMessages.length <= effectiveMaxNonSystemMessages) {
      const prepared = buildRequestMessages(systemMessages, compactBaseline, nonSystemMessages);
      return !requestMessagesChanged && !compactBaseline
        ? request
        : { ...request, messages: prepared };
    }

    const approximateTokens = estimateTokens(nonSystemMessages);
    const wantsInitialFullCompact =
      !compactBaseline &&
      (forceFullCompact ||
        (rawNonSystemMessages.length >= options.fullCompactTriggerMessages &&
          approximateTokens >= options.fullCompactTriggerTokens));
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
      ? await this.synopsisGenerator.generate(ctx, {
          nonSystemMessages,
          existing: existingSynopsis,
          options,
        })
      : existingSynopsis
        ? { synopsis: existingSynopsis, summarySource: 'existing' as const, failureStreak: 0 }
        : null;
    const synopsis = synopsisResult?.synopsis ?? null;

    if (wantsInitialFullCompact) {
      const result = await this.fullCompactOrchestrator.tryInitialCompact(ctx, {
        rawNonSystemMessages,
        nonSystemMessages,
        existingSynopsis,
        priorSynopsis: synopsis,
        options,
        effectiveTailNonSystemMessages,
        approximateTokens,
      });
      if (result) {
        compactBaseline = result.baseline;
        nonSystemMessages = result.nonSystemMessages;
      }
    }

    if (
      compactBaseline &&
      (forceFullCompact ||
        (nonSystemMessages.length >= options.fullCompactTriggerMessages &&
          approximateTokens >= options.fullCompactTriggerTokens))
    ) {
      const result = await this.fullCompactOrchestrator.tryRefreshCompact(ctx, {
        rawNonSystemMessages,
        nonSystemMessages,
        compactBaseline,
        options,
        effectiveTailNonSystemMessages,
        approximateTokens,
      });
      if (result) {
        compactBaseline = result.baseline;
        nonSystemMessages = result.nonSystemMessages;
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
        buildRequestMessages(systemMessages, compactBaseline, nonSystemMessages, synopsisMessage),
        {
          maxNonSystemMessages: effectiveTailNonSystemMessages,
          toolResultKeepRecent: options.toolResultKeepRecent,
          toolResultMaxContentChars: options.toolResultMaxContentChars,
        },
      ),
    };
  }

  private async recordMicroCompact(
    ctx: RuntimeContext,
    input: {
      compactedToolCallIds: readonly string[];
      bytesSaved: number;
      preCompactMessageCount: number;
      preCompactTokenCount: number;
      postCompactTokenCount: number;
    },
  ): Promise<void> {
    const summaryText = JSON.stringify({
      compactedToolCallIds: input.compactedToolCallIds,
      bytesSaved: input.bytesSaved,
      postCompactTokenCount: input.postCompactTokenCount,
    });
    const [latestCompact] = await ctx.repos.compactSummaries.listByThread(ctx.threadId, {
      limit: 1,
    });
    if (
      latestCompact?.compact_kind === 'microcompact' &&
      latestCompact.summary_text === summaryText
    ) {
      return;
    }
    const compactId = ctx.determinism.id('mcb');
    await ctx.repos.compactSummaries.create({
      compact_id: compactId,
      thread_id: ctx.threadId,
      company_id: ctx.companyId,
      compact_kind: 'microcompact',
      summary_source: 'deterministic',
      summary_text: summaryText,
      pre_compact_message_count: input.preCompactMessageCount,
      pre_compact_token_count: input.preCompactTokenCount,
      messages_compacted: input.compactedToolCallIds.length,
      failure_streak: 0,
      created_at: ctx.determinism.nowIso(),
    });
  }
}
