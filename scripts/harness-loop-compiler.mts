import { createHarness } from './lib/harness-runner.mjs';

const h = createHarness();

/**
 * Loop compiler oracle (PR-07). Drives the deterministic compiler core — the
 * software-development profile, the generic IR validator, the repair/needs_input
 * layer, the forbidden-infra scope gate, and the execution-packet adapter —
 * against an INJECTED scripted model. The real compiler calls PR-06's loop_design
 * enhance; here the model output is faked so the deterministic layer is the SUT.
 *
 * Pure Node via tsx against `packages/core` + `packages/shared-types` source — no
 * DOM, no renderer, no Pi. Style mirrors scripts/harness-mission-service.mts.
 */

import assert from 'node:assert/strict';
import {
  buildLoopExecutionPacket,
  softwareDevelopmentProfile,
} from '../packages/core/src/loops/index.ts';
import type {
  LoopCompileInput,
  LoopCompileModel,
  LoopModelOutput,
} from '../packages/core/src/loops/types.ts';
import { validateLoopIR } from '../packages/core/src/loops/validate.ts';
import type { LoopIR } from '../packages/shared-types/src/loops/ir.ts';

for (const asset of softwareDevelopmentProfile.referenceAssets) {
  for (const [, target] of asset.content.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/gu)) {
    assert.ok(
      softwareDevelopmentProfile.referenceAssets.some((candidate) => candidate.name === target),
      `${asset.name} links missing bundled asset ${target}`,
    );
  }
}
const check = h.checkAsync;

/** A model that returns a fixed output regardless of input (deterministic). */
function fixedModel(output: LoopModelOutput): LoopCompileModel {
  return async () => output;
}

function baseContext(inspected = true): LoopCompileInput['context'] {
  return {
    companyId: 'co-1',
    projectId: 'proj-1',
    repository: { root: '/repo', defaultBranch: 'main', inspected },
  };
}

// ---------------------------------------------------------------------------
// 1. Rough software request → valid IR with feedback/retry/exit/budget.
// ---------------------------------------------------------------------------

await check(
  'rough software request → ready IR with feedback + retry + exit states + budget',
  async () => {
    const model = fixedModel({
      enhancedPrompt: 'Add a dark-mode toggle to the settings page, tests green.',
      structuredHints: {
        title: 'Dark mode toggle',
        outcome: 'Users can toggle dark mode from settings; preference persists',
        tier: 'standard',
        scope: 'settings page + theme provider',
        acceptance: [
          {
            id: 'a1',
            description: 'toggle persists across reload',
            oracle: 'deterministic',
            evaluatorId: 'command_exit_zero',
            required: true,
          },
          {
            id: 'a2',
            description: 'visual review of both themes',
            oracle: 'review',
            required: false,
          },
        ],
      },
    });
    const result = await softwareDevelopmentProfile.compile(
      { sourcePrompt: 'add dark mode', context: baseContext() },
      model,
    );
    assert.equal(
      result.status,
      'ready',
      `expected ready, got ${result.status}: ${JSON.stringify(result.validation.findings)}`,
    );
    const ir = result.ir!;
    assert.ok(ir, 'ready result carries an IR');
    assert.equal(ir.schemaVersion, '1');
    // Topology: feedback + bounded retry edge exist; at least one finish; budget set.
    assert.ok(
      ir.edges.some((e) => e.kind === 'feedback'),
      'IR has a feedback edge',
    );
    const retry = ir.edges.find((e) => e.kind === 'retry');
    assert.ok(retry, 'IR has a retry edge');
    assert.ok((retry!.maxRetries ?? 0) > 0, 'retry edge is bounded');
    assert.ok(
      ir.nodes.some((n) => n.kind === 'finish'),
      'IR has a finish node',
    );
    assert.deepEqual(ir.completion.exitStates, ['success', 'budget-exhausted', 'blocked-handoff']);
    assert.ok(ir.budget, 'IR carries a budget');
    assert.equal(ir.budget!.tier, 'standard');
    assert.equal(ir.budget!.maxFixWavesPerGate, 3, 'default fix-wave budget is 3');
    // Profile traceability: version + checksum-backed assets present.
    assert.equal(ir.metadata.profileId, 'software-development');
    assert.equal(
      ir.metadata.profileVersion,
      '2.2.0',
      'profile version derived from bundle VERSION',
    );
    assert.ok(
      softwareDevelopmentProfile.referenceAssets.every((a) => /^[0-9a-f]{64}$/.test(a.sha256)),
      'every asset has a sha256',
    );
  },
);

