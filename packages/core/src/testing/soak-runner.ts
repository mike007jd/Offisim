import { performance } from 'node:perf_hooks';
import type { ToolCallResult } from '../llm/gateway.js';
import type { LlmMessage } from '../llm/gateway.js';
import { verifyCompletion } from '../runtime/completion-verifier.js';
import { microCompactMessages } from '../services/conversation-budget/micro-compact.js';
import { RollingJournal } from '../services/conversation-budget/rolling-journal.js';
import { canonicalJson } from './canonical-json.js';
import { sha256Text } from './hash.js';
import { summarizeRuntimeLeaks } from './leak-detector.js';
import {
  heapGrowthMbPerHour,
  sampleRuntimeHealth,
  summarizeLatencyMs,
} from './runtime-health-sampler.js';
import type { DeterministicScenario } from './scenario-runner.js';
import { runDeterministicScenario } from './scenario-runner.js';
import type { ScenarioTraceReport } from './trace-recorder.js';

export interface SoakRunnerOptions {
  readonly iterations?: number;
  readonly durationMs?: number;
  readonly concurrency?: number;
  readonly scenarioIds?: readonly string[];
}

export interface SoakRunnerReport {
  readonly suite: 'soak';
  readonly durationMs: number;
  readonly iterations: number;
  readonly passed: number;
  readonly failed: number;
  readonly memory: {
    readonly startMb: number;
    readonly endMb: number;
    readonly growthMbPerHour: number;
    readonly rssStartMb: number;
    readonly rssEndMb: number;
  };
  readonly latencyMs: {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
  };
  readonly runtime: {
    readonly activeInteractionsLeaked: number;
    readonly pendingAssignmentsLeaked: number;
    readonly duplicateTaskRuns: number;
    readonly duplicateToolCalls: number;
  };
  readonly metrics: readonly SoakScenarioMetrics[];
  readonly failures: readonly {
    readonly scenarioId: string;
    readonly traceHash: string;
    readonly assertions: ScenarioTraceReport['assertions'];
  }[];
}

export interface SoakScenarioMetrics {
  readonly scenarioId: string;
  readonly finalNonSystemTokens: number;
  readonly microCompactPasses: number;
  readonly rollingJournalWrites: number;
  readonly completionVerifierAllows: number;
  readonly completionVerifierBlocks: number;
}

interface YoloSoakScenario {
  readonly id: string;
  readonly category: 'long-running-soak';
  readonly fixture?: Partial<YoloSoakFixture>;
}

interface YoloSoakFixture {
  readonly turns: number;
  readonly journalEveryNTurns: number;
  readonly toolResultEveryNTurns: number;
  readonly toolResultBytes: number;
  readonly maxToolResultBytes: number;
  readonly snippetBytes: number;
  readonly preserveLastN: number;
  readonly maxFinalNonSystemTokens: number;
  readonly minMicroCompactPasses: number;
  readonly minRollingJournalWrites: number;
}

const DEFAULT_YOLO_SOAK_FIXTURE: YoloSoakFixture = {
  turns: 80,
  journalEveryNTurns: 8,
  toolResultEveryNTurns: 4,
  toolResultBytes: 24000,
  maxToolResultBytes: 8000,
  snippetBytes: 400,
  preserveLastN: 0,
  maxFinalNonSystemTokens: 120000,
  minMicroCompactPasses: 3,
  minRollingJournalWrites: 9,
};

const textEncoder = new TextEncoder();

