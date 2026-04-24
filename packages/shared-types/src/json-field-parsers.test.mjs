import assert from 'node:assert/strict';
import test from 'node:test';

import { parseEmployeeConfig } from './json-field-parsers.ts';

test('parseEmployeeConfig accepts an engine runtime binding override', () => {
  const config = parseEmployeeConfig(
    JSON.stringify({
      modelPreference: 'gpt-5.4',
      runtimeBinding: {
        mode: 'engine',
        engineId: 'codex-engine',
      },
    }),
  );

  assert.equal(config.modelPreference, 'gpt-5.4');
  assert.deepEqual(config.runtimeBinding, {
    mode: 'engine',
    engineId: 'codex-engine',
  });
});

test('parseEmployeeConfig accepts provider runtime binding and ignores invalid engines', () => {
  assert.deepEqual(parseEmployeeConfig(JSON.stringify({ runtimeBinding: { mode: 'provider' } })).runtimeBinding, {
    mode: 'provider',
  });

  assert.equal(
    parseEmployeeConfig(
      JSON.stringify({
        runtimeBinding: {
          mode: 'engine',
          engineId: 'not-an-engine',
        },
      }),
    ).runtimeBinding,
    undefined,
  );
});
