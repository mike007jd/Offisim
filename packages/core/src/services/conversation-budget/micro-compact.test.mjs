import assert from 'node:assert/strict';
import test from 'node:test';

import { microCompactMessages } from './micro-compact.ts';

function tool(content) {
  return {
    role: 'tool',
    content,
    toolCallId: 'tool-1',
  };
}

test('microCompactMessages replaces large tool results with head, marker, and tail', () => {
  const content = `${'a'.repeat(30)}middle${'z'.repeat(30)}`;
  const result = microCompactMessages([tool(content), { role: 'user', content: 'next' }], {
    maxToolResultBytes: 20,
    snippetBytes: 5,
    preserveLastN: 0,
  });

  assert.equal(result.compacted, 1);
  assert.equal(result.messages[0].content, 'aaaaa\n\n[microcompacted 66 bytes]\n\nzzzzz');
  assert.equal(result.bytesSaved > 0, true);
});

test('microCompactMessages leaves small tool results unchanged', () => {
  const messages = [tool('small')];
  const result = microCompactMessages(messages, {
    maxToolResultBytes: 20,
    preserveLastN: 0,
  });

  assert.equal(result.compacted, 0);
  assert.equal(result.bytesSaved, 0);
  assert.equal(result.messages, messages);
});

test('microCompactMessages preserves the most recent tool result by default', () => {
  const first = tool('x'.repeat(50));
  const latest = tool('y'.repeat(50));
  const result = microCompactMessages([first, latest], {
    maxToolResultBytes: 20,
    snippetBytes: 4,
    preserveLastN: 1,
  });

  assert.equal(result.compacted, 1);
  assert.equal(result.messages[0].content.includes('[microcompacted 50 bytes]'), true);
  assert.equal(result.messages[1].content, latest.content);
});
