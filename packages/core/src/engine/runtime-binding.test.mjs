import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveEmployeeRuntimeBinding } from './runtime-binding.ts';

function employee(configJson = null, isExternal = 0) {
  return {
    id: 'emp-1',
    company_id: 'company-1',
    name: 'Ada',
    role_slug: 'engineer',
    is_external: isExternal,
    config_json: configJson,
  };
}

test('resolveEmployeeRuntimeBinding defaults to provider mode', () => {
  assert.deepEqual(resolveEmployeeRuntimeBinding(employee(), {}), {
    mode: 'provider',
  });
});

test('resolveEmployeeRuntimeBinding applies company default and employee override wins', () => {
  const runtimePolicy = {
    employeeRuntimeDefault: {
      mode: 'engine',
      engineId: 'claude-engine',
    },
  };

  assert.deepEqual(resolveEmployeeRuntimeBinding(employee(), runtimePolicy), {
    mode: 'engine',
    engineId: 'claude-engine',
  });

  assert.deepEqual(
    resolveEmployeeRuntimeBinding(
      employee(
        JSON.stringify({
          runtimeBinding: {
            mode: 'engine',
            engineId: 'codex-engine',
          },
        }),
      ),
      runtimePolicy,
    ),
    {
      mode: 'engine',
      engineId: 'codex-engine',
    },
  );
});

test('resolveEmployeeRuntimeBinding does not apply engine binding to external employees', () => {
  assert.deepEqual(
    resolveEmployeeRuntimeBinding(
      employee(
        JSON.stringify({
          runtimeBinding: {
            mode: 'engine',
            engineId: 'codex-engine',
          },
        }),
        1,
      ),
      {
        employeeRuntimeDefault: {
          mode: 'engine',
          engineId: 'claude-engine',
        },
      },
    ),
    {
      mode: 'provider',
    },
  );
});
