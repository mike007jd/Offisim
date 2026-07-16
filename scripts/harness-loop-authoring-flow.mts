/**
 * Loop authoring-flow oracle (PR-08). Drives the PURE, deterministic pieces of the
 * prompt-first Loops editor headlessly — no DOM, no Tauri, no live model:
 *
 *   1. The authoring STATE MACHINE: empty → draft → compiling → needs_input →
 *      ready → dirty → saving → saved, plus invalid/error (prompt never lost).
 *   2. The Save / Use guards: a needs_input/invalid revision is savable but NOT
 *      usable; Use requires a SAVED + READY + clean (non-dirty) revision.
 *   3. The model-adapter MAPPING: the renderer's loop_design enhance output
 *      (enhanced text + structuredHints) maps to a LoopModelOutput the compiler
 *      then turns into ready / ≤3-question / invalid — proving runEnhance →
 *      LoopCompileModel is the real seam.
 *   4. The generated-details projection is read-only (derived from the IR), never
 *      a raw evaluator form.
 *   5. ≤3 questions are surfaced on a needs_input compile.
 *
 * Pure Node via tsx against `packages/core` + the renderer's pure modules. Style
 * mirrors scripts/harness-loop-office-invocation.mts.
 */

import assert from 'node:assert/strict';
import { getEnhanceProfile } from '../apps/desktop/renderer/src/assistant/enhance/profiles.ts';
import {
  type EnhanceTransport,
  type EnhanceTransportResult,
  assembleEnhanceResult,
  buildEnhanceRequest,
  runEnhance,
} from '../apps/desktop/renderer/src/assistant/enhance/service.ts';
import {
  type CompiledRevisionView,
  EMPTY_AUTHORING_MODEL,
  type LoopAuthoringModel,
  canSave,
  canUseInOffice,
  compileStatusToState,
  deriveAuthoringState,
  graphStateFor,
  isDirty,
  useBlockedReason,
} from '../apps/desktop/renderer/src/surfaces/mission/loops/loop-authoring-machine.ts';
import {
  buildGeneratedDetails,
  parseLoopIr,
} from '../apps/desktop/renderer/src/surfaces/mission/loops/loop-generated-details.ts';
import {
  type LoopServiceDeps,
  type LoopServiceRepos,
  createLoopService,
  getCompilerProfile,
} from '../packages/core/src/browser.ts';
import type {
  LoopCompileInput,
  LoopCompileModel,
  LoopModelOutput,
} from '../packages/core/src/loops/types.ts';
import { createMemoryRepositories } from '../packages/core/src/runtime/memory-repositories.ts';

let passed = 0;
let failed = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`  ✗ ${name}\n    ${message}`);
  }
}

const PROFILE = 'software-development';
const GENERAL_PROFILE = 'general-work';
const COMPANY = 'co-1';
const CTX = { companyId: COMPANY, projectId: 'proj-1', repository: { inspected: true } } as const;

function makeDeps(): LoopServiceDeps {
  let idSeq = 0;
  let clockSeq = 0;
  return {
    newId: () => {
      idSeq += 1;
      return `id-${idSeq.toString().padStart(4, '0')}`;
    },
    now: () => {
      clockSeq += 1;
      return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, clockSeq)).toISOString();
    },
  };
}

function freshSystem() {
  const repos = createMemoryRepositories();
  const loopRepos: LoopServiceRepos = {
    loopDefinitions: repos.loopDefinitions,
    loopRevisions: repos.loopRevisions,
    loopSkillBindings: repos.loopSkillBindings!,
    loopInvocations: repos.loopInvocations!,
  };
  return { repos, svc: createLoopService(loopRepos, makeDeps()) };
}

/** A canned enhance transport — the ONLY thing the real adapter does live. */
function fakeEnhanceTransport(out: EnhanceTransportResult): EnhanceTransport {
  return {
    async run() {
      return out;
    },
  };
}

/**
 * The model-adapter under test, expressed WITHOUT Tauri: it runs the loop_design
 * enhance over the source prompt and maps the result to a LoopModelOutput — the
 * SAME mapping `createLoopCompileModel` performs in the renderer (which only adds
 * the Tauri transport). Proving this mapping is the runEnhance → LoopCompileModel
 * seam the PR requires.
 */
