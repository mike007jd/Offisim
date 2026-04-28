import { compareScenarioTraces } from './checkpoint-diff.js';
import { assertTraceIdempotency } from './idempotency-assertions.js';
import type { DeterministicScenario } from './scenario-runner.js';
import { runDeterministicScenario } from './scenario-runner.js';

export interface ResumeEquivalenceCaseReport {
  readonly scenarioId: string;
  readonly passed: boolean;
  readonly equivalent: boolean;
  readonly idempotent: boolean;
  readonly uninterruptedHash: string;
  readonly resumedHash: string;
  readonly reason?: string;
}

export interface ResumeEquivalenceReport {
  readonly suite: 'resume';
  readonly cases: readonly ResumeEquivalenceCaseReport[];
  readonly passed: number;
  readonly failed: number;
}

export async function runResumeEquivalenceHarness(
  scenarios: readonly DeterministicScenario[],
): Promise<ResumeEquivalenceReport> {
  const cases: ResumeEquivalenceCaseReport[] = [];
  for (const scenario of scenarios) {
    const uninterrupted = await runDeterministicScenario(scenario);
    const resumed = await runDeterministicScenario(scenario);
    const diff = await compareScenarioTraces(uninterrupted, resumed);
    const idempotency = assertTraceIdempotency(resumed);
    cases.push({
      scenarioId: scenario.id,
      passed: uninterrupted.passed && resumed.passed && diff.equivalent && idempotency.passed,
      equivalent: diff.equivalent,
      idempotent: idempotency.passed,
      uninterruptedHash: diff.uninterruptedHash,
      resumedHash: diff.resumedHash,
      ...(diff.reason ? { reason: diff.reason } : {}),
    });
  }
  return {
    suite: 'resume',
    cases,
    passed: cases.filter((testCase) => testCase.passed).length,
    failed: cases.filter((testCase) => !testCase.passed).length,
  };
}
