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

const desktopRuntimeSource = source(
  '../apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts',
);
const codexProtocolSource = source('../apps/desktop/src-tauri/src/codex_agent_host/protocol.rs');
assert.doesNotMatch(
  desktopRuntimeSource,
  /runtimeVersion:\s*['"]0\.144\.4['"]/u,
  'renderer must not publish a fixed Codex CLI runtime version',
);
assert.match(
  codexProtocolSource,
  /CODEX_ADAPTER_VERSION:\s*&str\s*=\s*env!\("CARGO_PKG_VERSION"\)/u,
  'Codex adapter version must identify the Offisim adapter build',
);
assert.match(
  codexProtocolSource,
  /runtime_user_agent/u,
  'Codex initialize userAgent must be retained separately from adapter version',
);

const codexTarget: AiExecutionTarget = {
  engineId: 'codex',
  accountId: 'codex:local',
  billingMode: 'subscription',
  modelId: 'engine-managed',
  modelSource: { kind: 'native' },
};
const codexAuthority = { target: codexTarget, runtimeModelRef: 'codex' };
const codexExplicitTarget: AiExecutionTarget = {
  ...codexTarget,
  modelId: 'gpt-5.6-sol',
};
const codexExplicitAuthority = {
  target: codexExplicitTarget,
  runtimeModelRef: 'codex:gpt-5.6-sol',
};

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
      root('newest-unprepared', '2026-07-17T02:00:00Z', undefined, 'openai/gpt-5.6-sol'),
    ],
    'company-1',
  ),
  codexAuthority,
  'latest durable root must freeze the orchestration engine, not a model preset',
);
assert.deepEqual(
  resolveAuthoritativeThreadExecutionAuthority(
    [root('codex-actual-model', '2026-07-17T03:00:00Z', codexTarget, 'openai/gpt-5.6-sol')],
    'company-1',
  ),
  codexAuthority,
  'engine-reported Codex model diagnostics must not replace the engine-owned selector',
);
assert.deepEqual(
  resolveAuthoritativeThreadExecutionAuthority(
    [
      root(
        'codex-explicit-model',
        '2026-07-17T03:30:00Z',
        codexExplicitTarget,
        'codex:gpt-5.6-sol',
      ),
    ],
    'company-1',
  ),
  codexExplicitAuthority,
  'an explicit native model must remain part of durable execution authority',
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
  attachmentInput: { textFiles: true, images: 'supported' as const },
  permissionModes: ['plan', 'ask', 'auto', 'full'] as const,
  interactions: { approval: true, userInput: true },
  interactionRoutes: {
    browser: [
      {
        id: 'offisim-browser',
        source: 'offisim-local' as const,
        label: 'Offisim Browser',
        availability: 'available' as const,
      },
    ],
    computer: [
      {
        id: 'offisim-computer',
        source: 'offisim-local' as const,
        label: 'Offisim Computer Use',
        availability: 'runtime-determined' as const,
      },
    ],
  },
  processEvents: { reasoning: true, toolCalls: true, fileChanges: true },
  pace: { speedReport: 'unreported' },
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
      runOptions: {
        models: [
          {
            id: 'gpt-5.6-sol',
            displayName: 'GPT-5.6 Sol',
            isDefault: true,
            reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
            defaultReasoningEffort: 'medium',
            speedModes: ['standard', 'fast'],
          },
        ],
        sourceUrl: 'https://learn.chatgpt.com/docs/config-file/config-reference',
        checkedAt: '2026-07-24',
      },
    },
  ],
};
assert.deepEqual(
  resolveRuntimeExecutionSelection(runtimeStatus, {
    kind: 'orchestration-engine',
    engineId: 'codex',
  }),
  codexAuthority,
);
assert.deepEqual(
  resolveRuntimeExecutionSelection(runtimeStatus, undefined, codexTarget, 'codex'),
  codexAuthority,
);
assert.deepEqual(
  resolveRuntimeExecutionSelection(runtimeStatus, {
    kind: 'orchestration-engine',
    engineId: 'codex',
    modelId: 'gpt-5.6-sol',
  }),
  codexExplicitAuthority,
);
assert.deepEqual(
  resolveRuntimeExecutionSelection(
    runtimeStatus,
    undefined,
    codexExplicitTarget,
    'codex:gpt-5.6-sol',
  ),
  codexExplicitAuthority,
);
const openRouterTarget: AiExecutionTarget = {
  engineId: 'api',
  accountId: 'api:openrouter-free:0123456789abcdef',
  billingMode: 'api',
  modelId: 'cohere/north-mini-code:free',
  modelSource: {
    kind: 'official-api',
    sourceUrl: 'https://openrouter.ai/models/cohere/north-mini-code:free',
    checkedAt: '2026-07-17T00:00:00Z',
  },
};
const openRouterSelection = resolveRuntimeExecutionSelection(
  {
    checkedAt: '2026-07-17T00:00:00Z',
    orchestrationEngines: [],
    accounts: [
      {
        engineId: 'api',
        accountId: openRouterTarget.accountId,
        billingMode: 'api',
        displayName: 'OpenRouter Free',
        status: 'available',
        capabilities: {
          execute: { status: 'available' },
          models: { status: 'available' },
          usage: { status: 'available' },
          cost: { status: 'available' },
        },
      },
    ],
    models: [
      {
        ...openRouterTarget,
        displayName: 'North Mini Code Free',
        runtimeModelRef: 'openrouter-free/cohere/north-mini-code:free',
        availability: 'available',
        capabilities: { textInput: true, imageInput: false, tools: true, reasoning: false },
        source: openRouterTarget.modelSource,
      },
    ],
  } satisfies AiRuntimeStatus,
  undefined,
  undefined,
);
assert.deepEqual(openRouterSelection, {
  target: openRouterTarget,
  runtimeModelRef: 'openrouter-free/cohere/north-mini-code:free',
});
const apiModelNamedCodexStatus: AiRuntimeStatus = {
  checkedAt: '2026-07-17T00:00:00Z',
  orchestrationEngines: [],
  accounts: [
    {
      engineId: 'api',
      accountId: openRouterTarget.accountId,
      billingMode: 'api',
      displayName: 'API account',
      status: 'available',
      capabilities: {
        execute: { status: 'available' },
        models: { status: 'available' },
        usage: { status: 'available' },
        cost: { status: 'available' },
      },
    },
  ],
  models: [
    {
      ...openRouterTarget,
      modelId: 'codex',
      displayName: 'API model named Codex',
      runtimeModelRef: 'api-provider/codex',
      availability: 'available',
      capabilities: { textInput: true, imageInput: false, tools: true, reasoning: false },
      source: openRouterTarget.modelSource,
    },
  ],
};
assert.throws(
  () =>
    resolveRuntimeExecutionSelection(apiModelNamedCodexStatus, {
      kind: 'orchestration-engine',
      engineId: 'codex',
    }),
  /orchestration engine is unavailable/u,
  'an unavailable Codex engine selector must never fall through to an API model named codex',
);
assert.equal(
  resolveRuntimeExecutionSelection(apiModelNamedCodexStatus, {
    kind: 'api-model',
    runtimeModelRef: 'api-provider/codex',
  }).target.engineId,
  'api',
  'the API model remains selectable only through an explicit API selector',
);
assert.deepEqual(
  resolveAuthoritativeThreadExecutionAuthority(
    [
      root(
        'api-selector',
        '2026-07-17T04:00:00Z',
        openRouterTarget,
        'openrouter-free/cohere/north-mini-code:free',
      ),
    ],
    'company-1',
  ),
  {
    target: openRouterTarget,
    runtimeModelRef: 'openrouter-free/cohere/north-mini-code:free',
  },
  'API tasks must preserve the exact catalog selector stored in the run context',
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
  for (const engineManaged of [
    'model',
    'runtimeModelRef',
    'thinkingLevel',
    'serviceTier',
    'effort',
    'speedMode',
  ]) {
    assert.equal(
      payload[engineManaged],
      undefined,
      `${call.command} leaked engine-managed field ${engineManaged}`,
    );
  }
  for (const piOnly of [
    'skillPaths',
    'roster',
    'missionContextJson',
    'mcpTools',
    'directDelegation',
  ]) {
    assert.equal(payload[piOnly], undefined, `${call.command} leaked ${piOnly}`);
  }
}

