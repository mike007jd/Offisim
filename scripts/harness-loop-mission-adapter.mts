/**
 * Loop → Mission adapter oracle (PR-07). Asserts the compatibility contract PR-10
 * consumes: buildLoopExecutionPacket maps completion/oracles → Mission criteria,
 * is deterministic for the same revision, NEVER requires the user to hand-write
 * raw evaluator JSON, and that the EXISTING MissionService still accepts the
 * resulting criteria unchanged (the Mission engine stays the execution truth).
 *
 * Pure Node via tsx against `packages/core` source — no DOM, no renderer, no Pi.
 * Style mirrors scripts/harness-mission-service.mts.
 */

import assert from 'node:assert/strict';
import type { LoopIR, LoopRevision } from '../packages/shared-types/src/loops/index.ts';
import { buildLoopExecutionPacket } from '../packages/core/src/loops/mission-adapter.ts';
import { softwareDevelopmentProfile } from '../packages/core/src/loops/index.ts';
import { createMissionMemoryRepos } from '../packages/core/src/runtime/repos/mission/memory.ts';
import {
  createMissionService,
  type CreateMissionInput,
  type MissionServiceDeps,
  type MissionServiceRepos,
} from '../packages/core/src/runtime/mission/mission-service.ts';
import type { LoopCompileModel, LoopModelOutput } from '../packages/core/src/loops/types.ts';

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

function makeMissionDeps(): MissionServiceDeps {
  let idSeq = 0;
  let clockSeq = 0;
  return {
    newId: () => `mid-${(idSeq += 1).toString().padStart(4, '0')}`,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, (clockSeq += 1))).toISOString(),
  };
}

function freshMissionRepos(): MissionServiceRepos {
  const m = createMissionMemoryRepos();
  return {
    missions: m.missions,
    missionCriteria: m.missionCriteria,
    missionAttempts: m.missionAttempts,
    missionEvaluations: m.missionEvaluations,
    missionEvents: m.missionEvents,
  };
}

function fixedModel(output: LoopModelOutput): LoopCompileModel {
  return async () => output;
}

