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
    },
  ],
  sourceUrl: 'https://learn.chatgpt.com/docs/config-file/config-reference',
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
const notSignedIn = orchestrationEngine('claude', 'not-signed-in', {
  statusReason: 'Sign in first.',
});
const notInstalled = orchestrationEngine('missing-engine', 'not-installed', {
  statusReason: 'Install the CLI.',
});
const unavailable = orchestrationEngine('unavailable-engine', 'unavailable', {
  statusReason: 'Status inspection failed.',
});

const readyOnlyOptions = projectRunnableModelOptions(runtimeStatus([ready]), 0);
const allStatesOptions = projectRunnableModelOptions(
  runtimeStatus([ready, notSignedIn, notInstalled, unavailable]),
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
    engineId: option.engineId,
    modelId: option.modelId,
    reasoningEfforts: option.reasoningEfforts,
  })),
  [
    {
      selectionKind: 'api-model',
      engineId: 'api',
      modelId: 'fixture-model',
      reasoningEfforts: [],
    },
    {
      selectionKind: 'orchestration-engine',
      engineId: 'codex',
      modelId: 'engine-managed',
      reasoningEfforts: [],
    },
  ],
);

const directory = projectOrchestrationEngineDirectory(
  runtimeStatus([ready, notSignedIn, notInstalled, unavailable]),
);
assert.deepEqual(
  directory.map((entry) => [entry.engineId, entry.state]),
  [
    ['codex', 'ready'],
    ['claude', 'not-signed-in'],
    ['missing-engine', 'not-installed'],
    ['unavailable-engine', 'unavailable'],
  ],
);
assert.equal(directory[0]?.displayName, 'codex display');
assert.equal(directory[0]?.loginCommand, 'codex login');
assert.deepEqual(directory[0]?.runOptions, runOptions);
assert.equal(directory[1]?.statusReason, 'Sign in first.');
assert.equal(directory[2]?.statusReason, 'Install the CLI.');
assert.equal(directory[3]?.statusReason, 'Status inspection failed.');
assert.deepEqual(directory[0]?.runOptions?.models[0], {
  id: 'gpt-5.6-sol',
  displayName: 'GPT-5.6 Sol',
  isDefault: true,
  reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  defaultReasoningEffort: 'medium',
  speedModes: ['standard', 'fast'],
});

console.log('Runtime model picker and orchestration directory harness passed.');