// ---------------------------------------------------------------------------
// 2. Questions ≤3 and include defaults (needs_input).
// ---------------------------------------------------------------------------

await check('needs_input → ≤3 questions, each with a recommended default', async () => {
  // A too-thin request (no acceptance signal, sub-8-char outcome+prompt) → the one
  // MATERIAL un-inferable value (the acceptance demo) is asked, with a default.
  const model = fixedModel({ structuredHints: { tier: 'standard', outcome: 'x' } });
  const result = await softwareDevelopmentProfile.compile(
    { sourcePrompt: 'go', context: baseContext() },
    model,
  );
  assert.equal(result.status, 'needs_input', `expected needs_input, got ${result.status}`);
  assert.ok(
    result.questions.length >= 1 && result.questions.length <= 3,
    `questions in [1,3], got ${result.questions.length}`,
  );
  for (const q of result.questions) {
    assert.ok(q.recommendedDefault.length > 0, `question ${q.id} has a recommended default`);
  }
  assert.ok(
    result.questions.some((q) => q.id === 'acceptance'),
    'the acceptance demo is asked',
  );
});

await check('tier is never asked — it defaults silently (answer > model > standard)', async () => {
  // An illegal model tier with a usable outcome must NOT block on a tier question;
  // the tier silently defaults to standard.
  const model = fixedModel({
    structuredHints: { tier: 'turbo', outcome: 'Refactor the auth module to use sessions' },
  });
  const result = await softwareDevelopmentProfile.compile(
    { sourcePrompt: 'refactor auth', context: baseContext() },
    model,
  );
  assert.equal(
    result.status,
    'ready',
    `illegal tier must not force a question, got ${result.status}: ${JSON.stringify(result.validation.findings)}`,
  );
  assert.equal(result.ir!.budget!.tier, 'standard', 'illegal model tier falls back to standard');
});

await check(
  'answering the acceptance question → recompiles to ready, answered tier wins',
  async () => {
    const model = fixedModel({ structuredHints: { tier: 'turbo', outcome: 'x' } });
    const result = await softwareDevelopmentProfile.compile(
      {
        sourcePrompt: 'go',
        context: baseContext(),
        answers: { tier: 'light', acceptance: 'tests pass' },
      },
      model,
    );
    assert.equal(
      result.status,
      'ready',
      `answered recompile is ready, got ${result.status}: ${JSON.stringify(result.validation.findings)}`,
    );
    assert.equal(result.ir!.budget!.tier, 'light', 'answered tier wins');
  },
);

// ---------------------------------------------------------------------------
// 3. Malformed model output is repaired or rejected deterministically (no crash).
// ---------------------------------------------------------------------------

await check(
  'malformed structuredHints (not an object) is REPAIRED to a default IR, not a crash',
  async () => {
    const model = fixedModel({
      structuredHints: 'totally not an object' as unknown as Record<string, unknown>,
    });
    const result = await softwareDevelopmentProfile.compile(
      { sourcePrompt: 'implement the search feature end to end', context: baseContext() },
      model,
    );
    // Repaired: a default IR (matrix acceptance) is built; ready.
    assert.equal(result.status, 'ready', `malformed hints repaired to ready, got ${result.status}`);
    assert.ok(
      result.ir!.completion.acceptance.some((a) => a.required),
      'default acceptance has a required item',
    );
  },
);

await check('a throwing model is caught → invalid (never crashes the compiler)', async () => {
  const throwing: LoopCompileModel = async () => {
    throw new Error('model exploded');
  };
  const result = await softwareDevelopmentProfile.compile(
    { sourcePrompt: 'do work', context: baseContext() },
    throwing,
  );
  assert.equal(result.status, 'invalid', 'a throwing model yields invalid, not an exception');
  assert.ok(
    result.validation.findings.some((f) => f.code === 'model.failed'),
    'records the model failure',
  );
});

