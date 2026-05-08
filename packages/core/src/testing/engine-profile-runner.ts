import {
  DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES,
  defaultRuntimeEngineProfileId,
  evaluateRuntimeEngineTaskFit,
  resolveRuntimeEngineCapabilityProfile,
} from '../engine/capability-profiles.js';
import type { RuntimeEngineCapabilityProfile } from '../engine/engine-types.js';
import { detectTaskToolIntent } from '../agents/task-tool-intent.js';

export interface EngineProfileCaseResult {
  readonly id: string;
  readonly passed: boolean;
  readonly steps: readonly string[];
  readonly error?: string;
}

export interface EngineProfileHarnessReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly cases: readonly EngineProfileCaseResult[];
}

type CaseRecorder = (step: string) => void;

export async function runEngineProfileHarness(): Promise<EngineProfileHarnessReport> {
  const caseFns: ReadonlyArray<{
    readonly id: string;
    readonly run: (record: CaseRecorder) => void;
  }> = [
    { id: 'engine-profile-tier-records-complete', run: runTierRecordCase },
    { id: 'engine-profile-text-task-allowed', run: runTextTaskAllowedCase },
    { id: 'engine-profile-local-tool-task-blocked', run: runLocalToolBlockedCase },
    { id: 'engine-profile-explicit-binding-resolves-profile', run: runExplicitBindingCase },
    { id: 'engine-profile-full-agent-not-advertised', run: runFullAgentBlockedCase },
    { id: 'engine-profile-cancellation-status-gated', run: runCancellationStatusCase },
    { id: 'engine-profile-resume-checkpoint-blocked', run: runResumeCheckpointCase },
    { id: 'engine-profile-denied-path-blocked', run: runDeniedPathCase },
    { id: 'engine-profile-telemetry-taxonomy-declared', run: runTelemetryTaxonomyCase },
    { id: 'engine-profile-failure-classification-partial', run: runFailureClassificationCase },
  ];

  const cases: EngineProfileCaseResult[] = [];
  for (const caseFn of caseFns) {
    const steps: string[] = [];
    try {
      caseFn.run((step) => steps.push(step));
      cases.push({ id: caseFn.id, passed: true, steps });
    } catch (error) {
      cases.push({
        id: caseFn.id,
        passed: false,
        steps,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const passed = cases.filter((item) => item.passed).length;
  return { total: cases.length, passed, failed: cases.length - passed, cases };
}

function runTierRecordCase(record: CaseRecorder): void {
  for (const profile of DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES) {
    assert(profile.profileId === defaultRuntimeEngineProfileId(profile.engineId), 'bad profile id');
    assert(profile.tier === 'text-only', `${profile.profileId} is not text-only`);
    assert(profile.availability === 'preview', `${profile.profileId} is not preview`);
    assert(profile.toolNamespace === 'none', `${profile.profileId} exposes a tool namespace`);
    assert(profile.toolModel === 'none', `${profile.profileId} exposes a tool model`);
    assert(profile.sandbox.workspaceAccess === 'none', `${profile.profileId} has workspace access`);
    assert(profile.supportedTaskClasses.includes('text_answer'), 'text task support missing');
    assert(profile.unsupportedTaskClasses.includes('local_file_write'), 'write block missing');
    record(`${profile.profileId}:tier-record-complete`);
  }
}

function runTextTaskAllowedCase(record: CaseRecorder): void {
  for (const profile of DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES) {
    const fit = evaluateRuntimeEngineTaskFit(
      profile,
      detectTaskToolIntent('Write a short explanation of the product positioning.'),
    );
    assert(fit.allowed, `${profile.profileId} blocked a pure text task`);
    record(`${profile.profileId}:text-task-allowed`);
  }
}

function runLocalToolBlockedCase(record: CaseRecorder): void {
  for (const profile of DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES) {
    const fit = evaluateRuntimeEngineTaskFit(
      profile,
      detectTaskToolIntent('Edit the file, run pnpm typecheck, and verify the change.'),
    );
    assert(!fit.allowed, `${profile.profileId} allowed a local tool task`);
    assert(fit.code === 'ENGINE_PROFILE_CAPABILITY_GAP', 'wrong blocked code');
    assert(fit.reason.includes('default Offisim gateway harness'), 'guidance missing');
    record(`${profile.profileId}:local-tool-blocked`);
  }
}

function runExplicitBindingCase(record: CaseRecorder): void {
  const profile = mustProfile('codex-engine:text-only-preview');
  const resolution = resolveRuntimeEngineCapabilityProfile(
    { mode: 'engine', engineId: 'codex-engine', profileId: profile.profileId },
    { runtimeEngineProfiles: [profile] },
  );
  assert(resolution.profile.profileId === profile.profileId, 'explicit profile not resolved');
  assert(resolution.source === 'runtime-policy', 'explicit profile did not resolve from policy');
  record('explicit-profile-binding-resolved');
}

function runFullAgentBlockedCase(record: CaseRecorder): void {
  for (const profile of DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES) {
    assert(profile.tier !== 'full-agent-employee', `${profile.profileId} advertises full-agent`);
    assert(profile.verification.status !== 'verified', `${profile.profileId} overstates evidence`);
    assert(profile.verification.blockers.length > 0, `${profile.profileId} lacks blockers`);
    record(`${profile.profileId}:full-agent-not-advertised`);
  }
}

function runTelemetryTaxonomyCase(record: CaseRecorder): void {
  for (const profile of DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES) {
    assert(profile.telemetry === 'partial', `${profile.profileId} telemetry should be partial`);
    record(`${profile.profileId}:non-happy-path-status-declared`);
  }
}

function runCancellationStatusCase(record: CaseRecorder): void {
  for (const profile of DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES) {
    assert(profile.cancellation === 'partial', `${profile.profileId} cancellation should be partial`);
    assert(profile.verification.status !== 'verified', `${profile.profileId} overstates cancellation`);
    record(`${profile.profileId}:cancellation-preview-only`);
  }
}

function runResumeCheckpointCase(record: CaseRecorder): void {
  for (const profile of DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES) {
    assert(profile.checkpoint === 'missing', `${profile.profileId} checkpoint should be missing`);
    assert(profile.rollback === 'missing', `${profile.profileId} rollback should be missing`);
    record(`${profile.profileId}:resume-checkpoint-blocked`);
  }
}

function runDeniedPathCase(record: CaseRecorder): void {
  for (const profile of DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES) {
    assert(profile.permissions.deniedPath === 'missing', `${profile.profileId} denied path missing`);
    assert(
      profile.verification.blockers.some((blocker) => blocker.includes('denied-path')),
      `${profile.profileId} denied-path blocker missing`,
    );
    record(`${profile.profileId}:denied-path-blocked`);
  }
}

function runFailureClassificationCase(record: CaseRecorder): void {
  for (const profile of DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES) {
    assert(profile.failureTaxonomy === 'partial', `${profile.profileId} taxonomy should be partial`);
    assert(profile.availability === 'preview', `${profile.profileId} should remain preview`);
    record(`${profile.profileId}:failure-classification-partial`);
  }
}

function mustProfile(profileId: string): RuntimeEngineCapabilityProfile {
  const profile = DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES.find(
    (item) => item.profileId === profileId,
  );
  assert(profile !== undefined, `missing profile ${profileId}`);
  return profile;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
