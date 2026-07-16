import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AiExecutionTarget, AiRuntimeStatus } from '@offisim/shared-types';
import {
  normalizeStructuredAnswers,
  parseUserInputQuestions,
} from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.js';
import { resolveRuntimeExecutionSelection } from '../apps/desktop/renderer/src/runtime/desktop-agent-runtime.js';
import {
  type NativeCommandInvoke,
  createNativeAgentCommandTransport,
} from '../apps/desktop/renderer/src/runtime/native-agent-command-transport.js';
import {
  assertThreadExecutionLane,
  planThreadExecutionSelection,
  resolveAuthoritativeThreadExecutionAuthority,
} from '../apps/desktop/renderer/src/runtime/thread-execution-authority.js';

const source = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const codexTarget: AiExecutionTarget = {
  engineId: 'codex',
  accountId: 'codex:local',
  billingMode: 'subscription',
  modelId: 'engine-managed',
  modelSource: { kind: 'native' },
};
const codexAuthority = { target: codexTarget, runtimeModelRef: 'codex' };

function root(runId: string, startedAt: string, executionTarget: unknown, model = 'codex') {
  return {
    run_id: runId,
    company_id: 'company-1',
    parent_run_id: null,
    runtime_context_json: JSON.stringify({ executionTarget, model }),
    started_at: startedAt,
  };
}

console.log('renderer engine authority gate');

assert.deepEqual(
  resolveAuthoritativeThreadExecutionAuthority(
    [
      root('old-valid', '2026-07-17T00:00:00Z', codexTarget),
      root('new-valid', '2026-07-17T01:00:00Z', codexTarget),
      root('newest-unprepared', '2026-07-17T02:00:00Z', undefined),
    ],
    'company-1',
  ),
  codexAuthority,
  'latest durable root must freeze the orchestration engine, not a model preset',
);
assert.deepEqual(planThreadExecutionSelection(codexAuthority, undefined, undefined), {
  requestedModel: undefined,
  frozenAuthority: codexAuthority,
  authoritativeAuthority: codexAuthority,
  requiresCatalog: false,
});
assert.doesNotThrow(() => assertThreadExecutionLane(codexTarget, codexTarget));
assert.throws(
  () => assertThreadExecutionLane(codexTarget, { ...codexTarget, engineId: 'api' }),
  /cannot switch AI engine, account, or billing lane/u,
);

const capabilities = {
  stop: true,
  steer: false,
  resume: true,
  permissionModes: ['plan', 'ask', 'auto', 'full'] as const,
  interactions: { approval: true, userInput: true },
  processEvents: { reasoning: true, toolCalls: true, fileChanges: true },
};
const runtimeStatus: AiRuntimeStatus = {
  checkedAt: '2026-07-17T00:00:00Z',
  accounts: [],
  models: [],
  orchestrationEngines: [
    {
      engineId: 'codex',
      displayName: 'Codex CLI',
      state: 'ready',
      version: 'codex-cli 0.144.3',
      loginCommand: 'codex login',
      docsUrl: 'https://developers.openai.com/codex/auth',
      checkedAt: '2026-07-17T00:00:00Z',
      capabilities,
    },
  ],
};
assert.deepEqual(resolveRuntimeExecutionSelection(runtimeStatus, 'codex'), codexAuthority);
assert.deepEqual(
  resolveRuntimeExecutionSelection(runtimeStatus, undefined, codexTarget, 'codex'),
  codexAuthority,
);
assert.throws(
  () =>
    resolveRuntimeExecutionSelection(
      runtimeStatus,
      undefined,
      {
        ...codexTarget,
        modelSource: {
          kind: 'native',
          sourceUrl: 'https://example.invalid/fabricated',
          checkedAt: '2026-07-17T00:00:00Z',
        },
      },
      'codex',
    ),
  /valid execution target/u,
);

const questions = parseUserInputQuestions({
  questions: [
    {
      id: 'scope',
      header: 'Scope',
      question: 'Which area should change?',
      options: null,
      isOther: true,
      isSecret: false,
    },
    {
      id: 'token',
      header: 'Credential',
      question: 'Enter the temporary token.',
      options: null,
      isOther: false,
      isSecret: true,
    },
  ],
  autoResolutionMs: 60_000,
});
assert.ok(questions);
assert.deepEqual(
  normalizeStructuredAnswers(questions.questions, {
    scope: { answers: [' Workspace '] },
    token: { answers: ['  secret value  '] },
  }),
  { scope: { answers: ['Workspace'] }, token: { answers: ['  secret value  '] } },
);

