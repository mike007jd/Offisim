import assert from 'node:assert/strict';
import test from 'node:test';

import { ResumeCoordinator } from './resume-coordinator.ts';

test('ResumeCoordinator returns null when no checkpoint exists', async () => {
  const coordinator = new ResumeCoordinator({
    async getTuple() {
      return undefined;
    },
  });

  assert.equal(await coordinator.resume('thread-a'), null);
});

test('ResumeCoordinator returns the latest checkpoint snapshot', async () => {
  const coordinator = new ResumeCoordinator({
    async getTuple(config) {
      assert.equal(config.configurable.thread_id, 'thread-a');
      return {
        checkpoint: {
          id: 'cp-1',
          ts: '2026-04-28T00:00:00.000Z',
          channel_values: {
            threadId: 'thread-a',
            companyId: 'company-a',
            entryMode: 'boss_chat',
          },
        },
        config: { configurable: { thread_id: 'thread-a', checkpoint_id: 'cp-1' } },
        metadata: {},
        pendingWrites: [],
      };
    },
  });

  const snapshot = await coordinator.resume('thread-a');
  assert.equal(snapshot.state.threadId, 'thread-a');
  assert.equal(snapshot.lastCheckpointTs, Date.parse('2026-04-28T00:00:00.000Z'));
});
