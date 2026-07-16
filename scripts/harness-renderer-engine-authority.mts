import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AiExecutionTarget } from '@offisim/shared-types';
import { projectRunnableModelOptions } from '../apps/desktop/renderer/src/assistant/composer/usePiAgentModels.js';
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

const nativeSource = {
  kind: 'native',
  sourceUrl: 'https://learn.chatgpt.com/docs/models',
  checkedAt: '2026-07-15T00:00:00Z',
} as const;

const codexLeafA: AiExecutionTarget = {
  engineId: 'codex',
  accountId: 'codex:local:0123456789abcdef',
  billingMode: 'subscription',
  modelId: 'gpt-5.6-sol',
  modelSource: nativeSource,
};
const codexLeafB: AiExecutionTarget = { ...codexLeafA, modelId: 'gpt-5.6-terra' };

function root(
  runId: string,
  startedAt: string,
  executionTarget: unknown,
  runtimeModelRef = 'codex:preset-default',
  overrides: Partial<{
    company_id: string;
    parent_run_id: string | null;
    runtime_context_json: string | null;
  }> = {},
) {
  return {
    run_id: runId,
    company_id: 'company-1',
    parent_run_id: null,
    runtime_context_json: JSON.stringify({ executionTarget, model: runtimeModelRef }),
    started_at: startedAt,
    ...overrides,
  };
}

console.log('renderer engine authority gate');

const codexAuthorityA = { target: codexLeafA, runtimeModelRef: 'codex:preset-fast' };
const codexAuthorityB = { target: codexLeafB, runtimeModelRef: 'codex:preset-deep' };

const authoritative = resolveAuthoritativeThreadExecutionAuthority(
  [
    root('old-valid', '2026-07-15T00:00:00Z', codexLeafA, codexAuthorityA.runtimeModelRef),
    root('new-valid', '2026-07-15T01:00:00Z', codexLeafB, codexAuthorityB.runtimeModelRef),
    root('newest-not-prepared', '2026-07-15T02:00:00Z', undefined),
    root('foreign-newer', '2026-07-15T03:00:00Z', { engineId: 'api' }, 'codex:foreign', {
      company_id: 'company-2',
    }),
    root('child-newer', '2026-07-15T04:00:00Z', codexLeafA, 'codex:child', {
      parent_run_id: 'new-valid',
    }),
  ],
  'company-1',
);
assert.deepEqual(authoritative, codexAuthorityB, 'latest usable root must own leaf and selector');
assert.equal(
  resolveAuthoritativeThreadExecutionAuthority(
    [root('invalid', '2026-07-15T00:00:00Z', codexLeafA, '')],
    'company-1',
  ),
  undefined,
  'a task without a durable exact target remains unbound',
);

assert.deepEqual(
  planThreadExecutionSelection(codexAuthorityA, undefined, {
    target: { ...codexLeafA, engineId: 'api' },
    runtimeModelRef: 'api:preset',
  }),
  {
    requestedModel: undefined,
    frozenAuthority: codexAuthorityA,
    authoritativeAuthority: codexAuthorityA,
    requiresCatalog: false,
  },
  'no explicit model must reuse the durable exact leaf and ignore transient input',
);
assert.deepEqual(
  planThreadExecutionSelection(codexAuthorityA, 'codex:gpt-5.6-terra', undefined),
  {
    requestedModel: 'codex:gpt-5.6-terra',
    frozenAuthority: undefined,
    authoritativeAuthority: codexAuthorityA,
    requiresCatalog: true,
  },
  'an explicit model is re-resolved but remains subject to the durable lane',
);
assert.deepEqual(
  planThreadExecutionSelection(undefined, 'api:model-a', codexAuthorityA),
  {
    requestedModel: 'api:model-a',
    frozenAuthority: codexAuthorityA,
    authoritativeAuthority: undefined,
    requiresCatalog: true,
  },
  'a new task may use its current exact selection',
);
assert.doesNotThrow(
  () => assertThreadExecutionLane(codexLeafA, codexLeafB),
  'same-lane exact leaf changes are allowed',
);
for (const candidate of [
  { ...codexLeafB, engineId: 'api' },
  { ...codexLeafB, accountId: 'codex:local:other' },
  { ...codexLeafB, billingMode: 'api' as const },
]) {
  assert.throws(
    () => assertThreadExecutionLane(codexLeafA, candidate),
    /cannot switch AI engine, account, or billing lane/u,
  );
}

