import assert from 'node:assert/strict';
import type {
  AiRuntimeStatus,
  OrchestrationEngineRunOptions,
  OrchestrationEngineState,
  OrchestrationEngineStatus,
  RuntimeEngineCapabilityManifest,
} from '@offisim/shared-types';
import {
  projectOrchestrationEngineDirectory,
  projectRunnableModelOptions,
} from '../apps/desktop/renderer/src/assistant/composer/usePiAgentModels.js';

const capabilities: RuntimeEngineCapabilityManifest = {
  stop: true,
  steer: false,
  resume: true,
  attachmentInput: { textFiles: true, images: 'supported' },
  permissionModes: ['plan', 'ask', 'auto', 'full'],
  interactions: { approval: true, userInput: true },
  processEvents: { reasoning: true, toolCalls: true, fileChanges: true },
  pace: { speedReport: 'unreported' },
  interactionRoutes: {
    browser: [],
    computer: [],
  },
};

const runOptions: OrchestrationEngineRunOptions = {
  models: [
    {
      id: 'gpt-5.6-sol',
      displayName: 'GPT-5.6 Sol',
      isDefault: true,
      reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium',
      speedModes: ['standard', 'fast'],
      fastModeNote: 'Uses extra subscription capacity.',
      note: 'Default Codex model',
    },
    {
      id: 'gpt-5.4-mini',
      displayName: 'GPT-5.4 Mini',
      reasoningEfforts: ['minimal', 'low', 'medium', 'high'],
      defaultReasoningEffort: 'low',
      speedModes: ['standard'],
      note: 'Compact',
    },
  ],
  sourceUrl: 'https://learn.chatgpt.com/docs/config-file/config-reference',
  checkedAt: '2026-07-24',
};

const claudeRunOptions: OrchestrationEngineRunOptions = {
  models: [
    {
      id: 'sonnet',
      displayName: 'Sonnet (claude-sonnet-5)',
      isDefault: true,
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      speedModes: ['standard'],
    },
    {
      id: 'opus',
      displayName: 'Opus (claude-opus-4-8)',
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      speedModes: ['standard', 'fast'],
      fastModeNote: 'Fast mode bills usage credits beyond your subscription',
    },
    {
      id: 'haiku',
      displayName: 'Haiku (claude-haiku-4-5)',
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      speedModes: ['standard'],
    },
    {
      id: 'fable',
      displayName: 'Fable (claude-fable-5)',
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      speedModes: ['standard'],
    },
  ],
  sourceUrl: 'https://code.claude.com/docs/en/cli-reference',
  checkedAt: '2026-07-24',
};

function orchestrationEngine(
  engineId: string,
  state: OrchestrationEngineState,
  extras: Partial<OrchestrationEngineStatus> = {},
): OrchestrationEngineStatus {
  return {
    engineId,
    displayName: `${engineId} display`,
    state,
    loginCommand: `${engineId} login`,
    docsUrl: `https://example.invalid/${engineId}`,
    checkedAt: '2026-07-24T00:00:00Z',
    capabilities,
    ...extras,
  };
}

function runtimeStatus(
  orchestrationEngines: readonly OrchestrationEngineStatus[],
): AiRuntimeStatus {
  return {
    accounts: [
      {
        engineId: 'api',
        accountId: 'api:fixture',
        billingMode: 'api',
        displayName: 'Fixture API',
        status: 'available',
        capabilities: {
          execute: { status: 'available' },
          models: { status: 'available' },
          usage: { status: 'unavailable', reason: 'Fixture omits usage.' },
          cost: { status: 'unavailable', reason: 'Fixture omits cost.' },
        },
      },
    ],
    models: [
      {
        engineId: 'api',
        accountId: 'api:fixture',
        billingMode: 'api',
        modelId: 'fixture-model',
        displayName: 'Fixture Model',
        runtimeModelRef: 'fixture:model',
        availability: 'available',
        capabilities: {
          textInput: true,
          imageInput: false,
          tools: true,
          reasoning: false,
        },
      },
    ],
    orchestrationEngines,
    checkedAt: '2026-07-24T00:00:00Z',
  };
}

const ready = orchestrationEngine('codex', 'ready', { runOptions });
const readyClaude = orchestrationEngine('claude', 'ready', { runOptions: claudeRunOptions });
const notSignedIn = orchestrationEngine('claude-pending', 'not-signed-in', {
  statusReason: 'Sign in first.',
});
const notInstalled = orchestrationEngine('missing-engine', 'not-installed', {
  statusReason: 'Install the CLI.',
});
const unavailable = orchestrationEngine('unavailable-engine', 'unavailable', {
  statusReason: 'Status inspection failed.',
});

