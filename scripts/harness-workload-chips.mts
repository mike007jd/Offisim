import type { ToolRichDetail } from '@offisim/shared-types';
/**
 * Deterministic gate for the office workload-bubble grouping (WAVE 1 shared
 * helper). Asserts the concurrency tiers (small / medium / large), the PRD chip
 * priority (blocked/resource outrank ordinary work), the terminal-only blocked
 * actor fallback, and the overflow → drilldown affordance. Pure projection →
 * grouping, so every assertion compares against distinct expected values.
 */
import type {
  EmployeeWorkloadProjection,
  WorkloadPriorityIssue,
  WorkloadSummary,
} from '../apps/desktop/renderer/src/assistant/runtime/conversation-run-projections.js';
import {
  groupedWorkload,
  sceneWorkDetailSummary,
} from '../apps/desktop/renderer/src/assistant/runtime/scene-cue-projection.js';
import { compactWorkBenchSummary } from '../apps/desktop/renderer/src/surfaces/office/scene/work-bench/WorkBench.js';

let checks = 0;
let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// --- compact/PiP workbench: every rich family crosses one human-summary boundary --
{
  const details: ToolRichDetail[] = [
    {
      family: 'terminal',
      command: 'pwd',
      outputSummary: '/private/tmp/offisim-secret-worktree',
    },
    { family: 'file', path: '/Users/dev/private.txt', summary: '+ secret = true' },
    { family: 'search', query: 'PRIVATE_TOKEN', hitCount: 4 },
    { family: 'browser', url: 'https://internal.example/private', title: 'Admin' },
    {
      family: 'computer',
      action: 'click',
      targetApp: 'Secrets',
      targetWindow: 'Production',
      coordinates: { x: 941, y: 612 },
      textPreview: 'sensitive copy',
    },
  ];
  const expected = [
    'Verify changes',
    'Update task',
    'Research files',
    'Research files',
    'Verify changes',
  ];

  details.forEach((detail, index) => {
    const summary = compactWorkBenchSummary(detail);
    check(
      `compact ${detail.family} bench is deterministic human text`,
      summary === expected[index],
      summary,
    );
  });
}

// --- selected workbench: generic tool payloads use the same trust boundary --
{
  const delegatePayload = JSON.stringify({
    input: { tasks: [{ employeeId: 'e1' }, { employeeId: 'e2' }] },
  });
  check(
    'generic delegate payload → verb + object + count',
    sceneWorkDetailSummary(delegatePayload) === 'Delegate 2 tasks',
    sceneWorkDetailSummary(delegatePayload),
  );
  check(
    'clipped delegate payload → safe human summary',
    sceneWorkDetailSummary('{"input":{"tasks":[{"employeeId"') === 'Delegate task',
  );
  check(
    'unknown generic JSON → human fallback',
    sceneWorkDetailSummary('{"input":{"opaque":true}}') === 'Work on task',
  );
}

console.log('[workload-chips] groupedWorkload tiers + priority');

function summary(over: Partial<WorkloadSummary> = {}): WorkloadSummary {
  return {
    total: over.total ?? 1,
    byWorkKind: over.byWorkKind ?? {},
    byStatus: over.byStatus ?? { working: 0, waiting: 0, blocked: 0, artifact: 0 },
    priorityIssues: over.priorityIssues ?? [],
    artifactCount: over.artifactCount ?? 0,
    approvalCount: over.approvalCount ?? 0,
  };
}

function proj(over: Partial<EmployeeWorkloadProjection>): EmployeeWorkloadProjection {
  return {
    employeeId: over.employeeId ?? 'e',
    activeRunIds: over.activeRunIds ?? [],
    activeCount: over.activeCount ?? 0,
    waitingCount: over.waitingCount ?? 0,
    workloadChips: over.workloadChips ?? [],
    dominant: over.dominant ?? null,
    workloadSummary: over.workloadSummary ?? summary(),
  };
}