const availableCapability = { status: 'available' } as const;
const duplicatePresetStatus = {
  checkedAt: '2026-07-15T00:00:00Z',
  accounts: [
    {
      engineId: 'codex',
      accountId: codexLeafA.accountId,
      billingMode: 'subscription',
      displayName: 'Codex subscription',
      status: 'available',
      capabilities: {
        execute: availableCapability,
        models: availableCapability,
        usage: availableCapability,
        cost: { status: 'unavailable', reason: 'Subscription usage is not API cost.' },
      },
    },
  ],
  models: ['fast', 'deep'].map((preset) => ({
    engineId: 'codex',
    accountId: codexLeafA.accountId,
    billingMode: 'subscription',
    modelId: codexLeafA.modelId,
    displayName: `GPT preset ${preset}`,
    runtimeModelRef: `codex:preset-${preset}`,
    availability: 'available',
    capabilities: { textInput: true, imageInput: true, tools: true, reasoning: true },
    source: nativeSource,
  })),
};
assert.equal(
  resolveRuntimeExecutionSelection(
    duplicatePresetStatus,
    undefined,
    codexLeafA,
    'codex:preset-deep',
  ).runtimeModelRef,
  'codex:preset-deep',
  'durable native preset must survive when two selectors map to one leaf',
);
assert.throws(
  () => resolveRuntimeExecutionSelection(duplicatePresetStatus, undefined, codexLeafA),
  /saved AI account or exact model is no longer available/u,
  'a leaf-only continuation must fail ambiguous instead of first-matching a preset',
);

const nativeEffortOptions = projectRunnableModelOptions(
  {
    checkedAt: '2026-07-15T00:00:00Z',
    accounts: [
      duplicatePresetStatus.accounts[0],
      {
        ...duplicatePresetStatus.accounts[0],
        accountId: 'unavailable-account',
        status: 'unavailable',
        statusReason: 'Signed out',
      },
    ],
    models: [
      {
        ...duplicatePresetStatus.models[0],
        availability: 'expiring',
        availabilityReason: 'Native preset retirement',
        expiresAt: '2026-08-01T00:00:00Z',
        defaultReasoningEffort: 'max',
        reasoningEfforts: ['none', 'max', 'ultra', 'provider-next'].map((id) => ({ id })),
      },
      {
        ...duplicatePresetStatus.models[1],
        accountId: 'unavailable-account',
        runtimeModelRef: 'codex:unavailable',
      },
      {
        ...duplicatePresetStatus.models[1],
        availability: 'expiring',
        expiresAt: '2026-07-14T23:59:59Z',
        runtimeModelRef: 'codex:expired',
      },
      {
        ...duplicatePresetStatus.models[1],
        availability: 'expiring',
        runtimeModelRef: 'codex:expiring-without-deadline',
      },
    ],
  },
  Date.parse('2026-07-15T00:00:00Z'),
);
assert.deepEqual(
  nativeEffortOptions[0]?.reasoningEfforts,
  ['none', 'max', 'ultra', 'provider-next'],
  'the composer must preserve every exact native effort id, including future model-defined ids',
);
assert.equal(nativeEffortOptions[0]?.defaultReasoningEffort, 'max');
assert.equal(nativeEffortOptions[0]?.availabilityReason, 'Native preset retirement');
assert.equal(nativeEffortOptions[0]?.expiresAt, '2026-08-01T00:00:00Z');
assert.equal(
  nativeEffortOptions.length,
  1,
  'unavailable-account, expired, and unbounded expiring models must not appear runnable',
);