await check('empty / oversized source prompt is rejected deterministically', async () => {
  const model = fixedModel({ structuredHints: { tier: 'standard' } });
  const empty = await softwareDevelopmentProfile.compile(
    { sourcePrompt: '   ', context: baseContext() },
    model,
  );
  assert.equal(empty.status, 'invalid', 'empty prompt → invalid');
  assert.ok(empty.validation.findings.some((f) => f.code === 'input.empty'));

  const huge = 'x'.repeat(64 * 1024 + 1);
  const oversized = await softwareDevelopmentProfile.compile(
    { sourcePrompt: huge, context: baseContext() },
    model,
  );
  assert.equal(oversized.status, 'invalid', 'oversized prompt → invalid');
  assert.ok(oversized.validation.findings.some((f) => f.code === 'input.too_large'));
});

// ---------------------------------------------------------------------------
// 4. Semantic validator: unreachable node / dangling edge / unbounded retry → INVALID.
//    These exercise validateLoopIR directly against hand-built broken IRs.
// ---------------------------------------------------------------------------

function minimalValidIR(overrides?: Partial<LoopIR>): LoopIR {
  return {
    schemaVersion: '1',
    title: 'T',
    outcome: 'O',
    inputs: [],
    outputs: [],
    parameters: [],
    nodes: [
      { id: 's', kind: 'start', label: 'start' },
      { id: 'a', kind: 'action', label: 'do' },
      { id: 'f', kind: 'finish', label: 'done' },
    ],
    edges: [
      { id: 'e1', from: 's', to: 'a', kind: 'next' },
      { id: 'e2', from: 'a', to: 'f', kind: 'next' },
    ],
    completion: {
      outcome: 'O',
      acceptance: [
        {
          id: 'acc',
          description: 'works',
          oracle: 'deterministic',
          evaluatorId: 'command_exit_zero',
          required: true,
        },
      ],
      exitStates: ['success'],
    },
    humanGates: [],
    skillBindings: [],
    metadata: { profileId: 'p', profileVersion: '1', compilerVersion: '1' },
    ...overrides,
  };
}

await check('validator: a clean minimal IR is OK', () => {
  const v = validateLoopIR(minimalValidIR());
  assert.equal(v.ok, true, `minimal IR should validate: ${JSON.stringify(v.findings)}`);
});

await check('validator: every Loop budget cap must be a positive safe integer', () => {
  const invalidCaps: Array<[keyof NonNullable<LoopIR['budget']>, number]> = [
    ['maxConcurrentAgents', 0],
    ['maxTotalAgents', 1.5],
    ['maxRecursionDepth', Number.MAX_SAFE_INTEGER + 1],
    ['maxFixWavesPerGate', 0],
    ['wallClockMinutes', 0],
    ['tokenCeiling', 2.5],
  ];
  for (const [key, value] of invalidCaps) {
    const budget: NonNullable<LoopIR['budget']> = {
      tier: 'standard',
      maxConcurrentAgents: 1,
      maxTotalAgents: 2,
      maxRecursionDepth: 1,
      maxFixWavesPerGate: 3,
    };
    Object.assign(budget, { [key]: value });
    const result = validateLoopIR(minimalValidIR({ budget }));
    assert.equal(result.ok, false, `${key}=${value} must be rejected`);
    assert.ok(
      result.findings.some((finding) => finding.code === `budget.${key}`),
      `reports budget.${key}`,
    );
  }
});

await check('validator: dangling edge (to a missing node) → INVALID', () => {
  const ir = minimalValidIR();
  ir.edges.push({ id: 'e3', from: 'a', to: 'ghost', kind: 'next' });
  const v = validateLoopIR(ir);
  assert.equal(v.ok, false, 'a dangling edge must be invalid');
  assert.ok(
    v.findings.some((f) => f.code === 'edge.dangling_to'),
    'reports edge.dangling_to',
  );
});

