import { ENGINE_IDS } from '@offisim/shared-types';
import { detectTaskToolIntent } from '../agents/task-tool-intent.js';
import {
  DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES,
  defaultRuntimeEngineProfileId,
  evaluateRuntimeEngineTaskFit,
  profileEvidenceClass,
  resolveRuntimeEngineCapabilityProfile,
} from '../engine/capability-profiles.js';
import type { RuntimeEngineCapabilityProfile } from '../engine/engine-types.js';

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
    { id: 'engine-profile-sdk-native-full-power-declared', run: runSdkNativeFullPowerCase },
    {
      id: 'engine-profile-explicit-full-power-binding-resolves-blocked-profile',
      run: runExplicitFullPowerBindingCase,
    },
    { id: 'engine-profile-sdk-native-events-not-gateway-evidence', run: runSdkNativeEvidenceCase },
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
  for (const profile of textOnlyProfiles()) {
    assert(profile.profileId === defaultRuntimeEngineProfileId(profile.engineId), 'bad profile id');
    assert(profile.tier === 'text-only', `${profile.profileId} is not text-only`);
    assert(profile.availability === 'preview', `${profile.profileId} is not preview`);
    assert(profile.toolNamespace === 'none', `${profile.profileId} exposes a tool namespace`);
    assert(profile.toolModel === 'none', `${profile.profileId} exposes a tool model`);
    assert(profile.evidenceClass === 'sdk-native', `${profile.profileId} evidence class mismatch`);
    assert(profile.sandbox.workspaceAccess === 'none', `${profile.profileId} has workspace access`);
    assert(profile.supportedTaskClasses.includes('text_answer'), 'text task support missing');
    assert(profile.unsupportedTaskClasses.includes('local_file_write'), 'write block missing');
    record(`${profile.profileId}:tier-record-complete`);
  }
}

function runTextTaskAllowedCase(record: CaseRecorder): void {
  for (const profile of textOnlyProfiles()) {
    const fit = evaluateRuntimeEngineTaskFit(
      profile,
      detectTaskToolIntent('Write a short explanation of the product positioning.'),
    );
    assert(fit.allowed, `${profile.profileId} blocked a pure text task`);
    record(`${profile.profileId}:text-task-allowed`);
  }
}