const sharedOpaqueAccountId = 'shared:opaque:0123456789abcdef';
const compositeLaneOptions = projectRunnableModelOptions({
  checkedAt: '2026-07-15T00:00:00Z',
  accounts: [
    {
      ...duplicatePresetStatus.accounts[0],
      engineId: 'api',
      accountId: sharedOpaqueAccountId,
      billingMode: 'api',
      displayName: 'OpenRouter API',
    },
    {
      ...duplicatePresetStatus.accounts[0],
      accountId: sharedOpaqueAccountId,
      displayName: 'Codex subscription',
    },
  ],
  models: [
    {
      ...duplicatePresetStatus.models[0],
      engineId: 'api',
      accountId: sharedOpaqueAccountId,
      billingMode: 'api',
      runtimeModelRef: 'api:shared',
      source: {
        kind: 'official-api',
        sourceUrl: 'https://openrouter.ai/api/v1/models/exact/endpoints',
        checkedAt: '2026-07-15T00:00:00Z',
      },
    },
    {
      ...duplicatePresetStatus.models[1],
      accountId: sharedOpaqueAccountId,
      runtimeModelRef: 'codex:shared',
    },
  ],
});
assert.deepEqual(
  compositeLaneOptions.map((option) => option.accountName),
  ['OpenRouter API', 'Codex subscription'],
  'account labels must resolve by engine, account, and billing lane rather than account id alone',
);
assert.equal(
  compositeLaneOptions[0]?.source.sourceUrl,
  'https://openrouter.ai/api/v1/models/exact/endpoints',
  'picker options must preserve exact model provenance',
);

