import { HumanMessage } from '@langchain/core/messages';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createCheckpointSaver } from '../../graph/checkpoint-saver.js';
import { buildAicsGraph } from '../../graph/main-graph.js';
import { TEST_THREAD_ID } from '../helpers/fixtures.js';
import { createTestRuntime } from '../helpers/test-runtime.js';

describe('checkpoint persistence (E2E)', () => {
  it('graph execution writes checkpoints that survive DB reopen', async () => {
    // --- Phase A: Execute graph with SqliteSaver ---
    const db = new Database(':memory:');
    const checkpointer = createCheckpointSaver(db);

    const { gateway, runtimeCtx } = createTestRuntime();
    const graph = buildAicsGraph({ checkpointer });

    // Boss decides direct reply
    gateway.pushResponse({
      content: JSON.stringify({
        action: 'direct_reply',
        reason: 'greeting',
        reply: 'Hello!',
      }),
    });

    await graph.invoke(
      {
        threadId: TEST_THREAD_ID,
        companyId: runtimeCtx.companyId,
        entryMode: 'boss_chat',
        messages: [new HumanMessage('Hi')],
      },
      { configurable: { thread_id: TEST_THREAD_ID, runtimeCtx } },
    );

    // --- Phase B: Verify checkpoint was persisted ---
    const tuple = await checkpointer.getTuple({
      configurable: { thread_id: TEST_THREAD_ID },
    });

    expect(tuple).toBeDefined();
    expect(tuple?.checkpoint).toBeDefined();
    expect(tuple?.checkpoint.channel_values).toBeDefined();

    const state = tuple?.checkpoint.channel_values as Record<string, unknown>;
    expect(state.completed).toBe(true);

    // --- Phase C: "Restart" — create new SqliteSaver on SAME db ---
    const checkpointer2 = createCheckpointSaver(db);

    const tuple2 = await checkpointer2.getTuple({
      configurable: { thread_id: TEST_THREAD_ID },
    });

    expect(tuple2).toBeDefined();
    expect(tuple2?.checkpoint.id).toBe(tuple?.checkpoint.id);

    const state2 = tuple2?.checkpoint.channel_values as Record<string, unknown>;
    expect(state2.completed).toBe(true);

    db.close();
  });

  it('different threads have independent checkpoints', async () => {
    const db = new Database(':memory:');
    const checkpointer = createCheckpointSaver(db);

    const { gateway, runtimeCtx } = createTestRuntime();
    const graph = buildAicsGraph({ checkpointer });

    // Run thread 1
    gateway.pushResponse({
      content: JSON.stringify({ action: 'direct_reply', reason: 'test', reply: 'Reply 1' }),
    });
    await graph.invoke(
      {
        threadId: 'thread-A',
        companyId: runtimeCtx.companyId,
        entryMode: 'boss_chat',
        messages: [new HumanMessage('Message A')],
      },
      { configurable: { thread_id: 'thread-A', runtimeCtx } },
    );

    // Run thread 2
    gateway.pushResponse({
      content: JSON.stringify({ action: 'direct_reply', reason: 'test', reply: 'Reply 2' }),
    });
    await graph.invoke(
      {
        threadId: 'thread-B',
        companyId: runtimeCtx.companyId,
        entryMode: 'boss_chat',
        messages: [new HumanMessage('Message B')],
      },
      { configurable: { thread_id: 'thread-B', runtimeCtx } },
    );

    const tupleA = await checkpointer.getTuple({
      configurable: { thread_id: 'thread-A' },
    });
    const tupleB = await checkpointer.getTuple({
      configurable: { thread_id: 'thread-B' },
    });

    expect(tupleA).toBeDefined();
    expect(tupleB).toBeDefined();
    expect(tupleA?.checkpoint.id).not.toBe(tupleB?.checkpoint.id);

    db.close();
  });
});