const calls: Array<{ command: string; args: unknown }> = [];
const fakeInvoke = (async (command: string, args: unknown) => {
  calls.push({ command, args });
  if (command === 'codex_agent_execute' || command === 'codex_agent_resume') {
    const requestId = (args as { req: { requestId: string } }).req.requestId;
    return { text: 'ok', provenance: { ...codexTarget, runId: requestId } };
  }
  return undefined;
}) as NativeCommandInvoke;
const transport = createNativeAgentCommandTransport(fakeInvoke);
const request = {
  requestId: 'codex-run-1',
  text: 'Continue',
  expectedTarget: codexTarget,
  companyId: 'company-1',
  threadId: 'thread-1',
  projectId: 'project-1',
  rootRunId: 'codex-run-1',
  workspaceRequirement: 'required' as const,
  nativeSessionMode: 'tracked' as const,
  nativeSessionId: 'opaque-session',
  model: 'codex',
  runtimeModelRef: 'codex',
};
await transport.executeCodex({ req: request, onEvent: { onmessage: () => undefined } as never });
await transport.resumeCodex({
  req: { ...request, workspaceBindingHistoryId: 'binding-history-1' },
  onEvent: { onmessage: () => undefined } as never,
});
await transport.answer('codex', { requestId: request.requestId, id: 'interaction-1', value: '{}' });
await transport.abort('codex', { requestId: request.requestId });
assert.deepEqual(
  calls.map((call) => call.command),
  ['codex_agent_execute', 'codex_agent_resume', 'codex_agent_answer', 'codex_agent_abort'],
);
for (const call of calls.slice(0, 2)) {
  const payload = (call.args as { req: Record<string, unknown> }).req;
  assert.equal(payload.runtimeModelRef, 'codex');
  for (const piOnly of ['skillPaths', 'roster', 'missionContextJson', 'mcpTools', 'directDelegation']) {
    assert.equal(payload[piOnly], undefined, `${call.command} leaked ${piOnly}`);
  }
}

const runtimeSource = source('../apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts');
assert.match(runtimeSource, /readonly capabilities: RuntimeEngineCapabilityManifest/u);
assert.match(runtimeSource, /getEngineCapabilities\(engineId: string\)/u);
assert.match(runtimeSource, /context\?\.requestId !== answer\.requestId/u);
assert.match(runtimeSource, /context\.executionTarget\?\.engineId/u);
assert.doesNotMatch(runtimeSource, /adapters\.size\s*!==\s*1/u);
assert.match(runtimeSource, /modelId: 'engine-managed'/u);
assert.match(runtimeSource, /modelSource: \{ kind: 'native' \}/u);

const composerSource = source(
  '../apps/desktop/renderer/src/assistant/composer/ComposerSettingsMenu.tsx',
);
assert.match(composerSource, /effective\?\.capabilities\.permissionModes/u);
assert.match(composerSource, /selectionKind === 'orchestration-engine'/u);
assert.match(composerSource, /supportsReasoning \?/u);
assert.match(composerSource, /showPermissionMode \?/u);

const settingsSource = source('../apps/desktop/renderer/src/surfaces/settings/AiAccountsPane.tsx');
assert.match(settingsSource, /API engines/u);
assert.match(settingsSource, /Orchestration engines/u);
assert.match(settingsSource, /engine\.loginCommand/u);
assert.match(settingsSource, /new URL\(engine\.docsUrl\)/u);
assert.match(settingsSource, /无 API 成本/u);
assert.doesNotMatch(settingsSource, /Subscription usage|remaining credits/iu);

const controllerSource = source(
  '../apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.ts',
);
const approvalSource = source(
  '../apps/desktop/renderer/src/assistant/parts/PermissionApprovalBar.tsx',
);
assert.match(controllerSource, /raw\.options == null \? \[\] : raw\.options/u);
assert.match(controllerSource, /Never log the input object/u);
assert.match(approvalSource, /type=\{question\.isSecret \? 'password' : 'text'\}/u);
assert.match(approvalSource, /Do not log answer state/u);

const runtimeTabSource = source(
  '../apps/desktop/renderer/src/surfaces/personnel/RuntimeTab.tsx',
);
const personnelSource = source(
  '../apps/desktop/renderer/src/surfaces/personnel/PersonnelSurface.tsx',
);
assert.match(runtimeTabSource, /selectionKind === 'orchestration-engine' \? 'Engine' : 'Model'/u);
assert.match(runtimeTabSource, /\{supportsReasoning \? \(/u);
assert.doesNotMatch(runtimeTabSource, /disabled=\{!model \|\| invalid \|\| !supportsReasoning\}/u);
assert.match(personnelSource, /selectedRuntime\?\.selectionKind === 'orchestration-engine'/u);
assert.match(personnelSource, /thinking_level: model && supportsReasoning/u);
assert.match(personnelSource, /\{supportsReasoning \? \(/u);

console.log('renderer engine authority gate OK');