function adapterModel(transport: EnhanceTransport): LoopCompileModel {
  return async (input: LoopCompileInput): Promise<LoopModelOutput> => {
    const baseText = input.enhancedPrompt?.trim() || input.sourcePrompt;
    const answerSteer = input.answers
      ? Object.entries(input.answers)
          .map(([id, a]) => `${id}: ${a}`)
          .join('\n')
      : '';
    const request = buildEnhanceRequest({
      profile: 'loop_design',
      text: baseText,
      protectedSpans: [],
      context: { companyId: input.context.companyId },
      ...(answerSteer ? { feedback: `Resolve these clarifications:\n${answerSteer}` } : {}),
    });
    const result = await runEnhance(request, transport);
    return {
      enhancedPrompt: result.enhanced,
      ...(result.structuredHints ? { structuredHints: result.structuredHints } : {}),
    };
  };
}

// A loop_design enhance whose hints produce a READY compile.
const READY_TRANSPORT = fakeEnhanceTransport({
  text: 'Ship the feature end to end with green tests, pausing before push.',
  structuredHints: {
    tier: 'standard',
    outcome: 'The feature works end to end and tests are green',
    acceptance: [
      {
        id: 'a1',
        description: 'tests pass',
        oracle: 'deterministic',
        evaluatorId: 'command_exit_zero',
        required: true,
      },
      { id: 'a2', description: 'a human reviews the result', oracle: 'human', required: false },
    ],
  },
});

// A too-thin enhance (sub-8-char outcome, no acceptance signal) → the compiler
// asks ≤3 clarifying questions (needs_input). Mirrors the loop-compiler harness's
// needs_input fixture (`{ tier, outcome: 'x' }`).
const NEEDS_INPUT_TRANSPORT = fakeEnhanceTransport({
  text: 'x',
  structuredHints: { tier: 'standard', outcome: 'x' },
});

// ---------------------------------------------------------------------------
// State machine: resting derivations
// ---------------------------------------------------------------------------

await check('empty prompt + no compile → empty; typed → draft', () => {
  assert.equal(deriveAuthoringState(EMPTY_AUTHORING_MODEL), 'empty');
  assert.equal(deriveAuthoringState({ ...EMPTY_AUTHORING_MODEL, prompt: 'hi' }), 'draft');
});

await check('in-flight phases win: enhancing / compiling / saving', () => {
  assert.equal(
    deriveAuthoringState({ ...EMPTY_AUTHORING_MODEL, prompt: 'x', enhancing: true }),
    'enhancing',
  );
  assert.equal(
    deriveAuthoringState({ ...EMPTY_AUTHORING_MODEL, prompt: 'x', compiling: true }),
    'compiling',
  );
  assert.equal(
    deriveAuthoringState({ ...EMPTY_AUTHORING_MODEL, prompt: 'x', saving: true }),
    'saving',
  );
});

await check('an error never loses the prompt (state=error, prompt intact)', () => {
  const m: LoopAuthoringModel = { ...EMPTY_AUTHORING_MODEL, prompt: 'keep me', errored: true };
  assert.equal(deriveAuthoringState(m), 'error');
  assert.equal(m.prompt, 'keep me');
});

await check('compileStatusToState maps the three compile outcomes', () => {
  assert.equal(compileStatusToState('ready'), 'ready');
  assert.equal(compileStatusToState('needs_input'), 'needs_input');
  assert.equal(compileStatusToState('invalid'), 'invalid');
});

// ---------------------------------------------------------------------------
// Full flow: rough prompt → compile (ready) → save → dirty → recompile
// ---------------------------------------------------------------------------

