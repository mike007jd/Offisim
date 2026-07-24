import assert from 'node:assert/strict';
import type {
  AiRuntimeStatus,
  OrchestrationEngineRunOptions,
  OrchestrationEngineState,
  OrchestrationEngineStatus,
  RuntimeEngineCapabilityManifest,
} from '@offisim/shared-types';
import { planConversationRunDefaultSeed } from '../apps/desktop/renderer/src/assistant/composer/composer-default-seeding.js';
import { resolveComposerDefaultOption } from '../apps/desktop/renderer/src/assistant/composer/composer-default-selection.js';
import { orderComposerModelGroups } from '../apps/desktop/renderer/src/assistant/composer/composer-model-filter.js';
import {
  projectOrchestrationEngineDirectory,
  projectRunnableModelOptions,
} from '../apps/desktop/renderer/src/assistant/composer/usePiAgentModels.js';
import type { AgentRuntimeModelOption } from '../apps/desktop/renderer/src/assistant/composer/usePiAgentModels.js';
import {
  canSeedConversationRunDefaults,
  normalizeTargetRunDefaults,
} from '../apps/desktop/renderer/src/runtime/conversation-target-defaults-store.js';
import { declaredReasoningEffort } from '../apps/desktop/renderer/src/runtime/execution-selection.js';

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

// A drifted declaration (wrong shapes from the untyped Rust/sidecar producers)
// must degrade to "undeclared" — engine expansion drops, directory keeps the
// engine without runOptions — instead of crashing projections downstream.
const malformedRunOptions = {
  ...runOptions,
  models: [
    ...runOptions.models,
    { id: 'gpt-broken', displayName: 'Broken', reasoningEfforts: 'high', speedModes: ['standard'] },
  ],
} as unknown as OrchestrationEngineRunOptions;
assert.deepEqual(
  projectRunnableModelOptions(
    runtimeStatus([orchestrationEngine('codex', 'ready', { runOptions: malformedRunOptions })]),
    0,
  ).map((option) => option.engineId),
  ['api'],
  'a drifted run-option declaration must drop the engine expansion, not crash the picker',
);
const malformedDirectory = projectOrchestrationEngineDirectory(
  runtimeStatus([orchestrationEngine('codex', 'ready', { runOptions: malformedRunOptions })]),
);
assert.equal(malformedDirectory[0]?.state, 'ready', 'the engine itself stays listed');
assert.equal(
  malformedDirectory[0]?.runOptions,
  undefined,
  'a drifted declaration projects as undeclared',
);

// Delegated runs may inherit thinking levels from other lanes or stale employee
// settings; only efforts the resolved model declares survive to the engine.
const effortStatus = runtimeStatus([ready]);
assert.equal(declaredReasoningEffort(effortStatus, 'codex', 'gpt-5.6-sol', 'xhigh'), 'xhigh');
assert.equal(declaredReasoningEffort(effortStatus, 'codex', 'engine-managed', 'high'), 'high');
assert.equal(
  declaredReasoningEffort(effortStatus, 'codex', 'gpt-5.4-mini', 'xhigh'),
  undefined,
  'an effort the resolved model does not declare degrades to engine default',
);
assert.equal(
  declaredReasoningEffort(effortStatus, 'codex', 'gpt-5.6-sol', 'off'),
  undefined,
  "another lane's thinking vocabulary (Pi `off`) must not reach the engine",
);
assert.equal(declaredReasoningEffort(effortStatus, 'codex', 'gpt-5.6-sol', undefined), undefined);
assert.equal(
  declaredReasoningEffort(undefined, 'codex', 'gpt-5.6-sol', 'high'),
  undefined,
  'missing status degrades to engine default instead of passing an unvalidated effort',
);

// ---------------------------------------------------------------------------
// Composer pure-function contracts (default selection, group ordering, seed
// gates, and target-defaults normalization).
// ---------------------------------------------------------------------------

