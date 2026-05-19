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
  readonly route: 'offisim-core' | 'sdk-native-full-power' | 'gateway-bridged-tools';
  readonly routeId: string;
  readonly referenceFeatureRows: readonly string[];
  readonly status: 'measured' | 'blocked';
  readonly runtimeProfileId?: string;
  readonly taskCompletion: number;
  readonly toolCorrectness: number;
  readonly contextRetention: number;
  readonly cancellation: 'verified' | 'blocked';
  readonly costUsd: number;
  readonly latencyMsP95: number;
  readonly evidenceClass: RuntimeEvidenceClass;
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
    (profile) => profile.profileId === 'codex-engine:sdk-native-full-power',
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
      routeId: 'offisim-core:default-harness',
      referenceFeatureRows: featureRowsForScenario(scenario),
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
    const sdkNativePromoted = sdkNativeProfile?.availability === 'production';
    routeComparisons.push({
      scenarioId: scenario.id,
      route: 'sdk-native-full-power',
      routeId: sdkNativeProfile?.profileId ?? 'codex-engine:sdk-native-full-power',
      referenceFeatureRows: sdkNativeProfile?.evidenceRequirements.referenceFeatureRows ?? [
        'F23',
        'F24',
      ],
      status: sdkNativePromoted ? 'measured' : 'blocked',
      runtimeProfileId: sdkNativeProfile?.profileId ?? 'codex-engine:sdk-native-full-power',
      taskCompletion: sdkNativePromoted && report.passed ? 1 : 0,
      toolCorrectness:
        sdkNativePromoted && report.assertions.every((assertion) => assertion.passed) ? 1 : 0,
      contextRetention: sdkNativePromoted
        ? scenario.assertions.some(assertsConversationRetention)
          ? report.passed
            ? 1
            : 0
          : 1
        : 0,
      cancellation: sdkNativePromoted
        ? scenario.assertions.some(assertsCancellation)
          ? 'verified'
          : 'blocked'
        : 'blocked',
      costUsd: 0,
      latencyMsP95: 0,
      evidenceClass: 'sdk-native',
      evidenceQuality: sdkNativePromoted ? 'deterministic' : 'blocked-missing-release-evidence',
      passed: sdkNativePromoted && report.passed,
      gateSatisfied: sdkNativePromoted
        ? report.passed
        : sdkNativeProfile?.availability === 'blocked',
      ...(sdkNativePromoted
        ? {}
        : {
            blocker:
              'SDK-native full-power route is intentionally benchmark-visible but release-blocked until native tool, MCP, session, cancellation, rollback, budget, sandbox, usage, and release .app evidence exists.',
          }),
    });
    routeComparisons.push({
      scenarioId: scenario.id,
      route: 'gateway-bridged-tools',
      routeId: 'claude-engine:gateway-bridged-tools',
      referenceFeatureRows: ['F03', 'F04', 'F05', 'F06', 'F08', 'F11', 'F20', 'F21', 'F23'],
      status: 'blocked',
      runtimeProfileId: 'claude-engine:gateway-bridged-tools',
      taskCompletion: 0,
      toolCorrectness: 0,
      contextRetention: 0,
      cancellation: 'blocked',
      costUsd: 0,
      latencyMsP95: 0,
      evidenceClass: 'gateway-bridged',
      evidenceQuality: 'blocked-missing-release-evidence',
      passed: false,
      gateSatisfied: true,
      blocker:
        'Gateway-bridged route is benchmark-visible but unavailable until Offisim approval/checkpoint execution, task-run identity matching, denied-path behavior, and release .app evidence exist.',
    });
  }
  return { suite: 'model-bench', live: false, cases, routeComparisons };
}

function featureRowsForScenario(scenario: DeterministicScenario): readonly string[] {
  const rows = new Set<string>(['F01', 'F23']);
  const text = `${scenario.id} ${scenario.category ?? ''}`.toLowerCase();
  if (text.includes('stream')) rows.add('F02');
  if (text.includes('tool')) rows.add('F03');
  if (text.includes('permission') || text.includes('denied')) rows.add('F04');
  if (text.includes('file') || text.includes('workspace')) rows.add('F06');
  if (text.includes('shell') || text.includes('bash')) rows.add('F08');
  if (text.includes('mcp')) rows.add('F11');
  if (text.includes('resume') || text.includes('checkpoint')) rows.add('F12');
  if (text.includes('context') || text.includes('compact')) rows.add('F13');
  if (text.includes('artifact') || text.includes('deliverable')) rows.add('F16');
  if (text.includes('skill') || text.includes('todo') || text.includes('memory')) rows.add('F17');
  if (text.includes('attachment')) rows.add('F18');
  if (text.includes('credential') || text.includes('sandbox')) rows.add('F20');
  if (text.includes('harness') || text.includes('runtime')) rows.add('F21');
  return [...rows].sort();
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