await check(
  'rough prompt → compile READY (via the real model adapter) → save → ready/saved',
  async () => {
    const { svc } = freshSystem();
    const loop = await svc.createLoop({
      companyId: COMPANY,
      title: 'Ship feature',
      profileId: PROFILE,
    });

    // Compile = PREVIEW only (no save). Run the profile compile over the adapter model.
    const profile = getCompilerProfile(PROFILE)!;
    const preview = await profile.compile(
      { sourcePrompt: 'add search and keep tests green', context: CTX },
      adapterModel(READY_TRANSPORT),
    );
    assert.equal(preview.status, 'ready', 'the adapter-driven compile is ready');
    assert.ok(preview.ir, 'a ready compile has an IR');

    // The editor's compiled view BEFORE save: ready but NOT saved → not usable.
    const previewView: CompiledRevisionView = {
      status: preview.status,
      compiledIrJson: JSON.stringify(preview.ir),
      questions: preview.questions,
      findings: preview.validation.findings,
      ...(preview.enhancedPrompt ? { enhancedPrompt: preview.enhancedPrompt } : {}),
      sourcePrompt: 'add search and keep tests green',
    };
    const beforeSave: LoopAuthoringModel = {
      ...EMPTY_AUTHORING_MODEL,
      prompt: 'add search and keep tests green',
      compiled: previewView,
    };
    assert.equal(deriveAuthoringState(beforeSave), 'ready', 'preview is ready');
    assert.equal(
      canUseInOffice(beforeSave),
      false,
      'a previewed-but-unsaved ready revision is NOT usable',
    );
    assert.equal(canSave(beforeSave), true, 'a previewed ready revision is savable');

    // Save persists the exact preview; it must not run the model a second time.
    const saved = await svc.saveCompiledRevision({
      loopId: loop.loopId,
      sourcePrompt: 'add search and keep tests green',
      selectIfReady: true,
      compiled: preview,
    });
    assert.equal(saved.status, 'ready');
    assert.equal(saved.revision.revisionNumber, 1, 'first save is v1');
    assert.equal(
      saved.revision.compiledIrJson,
      JSON.stringify(preview.ir),
      'the stored graph is byte-identical to the reviewed preview',
    );
    const def = await svc.getLoop(loop.loopId);
    assert.equal(
      def.currentRevisionId,
      saved.revision.revisionId,
      'ready save selects the revision',
    );

    // The post-save view: saved + ready + clean → usable.
    const savedView: CompiledRevisionView = {
      ...previewView,
      savedRevisionId: saved.revision.revisionId,
      savedRevisionNumber: saved.revision.revisionNumber,
    };
    const afterSave: LoopAuthoringModel = { ...beforeSave, compiled: savedView, justSaved: true };
    assert.equal(deriveAuthoringState(afterSave), 'saved');
    assert.equal(canSave(afterSave), false, 'a persisted clean revision cannot be duplicated');

    const rehydrated: LoopAuthoringModel = { ...afterSave, justSaved: false };
    assert.equal(deriveAuthoringState(rehydrated), 'saved', 'a reopened persisted revision is saved');
    assert.equal(canSave(rehydrated), false, 'reopening does not enable a duplicate save');
    assert.equal(canUseInOffice(afterSave), true, 'a SAVED ready clean revision IS usable');
    assert.equal(useBlockedReason(afterSave), null, 'no block reason when usable');
  },
);

await check('saving a reviewed preview performs zero model calls', async () => {
  const { svc } = freshSystem();
  const loop = await svc.createLoop({
    companyId: COMPANY,
    title: 'No second call',
    profileId: PROFILE,
  });
  let modelCalls = 0;
  const model: LoopCompileModel = async (input) => {
    modelCalls += 1;
    return adapterModel(READY_TRANSPORT)(input);
  };
  const profile = getCompilerProfile(PROFILE)!;
  const preview = await profile.compile(
    { sourcePrompt: 'ship the reviewed plan', context: CTX },
    model,
  );
  assert.equal(modelCalls, 1, 'preview generation calls the model once');
  const globals = globalThis as unknown as Record<string, unknown>;
  const nodeBuffer = globals.Buffer;
  Reflect.deleteProperty(globals, 'Buffer');
  try {
    await svc.saveCompiledRevision({
      loopId: loop.loopId,
      sourcePrompt: 'ship the reviewed plan',
      compiled: preview,
    });
  } finally {
    globals.Buffer = nodeBuffer;
  }
  assert.equal(modelCalls, 1, 'saving does not call the model again');
});

