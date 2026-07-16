import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST = 'scripts/tauri-pi-agent-host.entry.mjs';
const FIRST_KEY = 'sk-or-v1-offisim-fixture-first-000000000000';
const REPLACEMENT_KEY = 'sk-or-v1-offisim-fixture-second-1111111111';

function run(payload, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [HOST], {
    cwd: process.cwd(),
    input: `${JSON.stringify(payload)}\n`,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(
    result.status,
    expectedStatus,
    result.stderr || 'API account host exited with an unexpected status',
  );
  const lines = result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(lines[0]?.kind, 'ready', 'the host must negotiate before configuration');
  return { result, lines, response: lines.find((line) => line.kind === 'result')?.response };
}

const fixtureRoot = mkdtempSync(join(tmpdir(), 'offisim-api-account-'));
const agentDir = join(fixtureRoot, 'agent');
try {
  const first = run({
    mode: 'configureApiAccount',
    agentDir,
    service: 'openrouter',
    apiKey: FIRST_KEY,
  });
  assert.ok(first.response?.runtimeStatus, 'configuration must return a safe refreshed catalog');
  const status = first.response.runtimeStatus;
  assert.equal(status.accounts.length, 1, 'one configured API identity must be projected');
  assert.equal(status.accounts[0]?.billingMode, 'api');
  assert.equal(status.accounts[0]?.displayName, 'OpenRouter API');
  assert.equal(status.models.length, 5, 'only verified exact OpenRouter leaves are projected');
  assert.ok(status.models.every((model) => model.accountId === status.accounts[0].accountId));

  const authPath = join(agentDir, 'auth.json');
  const authText = readFileSync(authPath, 'utf8');
  assert.match(
    authText,
    new RegExp(FIRST_KEY, 'u'),
    'the native credential store must receive key',
  );
  assert.equal(statSync(authPath).mode & 0o777, 0o600, 'credential file must be owner-only');
  for (const output of [first.result.stdout, first.result.stderr, JSON.stringify(status)]) {
    assert.doesNotMatch(output, new RegExp(FIRST_KEY, 'u'), 'credentials must never cross output');
  }
  assert.doesNotMatch(JSON.stringify(status), /(?:auth\.json|models\.json|~\/\.pi|pi[ -]?agent)/iu);

  const replacement = run({
    mode: 'configureApiAccount',
    agentDir,
    service: 'openrouter',
    accountId: status.accounts[0].accountId,
    apiKey: REPLACEMENT_KEY,
  });
  const replacementStatus = replacement.response?.runtimeStatus;
  assert.equal(
    replacementStatus?.accounts[0]?.displayName,
    status.accounts[0].displayName,
    'replacing a key must retain the same product account service',
  );
  assert.notEqual(
    replacementStatus?.accounts[0]?.accountId,
    status.accounts[0].accountId,
    'a replacement credential must start a distinct billing identity',
  );
  const replacedAuth = readFileSync(authPath, 'utf8');
  assert.doesNotMatch(replacedAuth, new RegExp(FIRST_KEY, 'u'));
  assert.match(replacedAuth, new RegExp(REPLACEMENT_KEY, 'u'));
  assert.doesNotMatch(replacement.result.stdout, new RegExp(REPLACEMENT_KEY, 'u'));
  assert.doesNotMatch(replacement.result.stderr, new RegExp(REPLACEMENT_KEY, 'u'));

  const invalid = run(
    {
      mode: 'configureApiAccount',
      agentDir: join(fixtureRoot, 'invalid-agent'),
      service: 'openrouter',
      apiKey: 'too short',
    },
    1,
  );
  const error = invalid.lines.find((line) => line.kind === 'error');
  assert.equal(error?.code, 'api-key-invalid');
  assert.doesNotMatch(JSON.stringify(error), /too short/u, 'validation errors must not echo input');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('PASS API account configuration (native store, replacement, and secret isolation)');
