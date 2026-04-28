import type { DeterministicScenario } from './scenario-runner.js';
import { runDeterministicScenario } from './scenario-runner.js';

export interface ModelBenchProfile {
  readonly provider: string;
  readonly model: string;
  readonly temperature: number;
}

export interface ModelBenchCaseReport {
  readonly scenarioId: string;
  readonly model: string;
  readonly planValidity: number;
  readonly toolCallValidity: number;
  readonly taskCompletion: number;
  readonly costUsd: number;
  readonly latencyMsP95: number;
  readonly passed: boolean;
}

export interface ModelBenchReport {
  readonly suite: 'model-bench';
  readonly live: boolean;
  readonly cases: readonly ModelBenchCaseReport[];
}

export async function runDeterministicModelBench(
  scenarios: readonly DeterministicScenario[],
  profiles: readonly ModelBenchProfile[] = [
    { provider: 'deterministic', model: 'fake-model', temperature: 0 },
  ],
): Promise<ModelBenchReport> {
  const cases: ModelBenchCaseReport[] = [];
  for (const scenario of scenarios) {
    const report = await runDeterministicScenario(scenario);
    for (const profile of profiles) {
      cases.push({
        scenarioId: scenario.id,
        model: `${profile.provider}/${profile.model}`,
        planValidity: report.passed ? 1 : 0,
        toolCallValidity: report.assertions.every((assertion) => assertion.passed) ? 1 : 0,
        taskCompletion: report.passed ? 1 : 0,
        costUsd: 0,
        latencyMsP95: 0,
        passed: report.passed,
      });
    }
  }
  return { suite: 'model-bench', live: false, cases };
}
