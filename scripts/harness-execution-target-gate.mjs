#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createChildSupervisor,
  createDelegationLimits,
  resolveChildExecutionBinding,
} from './pi-child-supervisor.mjs';
import { createExecutionTargetGate } from './pi-execution-provenance.mjs';

const provider = 'fixture-adapter';
const model = Object.freeze({ provider, id: 'maker/leaf-model' });
const runtimeModelRef = `${provider}/${model.id}`;
const modelSource = Object.freeze({
  kind: 'official-api',
  sourceUrl: 'https://fixture.example/models/maker/leaf-model',
  checkedAt: '2026-07-14T00:00:00Z',
});
const secret = 'fixture-secret';
const fingerprint = createHash('sha256')
  .update(`${provider}\0api\0credential-generation:${secret}`)
  .digest('hex')
  .slice(0, 16);
const expectedTarget = Object.freeze({
  engineId: 'api',
  accountId: `api:${provider}:${fingerprint}`,
  billingMode: 'api',
  modelId: model.id,
  modelSource,
});

const authStorage = {
  get: () => ({ type: 'api_key' }),
  getApiKey: async () => secret,
};

function registry(oauth = false) {
  return { isUsingOAuth: () => oauth };
}

function fakeSession(selectedModel = model) {
  return {
    model: selectedModel,
    promptCalls: 0,
    toolCalls: 0,
    async prompt() {
      this.promptCalls += 1;
      this.toolCalls += 1;
    },
  };
}

async function prepareCase({
  target = expectedTarget,
  selectedModel = model,
  oauth = false,
  fallback,
  ack = 'valid',
  timeoutMs = 20,
} = {}) {
  const session = fakeSession(selectedModel);
  const gate = createExecutionTargetGate({
    requestId: 'request-1',
    timeoutMs,
    newPrepareId: () => 'prepare-1',
    emit(line) {
      if (ack === 'none') return;
      queueMicrotask(() => {
        gate.resolveAck({
          type: 'executionTargetAck',
          requestId: 'request-1',
          prepareId: line.prepareId,
          targetDigest: ack === 'valid' ? line.targetDigest : 'wrong-digest',
        });
      });
    },
  });
  const prepare = gate.prepare({
    authStorage,
    modelRegistry: registry(oauth),
    session,
    modelFallbackMessage: fallback,
    expectedTarget: target,
    runtimeModelRef,
    runId: 'run-1',
  });
  return { gate, session, prepare };
}

let checks = 0;
async function rejectsBeforePrompt(label, options, expectedCode) {
  const { session, prepare } = await prepareCase(options);
  await assert.rejects(prepare, (error) => error?.code === expectedCode, label);
  assert.equal(session.promptCalls, 0, `${label}: promptCalls`);
  assert.equal(session.toolCalls, 0, `${label}: toolCalls`);
  checks += 1;
}

await rejectsBeforePrompt(
  'target model mismatch',
  { target: { ...expectedTarget, modelId: 'maker/other-model' } },
  'execution-target-mismatch',
);
await rejectsBeforePrompt(
  'OAuth/subscription credential',
  { oauth: true },
  'execution-target-subscription',
);
await rejectsBeforePrompt(
  'SDK model fallback',
  { fallback: 'selected model unavailable' },
  'execution-target-mismatch',
);
await rejectsBeforePrompt(
  'bad target acknowledgement',
  { ack: 'bad' },
  'execution-target-ack-invalid',
);
await rejectsBeforePrompt(
  'missing target acknowledgement',
  { ack: 'none', timeoutMs: 5 },
  'execution-target-ack-timeout',
);

{
  const session = fakeSession();
  const gate = createExecutionTargetGate({
    requestId: 'request-close',
    timeoutMs: 1_000,
    newPrepareId: () => 'prepare-close',
    emit() {
      queueMicrotask(() => gate.close('stdin closed'));
    },
  });
  await assert.rejects(
    gate.prepare({
      authStorage,
      modelRegistry: registry(),
      session,
      expectedTarget,
      runtimeModelRef,
      runId: 'run-close',
    }),
    (error) => error?.code === 'execution-target-ack-closed',
  );
  assert.equal(session.promptCalls, 0);
  assert.equal(session.toolCalls, 0);
  checks += 1;
}

{
  const { gate, session, prepare } = await prepareCase();
  const prepared = await prepare;
  gate.assertPrepared(prepared, session);
  await session.prompt('allowed');
  assert.equal(session.promptCalls, 1, 'valid ACK allows exactly one prompt');
  assert.equal(session.toolCalls, 1, 'valid ACK allows model-driven work only after prompt');
  checks += 1;
}

