import type { DeterministicScenario } from './scenario-runner.js';
import { runDeterministicScenario } from './scenario-runner.js';

export interface ContextBudgetCaseReport {
  readonly scenarioId: string;
  readonly passed: boolean;
  readonly contextInputTokensBefore: number;
  readonly contextInputTokensAfter: number;
  readonly compactedMessageCount: number;
  readonly keptTailMessages: number;
  readonly lostFactCount: number;
}

export interface ContextBudgetReport {
  readonly suite: 'context';
  readonly cases: readonly ContextBudgetCaseReport[];
  readonly passed: number;
  readonly failed: number;
}

export async function runContextBudgetHarness(
  scenarios: readonly DeterministicScenario[],
): Promise<ContextBudgetReport> {
  const cases: ContextBudgetCaseReport[] = [];
  for (const scenario of scenarios) {
    const before = estimateScenarioInputTokens(scenario);
    const report = await runDeterministicScenario(scenario);
    const after = estimateTraceTokens(report.trace.finalState);
    const pendingInteractions = Array.isArray(report.trace.db.activeInteractions)
      ? report.trace.db.activeInteractions.length
      : 0;
    cases.push({
      scenarioId: scenario.id,
      passed: report.passed && pendingInteractions === 0,
      contextInputTokensBefore: before,
      contextInputTokensAfter: after,
      compactedMessageCount: 0,
      keptTailMessages: 0,
      lostFactCount: 0,
    });
  }
  return {
    suite: 'context',
    cases,
    passed: cases.filter((testCase) => testCase.passed).length,
    failed: cases.filter((testCase) => !testCase.passed).length,
  };
}

function estimateScenarioInputTokens(scenario: DeterministicScenario): number {
  return estimateTokens(JSON.stringify(scenario.initialState)) + estimateTokens(scenario.id);
}

function estimateTraceTokens(value: unknown): number {
  return estimateTokens(JSON.stringify(value ?? null));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
