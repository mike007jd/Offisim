import type { RuntimeEvidenceClass } from '@offisim/shared-types';
import { DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES } from '../engine/capability-profiles.js';
import type { ScenarioAssertion } from './invariant-assertions.js';
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

export interface RouteBenchmarkReport {
  readonly scenarioId: string;
  readonly route: 'offisim-core' | 'sdk-native-full-power';
  readonly status: 'measured' | 'blocked';
  readonly runtimeProfileId?: string;
  readonly taskCompletion: number;
  readonly toolCorrectness: number;
  readonly contextRetention: number;
  readonly cancellation: 'verified' | 'blocked';
  readonly costUsd: number;
  readonly latencyMsP95: number;
  readonly evidenceClass: Extract<RuntimeEvidenceClass, 'offisim-gateway' | 'sdk-native'>;
  readonly evidenceQuality: 'deterministic' | 'blocked-missing-release-evidence';
  readonly passed: boolean;
  readonly gateSatisfied: boolean;
  readonly blocker?: string;
}

export interface ModelBenchReport {
  readonly suite: 'model-bench';
  readonly live: boolean;
  readonly cases: readonly ModelBenchCaseReport[];
  readonly routeComparisons: readonly RouteBenchmarkReport[];
}

export async function runDeterministicModelBench(
  scenarios: readonly DeterministicScenario[],
  profiles: readonly ModelBenchProfile[] = [
    { provider: 'deterministic', model: 'fake-model', temperature: 0 },
  ],
): Promise<ModelBenchReport> {
  const cases: ModelBenchCaseReport[] = [];
  const routeComparisons: RouteBenchmarkReport[] = [];
  const sdkNativeProfile = DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES.find(
    (profile) => profile.profileId === 'claude-engine:sdk-native-full-power',
  );
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
    routeComparisons.push({
      scenarioId: scenario.id,
      route: 'offisim-core',
      status: 'measured',
      taskCompletion: report.passed ? 1 : 0,
      toolCorrectness: report.assertions.every((assertion) => assertion.passed) ? 1 : 0,
      contextRetention: scenario.assertions.some(assertsConversationRetention)
        ? report.passed
          ? 1
          : 0
        : 1,
      cancellation: scenario.assertions.some(assertsCancellation) ? 'verified' : 'blocked',
      costUsd: 0,
      latencyMsP95: 0,
      evidenceClass: 'offisim-gateway',
      evidenceQuality: 'deterministic',
      passed: report.passed,
      gateSatisfied: report.passed,
    });
    routeComparisons.push({
      scenarioId: scenario.id,
      route: 'sdk-native-full-power',
      status: 'blocked',
      runtimeProfileId: sdkNativeProfile?.profileId ?? 'claude-engine:sdk-native-full-power',
      taskCompletion: 0,
      toolCorrectness: 0,
      contextRetention: 0,
      cancellation: 'blocked',
      costUsd: 0,
      latencyMsP95: 0,
      evidenceClass: 'sdk-native',
      evidenceQuality: 'blocked-missing-release-evidence',
      passed: false,
      gateSatisfied: sdkNativeProfile?.availability === 'blocked',
      blocker:
        'SDK-native full-power route is intentionally benchmark-visible but release-blocked until native tool, MCP, session, cancellation, rollback, budget, sandbox, usage, and release .app evidence exists.',
    });
  }
  return { suite: 'model-bench', live: false, cases, routeComparisons };
}

function assertsConversationRetention(assertion: ScenarioAssertion): boolean {
  return (
    assertion.kind === 'conversationStateContains' &&
    (assertion.minMessages !== undefined ||
      assertion.pendingToolCalls !== undefined ||
      assertion.toolResults !== undefined ||
      assertion.permissionDenials !== undefined ||
      assertion.activeTaskRunId !== undefined ||
      assertion.checkpointTaskRunId !== undefined ||
      assertion.discoveredTools !== undefined)
  );
}

function assertsCancellation(assertion: ScenarioAssertion): boolean {
  return (
    assertion.kind === 'noEmployeeAfterCancel' ||
    assertion.kind === 'interruptReasonIncludes' ||
    (assertion.kind === 'conversationStateContains' &&
      (assertion.cancellationRequested !== undefined ||
        assertion.cancellationReasonIncludes !== undefined))
  );
}