const textAndSecretQuestions = parseUserInputQuestions({
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
assert.ok(textAndSecretQuestions, 'official null options must render as freeform questions');
assert.deepEqual(textAndSecretQuestions.questions[0]?.options, []);
assert.deepEqual(
  normalizeStructuredAnswers(textAndSecretQuestions.questions, {
    scope: { answers: [' Workspace '] },
    token: { answers: ['  secret value  '] },
  }),
  {
    scope: { answers: ['Workspace'] },
    token: { answers: ['  secret value  '] },
  },
  'secret values stay opaque while ordinary answers are normalized',
);

const nativeCalls: Array<{ command: string; args: unknown }> = [];
const streamedEvents: unknown[] = [];
const fakeNativeInvoke = (async (command: string, args: unknown) => {
  nativeCalls.push({ command, args });
  if (command === 'codex_agent_execute' || command === 'codex_agent_resume') {
    const wire = args as {
      onEvent?: { onmessage?: (event: unknown) => void };
      req: { requestId: string };
    };
    wire.onEvent?.onmessage?.({
      kind: 'uiRequest',
      id: 'interaction-1',
      method: 'requestUserInput',
      title: 'Need input',
      params: { questions: [] },
    });
    return {
      text: 'ok',
      provenance: { ...codexLeafA, runId: wire.req.requestId },
    };
  }
  return undefined;
}) as NativeCommandInvoke;
const nativeTransport = createNativeAgentCommandTransport(fakeNativeInvoke);
const exactCodexRequest = {
  requestId: 'codex-run-1',
  text: 'Continue',
  expectedTarget: codexLeafA,
  companyId: 'company-1',
  threadId: 'thread-1',
  projectId: 'project-1',
  rootRunId: 'codex-run-1',
  workspaceRequirement: 'required' as const,
  nativeSessionMode: 'tracked' as const,
  nativeSessionId: 'opaque-session',
  model: codexAuthorityA.runtimeModelRef,
  runtimeModelRef: codexAuthorityA.runtimeModelRef,
};
const fakeChannel = { onmessage: (event: unknown) => streamedEvents.push(event) };
await nativeTransport.executeCodex({ req: exactCodexRequest, onEvent: fakeChannel as never });
await nativeTransport.resumeCodex({
  req: { ...exactCodexRequest, workspaceBindingHistoryId: 'binding-history-1' },
  onEvent: fakeChannel as never,
});
await nativeTransport.answer('codex', {
  requestId: exactCodexRequest.requestId,
  id: 'interaction-1',
  value: JSON.stringify({ answers: { token: { answers: ['secret'] } } }),
});
await nativeTransport.abort('codex', { requestId: exactCodexRequest.requestId });
assert.deepEqual(
  nativeCalls.map((call) => call.command),
  ['codex_agent_execute', 'codex_agent_resume', 'codex_agent_answer', 'codex_agent_abort'],
  'production native transport must serialize execute, resume, answer, and Stop to Codex',
);
assert.equal(
  streamedEvents.length,
  2,
  'the injected production transport must preserve event channels',
);
for (const call of nativeCalls.slice(0, 2)) {
  const request = (call.args as { req: Record<string, unknown> }).req;
  for (const piOnlyField of [
    'skillPaths',
    'roster',
    'missionContextJson',
    'mcpTools',
    'directDelegation',
    'delegationLimits',
  ]) {
    assert.equal(request[piOnlyField], undefined, `${call.command} leaked ${piOnlyField}`);
  }
  assert.equal(request.runtimeModelRef, codexAuthorityA.runtimeModelRef);
}

const runtimeSource = source('../apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts');
const gatewayStart = runtimeSource.indexOf('class DesktopAgentRuntimeGateway');
const executeStart = runtimeSource.indexOf('  async execute(', gatewayStart);
const executeEnd = runtimeSource.indexOf('\n  generateText(', executeStart);
assert.ok(gatewayStart >= 0 && executeStart > gatewayStart && executeEnd > executeStart);
const gatewayExecute = runtimeSource.slice(executeStart, executeEnd);
assert.ok(
  gatewayExecute.indexOf('this.repos.agentRuns.findByThread(input.threadId)') <
    gatewayExecute.indexOf("invokeCommand('agent_runtime_status'"),
  'durable thread authority must be read before engine selection',
);
assert.match(gatewayExecute, /resolveAuthoritativeThreadExecutionAuthority/u);
assert.match(gatewayExecute, /planThreadExecutionSelection/u);
assert.match(gatewayExecute, /assertThreadExecutionLane/u);
assert.match(
  gatewayExecute,
  /selectionPlan\.requiresCatalog\s*\?\s*resolveRuntimeExecutionSelection/u,
  'durable continuation must bypass status/catalog resolution',
);
const gatewayReattachStart = runtimeSource.indexOf('  async reattachLiveRuns(', gatewayStart);
const gatewayReattachEnd = runtimeSource.indexOf('\n  async dispose(', gatewayReattachStart);
assert.ok(gatewayReattachStart > gatewayStart && gatewayReattachEnd > gatewayReattachStart);
const gatewayReattach = runtimeSource.slice(gatewayReattachStart, gatewayReattachEnd);
assert.match(
  gatewayReattach,
  /if \(!engineId \|\| !this\.adapters\.has\(engineId\)\) \{[\s\S]*?gatewayConfirmedMissingRootRunIds\.add\(row\.run_id\)/u,
  'startup recovery must settle missing and unknown engine roots instead of skipping them',
);
assert.match(
  gatewayReattach,
  /confirmedMissingRootRunIds = new Set\(\[[\s\S]*?gatewayConfirmedMissingRootRunIds/u,
  'gateway-owned recovery failures must reach the durable confirmed-missing reconciliation set',
);
const nativeTurnStart = runtimeSource.indexOf('  private async runNativeTurn(');
const nativeTurnEnd = runtimeSource.indexOf(
  '\n  private async persistRootTerminal(',
  nativeTurnStart,
);
assert.ok(nativeTurnStart >= 0 && nativeTurnEnd > nativeTurnStart);
const nativeTurn = runtimeSource.slice(nativeTurnStart, nativeTurnEnd);
assert.match(nativeTurn, /const nativeSessionMode = input\.nativeSessionMode === 'fresh'/u);
assert.match(
  nativeTurn,
  /if \(nativeSessionMode === 'tracked'\) \{[\s\S]*?this\.previousNativeSessionId/u,
  'only tracked turns may recover the prior opaque native continuation',
);
assert.match(nativeTurn, /else \{[\s\S]*?runtimeContext\.nativeSessionId = undefined/u);
assert.match(
  nativeTurn,
  /nativeSessionMode === 'tracked' && runtimeContext\.nativeSessionId[\s\S]*?\{ nativeSessionId: runtimeContext\.nativeSessionId \}/u,
);
assert.match(
  nativeTurn,
  /nativeSessionMode === 'fresh'[\s\S]*?nativeSessionResetSourceRunId: input\.nativeSessionResetSourceRunId/u,
);
assert.doesNotMatch(
  nativeTurn,
  /nativeSessionId:\s*runtimeContext\.nativeSessionId,\s*\n/u,
  'fresh recovery must not serialize the old opaque continuation unconditionally',
);
const codexRequestStart = nativeTurn.indexOf("if (this.engineId === 'codex')");
const apiRequestStart = nativeTurn.indexOf('} else {', codexRequestStart);
assert.ok(codexRequestStart >= 0 && apiRequestStart > codexRequestStart);
const codexRequestBranch = nativeTurn.slice(codexRequestStart, apiRequestStart);
for (const piOnlyField of [
  'skillPaths',
  'roster',
  'missionContextJson',
  'mcpTools',
  'directDelegation',
  'delegationLimits',
]) {
  assert.doesNotMatch(
    codexRequestBranch,
    new RegExp(`\\b${piOnlyField}\\b`, 'u'),
    `strict Codex request must omit Pi-only field ${piOnlyField}`,
  );
}
assert.match(codexRequestBranch, /CommandArgs<'codex_agent_execute'>/u);
assert.match(codexRequestBranch, /nativeSessionMode/u);
assert.match(codexRequestBranch, /runtimeModelRef: resolvedModel/u);

const enhanceSource = source(
  '../apps/desktop/renderer/src/assistant/enhance/tauri-enhance-transport.ts',
);
assert.match(enhanceSource, /resolveRuntimeExecutionSelection/u);
assert.match(
  enhanceSource,
  /opts\?\.threadId\s*\?\s*resolveThreadModel\(opts\.threadId\)\s*:\s*undefined/u,
  'thread Enhance must honor its exact selector while loop Enhance may use the live default',
);
assert.match(enhanceSource, /invokeCommand\('codex_agent_enhance', args\)/u);
assert.match(enhanceSource, /invokeCommand\('agent_runtime_enhance', args\)/u);
assert.match(enhanceSource, /invokeCommand\('codex_agent_abort', \{ requestId \}\)/u);
assert.match(enhanceSource, /invokeCommand\('agent_runtime_abort', \{ requestId \}\)/u);
assert.match(enhanceSource, /sourceProvenance,/u);
assert.match(enhanceSource, /assertSameExecutionAccount\(sourceProvenance, identity\)/u);
assert.match(enhanceSource, /assertSameExecutionAccount\(sourceProvenance, provenance\)/u);

const ackStart = enhanceSource.indexOf('const promise = (async (): Promise<void> =>');
const ackEnd = enhanceSource.indexOf('preparations.set(', ackStart);
const ackBody = enhanceSource.slice(ackStart, ackEnd);
assert.ok(ackStart >= 0 && ackEnd > ackStart);
assert.ok(
  ackBody.indexOf("if (engineId === 'codex') return") <
    ackBody.indexOf("invokeCommand('agent_runtime_confirm_execution'"),
  'Codex Enhance must not cross the Pi-only confirmation ACK',
);
assert.match(enhanceSource, /event\.kind === 'messageDelta'/u);
assert.match(enhanceSource, /opts\?\.onDelta\?\.\(event\.delta\)/u);
assert.match(enhanceSource, /signal\.addEventListener\('abort', onAbort/u);
assert.ok(
  enhanceSource.indexOf("signal.addEventListener('abort', onAbort") <
    enhanceSource.indexOf('await resolveThreadEnhanceTarget'),
  'Enhance cancellation must be armed before durable target resolution starts',
);
assert.ok(
  enhanceSource.lastIndexOf(
    'throwIfAborted();',
    enhanceSource.indexOf("invokeCommand('codex_agent_enhance'"),
  ) < enhanceSource.indexOf("invokeCommand('codex_agent_enhance'"),
  'Enhance must recheck cancellation immediately before the paid native invoke',
);
assert.match(enhanceSource, /if \(!requestClaimed \|\| !engineId\) return/u);
assert.match(enhanceSource, /const text = response\.text \|\| streamed/u);

const modelCatalogSource = source(
  '../apps/desktop/renderer/src/assistant/composer/usePiAgentModels.ts',
);
const modelStoreSource = source('../apps/desktop/renderer/src/runtime/pi-thread-model-store.ts');
const modelSelectorSource = source(
  '../apps/desktop/renderer/src/assistant/composer/ComposerSettingsMenu.tsx',
);
assert.doesNotMatch(modelCatalogSource, /pruneInvalidModels/u);
assert.doesNotMatch(modelStoreSource, /pruneInvalidModels/u);
assert.match(modelSelectorSource, /useThreadExecutionAuthority/u);
assert.match(modelSelectorSource, /option\.engineId === authority\.target\.engineId/u);
assert.match(modelSelectorSource, /option\.accountId === authority\.target\.accountId/u);
assert.match(modelSelectorSource, /option\.billingMode === authority\.target\.billingMode/u);
assert.match(modelSelectorSource, /reasoningLevels\.map/u);
assert.match(modelSelectorSource, /clearThreadThinking/u);
assert.match(modelSelectorSource, /Selected model unavailable · choose another/u);
assert.match(modelSelectorSource, /Selected model unavailable — reselect/u);
assert.match(modelSelectorSource, /Model catalog unavailable/u);
assert.match(modelSelectorSource, /Retry loading models/u);
assert.match(modelSelectorSource, /availabilityReason/u);
assert.match(modelSelectorSource, /Expires \$\{catalogDateLabel\(option\.expiresAt\)\}/u);

const commandSource = source('../apps/desktop/renderer/src/lib/tauri-commands.ts');
assert.match(commandSource, /interface CodexAgentExecuteRequest/u);
assert.match(
  commandSource,
  /codex_agent_execute:\s*CommandSpec<AgentRuntimeArgs<CodexAgentExecuteRequest>/u,
);
assert.match(commandSource, /agent_runtime_status: CommandSpec<\{ includeUsage\?: boolean \}/u);
const settingsSource = source('../apps/desktop/renderer/src/surfaces/settings/AiAccountsPane.tsx');
assert.match(settingsSource, /agent_runtime_status', \{ includeUsage: true \}/u);
assert.match(settingsSource, /model\.availabilityReason/u);
assert.match(settingsSource, /Expires \$\{checkedAtLabel\(model\.expiresAt\)\}/u);
assert.match(modelCatalogSource, /agent_runtime_status', \{ includeUsage: false \}/u);

const controllerSource = source(
  '../apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.ts',
);
const approvalBarSource = source(
  '../apps/desktop/renderer/src/assistant/parts/PermissionApprovalBar.tsx',
);
assert.match(controllerSource, /raw\.options == null \? \[\] : raw\.options/u);
assert.match(controllerSource, /source: 'agent-ui-request'/u);
assert.doesNotMatch(controllerSource, /agentName: 'pi-agent'/u);
assert.match(controllerSource, /questionIds: approval\.questions/u);
assert.match(controllerSource, /Never log the input object/u);
assert.match(approvalBarSource, /type=\{question\.isSecret \? 'password' : 'text'\}/u);
assert.match(approvalBarSource, /Do not log answer state/u);
assert.doesNotMatch(approvalBarSource, /Pi UI primitive/u);
assert.match(approvalBarSource, /isUserInput\s*\? 'Question'/u);
assert.match(approvalBarSource, /aria-live=\{isUserInput \? 'polite' : 'assertive'\}/u);
assert.match(approvalBarSource, /!isLeaseReview && !isUserInput/u);
assert.match(approvalBarSource, /approval\.message && !messageRepeatsQuestion/u);
assert.match(approvalBarSource, /role="radiogroup"/u);
assert.match(approvalBarSource, /type="radio"/u);
assert.match(approvalBarSource, /aria-checked=/u);
assert.match(approvalBarSource, /option\.description \? <small>/u);
assert.match(approvalBarSource, /continues automatically after/u);
assert.match(approvalBarSource, />\s*Skip\s*</u);
assert.doesNotMatch(approvalBarSource, />\s*Cancel\s*</u);

const officeCssSource = source('../apps/desktop/renderer/src/surfaces/office/office.css');
const settingsCssSource = source('../apps/desktop/renderer/src/surfaces/settings/settings.css');
assert.match(officeCssSource, /\.off-permission-bar\.is-question/u);
assert.match(officeCssSource, /\.off-permission-option-copy small/u);
assert.match(settingsCssSource, /@media \(max-width: 1180px\)/u);
assert.match(
  settingsCssSource,
  /\.off-set-account-usage-grid strong \{[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: normal;/u,
);

const skillsSource = source('../apps/desktop/renderer/src/surfaces/personnel/SkillsTab.tsx');
const boardStageSource = source(
  '../apps/desktop/renderer/src/surfaces/office/board/BoardStage.tsx',
);
assert.doesNotMatch(skillsSource, /Injected into Pi runtime/u);
assert.doesNotMatch(boardStageSource, /completed by Pi/u);
assert.match(runtimeSource, /AGENT_UI_REQUEST_RESOLVED_EVENT/u);
assert.doesNotMatch(runtimeSource, /pi_tool_failed/u);

console.log('renderer engine authority gate OK');