function runLocalToolBlockedCase(record: CaseRecorder): void {
  for (const profile of textOnlyProfiles()) {
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
  for (const profile of textOnlyProfiles()) {
    assert(profile.tier !== 'sdk-native-full-agent', `${profile.profileId} advertises full-agent`);
    assert(profile.verification.status !== 'verified', `${profile.profileId} overstates evidence`);
    assert(profile.verification.blockers.length > 0, `${profile.profileId} lacks blockers`);
    record(`${profile.profileId}:full-agent-not-advertised`);
  }
}

function runTelemetryTaxonomyCase(record: CaseRecorder): void {
  for (const profile of textOnlyProfiles()) {
    assert(profile.telemetry === 'partial', `${profile.profileId} telemetry should be partial`);
    record(`${profile.profileId}:non-happy-path-status-declared`);
  }
}

function runCancellationStatusCase(record: CaseRecorder): void {
  for (const profile of textOnlyProfiles()) {
    assert(
      profile.cancellation === 'partial',
      `${profile.profileId} cancellation should be partial`,
    );
    assert(
      profile.verification.status !== 'verified',
      `${profile.profileId} overstates cancellation`,
    );
    record(`${profile.profileId}:cancellation-preview-only`);
  }
}

function runResumeCheckpointCase(record: CaseRecorder): void {
  for (const profile of textOnlyProfiles()) {
    assert(profile.checkpoint === 'missing', `${profile.profileId} checkpoint should be missing`);
    assert(profile.rollback === 'missing', `${profile.profileId} rollback should be missing`);
    record(`${profile.profileId}:resume-checkpoint-blocked`);
  }
}

function runDeniedPathCase(record: CaseRecorder): void {
  for (const profile of textOnlyProfiles()) {
    assert(
      profile.permissions.deniedPath === 'missing',
      `${profile.profileId} denied path missing`,
    );
    assert(
      profile.verification.blockers.some((blocker) => blocker.includes('denied-path')),
      `${profile.profileId} denied-path blocker missing`,
    );
    record(`${profile.profileId}:denied-path-blocked`);
  }
}

function runFailureClassificationCase(record: CaseRecorder): void {
  for (const profile of textOnlyProfiles()) {
    assert(
      profile.failureTaxonomy === 'partial',
      `${profile.profileId} taxonomy should be partial`,
    );
    assert(profile.availability === 'preview', `${profile.profileId} should remain preview`);
    record(`${profile.profileId}:failure-classification-partial`);
  }
}

function runSdkNativeFullPowerCase(record: CaseRecorder): void {
  for (const engineId of ENGINE_IDS) {
    const profile = mustProfile(`${engineId}:sdk-native-full-power`);
    assert(profile.tier === 'sdk-native-full-agent', `${profile.profileId} tier mismatch`);
    assert(profile.toolModel === 'native-sdk', `${profile.profileId} strips native tools`);
    assert(profile.nativeCapabilities.mcp, `${profile.profileId} does not declare MCP`);
    assert(profile.nativeCapabilities.subagents, `${profile.profileId} does not declare subagents`);
    assert(profile.nativeCapabilities.sessionResume, `${profile.profileId} omits session resume`);
    assert(
      profile.supportedTaskClasses.includes('checkpoint_rollback'),
      `${profile.profileId} omits rollback task class`,
    );
    assert(
      profile.evidenceRequirements.referenceFeatureRows.includes('F24'),
      `${profile.profileId} missing release-app feature row mapping`,
    );
    const fit = evaluateRuntimeEngineTaskFit(
      profile,
      detectTaskToolIntent('Edit a file through the native SDK tools and verify it.'),
    );
    assert(profile.availability === 'blocked', `${profile.profileId} is selectable`);
    assert(
      profile.capabilityMatrix.nativeTools === 'blocked' &&
        profile.capabilityMatrix.mcp === 'blocked' &&
        profile.capabilityMatrix.credentialBoundary === 'blocked',
      `${profile.profileId} capability matrix is incomplete`,
    );
    if (engineId === 'codex-engine') {
      assert(
        profile.verification.blockers.some((blocker) => blocker.includes('MiniMax-M2.7')),
        `${profile.profileId} lacks selected-model release blocker`,
      );
    } else {
      assert(
        profile.verification.blockers.some((blocker) => blocker.includes('cross-route benchmark')),
        `${profile.profileId} lacks benchmark blocker`,
      );
    }
    assert(!fit.allowed, `${profile.profileId} allowed production use without evidence`);
    assert(fit.code === 'ENGINE_PROFILE_BLOCKED', `${profile.profileId} wrong block code`);
    record(`${profile.profileId}:full-power-blocked-until-release-evidence`);
  }
}

function runExplicitFullPowerBindingCase(record: CaseRecorder): void {
  const resolution = resolveRuntimeEngineCapabilityProfile(
    {
      mode: 'engine',
      engineId: 'claude-engine',
      profileId: 'claude-engine:sdk-native-full-power',
    },
    null,
  );
  assert(
    resolution.profile.profileId === 'claude-engine:sdk-native-full-power',
    'explicit full-power builtin profile did not resolve',
  );
  assert(resolution.source === 'binding', 'explicit profile should be selected by binding');
  const fit = evaluateRuntimeEngineTaskFit(
    resolution.profile,
    detectTaskToolIntent('Use native SDK tools to edit a file and verify the result.'),
  );
  assert(!fit.allowed, 'full-power builtin profile was selectable before evidence');
  assert(fit.code === 'ENGINE_PROFILE_BLOCKED', 'full-power profile did not expose blocked code');
  record('explicit-full-power-binding-resolves-and-blocks');
}

function runSdkNativeEvidenceCase(record: CaseRecorder): void {
  const native = mustProfile('claude-engine:sdk-native-full-power');
  assert(profileEvidenceClass(native) === 'sdk-native', 'native SDK evidence mislabeled');
  const gatewayBridge: RuntimeEngineCapabilityProfile = {
    ...native,
    profileId: 'claude-engine:gateway-bridge-verified',
    tier: 'gateway-bridged-tools',
    availability: 'production',
    toolNamespace: 'offisim-gateway',
    toolModel: 'gateway-bridged',
    evidenceClass: 'gateway-bridged',
    verification: { status: 'verified', evidence: ['deterministic bridge fixture'], blockers: [] },
  };
  assert(profileEvidenceClass(gatewayBridge) === 'gateway-bridged', 'bridge evidence mislabeled');
  record('sdk-native-and-gateway-bridged-evidence-classes-distinct');
}

function textOnlyProfiles(): RuntimeEngineCapabilityProfile[] {
  return DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES.filter(
    (profile) => profile.tier === 'text-only',
  );
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
