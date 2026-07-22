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

function rustFunctionBody(source: string, name: string): string {
  const signature = new RegExp(`\\bfn\\s+${name}\\b`, 'u').exec(source);
  assert.ok(signature, `Rust function ${name} must exist`);
  const opening = source.indexOf('{', signature.index);
  assert.notEqual(opening, -1, `Rust function ${name} must have a body`);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  for (let index = opening; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (character === '/' && next === '*') {
        blockCommentDepth += 1;
        index += 1;
      } else if (character === '*' && next === '/') {
        blockCommentDepth -= 1;
        index += 1;
      }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
    } else if (character === '/' && next === '*') {
      blockCommentDepth = 1;
      index += 1;
    } else if (character === '"') {
      quoted = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(opening + 1, index);
    }
  }
  assert.fail(`Rust function ${name} has an unterminated body`);
}

function changed(
  source: TurnExecutionProvenance,
  key: keyof TurnExecutionProvenance,
  value: string,
): TurnExecutionProvenance {
  return { ...source, [key]: value };
}

console.log('execution-provenance gate');

const orchestrationTurn: TurnExecutionProvenance = {
  engineId: 'codex',
  accountId: 'codex:local',
  billingMode: 'subscription',
  modelId: 'engine-managed',
  modelSource: { kind: 'native' },
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
  adapter: { id: 'pi-agent', version: '0.80.9' },
};

check('orchestration provenance validates with its exact Turn id', () => {
  assert.deepEqual(validateTurnExecutionProvenance(orchestrationTurn, 'turn-1'), orchestrationTurn);
});
check('API provenance validates independently of orchestration billing', () => {
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
    () => validateTurnExecutionProvenance({ ...orchestrationTurn, accountId: '' }),
    /incomplete execution provenance/u,
  );
});
check('unknown billing modes are rejected', () => {
  assert.throws(
    () => validateTurnExecutionProvenance({ ...orchestrationTurn, billingMode: 'credits' }),
    /incomplete execution provenance/u,
  );
});
check('a host result cannot be attributed to another Turn', () => {
  assert.throws(
    () => validateTurnExecutionProvenance(orchestrationTurn, 'turn-other'),
    /provenance run mismatch/u,
  );
});

check('native orchestration provenance rejects fabricated catalog fields', () => {
  assert.throws(
    () =>
      validateTurnExecutionProvenance({
        ...orchestrationTurn,
        modelSource: {
          kind: 'native',
          sourceUrl: 'https://example.invalid/fabricated',
          checkedAt: '2026-07-17T00:00:00Z',
        },
      }),
    /incomplete execution provenance/u,
  );
});