await check('validator: unreachable node → INVALID', () => {
  const ir = minimalValidIR();
  ir.nodes.push({ id: 'orphan', kind: 'action', label: 'orphan' });
  const v = validateLoopIR(ir);
  assert.equal(v.ok, false, 'an unreachable node must be invalid');
  assert.ok(
    v.findings.some((f) => f.code === 'graph.unreachable'),
    'reports graph.unreachable',
  );
});

await check('validator: unbounded retry edge → INVALID', () => {
  const ir = minimalValidIR();
  ir.edges.push({ id: 'e3', from: 'a', to: 'a', kind: 'retry' }); // no maxRetries
  const v = validateLoopIR(ir);
  assert.equal(v.ok, false, 'an unbounded retry must be invalid');
  assert.ok(
    v.findings.some((f) => f.code === 'edge.unbounded_retry'),
    'reports edge.unbounded_retry',
  );
});

await check(
  'validator: a dangling edge does NOT suppress reporting an unrelated orphan node (BOTH reported)',
  () => {
    const ir = minimalValidIR();
    // A disconnected orphan node (reachable from nothing) …
    ir.nodes.push({ id: 'orphan', kind: 'action', label: 'orphan' });
    // … AND an unrelated dangling edge to a node that does not exist.
    ir.edges.push({ id: 'e_dangle', from: 'a', to: 'ghost', kind: 'next' });
    const v = validateLoopIR(ir);
    assert.equal(v.ok, false, 'the IR is invalid');
    // The reachability BFS must run REGARDLESS of the dangling edge, so the orphan
    // is still reported — the regression this fix closes.
    assert.ok(
      v.findings.some((f) => f.code === 'graph.unreachable' && f.ref === 'orphan'),
      'orphan node reported as unreachable despite the dangling edge',
    );
    assert.ok(
      v.findings.some((f) => f.code === 'edge.dangling_to'),
      'the dangling edge is still reported',
    );
    // No double-report: `ghost` (a dangling `to`) must NOT also be flagged unreachable.
    assert.ok(
      !v.findings.some((f) => f.code === 'graph.unreachable' && f.ref === 'ghost'),
      'a dangling-to target is not double-reported as unreachable',
    );
  },
);

await check('validator: missing start / no finish → INVALID', () => {
  const noStart = minimalValidIR();
  noStart.nodes = noStart.nodes.filter((n) => n.kind !== 'start');
  // drop the now-dangling edge from start
  noStart.edges = noStart.edges.filter((e) => e.from !== 's');
  const v1 = validateLoopIR(noStart);
  assert.equal(v1.ok, false, 'no start → invalid');
  assert.ok(v1.findings.some((f) => f.code === 'graph.entry'));

  const noFinish = minimalValidIR();
  noFinish.nodes = noFinish.nodes.filter((n) => n.kind !== 'finish');
  noFinish.edges = noFinish.edges.filter((e) => e.to !== 'f');
  const v2 = validateLoopIR(noFinish);
  assert.equal(v2.ok, false, 'no finish → invalid');
  assert.ok(v2.findings.some((f) => f.code === 'graph.exit'));
});

await check('validator: completion with zero required acceptance → INVALID', () => {
  const ir = minimalValidIR();
  ir.completion.acceptance = [
    { id: 'opt', description: 'optional', oracle: 'review', required: false },
  ];
  const v = validateLoopIR(ir);
  assert.equal(v.ok, false, 'no required acceptance → invalid');
  assert.ok(v.findings.some((f) => f.code === 'completion.no_required'));
});

// ---------------------------------------------------------------------------
// 5. Nested inline child graph + subloopRevisionId are valid.
// ---------------------------------------------------------------------------

