import { spawnSync } from 'node:child_process';
import process from 'node:process';

const BASELINE_WARNING_COUNTS = Object.freeze({
  './apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.ts|lint/style/noNonNullAssertion': 1,
  './apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts|lint/style/noNonNullAssertion': 1,
  './apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts|lint/suspicious/noExplicitAny': 2,
  './apps/desktop/renderer/src/runtime/host-event-dispatch.ts|lint/suspicious/noExplicitAny': 1,
  './apps/desktop/renderer/src/surfaces/mission/loops/graph/LoopGraphNode.tsx|lint/style/noNonNullAssertion': 1,
  './apps/desktop/renderer/src/surfaces/office/scene/scene-pathfinding.ts|lint/style/noNonNullAssertion': 23,
  './packages/core/src/loops/compiler-profiles/software-development/index.ts|lint/style/noNonNullAssertion': 1,
  './packages/core/src/loops/validate.ts|lint/style/noNonNullAssertion': 1,
  './packages/core/src/runtime/mission/workspace/checkpoint-manager.ts|lint/style/noNonNullAssertion': 4,
  './scripts/harness-collaboration-repo-contract.mts|lint/style/noNonNullAssertion': 3,
  './scripts/harness-connect-chat-flow.mts|lint/style/noNonNullAssertion': 1,
  './scripts/harness-employee-version-on-save.mts|lint/style/noNonNullAssertion': 3,
  './scripts/harness-install-core-integrity.mts|lint/style/noNonNullAssertion': 2,
  './scripts/harness-loop-authoring-flow.mts|lint/style/noNonNullAssertion': 9,
  './scripts/harness-loop-compiler.mts|lint/style/noNonNullAssertion': 12,
  './scripts/harness-loop-graph-projection.mts|lint/style/noNonNullAssertion': 11,
  './scripts/harness-loop-mission-adapter.mts|lint/style/noNonNullAssertion': 10,
  './scripts/harness-loop-office-invocation.mts|lint/style/noNonNullAssertion': 32,
  './scripts/harness-loop-repository.mts|lint/style/noNonNullAssertion': 13,
  './scripts/harness-mission-loop-controller.mts|lint/style/noNonNullAssertion': 20,
  './scripts/harness-mission-recovery.mts|lint/style/noNonNullAssertion': 6,
  './scripts/harness-mission-run-controller.mts|lint/style/noNonNullAssertion': 10,
  './scripts/harness-mission-service.mts|lint/style/noNonNullAssertion': 30,
  './scripts/harness-pi-collaboration-runtime.mts|lint/style/noNonNullAssertion': 4,
  './scripts/harness-run-recovery.mts|lint/style/noNonNullAssertion': 15,
  './scripts/harness-workspace-lease.mts|lint/style/noNonNullAssertion': 16,
});

const BASELINE_WARNING_TOTAL = Object.values(BASELINE_WARNING_COUNTS).reduce(
  (total, count) => total + count,
  0,
);

function warningSignature(diagnostic) {
  const path = diagnostic.location?.path?.file;
  return `${path ?? '<unknown>'}|${diagnostic.category ?? '<unknown>'}`;
}

function countWarnings(diagnostics) {
  const counts = new Map();
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity !== 'warning') continue;
    const signature = warningSignature(diagnostic);
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  return counts;
}

function findRegressions(warningCounts) {
  return [...warningCounts.entries()]
    .filter(([signature, count]) => count > (BASELINE_WARNING_COUNTS[signature] ?? 0))
    .sort(([left], [right]) => left.localeCompare(right));
}

function selfTest() {
  const unchanged = new Map(Object.entries(BASELINE_WARNING_COUNTS));
  const reduced = new Map(Object.entries(BASELINE_WARNING_COUNTS));
  reduced.set('./scripts/harness-mission-service.mts|lint/style/noNonNullAssertion', 29);
  const newSignature = new Map(reduced);
  newSignature.set('./new-file.ts|lint/suspicious/noExplicitAny', 1);
  const increased = new Map(reduced);
  increased.set('./scripts/harness-mission-service.mts|lint/style/noNonNullAssertion', 31);

  if (findRegressions(unchanged).length !== 0) throw new Error('unchanged baseline failed');
  if (findRegressions(reduced).length !== 0) throw new Error('downward ratchet failed');
  if (findRegressions(newSignature).length !== 1) throw new Error('new signature escaped');
  if (findRegressions(increased).length !== 1) throw new Error('increased count escaped');
  console.log('[biome-warning-ratchet] self-test passed');
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const result = spawnSync('./node_modules/.bin/biome', ['check', '--reporter=json', '.'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});

if (result.error) throw result.error;

let report;
try {
  report = JSON.parse(result.stdout);
} catch (error) {
  process.stderr.write(result.stderr);
  throw new Error(`Biome did not return valid JSON: ${error.message}`);
}

const diagnostics = report.diagnostics ?? [];
const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
if (errors.length > 0) {
  console.error(`[biome-warning-ratchet] ${errors.length} error(s); run pnpm lint:fix`);
  for (const error of errors) {
    console.error(`- ${warningSignature(error)}: ${error.description}`);
  }
  process.exit(1);
}

const warningCounts = countWarnings(diagnostics);
const regressions = findRegressions(warningCounts);
if (regressions.length > 0) {
  console.error('[biome-warning-ratchet] new or increased warning signatures:');
  for (const [signature, count] of regressions) {
    console.error(`- ${signature}: ${count} (baseline ${BASELINE_WARNING_COUNTS[signature] ?? 0})`);
  }
  process.exit(1);
}

const warningTotal = [...warningCounts.values()].reduce((total, count) => total + count, 0);
console.log(
  `[biome-warning-ratchet] passed: 0 errors, ${warningTotal}/${BASELINE_WARNING_TOTAL} warnings; no signature increased`,
);