const rendererCommandContract = source('../apps/desktop/renderer/src/lib/tauri-commands.ts');
const rustCommandContract = source('../apps/desktop/src-tauri/src/codex_agent_host/types.rs');
const rendererFields = rendererCommandContract
  .match(/interface CodexAgentExecuteRequest \{(?<body>[\s\S]*?)\n\}/u)
  ?.groups?.body.match(/^\s{2}[a-zA-Z][a-zA-Z0-9]*\??:/gmu)
  ?.map((field) => field.trim().replace(/[?:].*$/u, ''))
  .sort();
const rustFields = rustCommandContract
  .match(/pub struct CodexAgentExecuteRequest \{(?<body>[\s\S]*?)\n\}/u)
  ?.groups?.body.match(/^\s{4}pub [a-z_]+:/gmu)
  ?.map((field) =>
    field
      .trim()
      .slice(4, -1)
      .replace(/_([a-z])/gu, (_match, letter: string) => letter.toUpperCase()),
  )
  .sort();
assert.ok(rendererFields && rustFields, 'Codex execute request contracts must be parseable');
assert.deepEqual(
  rendererFields,
  rustFields,
  'renderer and Rust Codex execute request fields must stay in lockstep',
);

const runtimeSource = source('../apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts');
const executionSelectionSource = source(
  '../apps/desktop/renderer/src/runtime/execution-selection.ts',
);
const terminalCheckpointSource = source(
  '../apps/desktop/renderer/src/runtime/terminal-checkpoint.ts',
);
assert.match(runtimeSource, /readonly capabilities: RuntimeEngineCapabilityManifest/u);
assert.match(runtimeSource, /getEngineCapabilities\(engineId: string\)/u);
assert.match(runtimeSource, /context\?\.requestId !== answer\.requestId/u);
assert.match(runtimeSource, /context\.executionTarget\?\.engineId/u);
assert.doesNotMatch(runtimeSource, /adapters\.size\s*!==\s*1/u);
assert.match(terminalCheckpointSource, /TERMINAL_CHECKPOINT_MAX_RETRIES = 3/u);
assert.doesNotMatch(
  terminalCheckpointSource.match(
    /async function retryTerminalCheckpointUntilDurable\([\s\S]*?\n\}/u,
  )?.[0] ?? '',
  /for \(;;\)/u,
  'terminal checkpoint persistence must have a bounded retry plan',
);
assert.doesNotMatch(
  runtimeSource,
  /buildMcpScope\([\s\S]{0,240}?\.catch\(/u,
  'MCP scope resolution must fail visibly before provider side effects',
);
assert.doesNotMatch(
  runtimeSource,
  /resolveRuntimeExecutionSelection\([\s\S]{0,360}?catch\s*\{\s*return \[\];/u,
  'same-lane roster selector failures must not silently remove an employee',
);
assert.match(
  executionSelectionSource,
  /const ENGINE_MANAGED_MODEL_ID = 'engine-managed'[\s\S]*modelId = ENGINE_MANAGED_MODEL_ID/u,
);
assert.match(executionSelectionSource, /modelSource: \{ kind: 'native' \}/u);

const composerSource = source(
  '../apps/desktop/renderer/src/assistant/composer/ComposerSettingsMenu.tsx',
);
assert.match(composerSource, /effective\?\.capabilities\.permissionModes/u);
assert.match(composerSource, /selectionKind === 'orchestration-engine'/u);
assert.match(composerSource, /supportsReasoning \?/u);
assert.match(composerSource, /showPermissionMode \?/u);

const settingsSource = source('../apps/desktop/renderer/src/surfaces/settings/AiAccountsPane.tsx');
assert.match(settingsSource, /Subscription engines/u);
assert.match(settingsSource, /API providers/u);
assert.ok(
  settingsSource.indexOf('<CapsLabel>Subscription engines</CapsLabel>') <
    settingsSource.indexOf('<CapsLabel>API providers</CapsLabel>'),
  'subscription engines must precede self-managed API providers',
);
assert.match(settingsSource, /off-set-provider-overview-row is-merged/u);
assert.doesNotMatch(settingsSource, /<CapsLabel>API account activity<\/CapsLabel>/iu);
assert.match(settingsSource, /engine\.loginCommand/u);
assert.match(settingsSource, /new URL\(engine\.docsUrl\)/u);
assert.match(settingsSource, /No API cost|无 API 成本/iu);
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

const runtimeTabSource = source('../apps/desktop/renderer/src/surfaces/personnel/RuntimeTab.tsx');
const personnelSource = [
  source('../apps/desktop/renderer/src/surfaces/personnel/PersonnelSurface.tsx'),
  source('../apps/desktop/renderer/src/surfaces/personnel/EmployeeDetail.tsx'),
  source('../apps/desktop/renderer/src/surfaces/personnel/HireEmployeeDialog.tsx'),
].join('\n');
assert.match(runtimeTabSource, /<span>Employee AI<\/span>/u);
assert.match(runtimeTabSource, /const supportsReasoning = selectedOption\?\.reasoning === true/u);
assert.match(runtimeTabSource, /\{supportsReasoning \? \(/u);
assert.doesNotMatch(runtimeTabSource, /disabled=\{!model \|\| invalid \|\| !supportsReasoning\}/u);
assert.match(personnelSource, /selectedRuntime\?\.selectionKind === 'orchestration-engine'/u);
assert.match(personnelSource, /thinking_level: model && thinkingLevel/u);
assert.match(personnelSource, /thinking_level: model && supportsReasoning && thinkingLevel/u);
assert.match(personnelSource, /\{supportsReasoning \? \(/u);

console.log('renderer engine authority gate OK');
