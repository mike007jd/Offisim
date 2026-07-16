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
  engineId: 'codex',
  accountId: 'subscription:openai:0123456789abcdef',
  billingMode: 'subscription',
  modelId: 'gpt-5.2-codex',
  modelSource: {
    kind: 'native',
    sourceUrl: 'https://developers.openai.com/codex/models',
    checkedAt: '2026-07-14T00:00:00Z',
  },
  runId: 'turn-1',
  adapter: { id: 'codex-app-server', version: '2026-07-14' },
};

const apiTurn: TurnExecutionProvenance = {
  engineId: 'api',
  accountId: 'api:openrouter:fedcba9876543210',
  billingMode: 'api',
  modelId: 'openai/gpt-oss-20b:free',
  modelSource: {
    kind: 'official-api',
    sourceUrl: 'https://openrouter.ai/api/v1/models/openai/gpt-oss-20b:free/endpoints',
    checkedAt: '2026-07-14T00:00:00Z',
  },
  runId: 'turn-2',
  adapter: { id: 'pi-agent', version: '0.79.8' },
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
    /incomplete execution provenance/u,
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
  ['accountId', 'subscription:openai:fedcba9876543210'],
  ['billingMode', 'api'],
  ['modelId', 'gpt-5.2-codex-max'],
] as const) {
  check(`isolated text job rejects ${key} drift`, () => {
    assert.throws(
      () => assertSameExecutionAccount(subscriptionTurn, changed(isolatedJob, key, value)),
      new RegExp(`provenance mismatch for ${key}`, 'u'),
    );
  });
}
check('a prepared adapter cannot change before the result', () => {
  assert.throws(
    () =>
      assertSameExecutionAccount(subscriptionTurn, {
        ...isolatedJob,
        adapter: { id: 'other-adapter', version: '9.9.9' },
      }),
    /provenance mismatch for adapter/u,
  );
});

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
const chatMessageEventsSource = readFileSync(
  fileURLToPath(
    new URL('../apps/desktop/renderer/src/data/chat-message-events.ts', import.meta.url),
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
  assert.match(hostProvenanceSource, /accountMaterial[\s\S]*createHash\('sha256'\)/u);
  assert.doesNotMatch(hostProvenanceSource, /accountId:.*credential\.(key|access|refresh)/u);
});
check('isolated host jobs require an exact target and refuse provenance drift', () => {
  assert.match(
    nodeHostSource,
    /const \{ model, runtimeModelRef \} = requireRuntimeModel\(payload, modelRegistry\)/u,
  );
  assert.match(nodeHostSource, /sourceProvenance\.modelId !== payload\.expectedTarget\?\.modelId/u);
  assert.match(nodeHostSource, /Isolated text job model does not match source provenance/u);
  assert.match(
    nodeHostSource,
    /assertSameExecutionAccount\(sourceProvenance, preparedExecution\.identity\)/u,
  );
  assert.match(nodeHostSource, /expectedTarget: payload\.expectedTarget/u);
  assert.match(nodeHostSource, /runtimeModelRef,/u);
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
check('root runs persist their exact target before execution and retain host provenance', () => {
  assert.match(desktopRuntimeSource, /requireTurnExecutionProvenance/u);
  assert.match(desktopRuntimeSource, /runtimeContext\.executionTarget = executionTarget/u);
  assert.match(desktopRuntimeSource, /runtimeContext\.model = resolvedModel/u);
  assert.match(
    desktopRuntimeSource,
    /assertDurableExecutionTarget\(runScope\.runId, executionTarget, requestId\)/u,
  );
  assert.match(desktopRuntimeSource, /runtimeContext\.provenance = provenance/u);
  assert.match(desktopRuntimeSource, /requirePreparedExecutionIdentity/u);
});
check('direct delegated roots report the child session actual model', () => {
  assert.match(childSupervisorSource, /binding\.actualModel = session\.model \?\? model/u);
  assert.match(childSupervisorSource, /runSingleWithMetadata/u);
  assert.match(childSupervisorSource, /completed: result\.completed/u);
  assert.match(
    nodeHostSource,
    /if \(directResult\.completed && \(!directResult\.model \|\| !directResult\.provenance\)\)[\s\S]*?Direct delegation completed without a prepared child execution identity/u,
  );
  assert.match(
    nodeHostSource,
    /directResult\.provenance \? \{ provenance: directResult\.provenance \} : \{\}/u,
  );
});

const oauthRegistry = { isUsingOAuth: () => true };
const apiRegistry = { isUsingOAuth: () => false };
const nativeModelSource = {
  kind: 'native',
  sourceUrl: 'https://docs.anthropic.com/en/docs/about-claude/models/overview',
  checkedAt: '2026-07-14T00:00:00Z',
} as const;
const apiModelSource = {
  kind: 'official-api',
  sourceUrl: 'https://platform.openai.com/docs/models',
  checkedAt: '2026-07-14T00:00:00Z',
} as const;
const oauthA = await hostExecutionProvenance(
  {
    get: () => ({ type: 'oauth', accountId: 'native-account-a', refresh: 'refresh-v1' }),
  },
  oauthRegistry,
  { provider: 'anthropic', id: 'claude-fixture' },
  'oauth-run-a',
  nativeModelSource,
);
const oauthARepeat = await hostExecutionProvenance(
  {
    get: () => ({ type: 'oauth', accountId: 'native-account-a', refresh: 'refresh-v2' }),
  },
  oauthRegistry,
  { provider: 'anthropic', id: 'claude-fixture' },
  'oauth-run-b',
  nativeModelSource,
);
const oauthB = await hostExecutionProvenance(
  {
    get: () => ({ type: 'oauth', accountId: 'native-account-b', refresh: 'refresh-v3' }),
  },
  oauthRegistry,
  { provider: 'anthropic', id: 'claude-fixture' },
  'oauth-run-c',
  nativeModelSource,
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
  nativeModelSource,
);
const opaqueOauthB = await hostExecutionProvenance(
  {
    get: () => ({ type: 'oauth', refresh: 'rotating-refresh-b' }),
    getApiKey: async () => 'opaque-access-b',
  },
  oauthRegistry,
  { provider: 'anthropic', id: 'claude-fixture' },
  'opaque-oauth-b',
  nativeModelSource,
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
  apiModelSource,
);
const apiB = await hostExecutionProvenance(
  {
    get: () => ({ type: 'api_key', key: '$OFFISIM_PROVENANCE_TEST_KEY' }),
    getApiKey: async () => 'api-key-b',
  },
  apiRegistry,
  { provider: 'openai', id: 'gpt-fixture' },
  'api-run-b',
  apiModelSource,
);
check('one API-key reference cannot merge different resolved paid accounts', () => {
  assert.equal(apiA.billingMode, 'api');
  assert.notEqual(apiA.accountId, apiB.accountId);
  assert.doesNotMatch(apiA.accountId, /api-key/u);
});

const anonymousLocalA = await hostExecutionProvenance(
  {
    get: () => ({ type: 'api_key', key: '$LOCAL_CREDENTIAL_FRAGMENT' }),
    getApiKey: async () => undefined,
  },
  apiRegistry,
  {
    provider: 'ollama',
    id: 'qwen-fixture',
    baseUrl: 'HTTP://LOCALHOST:11434/v1/?token=credential-fragment#private',
  },
  'anonymous-local-a',
  apiModelSource,
);
const anonymousLocalB = await hostExecutionProvenance(
  {
    get: () => undefined,
    getApiKey: async () => undefined,
  },
  apiRegistry,
  { provider: 'ollama', id: 'qwen-fixture', baseUrl: 'http://localhost:11434/v1' },
  'anonymous-local-b',
  apiModelSource,
);
check('credential-free local endpoints receive an explicit anonymous account fingerprint', () => {
  assert.equal(anonymousLocalA.billingMode, 'api');
  assert.match(anonymousLocalA.accountId, /^credential-generation:anonymous:[a-f0-9]{16}$/u);
  assert.equal(anonymousLocalA.accountId, anonymousLocalB.accountId);
  assert.doesNotMatch(
    anonymousLocalA.accountId,
    /LOCAL_CREDENTIAL_FRAGMENT|credential-fragment|localhost|11434/u,
  );
});

check('terminal host streams remain eligible for renderer replay and DB reconciliation', () => {
  const reattachStart = desktopRuntimeSource.indexOf('async reattachLiveRuns(');
  const reattachEnd = desktopRuntimeSource.indexOf('private async runPiTurn', reattachStart);
  assert.ok(reattachStart >= 0 && reattachEnd > reattachStart);
  const reattachBody = desktopRuntimeSource.slice(reattachStart, reattachEnd);
  assert.match(
    reattachBody,
    /if \(!snapshot\) \{[\s\S]*?confirmedMissingRootRunIds\.add\(row\.run_id\);[\s\S]*?continue;/u,
  );
  assert.doesNotMatch(reattachBody, /if \(!snapshot\?\.running\) continue/u);
  assert.match(reattachBody, /agent_runtime_reattach/u);
  assert.match(reattachBody, /event\.kind === 'result'/u);
  assert.match(
    reattachBody,
    /status: 'failed',[\s\S]*?text: accumulatedContentText,[\s\S]*?error: event\.message/u,
    'failed reattach terminal must preserve the host error separately from partial assistant text',
  );
  assert.match(reattachBody, /pendingTerminalCheckpoint/u);
  assert.match(reattachBody, /enqueueTerminalCheckpoint/u);
  const checkpointStart = reattachBody.indexOf('const queueTerminalCheckpoint = (');
  const checkpointEnd = reattachBody.indexOf('const abortRejectedBinding', checkpointStart);
  const checkpointBody = reattachBody.slice(checkpointStart, checkpointEnd);
  const commitDefinition = checkpointBody.indexOf('const commit = () =>');
  const queuedCommit = checkpointBody.indexOf('this.persistQueue.enqueueTerminalCheckpoint');
  const terminalPersist = checkpointBody.indexOf('this.persistRootTerminal(');
  const publishDefinition = checkpointBody.indexOf('const publishTerminal = (): void =>');
  const publishAfterCommit = checkpointBody.indexOf(
    'const outcome = commit().then(publishTerminal)',
  );
  assert.ok(
    checkpointStart >= 0 &&
      checkpointEnd > checkpointStart &&
      commitDefinition >= 0 &&
      queuedCommit > commitDefinition &&
      terminalPersist > queuedCommit &&
      publishDefinition > terminalPersist &&
      publishAfterCommit > publishDefinition,
    'reattach must publish terminal UI only after the single durable terminal checkpoint commits',
  );
  const terminalStart = desktopRuntimeSource.indexOf('private async persistRootTerminal(');
  const terminalEnd = desktopRuntimeSource.indexOf('/** Persist a delegation run', terminalStart);
  assert.ok(terminalStart >= 0 && terminalEnd > terminalStart);
  const terminalBody = desktopRuntimeSource.slice(terminalStart, terminalEnd);
  const transaction = terminalBody.indexOf('await this.repos.asyncTransact(');
  const rootStatusWrite = terminalBody.indexOf('tx.agentRuns.updateStatus(rootRunId, status');
  const contextWrite = terminalBody.indexOf('tx.agentRuns.updateRuntimeContext(');
  const chatWrite = terminalBody.indexOf('persistChatMessageWithRepositories({');
  const committedRunReadback = terminalBody.indexOf(
    'const readback = await this.repos.agentRuns.findById(rootRunId);',
  );
  const committedMessageReadback = terminalBody.indexOf(
    'await assertPersistedChatMessageWithRepositories({',
  );
  assert.ok(
    transaction >= 0 &&
      rootStatusWrite > transaction &&
      contextWrite > transaction &&
      chatWrite > transaction &&
      committedRunReadback > chatWrite &&
      committedMessageReadback > committedRunReadback,
    'root status, merged cursor/context, and Conversation projection must commit atomically before main-repository readback',
  );
  for (const exactReadback of [
    'readback.status !== status',
    'readback.runtime_context_json !== expectedTerminalContextJson',
    'expected: conversationMessage',
  ]) {
    assert.match(terminalBody, new RegExp(exactReadback.replaceAll('.', '\\.'), 'u'));
  }
  assert.match(chatMessageEventsSource, /repos\.agentEvents\.findById\(directChatMessageEventId/u);
  assert.match(
    chatMessageEventsSource,
    /JSON\.stringify\(actual\) !== JSON\.stringify\(expectedStored\)/u,
  );
  assert.ok(
    reattachBody.match(/abortedRequests\.delete\(requestId\)/gu)?.length ?? 0 >= 3,
    'every reattach terminal source must consume a concurrent user abort before classifying status',
  );
});

check('empty reload terminals retain the last durable assistant checkpoint', () => {
  const projectionStart = desktopRuntimeSource.indexOf(
    'private async buildLiveConversationTerminalMessage(',
  );
  const projectionEnd = desktopRuntimeSource.indexOf(
    'private async persistRunStreamCursor(',
    projectionStart,
  );
  assert.ok(projectionStart >= 0 && projectionEnd > projectionStart);
  const projectionBody = desktopRuntimeSource.slice(projectionStart, projectionEnd);
  assert.match(projectionBody, /loadPersistedChatMessageWithRepositories\(\{/u);
  assert.match(projectionBody, /messageId: projection\.assistantMessageId/u);
  assert.match(projectionBody, /terminal\.text\.trim\(\) \|\| existing\?\.body\.trim\(\)/u);
  assert.match(
    projectionBody,
    /terminal\.reasoning\?\.trim\(\) \|\| existing\?\.reasoning\?\.trim\(\)/u,
  );
  assert.match(projectionBody, /terminal\.status === 'failed'[\s\S]*?'failed'/u);
});

console.log(`execution-provenance gate passed (${checks} checks)`);
