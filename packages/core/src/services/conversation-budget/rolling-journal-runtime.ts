import { conversationSynopsisUpdated } from '../../events/event-factories.js';
import type { LlmMessage } from '../../llm/gateway.js';
import type { RuntimeContext } from '../../runtime/runtime-context.js';
import { estimateTokens } from './message-utils.js';
import { RollingJournal } from './rolling-journal.js';
import { SynopsisGenerator, type ThreadSynopsisRecord } from './synopsis-generator.js';

export interface RuntimeRollingJournalOptions {
  readonly everyNTurns?: number;
}

const DEFAULT_ROLLING_JOURNAL_TURNS = 8;

function nonSystemMessages(messages: readonly LlmMessage[]): readonly LlmMessage[] {
  return messages.filter((message) => message.role !== 'system');
}

export function createRuntimeRollingJournal(
  getCtx: () => RuntimeContext,
  opts: RuntimeRollingJournalOptions = {},
): RollingJournal {
  const synopsisGenerator = new SynopsisGenerator();
  let latestMessages: readonly LlmMessage[] = [];

  return new RollingJournal({
    everyNTurns: opts.everyNTurns ?? DEFAULT_ROLLING_JOURNAL_TURNS,
    summarize: async (messages) => {
      latestMessages = nonSystemMessages(messages);
      const ctx = getCtx();
      const thread = await ctx.repos.threads.findById(ctx.threadId);
      const existing = synopsisGenerator.parseExisting(thread?.synopsis_json ?? null);
      return (
        (await synopsisGenerator.summarizeMessages(ctx, {
          messages: latestMessages,
          existing,
        })) ?? ''
      );
    },
    write: async (summary) => {
      const ctx = getCtx();
      const thread = await ctx.repos.threads.findById(ctx.threadId);
      const existing = synopsisGenerator.parseExisting(thread?.synopsis_json ?? null);
      const now = ctx.determinism.nowIso();
      const synopsis = buildSynopsisRecord(existing, summary, latestMessages, now);

      await ctx.repos.threads.updateSynopsis(ctx.threadId, JSON.stringify(synopsis));
      await ctx.repos.compactSummaries.create({
        compact_id: ctx.determinism.id('cs'),
        thread_id: ctx.threadId,
        company_id: ctx.companyId,
        compact_kind: 'rolling_journal',
        summary_source: 'rolling_journal',
        summary_text: synopsis.summary,
        pre_compact_message_count: latestMessages.length,
        pre_compact_token_count: estimateTokens(latestMessages),
        messages_compacted: latestMessages.length,
        failure_streak: 0,
        created_at: now,
      });
      await ctx.repos.events.insert({
        event_id: ctx.determinism.id('evt'),
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
        created_at: now,
      });
      ctx.eventBus.emit(
        conversationSynopsisUpdated(ctx.companyId, ctx.threadId, {
          summary: synopsis.summary,
          version: synopsis.version,
          prunedMessageCount: synopsis.prunedMessageCount,
          totalMessageCount: synopsis.totalMessageCount,
        }),
      );
    },
  });
}

function buildSynopsisRecord(
  existing: ThreadSynopsisRecord | null,
  summary: string,
  messages: readonly LlmMessage[],
  updatedAt: string,
): ThreadSynopsisRecord {
  return {
    version: (existing?.version ?? 0) + 1,
    summary,
    prunedMessageCount: messages.length,
    totalMessageCount: messages.length,
    updatedAt,
  };
}
