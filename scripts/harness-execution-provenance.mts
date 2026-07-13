import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import {
  type TurnExecutionProvenance,
  assertSameExecutionAccount,
  requireTurnExecutionProvenance,
  validateTurnExecutionProvenance,
} from '../apps/desktop/renderer/src/runtime/execution-provenance.js';
import { executionProvenance as hostExecutionProvenance } from './pi-execution-provenance.mjs';

let checks = 0;

function check(name: string, assertion: () => void): void {
  assertion();
  checks += 1;
  console.log(`  ✓ ${name}`);
}

function changed(
  source: TurnExecutionProvenance,
  key: keyof TurnExecutionProvenance,
  value: string,
): TurnExecutionProvenance {
  return { ...source, [key]: value };
}

console.log('execution-provenance gate');

const subscriptionTurn: TurnExecutionProvenance = {
  engineId: 'pi-agent',
  accountId: 'pi-agent:anthropic:0123456789abcdef',
  billingMode: 'subscription',
  modelId: 'anthropic/claude-sonnet-4-20250514',
  runId: 'turn-1',
};

const apiTurn: TurnExecutionProvenance = {
  engineId: 'pi-agent',
  accountId: 'pi-agent:openai:fedcba9876543210',
  billingMode: 'api',
  modelId: 'openai/gpt-5.2',
  runId: 'turn-2',
};

check('subscription provenance validates with its exact Turn id', () => {
  assert.deepEqual(validateTurnExecutionProvenance(subscriptionTurn, 'turn-1'), subscriptionTurn);
});
check('API provenance validates independently of subscription billing', () => {
  assert.deepEqual(validateTurnExecutionProvenance(apiTurn, 'turn-2'), apiTurn);
});
check('an absent optional provenance packet remains absent', () => {
  assert.equal(validateTurnExecutionProvenance(undefined), null);
});
check('a successful runtime boundary rejects absent provenance', () => {
  assert.throws(() => requireTurnExecutionProvenance(undefined), /no execution provenance/u);
});
check('incomplete provenance is rejected', () => {
  assert.throws(
    () => validateTurnExecutionProvenance({ ...subscriptionTurn, accountId: '' }),
    /incomplete execution provenance/u,
  );
});
check('unknown billing modes are rejected', () => {
  assert.throws(
    () => validateTurnExecutionProvenance({ ...subscriptionTurn, billingMode: 'credits' }),
    /unsupported billing mode/u,
  );
});
check('a host result cannot be attributed to another Turn', () => {
  assert.throws(
    () => validateTurnExecutionProvenance(subscriptionTurn, 'turn-other'),
    /provenance run mismatch/u,
  );
});

const isolatedJob = { ...subscriptionTurn, runId: 'title-job-1' };
check('an isolated text job may have its own run id', () => {
  assert.doesNotThrow(() => assertSameExecutionAccount(subscriptionTurn, isolatedJob));
});
for (const [key, value] of [
  ['engineId', 'other-engine'],
  ['accountId', 'pi-agent:openai:fedcba9876543210'],
  ['billingMode', 'api'],
  ['modelId', 'anthropic/claude-opus-4-20250514'],
] as const) {
  check(`isolated text job rejects ${key} drift`, () => {
    assert.throws(
      () => assertSameExecutionAccount(subscriptionTurn, changed(isolatedJob, key, value)),
      new RegExp(`provenance mismatch for ${key}`, 'u'),
    );
  });
}

const nodeHostSource = readFileSync(
  fileURLToPath(new URL('./tauri-pi-agent-host.entry.mjs', import.meta.url)),
  'utf8',
);
const rustPayloadSource = readFileSync(
  fileURLToPath(new URL('../apps/desktop/src-tauri/src/pi_agent_host/payload.rs', import.meta.url)),
  'utf8',
);
const rustRunSource = readFileSync(
  fileURLToPath(new URL('../apps/desktop/src-tauri/src/pi_agent_host/run.rs', import.meta.url)),
  'utf8',
);
const desktopRuntimeSource = readFileSync(
  fileURLToPath(
    new URL('../apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts', import.meta.url),
  ),
  'utf8',
);
const childSupervisorSource = readFileSync(
  fileURLToPath(new URL('./pi-child-supervisor.mjs', import.meta.url)),
  'utf8',
);
const hostProvenanceSource = readFileSync(
  fileURLToPath(new URL('./pi-execution-provenance.mjs', import.meta.url)),
  'utf8',
);

