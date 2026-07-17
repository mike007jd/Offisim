import assert from 'node:assert/strict';
import { microCompactMessages } from '../packages/core/dist/index.js';
import type { LlmMessage, LlmRequest, RuntimeContext } from '../packages/core/dist/index.js';
import { ConversationBudgetService } from '../packages/core/dist/services-public.js';

const largeResult = (label: string, size = 6_000) => `${label}:${'x'.repeat(size)}`;
const toolPair = (id: string, size?: number): LlmMessage[] => [
  {
    role: 'assistant',
    content: `calling ${id}`,
    toolCalls: [{ id, name: 'fixture', arguments: {} }],
  },
  { role: 'tool', toolCallId: id, content: largeResult(id, size) },
];

const exactMessages: LlmMessage[] = [
  ...toolPair('old-tool'),
  { role: 'tool', toolCallId: 'orphan-tool', content: largeResult('orphan') },
  { role: 'user', content: 'current turn' },
  ...toolPair('current-tool'),
];
const exact = microCompactMessages(exactMessages, {
  maxToolResultBytes: 100,
  snippetBytes: 20,
  preserveLastN: 0,
});
assert.equal(exact.compacted, 1, 'only an old, exactly paired tool result may microcompact');
assert.deepEqual(exact.compactedToolCallIds, ['old-tool']);
assert.equal(
  exact.messages[2]?.content,
  exactMessages[2]?.content,
  'orphan tool result stays intact',
);
assert.equal(
  exact.messages[5]?.content,
  exactMessages[5]?.content,
  'the current turn tool result stays intact',
);
assert.equal(exact.messages[1]?.toolCallId, 'old-tool', 'microcompact preserves the pair id');
assert.ok(
  exact.messages.some(
    (message) =>
      message.role === 'assistant' && message.toolCalls?.some((call) => call.id === 'old-tool'),
  ),
  'microcompact preserves the owning tool_use message',
);

interface HarnessContext {
  readonly ctx: RuntimeContext;
  readonly ledger: Array<{ compact_kind: string; summary_text: string }>;
  readonly fullCompactCalls: { count: number };
}