await check('validator: subloop node with an inline child graph is valid', () => {
  const ir = minimalValidIR();
  ir.nodes = [
    { id: 's', kind: 'start', label: 'start' },
    {
      id: 'sub',
      kind: 'subloop',
      label: 'nested',
      childGraph: {
        nodes: [
          { id: 'cs', kind: 'start', label: 'child start' },
          { id: 'cf', kind: 'finish', label: 'child finish' },
        ],
        edges: [{ id: 'ce', from: 'cs', to: 'cf', kind: 'next' }],
      },
    },
    { id: 'f', kind: 'finish', label: 'done' },
  ];
  ir.edges = [
    { id: 'e1', from: 's', to: 'sub', kind: 'next' },
    { id: 'e2', from: 'sub', to: 'f', kind: 'next' },
  ];
  const v = validateLoopIR(ir);
  assert.equal(v.ok, true, `inline child graph IR should validate: ${JSON.stringify(v.findings)}`);
});

await check('validator: subloop node with a subloopRevisionId is valid', () => {
  const ir = minimalValidIR();
  ir.nodes = [
    { id: 's', kind: 'start', label: 'start' },
    { id: 'sub', kind: 'subloop', label: 'ref', subloopRevisionId: 'rev-123' },
    { id: 'f', kind: 'finish', label: 'done' },
  ];
  ir.edges = [
    { id: 'e1', from: 's', to: 'sub', kind: 'next' },
    { id: 'e2', from: 'sub', to: 'f', kind: 'next' },
  ];
  const v = validateLoopIR(ir);
  assert.equal(v.ok, true, `subloopRevisionId IR should validate: ${JSON.stringify(v.findings)}`);
});

await check('validator: subloop with BOTH childGraph and subloopRevisionId → INVALID', () => {
  const ir = minimalValidIR();
  ir.nodes = [
    { id: 's', kind: 'start', label: 'start' },
    {
      id: 'sub',
      kind: 'subloop',
      label: 'both',
      subloopRevisionId: 'rev-1',
      childGraph: { nodes: [{ id: 'x', kind: 'start', label: 'x' }], edges: [] },
    },
    { id: 'f', kind: 'finish', label: 'done' },
  ];
  ir.edges = [
    { id: 'e1', from: 's', to: 'sub', kind: 'next' },
    { id: 'e2', from: 'sub', to: 'f', kind: 'next' },
  ];
  const v = validateLoopIR(ir);
  assert.equal(v.ok, false, 'a subloop with both child + ref is invalid');
  assert.ok(v.findings.some((f) => f.code === 'subloop.ref'));
});

// ---------------------------------------------------------------------------
// 6. Uploaded profile REJECTS scheduler/controller/lease language in the contract.
// ---------------------------------------------------------------------------

await check('software profile REJECTS generated scheduler/controller/lease language', async () => {
  for (const term of ['scheduler', 'controller', 'lease', 'heartbeat', 'daemon']) {
    const model = fixedModel({
      structuredHints: {
        tier: 'standard',
        outcome: 'build the thing',
        scope: `we will build a custom ${term} to run the fleet`,
      },
    });
    const result = await softwareDevelopmentProfile.compile(
      { sourcePrompt: 'implement the feature', context: baseContext() },
      model,
    );
    assert.equal(result.status, 'invalid', `"${term}" language must make the compile invalid`);
    assert.ok(
      result.validation.findings.some((f) => f.code === 'profile.forbidden_infra'),
      `"${term}" reported as forbidden infra`,
    );
  }
});

await check(
  'software profile rejects forbidden language even when it rides in the source prompt',
  async () => {
    const model = fixedModel({
      structuredHints: { tier: 'standard', outcome: 'Ship the new feature reliably' },
    });
    const result = await softwareDevelopmentProfile.compile(
      {
        sourcePrompt: 'build a worker daemon with a lease/heartbeat lifecycle database',
        context: baseContext(),
      },
      model,
    );
    assert.equal(result.status, 'invalid', 'forbidden language in the prompt is also rejected');
    assert.ok(result.validation.findings.some((f) => f.code === 'profile.forbidden_infra'));
  },
);