function composerOption(
  overrides: Partial<AgentRuntimeModelOption> & { value: string; modelId: string },
): AgentRuntimeModelOption {
  return {
    selectionKind: 'api-model',
    name: overrides.modelId,
    accountName: 'Fixture API',
    accountId: 'api:fixture',
    engineId: 'api',
    billingMode: 'api',
    availability: 'available',
    reasoning: false,
    reasoningEfforts: [],
    speedModes: ['standard'],
    capabilities,
    ...overrides,
  };
}

// composer-default-selection: a preferred selector hit wins; a miss falls back
// to the first available model; nothing available means no default.
const defaultPickList = [
  composerOption({ value: 'api-model:fixture:alpha', modelId: 'alpha' }),
  composerOption({ value: 'api-model:fixture:beta', modelId: 'beta', availability: 'expiring' }),
];
assert.equal(
  resolveComposerDefaultOption(defaultPickList, ['api-model:fixture:beta'])?.modelId,
  'beta',
  'a preferred selector hit must win over the availability fallback',
);
assert.equal(
  resolveComposerDefaultOption(defaultPickList, ['api-model:fixture:missing'])?.modelId,
  'alpha',
  'a missed selector falls back to the first available model',
);
assert.equal(
  resolveComposerDefaultOption(
    [
      composerOption({
        value: 'api-model:fixture:beta',
        modelId: 'beta',
        availability: 'expiring',
      }),
    ],
    [],
  ),
  undefined,
  'no available model means no default option',
);
assert.equal(resolveComposerDefaultOption([], ['api-model:fixture:alpha']), undefined);

// orderComposerModelGroups: the effective lane pins to the top; only a `:free`
// modelId suffix sinks into the collapsed free group — an expiring *paid*
// model stays a regular item.
const paidExpiring = composerOption({
  value: 'api-model:fixture:paid-expiring',
  modelId: 'paid-expiring',
  availability: 'expiring',
});
const freeModel = composerOption({
  value: 'api-model:fixture:tiny:free',
  modelId: 'tiny:free',
});
const regularModel = composerOption({
  value: 'api-model:fixture:regular',
  modelId: 'regular',
});
const effectiveLaneModel = composerOption({
  value: 'api-model:fixture:effective',
  modelId: 'effective',
});
const unorderedGroups = new Map([
  ['lane-other', { account: 'Other', items: [paidExpiring, freeModel, regularModel] }],
  ['lane-effective', { account: 'Effective', items: [effectiveLaneModel] }],
]);
const orderedGroups = orderComposerModelGroups(unorderedGroups, 'lane-effective', false);
assert.deepEqual(
  orderedGroups.map((group) => group.laneKey),
  ['lane-effective', 'lane-other'],
  'the effective lane must sort to the top',
);
assert.deepEqual(
  orderedGroups[1]?.regularItems.map((option) => option.modelId),
  ['paid-expiring', 'regular'],
  'an expiring paid model must stay in the regular group',
);
assert.deepEqual(
  orderedGroups[1]?.freeItems.map((option) => option.modelId),
  ['tiny:free'],
  'only `:free`-suffixed models sink into the free group',
);
const preservedGroups = orderComposerModelGroups(unorderedGroups, 'lane-effective', true);
assert.deepEqual(
  preservedGroups.map((group) => group.laneKey),
  ['lane-other', 'lane-effective'],
  'a locked thread preserves lane order and skips the free split',
);
assert.deepEqual(preservedGroups[0]?.freeItems, []);

// Seed gate: only an explicitly fetched `null` authority with a catalog opens
// seeding; unfetched and durable authorities stay closed.
assert.equal(
  canSeedConversationRunDefaults({ authorityIsFetched: false, authority: null, hasCatalog: true }),
  false,
  'an unfetched authority must not seed',
);
assert.equal(
  canSeedConversationRunDefaults({
    authorityIsFetched: true,
    authority: { target: 'durable' },
    hasCatalog: true,
  }),
  false,
  'a durable authority must not seed',
);
assert.equal(
  canSeedConversationRunDefaults({ authorityIsFetched: true, authority: null, hasCatalog: false }),
  false,
  'an empty catalog must not seed',
);
assert.equal(
  canSeedConversationRunDefaults({ authorityIsFetched: true, authority: null, hasCatalog: true }),
  true,
);