const issue = (kind: WorkloadPriorityIssue['kind'], label: string): WorkloadPriorityIssue => ({
  runId: 'r',
  kind,
  label,
  severity: kind === 'approval' ? 'warning' : 'exhausted',
  terminal: false,
});

// --- small: 1 run -----------------------------------------------------------
{
  const g = groupedWorkload(
    proj({
      activeCount: 1,
      activeRunIds: ['a'],
      workloadChips: [{ runId: 'a', label: 'Read', tone: 'work' }],
      workloadSummary: summary({
        total: 1,
        byWorkKind: { research: 1 },
        byStatus: { working: 1, waiting: 0, blocked: 0, artifact: 0 },
      }),
    }),
  );
  check('1 run → tier small', g.tier === 'small', g.tier);
  check('1 run → countLabel null', g.countLabel === null, `${g.countLabel}`);
  check(
    '1 run → one per-run chip, no count',
    g.chips.length === 1 && g.chips[0]?.count === undefined,
    JSON.stringify(g.chips),
  );
  check('1 run → no overflow', g.overflow === false);
}

// --- small: 3 runs → ×3 -----------------------------------------------------
{
  const g = groupedWorkload(
    proj({
      activeCount: 3,
      activeRunIds: ['a', 'b', 'c'],
      workloadChips: [
        { runId: 'a', label: 'Read', tone: 'work' },
        { runId: 'b', label: 'Compute', tone: 'work' },
        { runId: 'c', label: 'Review', tone: 'work' },
      ],
      workloadSummary: summary({
        total: 3,
        byWorkKind: { research: 3 },
        byStatus: { working: 3, waiting: 0, blocked: 0, artifact: 0 },
      }),
    }),
  );
  check('3 runs → tier small', g.tier === 'small', g.tier);
  check('3 runs → countLabel ×3', g.countLabel === '×3', `${g.countLabel}`);
  check('3 runs → chips ≤ 3', g.chips.length <= 3, `${g.chips.length}`);
}

// --- medium: 8 runs, mixed, blocked outranks --------------------------------
{
  const g = groupedWorkload(
    proj({
      activeCount: 8,
      activeRunIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      workloadSummary: summary({
        total: 8,
        byWorkKind: { research: 4, implement: 3, review: 1 },
        byStatus: { working: 4, waiting: 1, blocked: 2, artifact: 1 },
        priorityIssues: [issue('resource', 'Token exhausted'), issue('approval', 'Approval')],
        artifactCount: 1,
        approvalCount: 1,
      }),
    }),
  );
  check('8 runs → tier medium', g.tier === 'medium', g.tier);
  check('8 runs → ≤ 4 grouped chips', g.chips.length <= 4, `${g.chips.length}`);
  check(
    '8 runs → issue summary is first (outranks work)',
    g.chips[0]?.label === 'Resolve issue' && g.chips[0]?.tone === 'risk',
    JSON.stringify(g.chips[0]),
  );
  check(
    '8 runs → grouped chips carry counts',
    g.chips.every((c) => typeof c.count === 'number'),
    JSON.stringify(g.chips),
  );
  check('8 runs → blocked count is 2', g.chips[0]?.count === 2, `${g.chips[0]?.count}`);
  check('8 runs → overflow (5 groups > 4 shown)', g.overflow === true);
  check(
    '8 runs → topIssue is the resource strain',
    g.topIssue?.kind === 'resource',
    JSON.stringify(g.topIssue),
  );
}

