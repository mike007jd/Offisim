import assert from 'node:assert/strict';
import test from 'node:test';

import { forkSubContext } from './fork-sub-context.ts';

test('forkSubContext starts the child with only the subtask user message', async () => {
  let observed = null;
  const result = await forkSubContext({
    subTask: 'Audit this module',
    runChild: async (childMessages) => {
      observed = childMessages;
      return {
        summary: 'child summary',
        transcript: [...childMessages, { role: 'assistant', content: 'details' }],
      };
    },
  });

  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0], { role: 'user', content: 'Audit this module' });
  assert.equal(result.summary, 'child summary');
});

test('forkSubContext result does not expose transcript', async () => {
  const result = await forkSubContext({
    subTask: 'Summarize',
    runChild: async (childMessages) => ({
      summary: 'done',
      transcript: [...childMessages, { role: 'assistant', content: 'private transcript' }],
    }),
  });

  assert.deepEqual(Object.keys(result), ['summary']);
  assert.equal('transcript' in result, false);
});