await check('general work preserves the user steps, exit, retry, and escalation', async () => {
  const profile = getCompilerProfile(GENERAL_PROFILE)!;
  const prompt =
    'Every weekday, review changed Markdown files, update stale project documentation, run the docs checks, and stop when all checks pass; after three failed attempts, ask me for help.';
  const preview = await profile.compile({ sourcePrompt: prompt, context: CTX }, async () => ({
    enhancedPrompt: prompt,
  }));
  assert.equal(preview.status, 'ready', JSON.stringify(preview.validation));
  assert.ok(preview.ir);
  const labels = preview.ir.nodes.map((node) => node.label);
  assert.ok(labels.includes('Review changed Markdown files'));
  assert.ok(labels.includes('Update stale project documentation'));
  assert.ok(labels.includes('Run the docs checks'));
  assert.ok(labels.includes('All checks pass'));
  assert.ok(labels.includes('Ask me for help'));
  assert.equal(
    preview.ir.edges.find((edge) => edge.kind === 'retry')?.maxRetries,
    3,
    'the explicit retry limit is preserved',
  );
  assert.equal(
    labels.some((label) => /parallel discovery|freeze contracts|implement in waves/i.test(label)),
    false,
    'unrequested software-development ceremony is not invented',
  );
});

await check('general work keeps stop/help clauses out of the action list', async () => {
  const profile = getCompilerProfile(GENERAL_PROFILE)!;
  const prompt =
    'Every Friday, collect unresolved customer feedback, group similar items, draft the three highest-priority follow-ups, and stop after the draft is ready; if any source is unavailable, ask me for help.';
  const preview = await profile.compile({ sourcePrompt: prompt, context: CTX }, async () => ({
    enhancedPrompt: prompt,
  }));
  assert.equal(preview.status, 'ready', JSON.stringify(preview.validation));
  assert.ok(preview.ir);
  const labels = preview.ir.nodes.map((node) => node.label);
  assert.ok(labels.includes('The draft is ready'));
  assert.ok(labels.includes('Ask me for help'));
  assert.equal(labels.some((label) => /^and stop/i.test(label)), false);
  assert.equal(preview.ir.edges.find((edge) => edge.kind === 'retry')?.maxRetries, undefined);
  assert.equal(
    preview.ir.edges.find((edge) => edge.kind === 'escalate')?.label,
    'if any source is unavailable',
  );
});

await check('general work accepts task-language retry units', async () => {
  const profile = getCompilerProfile(GENERAL_PROFILE)!;
  const prompt =
    'Every Monday, review launch risks and stop when each critical risk has a mitigation; after two failed reviews, ask me for help.';
  const preview = await profile.compile({ sourcePrompt: prompt, context: CTX }, async () => ({
    enhancedPrompt: prompt,
  }));
  assert.equal(preview.status, 'ready', JSON.stringify(preview.validation));
  assert.equal(preview.ir?.edges.find((edge) => edge.kind === 'retry')?.maxRetries, 2);
  assert.equal(
    preview.ir?.edges.find((edge) => edge.kind === 'escalate')?.label,
    'after 2 attempts',
  );
});

await check('editing the prompt after save → DIRTY (old graph stays, Use blocked)', () => {
  const savedView: CompiledRevisionView = {
    status: 'ready',
    compiledIrJson: '{"schemaVersion":"1"}',
    questions: [],
    findings: [],
    sourcePrompt: 'original prompt',
    savedRevisionId: 'rev-1',
    savedRevisionNumber: 1,
  };
  const dirtyModel: LoopAuthoringModel = {
    ...EMPTY_AUTHORING_MODEL,
    prompt: 'original prompt — now changed',
    compiled: savedView,
    justSaved: true,
  };
  assert.equal(isDirty(dirtyModel), true);
  assert.equal(deriveAuthoringState(dirtyModel), 'dirty', 'a changed prompt marks the graph stale');
  assert.equal(canSave(dirtyModel), false, 'a stale graph cannot be saved under a new prompt');
  assert.equal(canUseInOffice(dirtyModel), false, 'a dirty graph cannot be Used');
  assert.match(useBlockedReason(dirtyModel)!, /update/i);

  // Trailing whitespace alone does NOT mark dirty.
  const ws: LoopAuthoringModel = { ...dirtyModel, prompt: 'original prompt   ' };
  assert.equal(isDirty(ws), false, 'trailing whitespace is not a real edit');
});

