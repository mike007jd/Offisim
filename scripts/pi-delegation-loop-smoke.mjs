#!/usr/bin/env node
/**
 * Delegation-loop smoke (Phase 1 + Phase 2). Proves the Node-side delegation
 * mechanism against the real Pi SDK.
 *
 * Structural checks (no credentials — always run, gate the exit code):
 *   - depth cap blocks a delegation past maxDepth (before any session is built)
 *   - total-children cap blocks once the budget is exhausted
 *
 * Live checks (auto-run only when the real Pi agent dir has an available model;
 * informational, never fail the run):
 *   - tool registration: the `delegate` tool registers on a root session
 *   - single delegation: supervisor.runSingle builds an in-process child, runs it,
 *     emits run.started → run.completed, returns the child's summary
 *   - parallel delegation: supervisor.runParallel fans out concurrently
 *
 *   node scripts/pi-delegation-loop-smoke.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SettingsManager,
  createAgentSession,
  getAgentDir,
} from '@earendil-works/pi-coding-agent';
import {
  createChildSupervisor,
  createDelegationLimits,
  parseChildSummary,
  renderChildSummary,
} from './pi-child-supervisor.mjs';
import { createDelegationExtensionFactory } from './pi-delegation-extension.mjs';

const errMsg = (e) => (e instanceof Error ? e.message : String(e));
let failed = false;
const check = (ok, label, detail) => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
};
const info = (label, detail) => console.log(`ℹ️  ${label}${detail ? ` — ${detail}` : ''}`);

const ROSTER = [
  { employeeId: 'emp-scout', name: 'Scout', roleSlug: 'researcher', persona: 'You are terse. Answer in one short sentence. No tools.' },
  { employeeId: 'emp-writer', name: 'Writer', roleSlug: 'writer', persona: 'You are terse. Answer in one short sentence. No tools.' },
];

function baseCtx(extra) {
  return {
    emit: () => {},
    agentDir: undefined,
    authStorage: undefined,
    modelRegistry: undefined,
    cwd: process.cwd(),
    settingsManager: undefined,
    threadId: 'thread-smoke',
    rootRunId: 'attempt-smoke',
    roster: ROSTER,
    resolveModel: () => undefined,
    buildPermissionGate: () => null,
    ...extra,
  };
}

async function structuralChecks() {
  // Depth cap: a supervisor already at depth=maxDepth must block before building
  // a session (so this needs no credentials).
  const depthEmitted = [];
  const depthSup = createChildSupervisor(
    baseCtx({ emit: (l) => depthEmitted.push(l), limits: createDelegationLimits({ maxDepth: 1 }), depth: 1 }),
  );
  const depthResult = await depthSup.runSingle({ employeeId: 'emp-scout', objective: 'x', access: 'read' });
  check(
    /blocked/i.test(depthResult) && depthEmitted.some((l) => l.runType === 'run.failed'),
    'depth cap blocks past maxDepth',
    depthResult.slice(0, 60),
  );

  // Total cap: maxTotalChildren=0 → the first spawn blocks.
  const totalEmitted = [];
  const totalSup = createChildSupervisor(
    baseCtx({ emit: (l) => totalEmitted.push(l), limits: createDelegationLimits({ maxTotalChildren: 0 }) }),
  );
  const totalResult = await totalSup.runSingle({ employeeId: 'emp-scout', objective: 'x', access: 'read' });
  check(
    /blocked/i.test(totalResult) && totalEmitted.some((l) => l.runType === 'run.failed'),
    'total-children cap blocks when exhausted',
    totalResult.slice(0, 60),
  );

  // Token budget (Phase 4): once spend crosses the budget, the next round blocks.
  const budgetEmitted = [];
  const budgetLimits = createDelegationLimits({ maxTotalTokens: 10 });
  budgetLimits.recordTokens({ input: 100, output: 100 }); // push spend past the budget
  const budgetSup = createChildSupervisor(
    baseCtx({ emit: (l) => budgetEmitted.push(l), limits: budgetLimits }),
  );
  const budgetResult = await budgetSup.runSingle({ employeeId: 'emp-scout', objective: 'x', access: 'read' });
  check(
    /budget/i.test(budgetResult) && budgetEmitted.some((l) => l.runType === 'run.failed'),
    'token budget blocks when exhausted',
    budgetResult.slice(0, 60),
  );

  // Structured child summary parser (Phase 4): deterministic, graceful fallback.
  const headingFree = parseChildSummary('Did the thing.\nIt worked.');
  check(
    headingFree.summary === 'Did the thing.\nIt worked.' &&
      headingFree.artifacts.length === 0 &&
      headingFree.risks.length === 0,
    'parseChildSummary: heading-free reply is summary-only (no fabricated sections)',
  );
  const structured = parseChildSummary(
    [
      '## Summary',
      'Fixed the flaky test.',
      '## Artifacts',
      '- src/foo.ts',
      '## Risks',
      '- timing-dependent',
      '**Verification:**',
      '- ran the suite 10x',
    ].join('\n'),
  );
  check(
    structured.summary === 'Fixed the flaky test.' &&
      structured.artifacts.length === 1 &&
      structured.artifacts[0] === 'src/foo.ts' &&
      structured.risks[0] === 'timing-dependent' &&
      structured.verification[0] === 'ran the suite 10x',
    'parseChildSummary: routes #/bold headings + bullets into the right buckets',
  );
  check(
    renderChildSummary(structured).includes('Artifacts:') &&
      renderChildSummary(structured).includes('- src/foo.ts'),
    'renderChildSummary: emits a compact labeled block',
  );
  // A child may write the heading and its content on the SAME line (mirroring the
  // guidance's "## Summary — …" format) — the trailing text must still bucket.
  const sameLine = parseChildSummary('## Summary — fixed it\n## Artifacts — src/a.ts\n## Risks — timing only');
  check(
    sameLine.summary === 'fixed it' &&
      sameLine.artifacts[0] === 'src/a.ts' &&
      sameLine.risks[0] === 'timing only',
    'parseChildSummary: same-line "## Heading — content" captures into the right bucket',
  );
  check(
    parseChildSummary('Risks were mitigated and verification passed.').artifacts.length === 0 &&
      parseChildSummary('Risks were mitigated.').risks.length === 0,
    'parseChildSummary: a plain line starting with a keyword is not a false heading',
  );
}

async function liveChecks() {
  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create(join(agentDir, 'auth.json'));
  const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, 'models.json'));
  const available = modelRegistry.getAvailable();
  if (available.length === 0) {
    info('Live checks skipped', 'no available model in the real Pi agent dir');
    return;
  }
  const model = available[0];
  console.log(`\nLive checks using model ${model.id}`);
  const cwd = mkdtempSync(join(tmpdir(), 'pi-deleg-loop-'));
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const emitted = [];
  const sup = createChildSupervisor(
    baseCtx({
      emit: (l) => emitted.push(l),
      agentDir,
      authStorage,
      modelRegistry,
      cwd,
      settingsManager,
      limits: createDelegationLimits({ maxParallelPerDelegation: 2 }),
    }),
  );

  // Tool registration
  try {
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      extensionFactories: [createDelegationExtensionFactory(sup)],
    });
    await loader.reload();
    const { session } = await createAgentSession({ cwd, agentDir, authStorage, modelRegistry, model, resourceLoader: loader });
    check(session.getActiveToolNames().includes('delegate'), 'delegate tool registers on root session');
    session.dispose();
  } catch (error) {
    check(false, 'delegate tool registers on root session', errMsg(error));
  }

  // Single delegation
  try {
    const summary = await sup.runSingle({ employeeId: 'emp-scout', objective: 'Capital of France? One word.', access: 'read' });
    const started = emitted.find((l) => l.runType === 'run.started');
    check(
      emitted.some((l) => l.runType === 'run.completed' || l.runType === 'run.failed') && typeof summary === 'string' && summary.trim().length > 0,
      'single delegation returns a summary',
      `"${summary.slice(0, 40)}" parent=${started?.parentRunId}`,
    );
  } catch (error) {
    check(false, 'single delegation', errMsg(error));
  }

  // Parallel delegation (2 tasks, both should complete)
  try {
    emitted.length = 0;
    const combined = await sup.runParallel(
      [
        { employeeId: 'emp-scout', objective: 'Reply with exactly RED.', access: 'read' },
        { employeeId: 'emp-writer', objective: 'Reply with exactly BLUE.', access: 'read' },
      ],
      undefined,
    );
    const starts = emitted.filter((l) => l.runType === 'run.started').length;
    const completes = emitted.filter((l) => l.runType === 'run.completed').length;
    check(
      starts === 2 && completes === 2 && combined.includes('emp-scout') && combined.includes('emp-writer'),
      'parallel delegation runs both tasks',
      `${starts} started / ${completes} completed`,
    );
  } catch (error) {
    check(false, 'parallel delegation', errMsg(error));
  }

  rmSync(cwd, { recursive: true, force: true });
}

async function main() {
  console.log('Delegation-loop smoke (Phase 1 + 2)\n');
  await structuralChecks();
  await liveChecks();
  console.log('');
  console.log(failed ? 'VERDICT: delegation loop FAILED' : 'VERDICT: delegation loop OK (limits + single + parallel)');
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('Unhandled:', errMsg(error));
  process.exit(1);
});
