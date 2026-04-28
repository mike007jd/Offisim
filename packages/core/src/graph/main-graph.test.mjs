import assert from 'node:assert/strict';
import test from 'node:test';

import { modeRouter } from './mode-router.ts';

test('modeRouter maps SOP and human-in-loop through boss', () => {
  assert.equal(modeRouter({ interactionMode: 'boss_proxy' }), 'boss');
  assert.equal(modeRouter({ interactionMode: 'human_in_loop' }), 'boss');
});

test('modeRouter maps Direct to planner', () => {
  assert.equal(modeRouter({ interactionMode: 'direct_to_employee' }), 'pm_planner');
});

test('modeRouter maps YOLO to yolo-master', () => {
  assert.equal(modeRouter({ interactionMode: 'yolo' }), 'yolo-master');
});