export async function runSoakHarness(
  scenarios: readonly DeterministicScenario[],
  options: SoakRunnerOptions = {},
): Promise<SoakRunnerReport> {
  const selectedScenarios = options.scenarioIds
    ? scenarios.filter((scenario) => options.scenarioIds?.includes(scenario.id))
    : scenarios;
  if (selectedScenarios.length === 0) throw new Error('Soak harness needs at least one scenario.');
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  const targetIterations = Math.max(1, Math.floor(options.iterations ?? selectedScenarios.length));
  const deadline =
    options.durationMs && options.durationMs > 0 ? performance.now() + options.durationMs : null;
  const start = sampleRuntimeHealth();
  const startedAt = performance.now();
  const latencies: number[] = [];
  const reports: ScenarioTraceReport[] = [];
  const metrics = new Map<string, SoakScenarioMetrics>();
  let nextIteration = 0;

  async function worker(): Promise<void> {
    while (nextIteration < targetIterations && (!deadline || performance.now() < deadline)) {
      const iteration = nextIteration++;
      const scenario = selectedScenarios[iteration % selectedScenarios.length];
      if (!scenario) return;
      const t0 = performance.now();
      const report = isYoloSoakScenario(scenario)
        ? await runYoloSoakScenario(scenario)
        : await runDeterministicScenario(scenario);
      latencies.push(performance.now() - t0);
      reports.push(report);
      const metric = extractSoakMetrics(report);
      if (metric) metrics.set(metric.scenarioId, metric);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const endedAt = performance.now();
  const end = sampleRuntimeHealth();
  const leaks = summarizeRuntimeLeaks(reports);
  const failures = reports.filter((report) => !report.passed);

  return {
    suite: 'soak',
    durationMs: Math.round(endedAt - startedAt),
    iterations: reports.length,
    passed: reports.length - failures.length,
    failed: failures.length,
    memory: {
      startMb: start.heapUsedMb,
      endMb: end.heapUsedMb,
      growthMbPerHour: heapGrowthMbPerHour(start, end),
      rssStartMb: start.rssMb,
      rssEndMb: end.rssMb,
    },
    latencyMs: summarizeLatencyMs(latencies),
    runtime: leaks,
    metrics: [...metrics.values()],
    failures: failures.map((report) => ({
      scenarioId: report.scenarioId,
      traceHash: report.traceHash,
      assertions: report.assertions,
    })),
  };
}

function isYoloSoakScenario(
  scenario: DeterministicScenario,
): scenario is DeterministicScenario & YoloSoakScenario {
  return (scenario as { category?: unknown }).category === 'long-running-soak';
}

async function runYoloSoakScenario(scenario: YoloSoakScenario): Promise<ScenarioTraceReport> {
  const fixture = { ...DEFAULT_YOLO_SOAK_FIXTURE, ...(scenario.fixture ?? {}) };
  const graphReport = await runDeterministicScenario(buildYoloSoakGraphScenario(scenario, fixture));
  let messages: LlmMessage[] = [
    {
      role: 'user',
      content: 'Refactor a multi-file counter component while preserving tests and state.',
    },
  ];
  const journalWrites: string[] = [];
  const journal = new RollingJournal({
    everyNTurns: fixture.journalEveryNTurns,
    write: async (text) => {
      journalWrites.push(text);
    },
    summarize: async (turnMessages): Promise<string> =>
      `summary:${turnMessages.length}:${turnMessages[0]?.content.slice(0, 32) ?? ''}`,
  });
  let microCompactPasses = 0;

  for (let turn = 1; turn <= fixture.turns; turn++) {
    messages.push({
      role: 'assistant',
      content: `turn-${turn}: edited file-${turn % 5}.ts and kept the objective anchored.`,
    });
    if (turn % fixture.toolResultEveryNTurns === 0) {
      messages.push({
        role: 'tool',
        toolCallId: `tool-${turn}`,
        content: `tool-result-${turn}\n${'x'.repeat(fixture.toolResultBytes)}`,
      });
    }
    const compacted = microCompactMessages(messages, {
      maxToolResultBytes: fixture.maxToolResultBytes,
      snippetBytes: fixture.snippetBytes,
      preserveLastN: fixture.preserveLastN,
    });
    if (compacted.compacted > 0) microCompactPasses += 1;
    messages = [...compacted.messages];
    await journal.observeTurn(messages);
  }

  const completion = verifyCompletion({
    recentToolResults: [{ toolName: 'pnpm-test', success: true, bytes: 2048 }],
  });
  const finalNonSystemTokens = estimateTokens(
    messages
      .filter((message) => message.role !== 'system')
      .map((message) => message.content)
      .join('\n'),
  );
  const metric: SoakScenarioMetrics = {
    scenarioId: scenario.id,
    finalNonSystemTokens,
    microCompactPasses,
    rollingJournalWrites: journalWrites.length,
    completionVerifierAllows: completion.ok ? 1 : 0,
    completionVerifierBlocks: completion.ok ? 0 : 1,
  };
  const assertions = [
    ...graphReport.assertions.map((assertion) => ({
      ...assertion,
      kind: `graph.${assertion.kind}`,
    })),
    {
      kind: 'soak.completed',
      passed: graphReport.passed,
      message: graphReport.passed ? undefined : `Graph report failed: ${graphReport.traceHash}`,
    },
    {
      kind: 'soak.final_non_system_tokens_under_120k',
      passed: finalNonSystemTokens < fixture.maxFinalNonSystemTokens,
      message:
        finalNonSystemTokens < fixture.maxFinalNonSystemTokens
          ? undefined
          : `Expected < ${fixture.maxFinalNonSystemTokens}, got ${finalNonSystemTokens}`,
    },
    {
      kind: 'soak.microcompact_passes',
      passed: microCompactPasses >= fixture.minMicroCompactPasses,
      message:
        microCompactPasses >= fixture.minMicroCompactPasses
          ? undefined
          : `Expected >= ${fixture.minMicroCompactPasses}, got ${microCompactPasses}`,
    },
    {
      kind: 'soak.rolling_journal_writes',
      passed: journalWrites.length >= fixture.minRollingJournalWrites,
      message:
        journalWrites.length >= fixture.minRollingJournalWrites
          ? undefined
          : `Expected >= ${fixture.minRollingJournalWrites}, got ${journalWrites.length}`,
    },
    {
      kind: 'soak.completion_verifier_allowed',
      passed: completion.ok,
      message: completion.ok ? undefined : completion.reason,
    },
  ];
  const trace = {
    events: graphReport.trace.events,
    db: graphReport.trace.db,
    finalState: {
      ...graphReport.trace.finalState,
      metrics: metric,
      anchor: journal.anchorText(),
      graphTraceHash: graphReport.traceHash,
    },
  };
  return {
    scenarioId: scenario.id,
    passed: assertions.every((assertion) => assertion.passed),
    traceHash: await sha256Text(canonicalJson(trace)),
    assertions,
    trace,
  };
}

function buildYoloSoakGraphScenario(
  scenario: YoloSoakScenario,
  fixture: YoloSoakFixture,
): DeterministicScenario {
  const companyId = `company-${scenario.id}`;
  const threadId = `thread-${scenario.id}`;
  const projectId = `project-${scenario.id}`;
  const employeeId = `emp-${scenario.id}-yolo`;
  const llmTurns = Array.from({ length: fixture.turns }, (_, index) => {
    const turn = index + 1;
    const title = `soak-card-${turn}`;
    const toolCall: ToolCallResult = {
      id: `tc-soak-create-${turn}`,
      name: 'todo_create',
      arguments: { title, projectId },
    };
    const testCall: ToolCallResult = {
      id: `tc-soak-test-${turn}`,
      name: 'pnpm-test',
      arguments: { command: `pnpm test -- soak-${turn}` },
    };
    return [
      {
        id: `yolo-soak-tool-${turn}`,
        match: { toolNames: ['todo_create', 'pnpm-test'] },
        content: '',
        toolCalls: [toolCall, testCall],
      },
      {
        id: `yolo-soak-final-${turn}`,
        match: { contains: title },
        content: `SOAK_TURN_${turn}_DONE`,
      },
    ];
  }).flat();

  return {
    id: `${scenario.id}-graph`,
    category: 'interaction-modes',
    entryMode: 'boss_chat',
    interactionMode: 'yolo',
    seed: {
      company: { companyId, name: 'YOLO Soak Harness Co' },
      thread: { threadId, status: 'running', projectId },
      projects: [{ id: projectId, name: 'YOLO Soak Project' }],
      employees: [{ id: employeeId, name: 'YOLO Master', role: 'yolo_master' }],
    },
    initialState: { projectId },
    tools: [
      {
        name: 'pnpm-test',
        description: 'Run deterministic soak verification.',
        parameters: { type: 'object', properties: { command: { type: 'string' } } },
      },
    ],
    toolFixtures: {
      'pnpm-test': Array.from({ length: fixture.turns }, (_, index) => ({
        success: true,
        result: { ok: true, command: `pnpm test -- soak-${index + 1}` },
      })),
    },
    llmTurns,
    runs: Array.from({ length: fixture.turns }, () => ({ startAt: 'yolo-master' as const })),
    assertions: [
      { kind: 'firstGraphNodeIs', nodeName: 'yolo-master' },
      {
        kind: 'kanbanCards',
        projectId,
        count: fixture.turns,
        origin: 'employee',
        states: { done: fixture.turns },
      },
      { kind: 'graphStateArrayEquals', field: 'pendingAssignments', value: [] },
    ],
  };
}

function extractSoakMetrics(report: ScenarioTraceReport): SoakScenarioMetrics | null {
  const metrics = report.trace.finalState.metrics;
  if (!metrics || typeof metrics !== 'object') return null;
  const record = metrics as Partial<SoakScenarioMetrics>;
  if (record.scenarioId !== report.scenarioId) return null;
  if (typeof record.finalNonSystemTokens !== 'number') return null;
  if (typeof record.microCompactPasses !== 'number') return null;
  if (typeof record.rollingJournalWrites !== 'number') return null;
  if (typeof record.completionVerifierAllows !== 'number') return null;
  if (typeof record.completionVerifierBlocks !== 'number') return null;
  return {
    scenarioId: record.scenarioId,
    finalNonSystemTokens: record.finalNonSystemTokens,
    microCompactPasses: record.microCompactPasses,
    rollingJournalWrites: record.rollingJournalWrites,
    completionVerifierAllows: record.completionVerifierAllows,
    completionVerifierBlocks: record.completionVerifierBlocks,
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(textEncoder.encode(text).byteLength / 4);
}