function makeContext(
  initialCompactBaseline: string | null = null,
  initialSynopsis: string | null = null,
): HarnessContext {
  const ledger: Array<{ compact_kind: string; summary_text: string }> = [];
  const fullCompactCalls = { count: 0 };
  let compactBaselineJson = initialCompactBaseline;
  const ctx = {
    threadId: 'thread-staged-compaction',
    companyId: 'company-staged-compaction',
    repos: {
      threads: {
        findById: async () => ({
          compact_baseline_json: compactBaselineJson,
          synopsis_json: initialSynopsis,
        }),
        updateCompactBaseline: async (_threadId: string, value: string) => {
          compactBaselineJson = value;
        },
      },
      nodeSummaries: {
        countByThread: async () => 0,
        listByThread: async () => [],
        trimByThread: async () => {},
      },
      compactSummaries: {
        create: async (row: { compact_kind: string; summary_text: string }) => {
          ledger.push(row);
          return row;
        },
        listByThread: async () => [...ledger].reverse(),
      },
      events: { insert: async () => {} },
    },
    eventBus: { emit: () => {} },
    interactionBox: { pending: null },
    summaryModelSelector: { resolve: () => ({ model: 'fixture-summary-model' }) },
    llmGateway: {
      chat: async (_request: LlmRequest) => {
        fullCompactCalls.count += 1;
        return {
          content: 'durable compact baseline',
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
    },
    determinism: {
      nowMs: () => Date.parse('2026-07-17T00:00:00.000Z'),
      nowIso: () => '2026-07-17T00:00:00.000Z',
      id: (prefix: string) => `${prefix}-fixture`,
      uuid: () => 'fixture-uuid',
    },
  };
  return { ctx: ctx as unknown as RuntimeContext, ledger, fullCompactCalls };
}

const mediumMessages: LlmMessage[] = [
  ...toolPair('medium-1'),
  ...toolPair('medium-2'),
  ...toolPair('medium-3'),
  { role: 'user', content: 'finish the current task' },
];
const baseOptions = {
  maxNonSystemMessages: 2,
  tailNonSystemMessages: 2,
  synopsisTriggerMessages: 10_000,
  fullCompactTriggerMessages: 5,
  fullCompactTriggerTokens: 5_000,
  microCompactTriggerTokens: 1_000,
  microMaxToolResultBytes: 100,
  microSnippetBytes: 20,
  microPreserveLastN: 1,
};
const request = (messages: readonly LlmMessage[]): LlmRequest => ({
  model: 'fixture-model',
  messages,
});

const lowPressure = makeContext();
const lowPressurePruned = await new ConversationBudgetService({
  maxNonSystemMessages: 5,
  tailNonSystemMessages: 5,
  toolResultKeepRecent: 1,
  toolResultMaxContentChars: 100,
  microCompactTriggerTokens: 4_000,
  fullCompactTriggerTokens: 5_000,
  fullCompactTriggerMessages: 100,
}).prepareRequest(
  lowPressure.ctx,
  request([...toolPair('prune-1', 200), ...toolPair('prune-2', 200), ...toolPair('prune-3', 200)]),
);
assert.match(
  lowPressurePruned.messages[1]?.content ?? '',
  /tool result compacted/,
  'the ordinary prune layer remains the first low-pressure compaction stage',
);
assert.deepEqual(lowPressure.ledger, [], 'ordinary prune does not claim a microcompact ledger row');

const staged = makeContext();
const stagedRequest = await new ConversationBudgetService(baseOptions).prepareRequest(
  staged.ctx,
  request(mediumMessages),
);
assert.equal(staged.fullCompactCalls.count, 0, 'microcompact delays the full LLM summary');
assert.deepEqual(
  staged.ledger.map((row) => row.compact_kind),
  ['microcompact'],
  'microcompact writes its own compact_summaries ledger kind',
);
await new ConversationBudgetService(baseOptions).prepareRequest(
  staged.ctx,
  request(mediumMessages),
);
assert.equal(
  staged.ledger.length,
  1,
  'an identical repeated prepare does not duplicate the ledger',
);
const seenToolUses = new Set<string>();
for (const message of stagedRequest.messages) {
  if (message.role === 'assistant') {
    for (const toolCall of message.toolCalls ?? []) seenToolUses.add(toolCall.id);
  }
  if (message.role === 'tool') {
    assert.ok(
      message.toolCallId && seenToolUses.has(message.toolCallId),
      `prepared tool_result ${message.toolCallId ?? '<missing>'} must retain its prior tool_use`,
    );
  }
}

const afterSummaryBoundary = makeContext(
  JSON.stringify({
    compactId: 'existing-full-compact',
    compactVersion: 1,
    compactedAt: '2026-07-16T00:00:00.000Z',
    summaryText: 'existing baseline',
    compactedNonSystemMessageCount: 0,
    keptTailNonSystemMessageCount: mediumMessages.length,
  }),
);
await new ConversationBudgetService({
  ...baseOptions,
  fullCompactTriggerMessages: 10_000,
}).prepareRequest(afterSummaryBoundary.ctx, request(mediumMessages));
assert.deepEqual(
  afterSummaryBoundary.ledger,
  [],
  'messages after an existing summary boundary must not be microcompacted',
);
const afterSynopsisBoundary = makeContext(
  null,
  JSON.stringify({
    version: 1,
    summary: 'existing synopsis',
    prunedMessageCount: 2,
    totalMessageCount: mediumMessages.length,
    updatedAt: '2026-07-16T00:00:00.000Z',
  }),
);
await new ConversationBudgetService({
  ...baseOptions,
  fullCompactTriggerMessages: 10_000,
}).prepareRequest(afterSynopsisBoundary.ctx, request(mediumMessages));
assert.deepEqual(
  afterSynopsisBoundary.ledger,
  [],
  'messages after an existing synopsis boundary must not be microcompacted',
);

const withoutMicro = makeContext();
await new ConversationBudgetService({
  ...baseOptions,
  microMaxToolResultBytes: 50_000,
}).prepareRequest(withoutMicro.ctx, request(mediumMessages));
assert.equal(
  withoutMicro.fullCompactCalls.count,
  1,
  'the same conversation requires a full compact when the micro stage does not run',
);

const highPressure = makeContext();
await new ConversationBudgetService({
  ...baseOptions,
  microSnippetBytes: 2_500,
}).prepareRequest(highPressure.ctx, request(mediumMessages));
assert.equal(
  highPressure.fullCompactCalls.count,
  1,
  'full compact still runs when micro is insufficient',
);
assert.deepEqual(
  highPressure.ledger.map((row) => row.compact_kind),
  ['microcompact', 'full_thread'],
  'the persisted stage order is microcompact before full compact',
);

console.log(
  '[harness-staged-compaction] prune -> microcompact -> full compact passed; exact tool pairs and protected current turn remain valid; full compact calls reduced',
);