// --- large: 58 runs → distribution, ×58 -------------------------------------
{
  const g = groupedWorkload(
    proj({
      activeCount: 58,
      activeRunIds: Array.from({ length: 58 }, (_v, i) => `r${i}`),
      workloadSummary: summary({
        total: 58,
        byWorkKind: { research: 24, implement: 16, review: 9, plan: 6 },
        byStatus: { working: 55, waiting: 0, blocked: 3, artifact: 0 },
        priorityIssues: [issue('failure', 'Build failed')],
      }),
    }),
  );
  check('58 runs → tier large', g.tier === 'large', g.tier);
  check('58 runs → countLabel ×58', g.countLabel === '×58', `${g.countLabel}`);
  check('58 runs → exactly 4 chips (fixed dims)', g.chips.length === 4, `${g.chips.length}`);
  check(
    '58 runs → issue summary reserved first',
    g.chips[0]?.label === 'Resolve issue' && g.chips[0]?.count === 3,
    JSON.stringify(g.chips[0]),
  );
  check(
    '58 runs → top work kind is a human summary with count 24',
    g.chips.some((c) => c.label === 'Research files' && c.count === 24),
    JSON.stringify(g.chips),
  );
  check('58 runs → overflow drops the smallest bucket', g.overflow === true);
}

// --- hostile/verbose upstream labels never reach either scene verbatim ------
{
  const raw = 'ks":[{"employeeId":"e1","objective":"update the board"}]';
  const verbose = 'Inspect and update every task board card before reporting completion';
  const g = groupedWorkload(
    proj({
      activeCount: 2,
      activeRunIds: ['raw', 'verbose'],
      workloadChips: [
        { runId: 'raw', label: raw, tone: 'work' },
        { runId: 'verbose', label: verbose, tone: 'work' },
      ],
      workloadSummary: summary({
        total: 2,
        byWorkKind: { implement: 2 },
        byStatus: { working: 2, waiting: 0, blocked: 0, artifact: 0 },
      }),
    }),
  );
  check(
    'raw JSON-like payload → human fallback',
    g.chips[0]?.label === 'Work on task',
    JSON.stringify(g.chips),
  );
  check(
    'verbose plain label → bounded with ellipsis',
    (g.chips[1]?.label.length ?? 99) <= 22 && g.chips[1]?.label.endsWith('…') === true,
    JSON.stringify(g.chips),
  );
  check(
    'no bubble chip retains payload syntax',
    g.chips.every((chip) => !/[{}\[\]]|"\s*:/u.test(chip.label)),
    JSON.stringify(g.chips),
  );
}

// --- terminal-only blocked actor: activeCount 0 but visible issue -----------
{
  const g = groupedWorkload(
    proj({
      activeCount: 0,
      activeRunIds: [],
      workloadChips: [],
      workloadSummary: summary({
        total: 1,
        byWorkKind: { unclassified: 1 },
        byStatus: { working: 0, waiting: 0, blocked: 1, artifact: 0 },
        priorityIssues: [
          { runId: 'dead', kind: 'failure', label: 'Crashed', severity: 'blocked', terminal: true },
        ],
      }),
    }),
  );
  check('terminal-only → tier small', g.tier === 'small', g.tier);
  check(
    'terminal-only → countLabel null (no active concurrency)',
    g.countLabel === null,
    `${g.countLabel}`,
  );
  check(
    'terminal-only → synthesizes a risk chip from the top issue',
    g.chips.length === 1 && g.chips[0]?.tone === 'risk' && g.chips[0]?.label === 'Crashed',
    JSON.stringify(g.chips),
  );
  check(
    'terminal-only → topIssue is the failed child',
    g.topIssue?.terminal === true,
    JSON.stringify(g.topIssue),
  );
}

// --- inject-proof: a constant grouping would fail the tier assertions -------
{
  const small = groupedWorkload(proj({ activeCount: 1, workloadSummary: summary({ total: 1 }) }));
  const large = groupedWorkload(
    proj({
      activeCount: 20,
      workloadSummary: summary({
        total: 20,
        byWorkKind: { research: 20 },
        byStatus: { working: 20, waiting: 0, blocked: 0, artifact: 0 },
      }),
    }),
  );
  check(
    'inject-proof: small ≠ large tier',
    small.tier !== large.tier,
    `${small.tier}/${large.tier}`,
  );
}

console.log(`\nworkload-chips: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`workload-chips gate FAILED with ${failures} failure(s)`);
  process.exit(1);
}
console.log('workload-chips gate PASSED');
