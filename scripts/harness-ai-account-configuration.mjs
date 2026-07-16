import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST = 'scripts/tauri-pi-agent-host.entry.mjs';
const FIRST_KEY = 'sk-private-fixture-first-0000000000000000';
const SECOND_KEY = 'sk-local-fixture-second-11111111111111111';

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
    result.stderr || 'API provider host exited with an unexpected status',
  );
  const lines = result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(lines[0]?.kind, 'ready', 'the host must negotiate before configuration');
  return { result, lines, response: lines.find((line) => line.kind === 'result')?.response };
}

const fixtureRoot = mkdtempSync(join(tmpdir(), 'offisim-api-provider-'));
const agentDir = join(fixtureRoot, 'agent');
try {
  const first = run({
    mode: 'saveProvider',
    agentDir,
    config: {
      providerId: 'private-gateway',
      displayName: 'Private Gateway',
      baseUrl: 'https://models.example.internal/v1',
      api: 'openai-completions',
      apiKey: FIRST_KEY,
      keepExistingApiKey: false,
      models: [
        { id: 'vendor/new-leaf', name: 'New Leaf', contextWindow: 131_072 },
        { id: 'Qwen3', name: 'Configured Family Label', maxTokens: 8_192 },
      ],
    },
  });
  const firstStatus = first.response?.runtimeStatus;
  assert.ok(firstStatus, 'saving a provider must return a refreshed safe runtime catalog');
  assert.equal(firstStatus.accounts.length, 1);
  assert.equal(firstStatus.accounts[0]?.displayName, 'Private Gateway');
  assert.deepEqual(
    firstStatus.models.map((model) => model.runtimeModelRef),
    ['private-gateway/vendor/new-leaf', 'private-gateway/Qwen3'],
    'arbitrary configured model ids become runnable without an allowlist',
  );
  assert.ok(firstStatus.models.every((model) => model.source === undefined));

  const second = run({
    mode: 'saveProvider',
    agentDir,
    config: {
      providerId: 'local-lab',
      displayName: 'Local Lab',
      baseUrl: 'http://127.0.0.1:11434/v1',
      api: 'openai-completions',
      apiKey: SECOND_KEY,
      keepExistingApiKey: false,
      models: [{ id: 'lab/experimental', name: 'Lab Experimental' }],
    },
  });
  const secondStatus = second.response?.runtimeStatus;
  assert.equal(secondStatus?.accounts.length, 2, 'custom endpoints are not restricted to OpenRouter');
  assert.deepEqual(
    new Set(secondStatus?.models.map((model) => model.runtimeModelRef)),
    new Set([
      'private-gateway/vendor/new-leaf',
      'private-gateway/Qwen3',
      'local-lab/lab/experimental',
    ]),
  );

  const retained = run({
    mode: 'saveProvider',
    agentDir,
    config: {
      providerId: 'private-gateway',
      displayName: 'Private Gateway',
      baseUrl: 'https://models.example.internal/v1',
      api: 'openai-completions',
      apiKey: null,
      keepExistingApiKey: true,
      models: [{ id: 'vendor/replacement-leaf', name: 'Replacement Leaf' }],
    },
  });
  assert.ok(
    retained.response?.runtimeStatus.models.some(
      (model) => model.runtimeModelRef === 'private-gateway/vendor/replacement-leaf',
    ),
  );

  const modelsPath = join(agentDir, 'models.json');
  const modelsText = readFileSync(modelsPath, 'utf8');
  assert.match(modelsText, new RegExp(FIRST_KEY, 'u'), 'Pi-owned models.json retains the first key');
  assert.match(modelsText, new RegExp(SECOND_KEY, 'u'), 'Pi-owned models.json stores the second key');
  assert.equal(statSync(modelsPath).mode & 0o777, 0o600, 'credential file must be owner-only');

  for (const output of [first, second, retained]) {
    const serializedOutput = `${output.result.stdout}\n${output.result.stderr}`;
    assert.doesNotMatch(serializedOutput, new RegExp(FIRST_KEY, 'u'));
    assert.doesNotMatch(serializedOutput, new RegExp(SECOND_KEY, 'u'));
    assert.doesNotMatch(JSON.stringify(output.response?.runtimeStatus), /(?:apiKey|models\.json)/iu);
  }

  const invalid = run(
    {
      mode: 'saveProvider',
      agentDir: join(fixtureRoot, 'invalid-agent'),
      config: {
        providerId: 'missing-key',
        baseUrl: 'https://example.com/v1',
        api: 'openai-completions',
        models: [{ id: 'valid-leaf' }],
      },
    },
    1,
  );
  assert.match(invalid.lines.find((line) => line.kind === 'error')?.message ?? '', /API key/u);
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('PASS dynamic API provider configuration (multi-provider, Pi-owned secrets, safe output)');