// planConversationRunDefaultSeed: a stale target model skips only the model
// axis; a stale existing thread selector resolves no landing model at all.
const seedOptions = [
  composerOption({
    value: 'api-model:fixture:alpha',
    modelId: 'alpha',
    reasoningEfforts: ['low', 'high'],
    speedModes: ['standard', 'fast'],
  }),
];
const seedFlags = {
  hasModelPick: false,
  hasThinkingPick: false,
  hasSpeedPick: false,
  hasModePick: false,
} as const;
assert.deepEqual(
  planConversationRunDefaultSeed({
    options: seedOptions,
    targetDefaults: {
      model: 'api-model:fixture:gone',
      thinking: 'high',
      speed: 'fast',
      mode: 'plan',
    },
    defaultModelSelector: undefined,
    existingModelValue: undefined,
    ...seedFlags,
  }),
  { thinking: 'high', speed: 'fast', mode: 'plan' },
  'a stale target model skips the model axis while the rest still seeds',
);
assert.deepEqual(
  planConversationRunDefaultSeed({
    options: seedOptions,
    targetDefaults: {
      model: 'api-model:fixture:alpha',
      thinking: 'high',
      speed: 'fast',
      mode: 'plan',
    },
    defaultModelSelector: undefined,
    existingModelValue: undefined,
    ...seedFlags,
  }),
  { model: 'api-model:fixture:alpha', thinking: 'high', speed: 'fast', mode: 'plan' },
  'a fresh target model seeds all four axes',
);
assert.equal(
  planConversationRunDefaultSeed({
    options: seedOptions,
    targetDefaults: { model: 'api-model:fixture:alpha' },
    defaultModelSelector: undefined,
    existingModelValue: 'api-model:fixture:vanished',
    ...seedFlags,
    hasModelPick: true,
  }),
  undefined,
  'a stale existing selector must not consume the seed',
);
assert.deepEqual(
  planConversationRunDefaultSeed({
    options: seedOptions,
    targetDefaults: { thinking: 'xhigh', speed: 'fast', mode: 'plan' },
    defaultModelSelector: undefined,
    existingModelValue: undefined,
    ...seedFlags,
    hasSpeedPick: true,
  }),
  { mode: 'plan' },
  'axes the thread already picked or the landing model cannot run are skipped',
);
assert.equal(
  planConversationRunDefaultSeed({
    options: [],
    targetDefaults: { model: 'api-model:fixture:alpha' },
    defaultModelSelector: undefined,
    existingModelValue: undefined,
    ...seedFlags,
  }),
  undefined,
  'an empty catalog resolves no landing model',
);

// normalizeTargetRunDefaults: persisted entries narrow to the validated four
// axes — extra fields (like legacy updatedAt), unknown keys, out-of-vocabulary
// values, and axis-less entries all drop.
assert.deepEqual(
  normalizeTargetRunDefaults({
    'employee:ada': {
      model: ' api-model:fixture:alpha ',
      thinking: 'high',
      speed: 'fast',
      mode: 'plan',
      updatedAt: 123,
    },
    'team:core': { updatedAt: 5 },
    'random-key': { model: 'api-model:fixture:alpha' },
    'employee:bob': { model: '', thinking: 'NO SPACES', speed: 'slow', mode: 'yolo' },
    'employee:carol': 'nope',
  }),
  {
    'employee:ada': {
      model: 'api-model:fixture:alpha',
      thinking: 'high',
      speed: 'fast',
      mode: 'plan',
    },
  },
  'loadMap normalization keeps only validated axes under valid target keys',
);
assert.deepEqual(normalizeTargetRunDefaults(null), {});
assert.deepEqual(normalizeTargetRunDefaults(42), {});
assert.deepEqual(normalizeTargetRunDefaults({}), {});

console.log('Runtime model picker and orchestration directory harness passed.');