await check(
  'software profile rejects forbidden language SMUGGLED into ir.title (catch-all IR scan)',
  async () => {
    // `title` is NOT one of the step-3 hint fields scanned, so a model could route
    // forbidden language straight into ir.title (which then flows into the mission
    // criteria via the packet). The catch-all scan over the built IR must catch it.
    const model = fixedModel({
      structuredHints: {
        title: 'Build a daemon controller for the fleet',
        tier: 'standard',
        outcome: 'Ship the feature with green tests',
      },
    });
    const result = await softwareDevelopmentProfile.compile(
      { sourcePrompt: 'implement the feature end to end', context: baseContext() },
      model,
    );
    assert.equal(
      result.status,
      'invalid',
      'forbidden language smuggled into ir.title must be rejected',
    );
    assert.ok(
      result.validation.findings.some((f) => f.code === 'profile.forbidden_infra'),
      'reports profile.forbidden_infra for the smuggled title',
    );
  },
);

await check(
  'software profile rejects forbidden language SMUGGLED into an acceptance description',
  async () => {
    // acceptance[].description flows into ir.completion.acceptance AND the mission
    // criteria; the catch-all IR scan must cover it too.
    const model = fixedModel({
      structuredHints: {
        tier: 'standard',
        outcome: 'Ship the feature with green tests',
        acceptance: [
          {
            id: 'a1',
            description: 'a lease/heartbeat scheduler keeps the workers alive',
            oracle: 'review',
            required: true,
          },
        ],
      },
    });
    const result = await softwareDevelopmentProfile.compile(
      { sourcePrompt: 'implement the feature end to end', context: baseContext() },
      model,
    );
    assert.equal(
      result.status,
      'invalid',
      'forbidden language in an acceptance description must be rejected',
    );
    assert.ok(result.validation.findings.some((f) => f.code === 'profile.forbidden_infra'));
  },
);

// ---------------------------------------------------------------------------
// 7. Execution packet is deterministic for the same revision.
// ---------------------------------------------------------------------------

await check('buildLoopExecutionPacket is deterministic for the same revision', async () => {
  const model = fixedModel({
    structuredHints: {
      tier: 'standard',
      outcome: 'Search works end to end',
      acceptance: [
        {
          id: 'a1',
          description: 'unit tests pass',
          oracle: 'deterministic',
          evaluatorId: 'command_exit_zero',
          required: true,
        },
        { id: 'a2', description: 'reviewer confirms UX', oracle: 'review', required: false },
      ],
    },
  });
  const compiled = await softwareDevelopmentProfile.compile(
    { sourcePrompt: 'add search', context: baseContext() },
    model,
  );
  assert.equal(compiled.status, 'ready');
  const ir = compiled.ir!;
  const revision = {
    revisionId: 'rev-1',
    loopId: 'loop-1',
    revisionNumber: 1,
    sourcePrompt: 'add search',
    compiledIrJson: JSON.stringify(ir),
    compilerProfileId: 'software-development',
    compilerProfileVersion: '2.2.0',
    compilerVersion: '1',
    compileStatus: 'ready' as const,
    questionsJson: '[]',
    validationJson: '{}',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const skills = [
    {
      bindingId: 'b1',
      revisionId: 'rev-1',
      skillId: 'sk-1',
      skillVersion: '1.0.0',
      orderIndex: 0,
      configJson: '{"k":1}',
    },
  ];
  const p1 = buildLoopExecutionPacket(revision, ir, skills);
  const p2 = buildLoopExecutionPacket(revision, ir, skills);
  assert.deepEqual(p1, p2, 'same revision → identical packet');
  assert.equal(JSON.stringify(p1), JSON.stringify(p2), 'byte-identical');
  // The deterministic acceptance item maps to a real criterion; the review item
  // maps to a human gate (manual_approval), never raw evaluator JSON to fill in.
  const criteria = p1.missionDraft.criteria;
  assert.equal(criteria.length, 2);
  assert.equal(criteria[0]!.evaluatorId, 'command_exit_zero', 'deterministic → real evaluator');
  assert.equal(criteria[1]!.evaluatorId, 'manual_approval', 'review → human gate');
  assert.ok(
    criteria.some((c) => c.required),
    'a required criterion survives',
  );
});

if (h.failures > 0) {
  console.error(`\nloop-compiler: ${(h.checks - h.failures)} passed, ${h.failures} failed`);
  process.exit(1);
}
console.log(`\nloop-compiler: ${(h.checks - h.failures)} checks passed`);

if (!process.exitCode) h.report();