const readyOnlyOptions = projectRunnableModelOptions(runtimeStatus([ready, readyClaude]), 0);
const allStatesOptions = projectRunnableModelOptions(
  runtimeStatus([ready, readyClaude, notSignedIn, notInstalled, unavailable]),
  0,
);
assert.deepEqual(
  allStatesOptions,
  readyOnlyOptions,
  'non-ready orchestration engines must not change runnable model data',
);
assert.deepEqual(
  allStatesOptions.map((option) => ({
    selectionKind: option.selectionKind,
    value: option.value,
    name: option.name,
    engineId: option.engineId,
    modelId: option.modelId,
    reasoning: option.reasoning,
    reasoningEfforts: option.reasoningEfforts,
    defaultReasoningEffort: option.defaultReasoningEffort,
    speedModes: option.speedModes,
    fastModeNote: option.fastModeNote,
    note: option.note,
  })),
  [
    {
      selectionKind: 'api-model',
      value: 'api-model:fixture:model',
      name: 'Fixture Model',
      engineId: 'api',
      modelId: 'fixture-model',
      reasoning: false,
      reasoningEfforts: [],
      defaultReasoningEffort: undefined,
      speedModes: ['standard'],
      fastModeNote: undefined,
      note: undefined,
    },
    {
      selectionKind: 'orchestration-engine',
      value: 'orchestration-engine:codex',
      name: 'Engine default',
      engineId: 'codex',
      modelId: 'engine-managed',
      reasoning: true,
      reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium',
      speedModes: ['standard', 'fast'],
      fastModeNote: 'Uses extra subscription capacity.',
      note: 'Default Codex model',
    },
    {
      selectionKind: 'orchestration-engine',
      value: 'orchestration-engine:codex:gpt-5.6-sol',
      name: 'GPT-5.6 Sol',
      engineId: 'codex',
      modelId: 'gpt-5.6-sol',
      reasoning: true,
      reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium',
      speedModes: ['standard', 'fast'],
      fastModeNote: 'Uses extra subscription capacity.',
      note: 'Default Codex model',
    },
    {
      selectionKind: 'orchestration-engine',
      value: 'orchestration-engine:codex:gpt-5.4-mini',
      name: 'GPT-5.4 Mini',
      engineId: 'codex',
      modelId: 'gpt-5.4-mini',
      reasoning: true,
      reasoningEfforts: ['minimal', 'low', 'medium', 'high'],
      defaultReasoningEffort: 'low',
      speedModes: ['standard'],
      fastModeNote: undefined,
      note: 'Compact',
    },
    {
      selectionKind: 'orchestration-engine',
      value: 'orchestration-engine:claude',
      name: 'Engine default',
      engineId: 'claude',
      modelId: 'engine-managed',
      reasoning: true,
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningEffort: undefined,
      speedModes: ['standard'],
      fastModeNote: undefined,
      note: undefined,
    },
    {
      selectionKind: 'orchestration-engine',
      value: 'orchestration-engine:claude:sonnet',
      name: 'Sonnet (claude-sonnet-5)',
      engineId: 'claude',
      modelId: 'sonnet',
      reasoning: true,
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningEffort: undefined,
      speedModes: ['standard'],
      fastModeNote: undefined,
      note: undefined,
    },
    {
      selectionKind: 'orchestration-engine',
      value: 'orchestration-engine:claude:opus',
      name: 'Opus (claude-opus-4-8)',
      engineId: 'claude',
      modelId: 'opus',
      reasoning: true,
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningEffort: undefined,
      speedModes: ['standard', 'fast'],
      fastModeNote: 'Fast mode bills usage credits beyond your subscription',
      note: undefined,
    },
    {
      selectionKind: 'orchestration-engine',
      value: 'orchestration-engine:claude:haiku',
      name: 'Haiku (claude-haiku-4-5)',
      engineId: 'claude',
      modelId: 'haiku',
      reasoning: true,
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningEffort: undefined,
      speedModes: ['standard'],
      fastModeNote: undefined,
      note: undefined,
    },
    {
      selectionKind: 'orchestration-engine',
      value: 'orchestration-engine:claude:fable',
      name: 'Fable (claude-fable-5)',
      engineId: 'claude',
      modelId: 'fable',
      reasoning: true,
      reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningEffort: undefined,
      speedModes: ['standard'],
      fastModeNote: undefined,
      note: undefined,
    },
  ],
);

assert.deepEqual(
  projectRunnableModelOptions(
    runtimeStatus([
      orchestrationEngine('codex', 'ready', {
        runOptions: {
          ...runOptions,
          models: runOptions.models.map((model) => ({ ...model, isDefault: true })),
        },
      }),
    ]),
    0,
  ).map((option) => option.engineId),
  ['api'],
  'duplicate orchestration defaults must fail closed',
);
assert.deepEqual(
  projectRunnableModelOptions(
    runtimeStatus([
      orchestrationEngine('codex', 'ready', {
        runOptions: {
          ...runOptions,
          models: runOptions.models.map(({ isDefault: _isDefault, ...model }) => model),
        },
      }),
    ]),
    0,
  ).map((option) => option.engineId),
  ['api'],
  'missing orchestration defaults must fail closed',
);

const directory = projectOrchestrationEngineDirectory(
  runtimeStatus([ready, readyClaude, notSignedIn, notInstalled, unavailable]),
);
assert.deepEqual(
  directory.map((entry) => [entry.engineId, entry.state]),
  [
    ['codex', 'ready'],
    ['claude', 'ready'],
    ['claude-pending', 'not-signed-in'],
    ['missing-engine', 'not-installed'],
    ['unavailable-engine', 'unavailable'],
  ],
);
assert.equal(directory[0]?.displayName, 'codex display');
assert.equal(directory[0]?.loginCommand, 'codex login');
assert.deepEqual(directory[0]?.runOptions, runOptions);
assert.deepEqual(directory[1]?.runOptions, claudeRunOptions);
assert.equal(directory[2]?.statusReason, 'Sign in first.');
assert.equal(directory[3]?.statusReason, 'Install the CLI.');
assert.equal(directory[4]?.statusReason, 'Status inspection failed.');
assert.deepEqual(directory[0]?.runOptions?.models[0], {
  id: 'gpt-5.6-sol',
  displayName: 'GPT-5.6 Sol',
  isDefault: true,
  reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  defaultReasoningEffort: 'medium',
  speedModes: ['standard', 'fast'],
  fastModeNote: 'Uses extra subscription capacity.',
  note: 'Default Codex model',
});

console.log('Runtime model picker and orchestration directory harness passed.');
