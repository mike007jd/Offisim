import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_INTERACTION_MODE, INTERACTION_MODE_LABEL } from './interactions.ts';

test('DEFAULT_INTERACTION_MODE remains boss_proxy', () => {
  assert.equal(DEFAULT_INTERACTION_MODE, 'boss_proxy');
});

test('interaction mode labels cover all 4 modes', () => {
  assert.deepEqual(Object.keys(INTERACTION_MODE_LABEL).sort(), [
    'boss_proxy',
    'direct_to_employee',
    'human_in_loop',
    'yolo',
  ]);
});
