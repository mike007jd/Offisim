import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRuntimeBuild } from './harness-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCENARIOS_DIR = resolve(ROOT, 'packages/core/harness/scenarios');
const manifest = JSON.parse(readFileSync(resolve(SCENARIOS_DIR, 'manifest.json'), 'utf8'));
const files = readdirSync(SCENARIOS_DIR)
  .filter((file) => file.endsWith('.json') && file !== 'manifest.json')
  .sort();
const manifestIds = manifest.scenarios.map((scenario) => scenario.id).sort();
const fileIds = files.map((file) => file.replace(/\.json$/u, '')).sort();

assertUnique(manifestIds, 'manifest scenario id');
assertSameList(manifestIds, fileIds, 'manifest scenarios', 'scenario files');

for (const file of files) {
  const scenario = JSON.parse(readFileSync(resolve(SCENARIOS_DIR, file), 'utf8'));
  const expectedId = file.replace(/\.json$/u, '');
  if (scenario.id !== expectedId) {
    throw new Error(`${file} id mismatch: expected ${expectedId}, got ${scenario.id}`);
  }
}

await ensureRuntimeBuild({ force: process.argv.includes('--force-build') });
const core = await import(new URL('../packages/core/dist/index.js', import.meta.url).href);
const graph = await import(
  new URL('../packages/core/dist/graph/main-graph.js', import.meta.url).href
);
const invariants = [
  await assertRuntimeDenyOverridesGrant(core),
  await assertPlanReviewCancelPersistsPayload(core),
  assertDagOutputAttribution(graph),
];

console.log(
  JSON.stringify(
    {
      ok: true,
      suite: 'contract',
      scenarioCount: manifestIds.length,
      scenarios: manifestIds,
      invariants,
    },
    null,
    2,
  ),
);

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function assertSameList(left, right, leftName, rightName) {
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    throw new Error(
      `${leftName} do not match ${rightName}\n${leftName}: ${left.join(', ')}\n${rightName}: ${right.join(', ')}`,
    );
  }
}

async function assertRuntimeDenyOverridesGrant(core) {
  const repos = core.createMemoryRepositories();
  let grantConsumed = false;
  const engine = new core.ToolPermissionEngine({
    employees: repos.employees,
    mcpAudit: repos.mcpAudit,
    approvals: repos.toolPermissionApprovals,
    runtimePolicy: {
      toolPermissions: {
        enabled: true,
        defaultBehavior: 'allow',
        rules: [{ pattern: 'mcp:filesystem:write_file', behavior: 'deny' }],
      },
    },
    grants: {
      consumeMatchingGrant() {
        grantConsumed = true;
        return { scope: 'thread' };
      },
    },
  });
  const decision = await engine.evaluate({
    threadId: 'thread-contract',
    serverName: 'filesystem',
    toolName: 'write_file',
  });
  if (decision.behavior !== 'deny' || grantConsumed) {
    throw new Error('permission-runtime-deny-overrides-thread-grant invariant failed');
  }
  return { id: 'permission.runtime_deny_absolute', passed: true };
}

async function assertPlanReviewCancelPersistsPayload(core) {
  const repos = core.createMemoryRepositories();
  const eventBus = new core.InMemoryEventBus();
  const service = new core.InteractionService({
    eventBus,
    companyId: 'company-contract',
    threadId: 'thread-contract',
    defaultMode: 'human_in_loop',
    activeRepo: repos.activeInteractions,
    historyRepo: repos.interactionHistory,
    permissionApprovals: repos.toolPermissionApprovals,
  });
  const request = {
    interactionId: 'ix-contract',
    threadId: 'thread-contract',
    companyId: 'company-contract',
    kind: 'plan_review',
    severity: 'normal',
    title: 'Review plan',
    prompt: 'Review plan',
    options: [{ id: 'cancel', label: 'Cancel' }],
    allowFreeformResponse: false,
    context: { type: 'plan_review', planId: 'plan-contract' },
    createdAt: 1,
  };
  await service.request(request, { payload: { summary: 'contract plan', steps: [] } });
  const active = await repos.activeInteractions.findByThread('thread-contract');
  if (!active?.payload_json) throw new Error('plan review active payload was not persisted');
  await service.resolve({
    interactionId: 'ix-contract',
    selectedOptionId: 'cancel',
    respondedAt: 2,
  });
  const decision = service.consumePlanReviewDecision('thread-contract');
  if (decision?.selectedOptionId !== 'cancel') {
    throw new Error('plan-review-cancel-terminates invariant failed');
  }
  const history = await repos.interactionHistory.listByThread('thread-contract');
  if (!history[0]?.payload_json) throw new Error('plan review history payload was not persisted');
  return { id: 'interaction.plan_review_cancel_payload', passed: true };
}

function assertDagOutputAttribution(graph) {
  const base = {
    employeeId: 'emp',
    employeeName: 'Employee',
    roleSlug: 'engineer',
    taskRunId: 'tr',
  };
  const grouped = graph.groupCurrentStepOutputsByStep(
    [
      { ...base, content: 'A_OUTPUT', stepIndex: 0 },
      { ...base, content: 'B_OUTPUT', stepIndex: 1 },
    ],
    [0, 1],
    0,
  );
  const step0 = grouped.get(0) ?? [];
  const step1 = grouped.get(1) ?? [];
  if (
    step0.length !== 1 ||
    step0[0]?.content !== 'A_OUTPUT' ||
    step1.length !== 1 ||
    step1[0]?.content !== 'B_OUTPUT'
  ) {
    throw new Error('dag-output-attribution invariant failed');
  }
  return { id: 'graph.step_outputs_grouped_by_step_index', passed: true };
}
