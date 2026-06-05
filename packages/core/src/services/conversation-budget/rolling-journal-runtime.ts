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

      // The rolling journal summarizes the whole window, so it prunes every
      // message it counts (prunedMessageCount === totalMessageCount; see
      // buildSynopsisRecord), unlike generate() which keeps a tail.
      await synopsisGenerator.persistSynopsis(ctx, synopsis, {
        compactId: ctx.determinism.id('cs'),
        eventId: ctx.determinism.id('evt'),
        compactKind: 'rolling_journal',
        summarySource: 'rolling_journal',
        preCompactMessageCount: latestMessages.length,
        preCompactTokenCount: estimateTokens(latestMessages),
        messagesCompacted: latestMessages.length,
        failureStreak: 0,
      });
      ctx.eventBus.emit(synopsisGenerator.makeSynopsisEvent(ctx, synopsis));
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