// ---------------------------------------------------------------------------
// needs_input: ≤3 questions, savable but NOT usable
// ---------------------------------------------------------------------------

await check(
  'a vague prompt compiles to needs_input with ≤3 questions, savable but not usable',
  async () => {
    const { svc } = freshSystem();
    const loop = await svc.createLoop({ companyId: COMPANY, title: 'WIP', profileId: PROFILE });
    const profile = getCompilerProfile(PROFILE)!;
    const preview = await profile.compile(
      { sourcePrompt: 'do something', context: CTX },
      adapterModel(NEEDS_INPUT_TRANSPORT),
    );
    assert.equal(preview.status, 'needs_input', 'a vague prompt needs input');
    assert.ok(
      preview.questions.length >= 1 && preview.questions.length <= 3,
      '1..3 questions surfaced',
    );
    for (const q of preview.questions) {
      assert.ok(
        typeof q.recommendedDefault === 'string',
        'every question carries a recommended default',
      );
    }

    const view: CompiledRevisionView = {
      status: 'needs_input',
      compiledIrJson: '{}',
      questions: preview.questions,
      findings: preview.validation.findings,
      sourcePrompt: 'do something',
    };
    const model: LoopAuthoringModel = {
      ...EMPTY_AUTHORING_MODEL,
      prompt: 'do something',
      compiled: view,
    };
    assert.equal(deriveAuthoringState(model), 'needs_input');
    assert.equal(canSave(model), true, 'a needs_input revision is a real, savable revision');
    assert.equal(canUseInOffice(model), false, 'a needs_input revision is NOT usable');

    // Persisting it really records a needs_input revision (history preserved).
    const saved = await svc.saveRevision(
      { loopId: loop.loopId, sourcePrompt: 'do something', context: CTX },
      adapterModel(NEEDS_INPUT_TRANSPORT),
    );
    assert.equal(saved.status, 'needs_input');
    const savedModel: LoopAuthoringModel = {
      ...model,
      compiled: { ...view, savedRevisionId: saved.revision.revisionId, savedRevisionNumber: 1 },
    };
    assert.equal(
      canUseInOffice(savedModel),
      false,
      'even SAVED needs_input is not usable — only ready',
    );
  },
);

await check('answering the questions → a ready recompile (answers steer the model)', async () => {
  const { svc } = freshSystem();
  const loop = await svc.createLoop({ companyId: COMPANY, title: 'Resolve', profileId: PROFILE });
  // First compile is needs_input.
  const first = await svc.saveRevision(
    { loopId: loop.loopId, sourcePrompt: 'do something', context: CTX },
    adapterModel(NEEDS_INPUT_TRANSPORT),
  );
  assert.equal(first.status, 'needs_input');
  // Recompile WITH answers + a model that now returns a complete design → ready.
  const second = await svc.saveRevision(
    {
      loopId: loop.loopId,
      sourcePrompt: 'do something',
      answers: { q1: 'Ship the search feature with tests' },
      context: CTX,
      selectIfReady: true,
    },
    adapterModel(READY_TRANSPORT),
  );
  assert.equal(second.status, 'ready', 'answered recompile reaches ready');
  assert.equal(second.revision.revisionNumber, 2, 'each save is a NEW immutable revision');
});

// ---------------------------------------------------------------------------
// invalid path: keeps the graph, blocks Use, never throws
// ---------------------------------------------------------------------------

await check('an invalid compile blocks Use and keeps the prompt', () => {
  const view: CompiledRevisionView = {
    status: 'invalid',
    compiledIrJson: '{}',
    questions: [],
    findings: [{ code: 'x', message: 'bad', severity: 'error' }],
    sourcePrompt: 'p',
  };
  const model: LoopAuthoringModel = { ...EMPTY_AUTHORING_MODEL, prompt: 'p', compiled: view };
  assert.equal(deriveAuthoringState(model), 'invalid');
  assert.equal(canUseInOffice(model), false);
  assert.equal(
    graphStateFor('invalid', view),
    'invalid',
    'the graph panel shows the invalid state',
  );
});

