import assert from 'node:assert/strict';
import test from 'node:test';

import { RollingJournal } from './rolling-journal.ts';

function user(content) {
  return { role: 'user', content };
}

test('RollingJournal writes summarize output on the fifth and tenth turns', async () => {
  const writes = [];
  const journal = new RollingJournal({
    everyNTurns: 5,
    summarize: async () => `summary-${writes.length + 1}`,
    write: async (text) => {
      writes.push(text);
    },
  });

  for (let i = 0; i < 10; i++) {
    await journal.observeTurn([user('build the feature')]);
  }

  assert.deepEqual(writes, ['summary-1', 'summary-2']);
  assert.equal(journal.currentTurn(), 10);
});

test('RollingJournal keeps the first anchor after later user messages', async () => {
  const journal = new RollingJournal({
    everyNTurns: 3,
    summarize: async () => 'summary',
    write: async () => {},
  });

  await journal.observeTurn([user('original objective')]);
  await journal.observeTurn([user('different request')]);

  assert.equal(journal.anchorText(), 'original objective');
});

test('RollingJournal exposes the anchor immediately after the first observed turn', async () => {
  const journal = new RollingJournal({
    everyNTurns: 3,
    summarize: async () => 'summary',
    write: async () => {},
  });

  await journal.observeTurn([{ role: 'system', content: 'sys' }, user('ship rc1')]);

  assert.equal(journal.anchorText(), 'ship rc1');
});
