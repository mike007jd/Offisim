import { describe, it, expect } from 'vitest';
import { createCheckpointSaver, DrizzleCheckpointSaver } from '../../graph/checkpoint-saver.js';
import { MemorySaver } from '@langchain/langgraph';

describe('createCheckpointSaver', () => {
  it('returns MemorySaver when no db provided', () => {
    const saver = createCheckpointSaver();
    expect(saver).toBeInstanceOf(MemorySaver);
  });

  it('returns DrizzleCheckpointSaver when db provided', () => {
    const saver = createCheckpointSaver({} /* mock db */);
    expect(saver).toBeInstanceOf(DrizzleCheckpointSaver);
  });
});

describe('DrizzleCheckpointSaver', () => {
  it('implements all required BaseCheckpointSaver methods', () => {
    const saver = new DrizzleCheckpointSaver(null as any);
    expect(typeof saver.getTuple).toBe('function');
    expect(typeof saver.list).toBe('function');
    expect(typeof saver.put).toBe('function');
    expect(typeof saver.putWrites).toBe('function');
  });
});
