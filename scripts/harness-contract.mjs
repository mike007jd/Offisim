import { spawnSync } from 'node:child_process';
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
  assertNoSelfAttestFinalOutput(scenario, file);
}

await ensureRuntimeBuild({ force: process.argv.includes('--force-build') });
ensureDesktopAgentHosts();
const core = await import(new URL('../packages/core/dist/index.js', import.meta.url).href);
const sharedKanban = await import(
  new URL('../packages/shared-types/dist/kanban.js', import.meta.url).href
);
const graph = await import(
  new URL('../packages/core/dist/graph/main-graph.js', import.meta.url).href
);
const planReview = await import(
  new URL('../packages/core/dist/agents/pm-planner/plan-review-payload.js', import.meta.url).href
);
const pmPlanParser = await import(
  new URL('../packages/core/dist/agents/pm-planner/plan-parser.js', import.meta.url).href
);
const microCompact = await import(
  new URL('../packages/core/dist/services/conversation-budget/micro-compact.js', import.meta.url)
    .href
);
const completionVerifier = await import(
  new URL('../packages/core/dist/runtime/completion-verifier.js', import.meta.url).href
);
const taskToolIntent = await import(
  new URL('../packages/core/dist/agents/task-tool-intent.js', import.meta.url).href
);
const employeeCompletion = await import(
  new URL('../packages/core/dist/agents/employee-completion.js', import.meta.url).href
);
const bossSummary = await import(
  new URL('../packages/core/dist/agents/boss-summary-node.js', import.meta.url).href
);
const leakDetector = await import(
  new URL('../packages/core/dist/testing/leak-detector.js', import.meta.url).href
);
const soakRunner = await import(
  new URL('../packages/core/dist/testing/soak-runner.js', import.meta.url).href
);
const logger = await import(
  new URL('../packages/core/dist/services/logger.js', import.meta.url).href
);
logger.setLogHandler(() => {});
const invariants = [
  await assertRuntimeDenyOverridesGrant(core),
  await assertOnceApprovalIsConsumedOnce(core),
  await assertThreadApprovalIsReusable(core),
  await assertPlanReviewCancelPersistsPayload(core),
  await assertPlanReviewPayloadValidation(planReview),
  assertArtifactFallbackIsPhased(pmPlanParser),
  assertTaskRunStatusBaseline(),
  assertLongRunningMicroCompactScenario(microCompact),
  assertCompletionVerifierScenario(completionVerifier),
  assertCompletionEvidenceFamilies(completionVerifier),
  assertCodexFullAgentRequestGuards(),
  assertBashEvidenceCanSatisfyFileIntent(completionVerifier, taskToolIntent),
  await assertArtifactTasksRequireWriteAudit(employeeCompletion),
  await assertBossSummaryWaitsForPendingPlan(bossSummary),
  assertLeakDetectorScenario(leakDetector),
  await assertSoakBoundedMemoryScenario(soakRunner),
  assertDagOutputAttribution(graph),
  assertKanbanStateMachineSsot(sharedKanban),
  assertDesktopKanbanStateMachineScenario(),
  ...assertDesktopBuiltinToolScenarios(),
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

function assertNoSelfAttestFinalOutput(scenario, file) {
  const llmContents = new Set(
    (scenario.llmTurns ?? [])
      .map((turn) => (typeof turn?.content === 'string' ? turn.content : null))
      .filter((content) => content && content.trim().length > 0),
  );
  for (const assertion of scenario.assertions ?? []) {
    if (
      assertion?.kind === 'finalOutputContains' &&
      typeof assertion.contains === 'string' &&
      llmContents.has(assertion.contains)
    ) {
      throw new Error(
        `${file} self-attests finalOutputContains with exact llmTurns content: ${assertion.contains}`,
      );
    }
  }
}

function assertDesktopBuiltinToolScenarios() {
  const scenarioIds = [
    'builtin-tools-rejects-symlink-escape',
    'builtin-tools-rejects-overbroad-root',
    'builtin-tools-rejects-oversize-read',
    'builtin-tools-rejects-oversize-write',
    'builtin-tools-overwrites-existing-root-file',
  ];
  const expectedTests = new Set([
    'rejects_symlink_escape_before_write_target_resolution',
    'rejects_overbroad_workspace_root',
    'rejects_oversize_read_with_redacted_path',
    'rejects_oversize_write_with_redacted_path',
    'overwrites_existing_root_file_through_resolved_write_target',
  ]);
  for (const scenarioId of scenarioIds) {
    const scenario = readScenario(scenarioId);
    for (const assertion of scenario.assertions ?? []) {
      if (assertion.kind !== 'desktopRustTest') {
        throw new Error(`${scenarioId} unsupported assertion ${JSON.stringify(assertion)}`);
      }
      if (!expectedTests.has(assertion.testName)) {
        throw new Error(`${scenarioId} references unknown Rust test ${assertion.testName}`);
      }
    }
  }
  const result = spawnSync('cargo', ['test', '--quiet', '--lib', 'builtin_tools_contracts'], {
    cwd: resolve(ROOT, 'apps/desktop/src-tauri'),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      [
        'desktop builtin tool Rust contract tests failed',
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return scenarioIds.map((id) => ({ id: `desktop.${id.replaceAll('-', '_')}`, passed: true }));
}

function ensureDesktopAgentHosts() {
  const resourcesDir = resolve(ROOT, 'apps/desktop/src-tauri/resources');
  const hosts = [
    {
      file: resolve(resourcesDir, 'claude-agent-host.mjs'),
      script: resolve(ROOT, 'scripts/build-claude-agent-host.mjs'),
    },
    {
      file: resolve(resourcesDir, 'codex-agent-host.mjs'),
      script: resolve(ROOT, 'scripts/build-codex-agent-host.mjs'),
    },
  ];
  for (const host of hosts) {
    const result = spawnSync(process.execPath, [host.script], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(
        [`failed to build desktop agent host ${host.file}`, result.stdout, result.stderr]
          .filter(Boolean)
          .join('\n'),
      );
    }
  }
}

function assertKanbanStateMachineSsot(sharedKanban) {
  const ssot = JSON.parse(
    readFileSync(resolve(ROOT, 'packages/shared-types/src/kanban-state-machine.json'), 'utf8'),
  );
  assertTransitionTableEquals(
    sharedKanban.KANBAN_TRANSITIONS,
    ssot.transitions,
    'shared-types KANBAN_TRANSITIONS',
  );
  return { id: 'kanban.state_machine_ts_matches_ssot', passed: true };
}

function assertDesktopKanbanStateMachineScenario() {
  const result = spawnSync(
    'cargo',
    ['test', '--quiet', '--lib', 'kanban_state_machine_contracts'],
    {
      cwd: resolve(ROOT, 'apps/desktop/src-tauri'),
      encoding: 'utf8',
    },
  );
  if (result.status !== 0) {
    throw new Error(
      [
        'desktop kanban state machine Rust contract tests failed',
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return { id: 'kanban.state_machine_rust_matches_ssot', passed: true };
}

function assertTransitionTableEquals(actual, expected, label) {
  const normalize = (table) =>
    Object.fromEntries(
      Object.entries(table)
        .map(([state, targets]) => [state, [...targets].sort()])
        .sort(([left], [right]) => left.localeCompare(right)),
    );
  const normalizedActual = normalize(actual);
  const normalizedExpected = normalize(expected);
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    throw new Error(
      `${label} does not match kanban-state-machine.json\nactual=${JSON.stringify(
        normalizedActual,
      )}\nexpected=${JSON.stringify(normalizedExpected)}`,
    );
  }
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

function assertCompletionEvidenceFamilies(completionVerifier) {
  const cases = [
    {
      family: 'file',
      positive: { toolName: 'write_file', success: true, bytes: 128 },
      negative: { toolName: 'pure_text', success: true, bytes: 0 },
    },
    {
      family: 'shell',
      positive: { toolName: 'bash', success: true, bytes: 128 },
      negative: { toolName: 'read_file', success: true, bytes: 128 },
    },
    {
      family: 'mcp',
      positive: { toolName: 'mcp:filesystem.read', success: true, bytes: 128 },
      negative: { toolName: 'read_file', success: true, bytes: 128 },
    },
    {
      family: 'git-worktree',
      positive: { toolName: 'git_diff', success: true, bytes: 128 },
      negative: { toolName: 'bash', success: true, bytes: 128 },
    },
    {
      family: 'artifact',
      positive: { toolName: 'deliverable_created', success: true, bytes: 128 },
      negative: { toolName: 'read_file', success: true, bytes: 128 },
    },
    {
      family: 'memory-todo-skill',
      positive: { toolName: 'skill_install', success: true, bytes: 128 },
      negative: { toolName: 'write_file', success: true, bytes: 128 },
    },
    {
      family: 'browser-desktop',
      positive: { toolName: 'computer_use', success: true, bytes: 128 },
      negative: { toolName: 'bash', success: true, bytes: 128 },
    },
    {
      family: 'sdk-native',
      positive: { toolName: 'native_tool', evidenceClass: 'sdk-native', success: true, bytes: 128 },
      negative: {
        toolName: 'native_tool',
        evidenceClass: 'gateway-bridged',
        success: true,
        bytes: 128,
      },
    },
    {
      family: 'gateway-bridged',
      positive: {
        toolName: 'bridge_tool',
        evidenceClass: 'gateway-bridged',
        success: true,
        bytes: 128,
      },
      negative: { toolName: 'bridge_tool', evidenceClass: 'sdk-native', success: true, bytes: 128 },
    },
    {
      family: 'pure-text',
      positive: { toolName: 'pure_text', success: true, bytes: 1 },
      negative: { toolName: 'bash', success: true, bytes: 128 },
    },
    {
      family: 'verification',
      positive: { toolName: 'harness-contract', success: true, bytes: 128 },
      negative: { toolName: 'read_file', success: true, bytes: 128 },
    },
  ];

  for (const testCase of cases) {
    const positive = completionVerifier.verifyCompletion(
      { recentToolResults: [testCase.positive] },
      { evidenceTools: [], evidenceFamilies: [testCase.family] },
    );
    if (!positive.ok) {
      throw new Error(`completion verifier rejected ${testCase.family} evidence family`);
    }
    const negative = completionVerifier.verifyCompletion(
      { recentToolResults: [testCase.negative] },
      { evidenceTools: [], evidenceFamilies: [testCase.family] },
    );
    if (negative.ok) {
      throw new Error(`completion verifier accepted mislabeled ${testCase.family} evidence`);
    }
  }

  const scoped = completionVerifier.verifyCompletion(
    {
      recentToolResults: [
        { toolName: 'write_file', success: true, bytes: 128, taskRunId: 'wrong-task' },
        { toolName: 'read_file', success: true, bytes: 128, taskRunId: 'task-1' },
      ],
    },
    { evidenceTools: ['write_file'], taskRunId: 'task-1' },
  );
  if (scoped.ok) {
    throw new Error('completion verifier accepted evidence from the wrong task run');
  }
  const nativeFunctionAsWrite = completionVerifier.verifyCompletion(
    {
      recentToolResults: [
        {
          toolName: 'sdk-native:write_file',
          evidenceClass: 'sdk-native',
          success: true,
          bytes: 128,
          taskRunId: 'task-1',
        },
      ],
    },
    { evidenceTools: ['write_file'], taskRunId: 'task-1' },
  );
  if (nativeFunctionAsWrite.ok) {
    throw new Error('completion verifier accepted native function evidence as file evidence');
  }
  return { id: 'completion.evidence_families_are_classified', passed: true };
}

function assertCodexFullAgentRequestGuards() {
  const adapterSource = readFileSync(
    resolve(ROOT, 'apps/desktop/renderer/src/lib/tauri-engine-adapters.ts'),
    'utf8',
  );
  if (!/model:\s*envelope\.model/u.test(adapterSource)) {
    throw new Error('Tauri engine adapter must always pass the selected model');
  }
  if (/runtimeProfile\.tier\s*!==\s*['"]sdk-native-full-agent['"]/u.test(adapterSource)) {
    throw new Error('Tauri engine adapter still strips model from sdk-native full-agent requests');
  }
  if (/approvalPolicy:\s*[^,\n]*['"]never['"]/u.test(adapterSource)) {
    throw new Error(
      'Tauri engine adapter must not hardcode approvalPolicy never for full-agent requests',
    );
  }

  const hostFiles = [
    {
      label: 'source',
      path: resolve(ROOT, 'scripts/tauri-codex-agent-host.mjs'),
    },
    {
      label: 'bundled',
      path: resolve(ROOT, 'apps/desktop/src-tauri/resources/codex-agent-host.mjs'),
    },
  ];
  for (const hostFile of hostFiles) {
    const hostSource = readFileSync(hostFile.path, 'utf8');
    if (/thread\/rollback['"][\s\S]{0,80}\{\s*threadId\s*,\s*numTurns/u.test(hostSource)) {
      throw new Error(`Codex host ${hostFile.label} must not rollback the main threadId directly`);
    }
    if (!/threadId:\s*forkThreadId/u.test(hostSource)) {
      throw new Error(`Codex host ${hostFile.label} rollback must target the fork thread id`);
    }
    if (
      /return\s+['"]connecting['"]/u.test(hostSource) ||
      /return\s+['"]error['"]/u.test(hostSource)
    ) {
      throw new Error(
        `Codex host ${hostFile.label} MCP status mapper must not emit connecting or error product states`,
      );
    }
  }

  for (const testCase of [
    {
      id: 'missing-model',
      request: { runtimeProfileTier: 'sdk-native-full-agent', messages: [] },
      expected: 'Codex trusted-host requests must include a selected model.',
    },
    {
      id: 'gateway-bridged-native-host',
      request: {
        runtimeProfileTier: 'gateway-bridged-tools',
        model: 'gpt-5.4',
        messages: [],
      },
      expected: 'Gateway-bridged runtime profiles must execute through the Offisim gateway adapter',
    },
    {
      id: 'native-event-bypass',
      request: {
        runtimeProfileTier: 'text-only',
        enableNativeRuntimeEvents: true,
        model: 'gpt-5.4',
        messages: [],
      },
      expected: 'Native runtime events require runtimeProfileTier "sdk-native-full-agent"',
    },
    {
      id: 'lifecycle-verification-bypass',
      request: {
        runtimeProfileTier: 'text-only',
        enableLifecycleVerification: true,
        model: 'gpt-5.4',
        messages: [],
      },
      expected: 'Lifecycle verification requires runtimeProfileTier "sdk-native-full-agent"',
    },
    {
      id: 'full-agent-never-approval',
      request: {
        runtimeProfileTier: 'sdk-native-full-agent',
        approvalPolicy: 'never',
        model: 'gpt-5.4',
        messages: [],
      },
      expected: 'SDK-native full-agent requests must not use approvalPolicy "never"',
    },
  ]) {
    for (const hostFile of hostFiles) {
      const result = spawnSync(process.execPath, [hostFile.path], {
        input: JSON.stringify({ request: testCase.request, cwd: ROOT }),
        encoding: 'utf8',
        env: { ...process.env, OFFISIM_CODEX_EXECUTABLE: '/definitely/not/codex' },
        timeout: 10_000,
      });
      const payload = parseHostStdout(result.stdout, `${hostFile.label}:${testCase.id}`);
      if (
        result.status !== 1 ||
        payload.ok !== false ||
        payload.error?.code !== 'invalid-request'
      ) {
        throw new Error(
          `Codex host ${hostFile.label} ${testCase.id} guard failed: status=${result.status}, stdout=${result.stdout}, stderr=${result.stderr}`,
        );
      }
      if (!String(payload.error?.message ?? '').includes(testCase.expected)) {
        throw new Error(`Codex host ${hostFile.label} ${testCase.id} guard returned wrong message`);
      }
    }
  }

  return { id: 'codex.full_agent_request_guards', passed: true };
}

function parseHostStdout(stdout, label) {
  try {
    return JSON.parse(String(stdout || '').trim());
  } catch (error) {
    throw new Error(
      `Codex host ${label} returned non-JSON stdout: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function assertArtifactFallbackIsPhased(pmPlanParser) {
  const employees = [
    { employee_id: 'pm', name: 'Sophie Park', role_slug: 'project_manager' },
    { employee_id: 'be', name: 'Marcus Johnson', role_slug: 'backend' },
    { employee_id: 'fs', name: 'Kai Nakamura', role_slug: 'fullstack' },
    { employee_id: 'ux', name: 'Zara Okafor', role_slug: 'ux_designer' },
    { employee_id: 'qa', name: 'OpenRouter QA Analyst', role_slug: 'qa' },
  ];
  const plan = pmPlanParser.buildLlmPlanFallback(
    employees,
    '分析项目代码库，输出 deliverables/02_analysis/codebase-analysis.pdf、deliverables/03_presentation/project-overview.pptx、deliverables/04_infographic/project-infographic.html，并复制项目到 deliverables/01_source_copy/source_project，写 deliverables/05_evidence/manifest.json。Do not rely on reportlab, python-pptx, or new packages.',
  );
  if (plan.steps.length < 4) {
    throw new Error(`artifact fallback must be phased, got ${plan.steps.length} step(s)`);
  }
  const allDescriptions = plan.steps.flatMap((step) => step.tasks.map((task) => task.description));
  if (allDescriptions.every((description) => description.startsWith('分析项目代码库'))) {
    throw new Error('artifact fallback must not broadcast the full prompt to every employee');
  }
  if (allDescriptions.some((description) => /PDF\/report|PPT\/presentation/u.test(description))) {
    throw new Error('artifact fallback used pseudo artifact paths instead of concrete targets');
  }
  for (const expectedTarget of [
    'deliverables/01_source_copy/source_project',
    'deliverables/02_analysis/codebase-analysis.pdf',
    'deliverables/03_presentation/project-overview.pptx',
    'deliverables/04_infographic/project-infographic.html',
    'deliverables/05_evidence/manifest.json',
  ]) {
    if (!allDescriptions.some((description) => description.includes(expectedTarget))) {
      throw new Error(`artifact fallback omitted concrete target ${expectedTarget}`);
    }
  }
  return { id: 'pm.artifact_fallback_is_phased', passed: true };
}

function assertTaskRunStatusBaseline() {
  const schemaSql = readFileSync(resolve(ROOT, 'packages/db-local/src/schema.sql'), 'utf8');
  if (!schemaSql.includes("'planned'") || !schemaSql.includes("'waiting_dependency'")) {
    throw new Error('task_runs schema must allow planned and waiting_dependency statuses');
  }
  const planPersistence = readFileSync(
    resolve(ROOT, 'packages/core/src/agents/pm-planner/plan-persistence.ts'),
    'utf8',
  );
  const replanNode = readFileSync(
    resolve(ROOT, 'packages/core/src/agents/pm-replan-node.ts'),
    'utf8',
  );
  if (!/status:\s*'planned'/u.test(planPersistence)) {
    throw new Error('pm planner must persist new task runs as planned');
  }
  if (!/status:\s*'planned'/u.test(replanNode)) {
    throw new Error('pm replan must persist new task runs as planned');
  }
  return { id: 'task_runs.planned_status_baseline', passed: true };
}

function assertBashEvidenceCanSatisfyFileIntent(completionVerifier, taskToolIntent) {
  const intent = taskToolIntent.detectTaskToolIntent(
    '分析项目代码库，输出 HTML infographic，并拷贝项目到目标目录。',
  );
  const evidenceTools = taskToolIntent.evidenceToolsForIntent(intent);
  if (!evidenceTools.includes('bash')) {
    throw new Error('file/task evidence tools must accept bash for shell-backed workspace work');
  }
  const outcome = completionVerifier.verifyCompletion(
    {
      recentToolResults: [{ toolName: 'bash', success: true, bytes: 1024 }],
    },
    { evidenceTools },
  );
  if (!outcome.ok) {
    throw new Error('completion verifier rejected successful bash evidence for file intent');
  }
  const scriptIntent = taskToolIntent.detectTaskToolIntent(
    'Run python3 generate_pdf.py to create deliverables/02_analysis/codebase-analysis.pdf.',
  );
  const scriptEvidenceTools = taskToolIntent.evidenceToolsForIntent(scriptIntent);
  if (!scriptIntent.needsBash || !scriptIntent.needsWrite) {
    throw new Error('python artifact command must require bash and write evidence');
  }
  if (!scriptEvidenceTools.includes('bash')) {
    throw new Error('python artifact command evidence tools must include bash');
  }
  return { id: 'completion.bash_evidence_satisfies_file_intent', passed: true };
}

async function assertArtifactTasksRequireWriteAudit(employeeCompletion) {
  const taskDescription =
    'Generate the self-contained HTML infographic at the requested 04_infographic path. Full user intent: 分析项目代码库，输出 PDF、PPT、HTML infographic，并拷贝项目到目标目录。';
  if (!employeeCompletion.requiresConcreteWriteEvidence(taskDescription)) {
    throw new Error('artifact HTML task did not require concrete write evidence');
  }
  const runtimeCtx = {
    repos: {
      mcpAudit: {
        async listByThread() {
          return [
            {
              task_run_id: 'task-artifact',
              tool_name: 'bash',
              arguments_json: JSON.stringify({ command: 'ls -la /tmp/04_infographic' }),
              error: null,
            },
          ];
        },
      },
    },
  };
  const outcome = await employeeCompletion.verifyConcreteWriteEvidence({
    runtimeCtx,
    threadId: 'thread-artifact',
    taskRunId: 'task-artifact',
    taskDescription,
  });
  if (outcome?.ok) {
    throw new Error('artifact task accepted read/list-only bash evidence');
  }
  const failedWriteOutcome = await employeeCompletion.verifyConcreteWriteEvidence({
    runtimeCtx: makeArtifactAuditRuntime([
      {
        task_run_id: 'task-artifact',
        tool_name: 'write_file',
        arguments_json: JSON.stringify({ path: 'deliverables/04_infographic/project.html' }),
        result_json: JSON.stringify(
          'Error writing file: write project file failed: generate_pdf.py (NotADirectory)',
        ),
        error: null,
      },
    ]),
    threadId: 'thread-artifact',
    taskRunId: 'task-artifact',
    taskDescription,
  });
  if (failedWriteOutcome?.ok) {
    throw new Error('artifact task accepted failed write_file audit evidence');
  }
  const failedBashOutcome = await employeeCompletion.verifyConcreteWriteEvidence({
    runtimeCtx: makeArtifactAuditRuntime([
      {
        task_run_id: 'task-artifact',
        tool_name: 'bash',
        arguments_json: JSON.stringify({ command: 'python3 generate_pdf.py > output.pdf' }),
        result_json: JSON.stringify('SyntaxError: invalid syntax\n[Exit code: 1]'),
        error: null,
      },
    ]),
    threadId: 'thread-artifact',
    taskRunId: 'task-artifact',
    taskDescription,
  });
  if (failedBashOutcome?.ok) {
    throw new Error('artifact task accepted failed bash write audit evidence');
  }
  let checkedCommand = '';
  const fullIntentTargetOutcome = await employeeCompletion.verifyConcreteWriteEvidence({
    runtimeCtx: makeArtifactAuditRuntime(
      [
        {
          task_run_id: 'task-pdf',
          tool_name: 'bash',
          arguments_json: JSON.stringify({
            command:
              "python3 - <<'PY'\nfrom pathlib import Path\nPath('deliverables/02_analysis/codebase-analysis.pdf').write_bytes(b'%PDF smoke')\nPY",
          }),
          result_json: JSON.stringify('wrote pdf\n[Exit code: 0]'),
          error: null,
        },
      ],
      {
        async execute(call) {
          checkedCommand = call.arguments.command;
          return checkedCommand.includes('deliverables/02_analysis/codebase-analysis.pdf') &&
            !checkedCommand.includes('PDF/report')
            ? { success: true, result: 'ok' }
            : { success: false, result: 'missing requested target' };
        },
      },
    ),
    threadId: 'thread-artifact',
    taskRunId: 'task-pdf',
    taskDescription:
      'Generate the codebase analysis PDF/report in the requested 02_analysis folder. Full user intent: Generate deliverables/02_analysis/codebase-analysis.pdf and deliverables/03_presentation/project-overview.pptx.',
  });
  if (!fullIntentTargetOutcome?.ok) {
    throw new Error('artifact task did not resolve concrete target from full user intent');
  }
  const dependencyOutcome = await employeeCompletion.verifyDependencyConstraints({
    runtimeCtx: makeArtifactAuditRuntime([
      {
        task_run_id: 'task-pdf',
        tool_name: 'bash',
        arguments_json: JSON.stringify({
          command: "python3 - <<'PY'\nfrom reportlab.pdfgen import canvas\nPY",
        }),
        result_json: JSON.stringify('ok\n[Exit code: 0]'),
        error: null,
      },
    ]),
    threadId: 'thread-artifact',
    taskRunId: 'task-pdf',
    taskDescription:
      'Generate the codebase analysis PDF at deliverables/02_analysis/codebase-analysis.pdf. Full user intent: Do not rely on reportlab, python-pptx, or new packages.',
  });
  if (dependencyOutcome?.ok !== false) {
    throw new Error('artifact task accepted forbidden dependency usage');
  }
  return { id: 'completion.artifact_tasks_require_write_audit', passed: true };
}

function makeArtifactAuditRuntime(rows, toolExecutor) {
  return {
    repos: {
      mcpAudit: {
        async listByThread() {
          return rows;
        },
      },
    },
    ...(toolExecutor ? { toolExecutor } : {}),
  };
}

async function assertBossSummaryWaitsForPendingPlan(bossSummaryModule) {
  const outcome = await bossSummaryModule.bossSummaryNode(
    {
      threadId: 'thread-pending-plan',
      projectId: 'project-pending-plan',
      messages: [],
      entryMode: 'boss_chat',
      routeDecision: null,
      targetEmployeeId: null,
      pendingAssignments: [{ taskRunId: 'tr-pending-1' }],
      taskPlan: {
        planId: 'plan-pending',
        summary: 'Pending multi-step delivery',
        steps: [
          { stepIndex: 0, description: 'Copy project', tasks: [] },
          { stepIndex: 1, description: 'Generate artifacts', tasks: [] },
        ],
      },
      completedStepIndices: [0],
      blockedStepIndices: [],
      currentStepIndex: 1,
      currentStepOutputs: [
        {
          employeeId: 'emp-copy',
          employeeName: 'Copy Engineer',
          sourceKind: 'employee',
          roleSlug: 'engineer',
          content: 'Copied source files.',
          taskRunId: 'tr-copy',
          stepIndex: 0,
          isExternal: false,
          brandKey: null,
        },
      ],
      stepResults: [],
      meetingActionItems: [],
    },
    {},
  );
  if (outcome.completed) {
    throw new Error('boss_summary completed with a pending plan step');
  }
  if (!outcome.interruptReason?.includes('boss-summary-pending-plan')) {
    throw new Error('boss_summary did not expose pending-plan interrupt reason');
  }
  return { id: 'summary.pending_plan_waits_for_remaining_steps', passed: true };
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

async function assertSoakBoundedMemoryScenario(soakRunner) {
  const scenario = readScenario('soak-leak-detector-bounded-memory');
  const fixture = scenario.fixture ?? {};
  const iterations = Number(fixture.iterations ?? 20);
  const concurrency = Number(fixture.concurrency ?? 4);
  const sampleFailureCap = Number(fixture.sampleFailureCap ?? 5);
  const report = await soakRunner.runSoakHarness(
    [readScenario('yolo-80-turn-multi-file-refactor')],
    {
      iterations,
      concurrency,
    },
  );
  if (report.leakSummary.sampleFailures.length > sampleFailureCap) {
    throw new Error(
      `soak sample failures exceeded cap: ${report.leakSummary.sampleFailures.length} > ${sampleFailureCap}`,
    );
  }
  if (report.leakSummary.leakingIterations > 0) {
    throw new Error(`soak leak detector reported ${report.leakSummary.leakingIterations} leaks`);
  }
  return { id: 'soak.bounded_memory_summary', passed: true };
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