const isolatedJob = { ...orchestrationTurn, runId: 'title-job-1' };
check('an isolated text job may have its own run id', () => {
  assert.doesNotThrow(() => assertSameExecutionAccount(orchestrationTurn, isolatedJob));
});
for (const [key, value] of [
  ['engineId', 'other-engine'],
  ['accountId', 'subscription:openai:fedcba9876543210'],
  ['billingMode', 'api'],
  ['modelId', 'gpt-5.2-codex-max'],
] as const) {
  check(`isolated text job rejects ${key} drift`, () => {
    assert.throws(
      () => assertSameExecutionAccount(orchestrationTurn, changed(isolatedJob, key, value)),
      new RegExp(`provenance mismatch for ${key}`, 'u'),
    );
  });
}
check('a prepared adapter cannot change before the result', () => {
  assert.throws(
    () =>
      assertSameExecutionAccount(orchestrationTurn, {
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
const claudeRustSource = readFileSync(
  fileURLToPath(new URL('../apps/desktop/src-tauri/src/claude_agent_host/mod.rs', import.meta.url)),
  'utf8',
);
const desktopRuntimeSource = readFileSync(
  fileURLToPath(
    new URL('../apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts', import.meta.url),
  ),
  'utf8',
);
const agentRunPersistenceSource = readFileSync(
  fileURLToPath(
    new URL('../apps/desktop/renderer/src/runtime/agent-run-persistence.ts', import.meta.url),
  ),
  'utf8',
);
const hostEventDispatchSource = readFileSync(
  fileURLToPath(
    new URL('../apps/desktop/renderer/src/runtime/host-event-dispatch.ts', import.meta.url),
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

check('Rust function extraction cannot satisfy a contract from a later function', () => {
  const fixture = 'fn first() {\n  let value = "}"; // }\n}\nfn second() {\n  neutral_cwd();\n}\n';
  assert.doesNotMatch(rustFunctionBody(fixture, 'first'), /neutral_cwd/u);
  assert.match(rustFunctionBody(fixture, 'second'), /neutral_cwd/u);
});

check('host delegates OAuth billing truth to Pi without exposing the credential', () => {
  assert.match(hostProvenanceSource, /modelRegistry\.isUsingOAuth\(model\)/u);
  assert.match(hostProvenanceSource, /createHmac\('sha256', resolvedSecret\)/u);
  assert.match(hostProvenanceSource, /offisim:credential-generation:v1/u);
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
  const neutralCwdSource = rustFunctionBody(rustRunSource, 'neutral_cwd');
  assert.match(neutralCwdSource, /app_cache_dir\(\)[\s\S]*?prepare_neutral_cwd/u);
  assert.doesNotMatch(neutralCwdSource, /dev_workspace_root|home_dir|current_dir/u);
  assert.match(rustRunSource, /struct TrustedDirectoryIdentity/u);
  const prepareNeutralCwd = rustFunctionBody(rustRunSource, 'prepare_neutral_cwd');
  assert.match(prepareNeutralCwd, /open_directory_chain[\s\S]*?ensure_directory/u);
  assert.doesNotMatch(prepareNeutralCwd, /create_dir_all|std::fs::create_dir/u);
  const bindNeutralCommand = rustFunctionBody(rustRunSource, 'bind_command');
  assert.match(bindNeutralCommand, /pre_exec[\s\S]*?fstat[\s\S]*?fchdir/u);
});
check('every direct Pi and Claude isolated mode uses the hardened neutral cwd', () => {
  const piUnavailable = rustFunctionBody(rustRunSource, 'execute_without_workspace');
  const piEnhance = rustFunctionBody(rustRunSource, 'do_enhance');
  const piCollaborate = rustFunctionBody(rustRunSource, 'do_collaborate');
  const claudeExecute = rustFunctionBody(claudeRustSource, 'do_execute');
  const claudeEnhance = rustFunctionBody(claudeRustSource, 'do_enhance');
  const claudeStatus = rustFunctionBody(claudeRustSource, 'status_impl');
  assert.match(piUnavailable, /let cwd = neutral_cwd\(app\)\?/u);
  assert.match(piEnhance, /let cwd = neutral_cwd\(app\)\?/u);
  assert.match(piCollaborate, /let cwd = neutral_cwd\(app\)\?/u);
  assert.match(claudeExecute, /\(neutral_cwd\(app\)\?, "unavailable"\)/u);
  assert.match(claudeEnhance, /let cwd = neutral_cwd\(app\)\?/u);
  assert.match(claudeStatus, /let cwd = neutral_cwd\(&app\)/u);
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
    /assertDurableExecutionTarget\(\s*runScope\.runId,\s*executionTarget,\s*commandName === 'agent_runtime_execute' \? requestId : undefined,\s*\)/u,
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
  assert.match(
    desktopRuntimeSource,
    /function requireRootResultProvenance\([\s\S]*orchestrationShell \? undefined : rootRunId[\s\S]*requirePreparedExecutionIdentity\(preparations, actual\.runId\)[\s\S]*orchestrationShell \? \{ \.\.\.actual, runId: rootRunId \} : actual/u,
  );
});

const oauthRegistry = { isUsingOAuth: () => true };
const apiRegistry = { isUsingOAuth: () => false };
const nativeModelSource = {
  kind: 'official-api',
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
  const reattachEnd = desktopRuntimeSource.indexOf('private async runNativeTurn', reattachStart);
  assert.ok(reattachStart >= 0 && reattachEnd > reattachStart);
  const reattachBody = desktopRuntimeSource.slice(reattachStart, reattachEnd);
  assert.match(
    reattachBody,
    /if \(!snapshot\) \{[\s\S]*?confirmedMissingRootRunIds\.add\(row\.run_id\);[\s\S]*?continue;/u,
  );
  assert.doesNotMatch(reattachBody, /if \(!snapshot\?\.running\) continue/u);
  assert.match(reattachBody, /this\.invokeReattach/u);
  assert.match(
    hostEventDispatchSource,
    /const result: HostEventHandler<'result'>[\s\S]*?active\.onResult\(event\)/u,
  );
  assert.match(
    reattachBody,
    /onError: \(errorEvent:[\s\S]*?status: 'failed',[\s\S]*?text: accumulatedContentText,[\s\S]*?error: errorEvent\.message/u,
    'failed reattach terminal must preserve the host error separately from partial assistant text',
  );
  assert.match(reattachBody, /pendingTerminalCheckpoint/u);
  assert.match(reattachBody, /enqueueTerminalCheckpoint/u);
  const checkpointStart = reattachBody.indexOf('const queueTerminalCheckpoint = (');
  const checkpointEnd = reattachBody.indexOf('const abortRejectedBinding', checkpointStart);
  const checkpointBody = reattachBody.slice(checkpointStart, checkpointEnd);
  const commitDefinition = checkpointBody.indexOf('const commit = () =>');
  const queuedCommit = checkpointBody.indexOf('this.persistQueue.enqueueTerminalCheckpoint');
  const terminalPersist = checkpointBody.indexOf('this.persistQueue.persistRootTerminal(');
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
  const terminalStart = agentRunPersistenceSource.indexOf('async persistRootTerminal(');
  const terminalEnd = agentRunPersistenceSource.indexOf(
    '/** Persist a delegation run',
    terminalStart,
  );
  assert.ok(terminalStart >= 0 && terminalEnd > terminalStart);
  const terminalBody = agentRunPersistenceSource.slice(terminalStart, terminalEnd);
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
  const projectionStart = agentRunPersistenceSource.indexOf(
    'async buildLiveConversationTerminalMessage(',
  );
  const projectionEnd = agentRunPersistenceSource.indexOf(
    'async persistRootTerminal(',
    projectionStart,
  );
  assert.ok(projectionStart >= 0 && projectionEnd > projectionStart);
  const projectionBody = agentRunPersistenceSource.slice(projectionStart, projectionEnd);
  assert.match(projectionBody, /loadPersistedChatMessageWithRepositories\(\{/u);
  assert.match(projectionBody, /messageId: projection\.assistantMessageId/u);
  assert.match(projectionBody, /terminal\.text\.trim\(\) \|\| existing\?\.body\.trim\(\)/u);
  assert.match(
    projectionBody,
    /terminal\.reasoning\?\.trim\(\) \|\| existing\?\.reasoning\?\.trim\(\)/u,
  );
  assert.match(projectionBody, /terminal\.status === 'failed'[\s\S]*?'failed'/u);
});

check('native Stop coalesces transport and snapshot arbitration for one request', () => {
  assert.match(
    desktopRuntimeSource,
    /private readonly abortInFlight = new Map<string, Promise<void>>\(\);/u,
  );
  assert.equal(
    desktopRuntimeSource.match(/this\.invokeAbort\(requestId\)/gu)?.length,
    1,
    'only the coalescer may call the raw native abort transport',
  );
  assert.match(
    desktopRuntimeSource,
    /private readonly abortDecisionByRequest = new Map<string, Promise<void>>\(\);/u,
  );
  assert.match(desktopRuntimeSource, /void this\.abort\(input\.threadId\)\.catch/u);
  assert.ok(
    (desktopRuntimeSource.match(/this\.invokeAbortOnce\(requestId\)/gu)?.length ?? 0) >= 3,
    'Stop and rejected-binding paths must share the native abort coalescer',
  );
  assert.match(desktopRuntimeSource, /snapshot\?\.terminal\?\.status === 'aborted'/u);
  assert.match(
    desktopRuntimeSource,
    /if \(this\.abortInFlight\.get\(requestId\) === pending\) \{\s*this\.abortInFlight\.delete\(requestId\);/u,
  );
});

console.log(`execution-provenance gate passed (${checks} checks)`);
