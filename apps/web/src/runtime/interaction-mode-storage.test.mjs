import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadDefaultInteractionMode,
  persistDefaultInteractionMode,
} from './interaction-mode-storage.ts';

function withLocalStorage(raw, fn) {
  const store = new Map();
  if (raw !== null) store.set('offisim.interaction-mode.default', raw);
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    },
  };
  try {
    return fn(store);
  } finally {
    globalThis.window = previousWindow;
  }
}

test('loadDefaultInteractionMode accepts all 4 valid modes', () => {
  for (const mode of ['boss_proxy', 'human_in_loop', 'direct_to_employee', 'yolo']) {
    withLocalStorage(mode, () => {
      assert.equal(loadDefaultInteractionMode(), mode);
    });
  }
});

test('loadDefaultInteractionMode falls back to boss_proxy for invalid values', () => {
  withLocalStorage('bad-mode', () => {
    assert.equal(loadDefaultInteractionMode(), 'boss_proxy');
  });
});

test('persistDefaultInteractionMode stores the selected mode', () => {
  withLocalStorage(null, (store) => {
    persistDefaultInteractionMode('yolo');
    assert.equal(store.get('offisim.interaction-mode.default'), 'yolo');
  });
});
