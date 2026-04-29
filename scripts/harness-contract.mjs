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
const planReview = await import(
  new URL('../packages/core/dist/agents/pm-planner/plan-review-payload.js', import.meta.url).href
);
const microCompact = await import(
  new URL('../packages/core/dist/services/conversation-budget/micro-compact.js', import.meta.url)
    .href
);
const completionVerifier = await import(
  new URL('../packages/core/dist/runtime/completion-verifier.js', import.meta.url).href
);
const leakDetector = await import(
  new URL('../packages/core/dist/testing/leak-detector.js', import.meta.url).href
);
const invariants = [
  await assertRuntimeDenyOverridesGrant(core),
  await assertOnceApprovalIsConsumedOnce(core),
  await assertThreadApprovalIsReusable(core),
  await assertPlanReviewCancelPersistsPayload(core),
  await assertPlanReviewPayloadValidation(planReview),
  assertLongRunningMicroCompactScenario(microCompact),
  assertCompletionVerifierScenario(completionVerifier),
  assertLeakDetectorScenario(leakDetector),
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

function readScenario(id) {
  return JSON.parse(readFileSync(resolve(SCENARIOS_DIR, `${id}.json`), 'utf8'));
}

function assertLongRunningMicroCompactScenario(microCompact) {
  const scenario = readScenario('long-running-microcompact-triggers');
  const fixture = scenario.fixture;
  const messages = Array.from({ length: fixture.toolResultCount }, (_, index) => ({
    role: 'tool',
    content: `${String(index).repeat(fixture.toolResultBytes)}`,
    toolCallId: `tool-${index}`,
  }));
  const result = microCompact.microCompactMessages(messages, {
    maxToolResultBytes: fixture.maxToolResultBytes,
    snippetBytes: fixture.snippetBytes,
    preserveLastN: fixture.preserveLastN,
  });
  const joined = result.messages.map((message) => message.content).join('\n');
  const markerCount = (joined.match(/\[microcompacted \d+ bytes\]/gu) ?? []).length;
  const finalBytes = new TextEncoder().encode(joined).byteLength;
  if (markerCount !== fixture.toolResultCount) {
    throw new Error(
      `micro-compact marker count mismatch: expected ${fixture.toolResultCount}, got ${markerCount}`,
    );
  }
  if (finalBytes > fixture.maxFinalNonSystemBytes) {
    throw new Error(`micro-compact final bytes exceeded limit: ${finalBytes}`);
  }
  return { id: 'long_running.microcompact_triggers', passed: true };
}

function assertCompletionVerifierScenario(completionVerifier) {
  const scenario = readScenario('completion-verifier-blocks-without-evidence');
  const outcome = completionVerifier.verifyCompletion({
    recentToolResults: scenario.fixture.recentToolResults,
  });
  if (outcome.ok) {
    throw new Error('completion verifier allowed completion without evidence');
  }
  if (scenario.fixture.expectedState !== 'review_ready') {
    throw new Error(`unexpected blocked state fixture: ${scenario.fixture.expectedState}`);
  }
  if (scenario.fixture.expectedEventKind !== 'completion-blocked') {
    throw new Error(`unexpected blocked event fixture: ${scenario.fixture.expectedEventKind}`);
  }
  return { id: 'completion.verifier_blocks_without_evidence', passed: true };
}

function assertLeakDetectorScenario(leakDetector) {
  const scenario = readScenario('soak-leak-detector-catches-pending-assignment');
  const leaks = leakDetector.summarizeRuntimeLeaks([
    {
      scenarioId: scenario.id,
      passed: false,
      traceHash: 'fixture',
      assertions: [],
      trace: {
        events: [],
        db: {
          taskRuns: [],
          llmCalls: [],
          mcpAudit: [],
          activeInteractions: [],
          interactionHistory: [],
          toolPermissionApprovals: [],
        },
        finalState: {
          pendingAssignments: scenario.fixture.pendingAssignments,
        },
      },
    },
  ]);
  if (leaks.pendingAssignmentsLeaked !== scenario.fixture.expectedPendingAssignmentsLeaked) {
    throw new Error(
      `leak detector pending assignment mismatch: expected ${scenario.fixture.expectedPendingAssignmentsLeaked}, got ${leaks.pendingAssignmentsLeaked}`,
    );
  }
  return { id: 'soak.leak_detector_reports_pending_assignments', passed: true };
}

async function assertRuntimeDenyOverridesGrant(core) {
  const repos = core.createMemoryRepositories();
  let grantConsumed = false;
  const engine = new core.ToolPermissionEngine({
    companyId: 'company-contract',
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
  const payload = await planReview.buildPlanReviewPayload(makeContractPlan('contract plan'));
  await service.request(request, { payload });
  const active = await repos.activeInteractions.findByThread('thread-contract');
  if (!active?.payload_json) throw new Error('plan review active payload was not persisted');
  const activePayload = JSON.parse(active.payload_json);
  if (activePayload.type !== 'plan_review_payload') {
    throw new Error('plan review active payload was not enveloped');
  }
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

async function assertPlanReviewPayloadValidation(planReviewModule) {
  const plan = makeContractPlan('hash checked plan');
  const payload = await planReviewModule.buildPlanReviewPayload(plan);
  const parsed = await planReviewModule.parseReviewedPlanPayload(payload);
  if (!parsed || parsed.summary !== plan.summary) {
    throw new Error('plan-review payload parser rejected valid payload');
  }
  const mutated = {
    ...payload,
    plan: {
      ...payload.plan,
      summary: 'mutated plan',
    },
  };
  if (await planReviewModule.parseReviewedPlanPayload(mutated)) {
    throw new Error('plan-review payload parser accepted hash mismatch');
  }
  if (await planReviewModule.parseReviewedPlanPayload({ type: 'plan_review_payload' })) {
    throw new Error('plan-review payload parser accepted invalid shape');
  }
  return { id: 'interaction.plan_review_payload_validated', passed: true };
}

async function assertOnceApprovalIsConsumedOnce(core) {
  const repos = core.createMemoryRepositories();
  const engine = makeAskFirstTimePermissionEngine(core, repos);
  const request = makeAskFirstTimePermissionRequest();

  const initial = await engine.evaluate(request);
  if (initial.behavior !== 'ask' || !initial.policyHash) {
    throw new Error('permission-once-approval setup did not produce ask decision');
  }

  await repos.toolPermissionApprovals.create(
    makeAskFirstTimeApproval({
      approvalId: 'tpa-contract-once',
      request,
      policyHash: initial.policyHash,
      scope: 'once',
      approvedBy: 'interaction:once',
    }),
  );

  const first = await engine.evaluate(request);
  if (first.behavior !== 'allow' || first.approvedBy !== 'employee:ask_first_time:once') {
    throw new Error('permission-once-approval did not allow first reuse');
  }
  const consumed = repos.toolPermissionApprovals
    .snapshot()
    .find((row) => row.approval_id === 'tpa-contract-once')?.consumed_at;
  if (!consumed) {
    throw new Error('permission-once-approval was not consumed');
  }

  const second = await engine.evaluate(request);
  if (second.behavior !== 'ask') {
    throw new Error('permission-once-approval was reused after consumption');
  }

  return { id: 'permission.once_approval_consumed_once', passed: true };
}

async function assertThreadApprovalIsReusable(core) {
  const repos = core.createMemoryRepositories();
  const engine = makeAskFirstTimePermissionEngine(core, repos);
  const request = makeAskFirstTimePermissionRequest();

  const initial = await engine.evaluate(request);
  if (initial.behavior !== 'ask' || !initial.policyHash) {
    throw new Error('permission-thread-approval setup did not produce ask decision');
  }

  await repos.toolPermissionApprovals.create(
    makeAskFirstTimeApproval({
      approvalId: 'tpa-contract-thread',
      request,
      policyHash: initial.policyHash,
      scope: 'thread',
      approvedBy: 'interaction:thread',
    }),
  );

  const first = await engine.evaluate(request);
  const second = await engine.evaluate(request);
  if (
    first.behavior !== 'allow' ||
    second.behavior !== 'allow' ||
    first.approvedBy !== 'employee:ask_first_time:thread' ||
    second.approvedBy !== 'employee:ask_first_time:thread'
  ) {
    throw new Error('permission-thread-approval was not reusable');
  }

  return { id: 'permission.thread_approval_reused', passed: true };
}

function makeAskFirstTimePermissionEngine(core, repos) {
  return new core.ToolPermissionEngine({
    companyId: 'company-contract',
    employees: repos.employees,
    mcpAudit: repos.mcpAudit,
    approvals: repos.toolPermissionApprovals,
  });
}

function makeAskFirstTimePermissionRequest() {
  return {
    threadId: 'thread-contract',
    serverName: 'filesystem',
    toolName: 'write_file',
    employeeId: 'emp-contract',
    employeeConfigJson: JSON.stringify({
      toolPermissionPolicy: {
        defaultMode: 'ask_first_time',
        overrides: [],
      },
    }),
  };
}

function makeAskFirstTimeApproval({ approvalId, request, policyHash, scope, approvedBy }) {
  return {
    approval_id: approvalId,
    thread_id: request.threadId,
    company_id: 'company-contract',
    employee_id: request.employeeId,
    server_name: request.serverName,
    tool_name: request.toolName,
    scope,
    approved_by: approvedBy,
    policy_hash: policyHash,
    consumed_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    expires_at: null,
  };
}

function makeContractPlan(summary) {
  return {
    summary,
    steps: [
      {
        stepIndex: 0,
        description: 'Contract step',
        tasks: [
          {
            taskType: 'general',
            employeeId: 'emp-contract',
            description: 'Contract task',
            dependsOnStepOutput: false,
          },
        ],
      },
    ],
  };
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
