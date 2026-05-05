import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeClipboardTextIntoComposer } from './clipboard-text.ts';

test('mixed clipboard files preserve pasted text at the current selection', () => {
  const next = mergeClipboardTextIntoComposer({
    currentText: 'Please review ',
    selectionStart: 7,
    selectionEnd: 13,
    pastedText: 'inspect the attached screenshot',
  });

  assert.equal(next.text, 'Please inspect the attached screenshot ');
  assert.equal(next.selectionStart, 'Please inspect the attached screenshot'.length);
  assert.equal(next.selectionEnd, 'Please inspect the attached screenshot'.length);
});

test('empty clipboard text leaves composer text unchanged', () => {
  const next = mergeClipboardTextIntoComposer({
    currentText: 'unchanged',
    selectionStart: 3,
    selectionEnd: 3,
    pastedText: '',
  });

  assert.deepEqual(next, { text: 'unchanged', selectionStart: 3, selectionEnd: 3 });
});