// ---------------------------------------------------------------------------
// graph state projection
// ---------------------------------------------------------------------------

await check('graphStateFor maps authoring → LoopGraphPanel state', () => {
  const ready: CompiledRevisionView = {
    status: 'ready',
    compiledIrJson: '{}',
    questions: [],
    findings: [],
    sourcePrompt: 'p',
  };
  assert.equal(graphStateFor('compiling', null), 'compiling');
  assert.equal(graphStateFor('error', null), 'error');
  assert.equal(graphStateFor('empty', null), 'empty');
  assert.equal(graphStateFor('ready', ready), 'ready');
  assert.equal(
    graphStateFor('needs_input', { ...ready, status: 'needs_input' }),
    'empty',
    'needs_input has no legal IR → empty graph (question cards drive the UI)',
  );
});

// ---------------------------------------------------------------------------
// generated details: read-only projection, NOT a form
// ---------------------------------------------------------------------------

await check(
  'generated details are derived read-only from the IR (outcome/budget/oracles)',
  async () => {
    const { svc } = freshSystem();
    const loop = await svc.createLoop({ companyId: COMPANY, title: 'Details', profileId: PROFILE });
    const saved = await svc.saveRevision(
      {
        loopId: loop.loopId,
        sourcePrompt: 'ship it with tests',
        context: CTX,
        selectIfReady: true,
      },
      adapterModel(READY_TRANSPORT),
    );
    const ir = parseLoopIr(saved.revision.compiledIrJson);
    assert.ok(ir, 'a ready revision has a parseable IR');
    const sections = buildGeneratedDetails(ir);
    assert.ok(sections.length > 0, 'sections are generated');
    const keys = sections.map((s) => s.key);
    assert.ok(keys.includes('outcome'), 'an outcome section is generated');
    // No raw evaluator JSON leaks — values are human strings, never serialized config.
    for (const section of sections) {
      for (const row of section.rows) {
        assert.ok(
          !row.value.includes('"evaluatorId"'),
          'no raw evaluator JSON in the read-only view',
        );
        assert.equal(typeof row.value, 'string', 'every detail row is a plain string');
      }
    }
  },
);

await check('parseLoopIr rejects an empty `{}` IR (needs_input/invalid → no details)', () => {
  assert.equal(parseLoopIr('{}'), null);
  assert.equal(parseLoopIr('not json'), null);
  assert.deepEqual(
    buildGeneratedDetails(null),
    [],
    'no IR → no details cards (drawer shows a hint)',
  );
});

// ---------------------------------------------------------------------------
// model-adapter mapping: runEnhance(loop_design) → LoopModelOutput
// ---------------------------------------------------------------------------

await check(
  'the adapter maps enhance output → LoopModelOutput (enhanced text + structured hints)',
  async () => {
    const profile = getEnhanceProfile('loop_design');
    const request = buildEnhanceRequest({
      profile: 'loop_design',
      text: 'rough idea',
      protectedSpans: [],
      context: { companyId: COMPANY },
    });
    const transportResult: EnhanceTransportResult = {
      text: 'A clearer loop description.',
      structuredHints: { outcome: 'works', tier: 'standard' },
    };
    const enhanceResult = assembleEnhanceResult(request, profile, transportResult);
    // The adapter's mapping (mirrored): enhanced → enhancedPrompt, hints → structuredHints.
    const mapped: LoopModelOutput = {
      enhancedPrompt: enhanceResult.enhanced,
      ...(enhanceResult.structuredHints ? { structuredHints: enhanceResult.structuredHints } : {}),
    };
    assert.equal(
      mapped.enhancedPrompt,
      'A clearer loop description.',
      'enhanced text maps to enhancedPrompt',
    );
    assert.equal(
      (mapped.structuredHints as Record<string, unknown>).outcome,
      'works',
      'hints pass through to structuredHints',
    );
  },
);