check('host delegates OAuth billing truth to Pi without exposing the credential', () => {
  assert.match(hostProvenanceSource, /modelRegistry\.isUsingOAuth\(model\)/u);
  assert.match(hostProvenanceSource, /createHash\('sha256'\)/u);
  assert.match(hostProvenanceSource, /accountFingerprint/u);
  assert.doesNotMatch(hostProvenanceSource, /accountId:.*credential\.(key|access|refresh)/u);
});
check('isolated host jobs pin the source model and refuse fallback', () => {
  assert.match(nodeHostSource, /requestedModel = sourceProvenance\?\.modelId \?\? payload\.model/u);
  assert.match(nodeHostSource, /Isolated text job refused model fallback/u);
  assert.match(nodeHostSource, /assertSameExecutionAccount\(sourceProvenance, actualProvenance\)/u);
});
check('isolated host jobs load no workspace resources and persist no native session', () => {
  assert.match(nodeHostSource, /SessionManager\.inMemory\(cwd\)/u);
  for (const flag of [
    'noExtensions',
    'noSkills',
    'noPromptTemplates',
    'noThemes',
    'noContextFiles',
  ]) {
    assert.match(nodeHostSource, new RegExp(`${flag}: true`, 'u'));
  }
  assert.match(nodeHostSource, /systemPrompt,/u);
  const neutralCwdSource = rustRunSource.match(/fn neutral_cwd[\s\S]*?\n\}/u)?.[0] ?? '';
  assert.match(neutralCwdSource, /temp_dir\(\)[\s\S]*?offisim-agent-runtime[\s\S]*?isolated/u);
  assert.doesNotMatch(neutralCwdSource, /dev_workspace_root|home_dir|current_dir/u);
});
check('Pi in-memory sessions keep message entries off disk', () => {
  const cwd = join(tmpdir(), `offisim-in-memory-proof-${randomUUID()}`);
  const session = SessionManager.inMemory(cwd);
  session.appendCustomEntry('offisim-isolation-proof', { text: 'must stay in memory' });
  assert.equal(session.sessionFile, undefined);
  assert.equal(existsSync(cwd), false);
});
check('Rust forwards opaque source provenance to the host', () => {
  assert.match(rustPayloadSource, /if let Some\(source_provenance\) = &req\.source_provenance/u);
  assert.match(
    rustPayloadSource,
    /\.insert\("sourceProvenance"\.into\(\), source_provenance\.clone\(\)\)/u,
  );
});
check('desktop isolated jobs send and verify the source execution identity', () => {
  assert.match(desktopRuntimeSource, /async generateText\(input: IsolatedTextJobInput\)/u);
  assert.match(desktopRuntimeSource, /sourceProvenance: input\.sourceProvenance/u);
  assert.match(
    desktopRuntimeSource,
    /assertSameExecutionAccount\(input\.sourceProvenance, provenance\)/u,
  );
});
check('root runs persist host-selected provenance instead of requested settings', () => {
  assert.match(desktopRuntimeSource, /requireTurnExecutionProvenance/u);
  assert.match(desktopRuntimeSource, /runtimeContext\.provenance = provenance/u);
  assert.match(desktopRuntimeSource, /runtimeContext\.model = provenance\.modelId/u);
});
check('direct delegated roots report the child session actual model', () => {
  assert.match(childSupervisorSource, /binding\.actualModel = session\.model \?\? model/u);
  assert.match(childSupervisorSource, /runSingleWithMetadata/u);
  assert.match(
    nodeHostSource,
    /await executionProvenance\([\s\S]*?authStorage,[\s\S]*?modelRegistry,[\s\S]*?directResult\.model,[\s\S]*?rootRunId/u,
  );
});

const oauthRegistry = { isUsingOAuth: () => true };
const apiRegistry = { isUsingOAuth: () => false };
const oauthA = await hostExecutionProvenance(
  {
    get: () => ({ type: 'oauth', accountId: 'native-account-a', refresh: 'refresh-v1' }),
  },
  oauthRegistry,
  { provider: 'anthropic', id: 'claude-fixture' },
  'oauth-run-a',
);
const oauthARepeat = await hostExecutionProvenance(
  {
    get: () => ({ type: 'oauth', accountId: 'native-account-a', refresh: 'refresh-v2' }),
  },
  oauthRegistry,
  { provider: 'anthropic', id: 'claude-fixture' },
  'oauth-run-b',
);
const oauthB = await hostExecutionProvenance(
  {
    get: () => ({ type: 'oauth', accountId: 'native-account-b', refresh: 'refresh-v3' }),
  },
  oauthRegistry,
  { provider: 'anthropic', id: 'claude-fixture' },
  'oauth-run-c',
);
check(
  'provider-native account identity survives OAuth refresh and changes with the account',
  () => {
    assert.equal(oauthA.billingMode, 'subscription');
    assert.equal(oauthA.accountId, oauthARepeat.accountId);
    assert.notEqual(oauthA.accountId, oauthB.accountId);
    assert.doesNotMatch(oauthA.accountId, /native-account|refresh-/u);
  },
);

const opaqueOauthA = await hostExecutionProvenance(
  {
    get: () => ({ type: 'oauth', refresh: 'rotating-refresh-a' }),
    getApiKey: async () => 'opaque-access-a',
  },
  oauthRegistry,
  { provider: 'anthropic', id: 'claude-fixture' },
  'opaque-oauth-a',
);
const opaqueOauthB = await hostExecutionProvenance(
  {
    get: () => ({ type: 'oauth', refresh: 'rotating-refresh-b' }),
    getApiKey: async () => 'opaque-access-b',
  },
  oauthRegistry,
  { provider: 'anthropic', id: 'claude-fixture' },
  'opaque-oauth-b',
);
check('opaque OAuth account replacement cannot merge credential generations', () => {
  assert.notEqual(opaqueOauthA.accountId, opaqueOauthB.accountId);
  assert.doesNotMatch(opaqueOauthA.accountId, /rotating-refresh/u);
});

const apiA = await hostExecutionProvenance(
  {
    get: () => ({ type: 'api_key', key: '$OFFISIM_PROVENANCE_TEST_KEY' }),
    getApiKey: async () => 'api-key-a',
  },
  apiRegistry,
  { provider: 'openai', id: 'gpt-fixture' },
  'api-run-a',
);
const apiB = await hostExecutionProvenance(
  {
    get: () => ({ type: 'api_key', key: '$OFFISIM_PROVENANCE_TEST_KEY' }),
    getApiKey: async () => 'api-key-b',
  },
  apiRegistry,
  { provider: 'openai', id: 'gpt-fixture' },
  'api-run-b',
);
check('one API-key reference cannot merge different resolved paid accounts', () => {
  assert.equal(apiA.billingMode, 'api');
  assert.notEqual(apiA.accountId, apiB.accountId);
  assert.doesNotMatch(apiA.accountId, /api-key/u);
});

check('terminal host streams remain eligible for renderer replay and DB reconciliation', () => {
  const reattachStart = desktopRuntimeSource.indexOf('async reattachLiveRuns()');
  const reattachEnd = desktopRuntimeSource.indexOf('private async runPiTurn', reattachStart);
  assert.ok(reattachStart >= 0 && reattachEnd > reattachStart);
  const reattachBody = desktopRuntimeSource.slice(reattachStart, reattachEnd);
  assert.match(reattachBody, /if \(!snapshot\) continue/u);
  assert.doesNotMatch(reattachBody, /if \(!snapshot\?\.running\) continue/u);
  assert.match(reattachBody, /agent_runtime_reattach/u);
  assert.match(reattachBody, /event\.kind === 'result'/u);
  assert.match(reattachBody, /reconcileRoot\(row\.run_id, 'completed'/u);
});

console.log(`execution-provenance gate passed (${checks} checks)`);
