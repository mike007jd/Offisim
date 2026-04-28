import { performance } from 'node:perf_hooks';
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
  readonly failures: readonly {
    readonly scenarioId: string;
    readonly traceHash: string;
    readonly assertions: ScenarioTraceReport['assertions'];
  }[];
}

export async function runSoakHarness(
  scenarios: readonly DeterministicScenario[],
  options: SoakRunnerOptions = {},
): Promise<SoakRunnerReport> {
  if (scenarios.length === 0) throw new Error('Soak harness needs at least one scenario.');
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  const targetIterations = Math.max(1, Math.floor(options.iterations ?? scenarios.length));
  const deadline =
    options.durationMs && options.durationMs > 0 ? performance.now() + options.durationMs : null;
  const start = sampleRuntimeHealth();
  const startedAt = performance.now();
  const latencies: number[] = [];
  const reports: ScenarioTraceReport[] = [];
  let nextIteration = 0;

  async function worker(): Promise<void> {
    while (nextIteration < targetIterations && (!deadline || performance.now() < deadline)) {
      const iteration = nextIteration++;
      const scenario = scenarios[iteration % scenarios.length];
      if (!scenario) return;
      const t0 = performance.now();
      const report = await runDeterministicScenario(scenario);
      latencies.push(performance.now() - t0);
      reports.push(report);
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
    failures: failures.map((report) => ({
      scenarioId: report.scenarioId,
      traceHash: report.traceHash,
      assertions: report.assertions,
    })),
  };
}