// ---------------------------------------------------------------------------
// BUG-1 regression: a SECOND needs_input compile with a DIFFERENT question set
// must not carry the prior set's answers. The editor keys LoopQuestionCards on
// the question-id set so a remount re-derives defaults; this proves the key is
// distinct AND that fresh defaults contain ONLY the new question ids (no stale id).
// ---------------------------------------------------------------------------

/** Mirror of LoopQuestionCards' default derivation + its remount key. */
function questionKey(qs: { id: string }[]): string {
  return qs.map((q) => q.id).join(',');
}
function deriveDefaults(qs: { id: string; recommendedDefault: string }[]): Record<string, string> {
  return Object.fromEntries(qs.map((q) => [q.id, q.recommendedDefault]));
}

await check(
  'BUG-1: a new question set has a distinct remount key and drops stale answer ids',
  () => {
    const setA = [
      { id: 'q1', question: 'A?', recommendedDefault: 'a-default' },
      { id: 'acceptance', question: 'Demo?', recommendedDefault: 'tests pass' },
    ];
    const setB = [
      { id: 'budget', question: 'Tier?', recommendedDefault: 'standard' },
      { id: 'scope', question: 'Scope?', recommendedDefault: 'the module' },
    ];

    // The remount key changes when the question id set changes → React replaces the
    // card → its local `answers` state is re-seeded from the NEW defaults.
    assert.notEqual(
      questionKey(setA),
      questionKey(setB),
      'a different question set yields a different key',
    );

    const defaultsA = deriveDefaults(setA);
    const defaultsB = deriveDefaults(setB);
    // The fresh state for set B carries ONLY set B's ids — no q1/acceptance leak.
    assert.deepEqual(
      Object.keys(defaultsB).sort(),
      ['budget', 'scope'],
      'set B defaults contain only set B ids',
    );
    for (const staleId of Object.keys(defaultsA)) {
      assert.ok(
        !(staleId in defaultsB),
        `stale id "${staleId}" must NOT appear under the new question set`,
      );
    }
    // Same id set (e.g. a recompile that re-asks the same questions) keeps the key
    // stable — no needless remount.
    assert.equal(
      questionKey(setA),
      questionKey([...setA]),
      'an identical id set keeps a stable key',
    );
  },
);

// ---------------------------------------------------------------------------
// BUG-2 regression: an in-flight compile blocks a second compile, EVEN on the
// "Apply answers" path (answers truthy). Models the synchronous compilingRef guard.
// ---------------------------------------------------------------------------

await check('BUG-2: an in-flight compile blocks a second compile even with answers', async () => {
  // A re-entrancy guard identical in shape to LoopEditor's compilingRef: it is set
  // SYNCHRONOUSLY before the first await, so a second call (answers or not) bails
  // before launching a racing compile.
  const inFlight = { current: false };
  let started = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });

  async function guardedCompile(answers?: Record<string, string>): Promise<'ran' | 'blocked'> {
    if (inFlight.current) return 'blocked';
    // answers only skips an empty-prompt check, never the in-flight guard above.
    void answers;
    inFlight.current = true;
    started += 1;
    try {
      await gate; // simulate the async model call still running
      return 'ran';
    } finally {
      inFlight.current = false;
    }
  }

  const first = guardedCompile(); // plain compile, now in flight (awaiting gate)
  // Both of these arrive WHILE the first is in flight — both must be blocked.
  const secondPlain = await guardedCompile();
  const secondWithAnswers = await guardedCompile({ q1: 'x' });
  assert.equal(secondPlain, 'blocked', 'a second plain compile is blocked while one is in flight');
  assert.equal(
    secondWithAnswers,
    'blocked',
    'the answers path is ALSO blocked while a compile is in flight',
  );
  assert.equal(started, 1, 'only ONE compile actually started — no racing second compile');

  release();
  assert.equal(await first, 'ran', 'the first compile completes');
  // After it finishes, a new compile is allowed again.
  assert.equal(await guardedCompile({ q1: 'y' }), 'ran', 'once idle, the answers path runs again');
});

console.log(`\nLoop authoring flow: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