function revisionFor(ir: LoopIR): LoopRevision {
  return {
    revisionId: 'rev-1',
    loopId: 'loop-1',
    revisionNumber: 1,
    sourcePrompt: 'add a search feature',
    compiledIrJson: JSON.stringify(ir),
    compilerProfileId: 'software-development',
    compilerProfileVersion: '2.2.0',
    compilerVersion: '1',
    compileStatus: 'ready',
    questionsJson: '[]',
    validationJson: '{}',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const ctx = { companyId: 'co-1', projectId: 'proj-1', repository: { inspected: true } };

async function compileSampleIR(): Promise<LoopIR> {
  const model = fixedModel({
    structuredHints: {
      tier: 'standard',
      outcome: 'Users can search and results are correct',
      acceptance: [
        { id: 'a1', description: 'search unit tests pass', oracle: 'deterministic', evaluatorId: 'command_exit_zero', required: true },
        { id: 'a2', description: 'index file exists', oracle: 'deterministic', evaluatorId: 'file_exists', required: true },
        { id: 'a3', description: 'reviewer confirms relevance UX', oracle: 'review', required: false },
        { id: 'a4', description: 'product owner signs off on launch', oracle: 'human', required: true },
      ],
    },
  });
  const result = await softwareDevelopmentProfile.compile({ sourcePrompt: 'add search', context: ctx }, model);
  assert.equal(result.status, 'ready', `sample IR must compile ready: ${JSON.stringify(result.validation.findings)}`);
  return result.ir!;
}

// ---------------------------------------------------------------------------
// 1. completion/oracles → mission criteria mapping.
// ---------------------------------------------------------------------------

await check('completion acceptance items map to mission criteria with the right evaluators', async () => {
  const ir = await compileSampleIR();
  const packet = buildLoopExecutionPacket(revisionFor(ir), ir, []);
  const criteria = packet.missionDraft.criteria;
  assert.equal(criteria.length, 4, 'one criterion per acceptance item');

  // deterministic + named evaluator → that evaluator.
  assert.equal(criteria[0]!.evaluatorId, 'command_exit_zero');
  assert.equal(criteria[1]!.evaluatorId, 'file_exists');
  // review → human gate (manual_approval), NOT a fabricated deterministic evaluator.
  assert.equal(criteria[2]!.evaluatorId, 'manual_approval');
  // human → human gate.
  assert.equal(criteria[3]!.evaluatorId, 'manual_approval');

  // required flags are carried through.
  assert.equal(criteria[0]!.required, true);
  assert.equal(criteria[2]!.required, false);
  assert.equal(criteria[3]!.required, true);

  // order_index is 0..n in acceptance order.
  assert.deepEqual(criteria.map((c) => c.orderIndex), [0, 1, 2, 3]);

  // The packet carries the IR, title, sourcePrompt, and the runtime policy trace.
  assert.equal(packet.loopId, 'loop-1');
  assert.equal(packet.revisionId, 'rev-1');
  assert.equal(packet.ir.schemaVersion, '1');
  const policy = JSON.parse(packet.missionDraft.runtimePolicyJson);
  assert.equal(policy.profileId, 'software-development');
  assert.equal(policy.revisionId, 'rev-1');
});

// ---------------------------------------------------------------------------
// 2. NEVER requires hand-written evaluator JSON.
// ---------------------------------------------------------------------------

await check('non-determinable items become human gates — config is DERIVED, never user-authored raw JSON', async () => {
  const ir = await compileSampleIR();
  const packet = buildLoopExecutionPacket(revisionFor(ir), ir, []);
  for (const c of packet.missionDraft.criteria) {
    // Every criterion config is valid JSON the adapter produced (never a TODO /
    // placeholder the user must fill).
    const cfg = JSON.parse(c.evaluatorConfigJson);
    assert.ok(typeof cfg === 'object' && cfg !== null, 'config is a real object');
    assert.ok('acceptanceId' in cfg, 'config keys off the acceptance id, derived deterministically');
    assert.ok(!JSON.stringify(cfg).includes('TODO'), 'no placeholder the user must hand-write');
  }
  // The two non-deterministic items carry a reason (review/human), not raw config.
  const human = packet.missionDraft.criteria[3]!;
  assert.equal(JSON.parse(human.evaluatorConfigJson).reason, 'human');
});

// ---------------------------------------------------------------------------
// 3. Deterministic for the same revision.
// ---------------------------------------------------------------------------

await check('buildLoopExecutionPacket is byte-deterministic for the same revision', async () => {
  const ir = await compileSampleIR();
  const rev = revisionFor(ir);
  const skills = [
    { bindingId: 'b1', revisionId: 'rev-1', skillId: 'sk-2', skillVersion: '1', orderIndex: 1, configJson: '{}' },
    { bindingId: 'b0', revisionId: 'rev-1', skillId: 'sk-1', skillVersion: '1', orderIndex: 0, configJson: '{"x":1}' },
  ];
  const p1 = buildLoopExecutionPacket(rev, ir, skills);
  const p2 = buildLoopExecutionPacket(rev, ir, skills);
  assert.equal(JSON.stringify(p1), JSON.stringify(p2), 'identical packet bytes');
  // Skills are sorted by orderIndex deterministically.
  assert.deepEqual(p1.resolvedSkills.map((s) => s.skillId), ['sk-1', 'sk-2']);
});

await check('malformed skill binding config does not crash the packet — falls back to {}', async () => {
  const ir = await compileSampleIR();
  const rev = revisionFor(ir);
  const skills = [
    { bindingId: 'b0', revisionId: 'rev-1', skillId: 'sk-bad', skillVersion: '1', orderIndex: 0, configJson: '{not json' },
  ];
  const packet = buildLoopExecutionPacket(rev, ir, skills);
  assert.deepEqual(packet.resolvedSkills[0]!.config, {}, 'malformed config → empty object, no throw');
});

// ---------------------------------------------------------------------------
// 4. The EXISTING MissionService accepts the mapped criteria unchanged.
// ---------------------------------------------------------------------------

await check('the packet criteria feed the EXISTING MissionService unchanged (mission engine stays green)', async () => {
  const ir = await compileSampleIR();
  const packet = buildLoopExecutionPacket(revisionFor(ir), ir, []);

  // Hand the missionDraft straight to the real MissionService — this is exactly
  // what PR-10 does at Office Send. It must accept the criteria (incl. ≥1 required).
  const repos = freshMissionRepos();
  const svc = createMissionService(repos, makeMissionDeps());
  const input: CreateMissionInput = {
    companyId: 'co-1',
    threadId: 'thr-1',
    title: packet.title,
    goal: packet.missionDraft.goal,
    runtimeId: 'pi',
    runtimePolicyJson: packet.missionDraft.runtimePolicyJson,
    budgetJson: packet.missionDraft.budgetJson,
    criteria: packet.missionDraft.criteria.map((c) => ({
      description: c.description,
      evaluatorId: c.evaluatorId,
      evaluatorConfigJson: c.evaluatorConfigJson,
      required: c.required,
    })),
  };
  const mission = await svc.createMission(input);
  assert.equal(mission.status, 'draft', 'MissionService accepts the loop-derived mission');

  const persisted = await repos.missionCriteria.listByMission(mission.mission_id);
  assert.equal(persisted.length, 4, 'all four criteria persisted by the existing engine');
  assert.ok(persisted.some((c) => c.required === 1), 'the required criteria survive (engine requires ≥1)');
  // The deterministic evaluators map straight through.
  assert.ok(persisted.some((c) => c.evaluator_id === 'command_exit_zero'));
  assert.ok(persisted.some((c) => c.evaluator_id === 'manual_approval'));
});

if (failed > 0) {
  console.error(`\nloop-mission-adapter: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nloop-mission-adapter: ${passed} checks passed`);
