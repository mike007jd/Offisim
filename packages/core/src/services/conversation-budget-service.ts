import type { CompactBaselineState } from './conversation-budget/compact-baseline.js';
import { parseCompactBaseline } from './conversation-budget/compact-baseline.js';
import type { LlmRequest } from '../llm/gateway.js';
import { pruneLlmMessages } from '../llm/prune-messages.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { FullCompactOrchestrator } from './conversation-budget/full-compact-orchestrator.js';
import { buildRequestMessages, estimateTokens } from './conversation-budget/message-utils.js';
import { microCompactMessages } from './conversation-budget/micro-compact.js';
import type { ConversationBudgetServiceOptions } from './conversation-budget/options-resolver.js';
import { resolveOptions } from './conversation-budget/options-resolver.js';
import { SynopsisGenerator } from './conversation-budget/synopsis-generator.js';

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
    const compactedMessages = microCompactMessages(request.messages, {
      maxToolResultBytes: options.microMaxToolResultBytes,
      snippetBytes: options.microSnippetBytes,
      preserveLastN: options.microPreserveLastN,
    }).messages;
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

    const forceFullCompact = preparation.forceFullCompact === true;

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
      return compactedMessages === request.messages && !compactBaseline
        ? request
        : { ...request, messages: prepared };
    }

    const existingSynopsis = compactBaseline
      ? null
      : this.synopsisGenerator.parseExisting(thread?.synopsis_json ?? null);
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
}
