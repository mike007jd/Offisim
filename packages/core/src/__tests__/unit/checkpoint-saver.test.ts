import { MemorySaver } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  createCheckpointSaver,
  createMemoryCheckpointSaver,
} from '../../graph/checkpoint-saver.js';

describe('createCheckpointSaver', () => {
  it('returns SqliteSaver backed by provided Database', () => {
    const db = new Database(':memory:');
    const saver = createCheckpointSaver(db);
    expect(saver).toBeInstanceOf(SqliteSaver);
    db.close();
  });
});

describe('createMemoryCheckpointSaver', () => {
  it('returns MemorySaver for testing', () => {
    const saver = createMemoryCheckpointSaver();
    expect(saver).toBeInstanceOf(MemorySaver);
  });
});

describe('SqliteSaver basic persistence', () => {
  it('can put and getTuple a checkpoint', async () => {
    const db = new Database(':memory:');
    const saver = createCheckpointSaver(db);

    const config = { configurable: { thread_id: 'test-thread-1' } };

    const checkpoint = {
      v: 1,
      id: 'cp-001',
      ts: new Date().toISOString(),
      channel_values: { messages: [], completed: false },
      channel_versions: {},
      versions_seen: {},
      pending_sends: [],
    };

    const metadata = { source: 'input' as const, step: 0, parents: {} };

    const savedConfig = await saver.put(config, checkpoint, metadata, {});
    expect(savedConfig.configurable?.checkpoint_id).toBe('cp-001');

    const tuple = await saver.getTuple({
      configurable: { thread_id: 'test-thread-1', checkpoint_id: 'cp-001' },
    });

    expect(tuple).toBeDefined();
    expect(tuple?.checkpoint.id).toBe('cp-001');
    expect(tuple?.checkpoint.channel_values).toEqual({
      messages: [],
      completed: false,
    });

    db.close();
  });
});