{
  const alternateModel = Object.freeze({ provider, id: 'maker/alternate-leaf' });
  const alternateRuntimeModelRef = `${provider}/${alternateModel.id}`;
  const alternateTarget = Object.freeze({
    ...expectedTarget,
    modelId: alternateModel.id,
    modelSource: Object.freeze({
      ...modelSource,
      sourceUrl: 'https://fixture.example/models/maker/alternate-leaf',
    }),
  });
  const resolved = resolveChildExecutionBinding({
    employee: {
      employeeId: 'employee-exact',
      model: alternateModel.id,
      executionTarget: alternateTarget,
      runtimeModelRef: alternateRuntimeModelRef,
    },
    rootModel: model,
    rootExpectedTarget: expectedTarget,
    rootRuntimeModelRef: runtimeModelRef,
    resolveModel: (ref) => (ref === alternateRuntimeModelRef ? alternateModel : undefined),
  });
  assert.equal(resolved.model, alternateModel);
  assert.equal(resolved.expectedTarget, alternateTarget);
  assert.equal(resolved.runtimeModelRef, alternateRuntimeModelRef);
  assert.equal(resolved.inheritedModel, false);
  checks += 1;
}

{
  const inherited = resolveChildExecutionBinding({
    employee: { employeeId: 'employee-inherited' },
    rootModel: model,
    rootThinkingLevel: 'high',
    rootExpectedTarget: expectedTarget,
    rootRuntimeModelRef: runtimeModelRef,
    resolveModel: () => undefined,
  });
  assert.equal(inherited.model, model);
  assert.equal(inherited.expectedTarget, expectedTarget);
  assert.equal(inherited.runtimeModelRef, runtimeModelRef);
  assert.equal(inherited.thinkingLevel, 'high');
  assert.equal(inherited.inheritedModel, true);
  checks += 1;
}

assert.throws(
  () =>
    resolveChildExecutionBinding({
      employee: {
        employeeId: 'employee-cross-account',
        executionTarget: { ...expectedTarget, accountId: 'api:other:0123456789abcdef' },
        runtimeModelRef,
      },
      rootModel: model,
      rootExpectedTarget: expectedTarget,
      rootRuntimeModelRef: runtimeModelRef,
      resolveModel: () => model,
    }),
  /cannot switch accountId/,
);
assert.throws(
  () =>
    resolveChildExecutionBinding({
      employee: { employeeId: 'employee-unproven', model: model.id },
      rootModel: model,
      rootExpectedTarget: expectedTarget,
      rootRuntimeModelRef: runtimeModelRef,
      resolveModel: () => model,
    }),
  /requires an exact executionTarget and runtimeModelRef/,
);
checks += 1;

{
  let createSessionCalls = 0;
  const supervisor = createChildSupervisor({
    emit: () => {},
    agentDir: undefined,
    authStorage,
    modelRegistry: registry(),
    cwd: '.',
    settingsManager: {},
    threadId: 'thread-1',
    rootRunId: 'root-1',
    roster: [{ employeeId: 'employee-1', model: 'missing-provider/missing-model' }],
    resolveModel: () => undefined,
    rootModel: model,
    buildPermissionGate: () => null,
    limits: createDelegationLimits({ maxDepth: 2, maxTotalChildren: 2 }),
    createAgentSession: async () => {
      createSessionCalls += 1;
      return { session: fakeSession() };
    },
  });
  const result = await supervisor.runSingle({
    employeeId: 'employee-1',
    objective: 'Do the work',
    access: 'read',
  });
  assert.match(result, /failed/i);
  assert.equal(createSessionCalls, 0, 'invalid child model cannot create or prompt a session');
  checks += 1;
}

{
  const entry = readFileSync(new URL('./tauri-pi-agent-host.entry.mjs', import.meta.url), 'utf8');
  const child = readFileSync(new URL('./pi-child-supervisor.mjs', import.meta.url), 'utf8');
  for (const [name, start, end] of [
    ['root', 'async function runPrompt', '// ── Prompt Enhance'],
    ['enhance', 'async function runEnhance', '// ── Collaboration'],
    ['collaboration', 'async function runCollaboration', '// The host is line-delimited'],
  ]) {
    const slice = entry.slice(entry.indexOf(start), entry.indexOf(end));
    assert.ok(slice.includes('executionGate.prepare({'), `${name} creates a preparation`);
    assert.ok(
      slice.indexOf('executionGate.assertPrepared') < slice.indexOf('session.prompt('),
      `${name} asserts immutable preparation before prompt`,
    );
  }
  const childSession = child.slice(
    child.indexOf('async function runChildSession'),
    child.indexOf('return {', child.indexOf('async function runChildSession') + 1),
  );
  assert.ok(child.includes('binding.preparedExecution = await ctx.executionTargetGate.prepare({'));
  assert.ok(
    child.includes('ctx.executionTargetGate.assertPrepared(binding.preparedExecution, session);'),
  );
  assert.ok(childSession.includes('runId'));
  checks += 1;
}

console.log(`execution-target-gate: ${checks}/${checks} checks passed`);
console.log('execution-target-gate OK');
