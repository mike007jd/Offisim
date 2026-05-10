import type {
  MainHarnessOverridePolicyRecord,
  MainHarnessPolicyConfig,
} from '@offisim/shared-types';
import {
  createAgentDriverProposal,
  listMainHarnessRuntimeStatus,
  resolveMainHarnessMode,
} from '../harness/main-harness-policy.js';

export interface MainHarnessControlPlaneCaseResult {
  readonly id: string;
  readonly passed: boolean;
  readonly steps: readonly string[];
  readonly error?: string;
}

export interface MainHarnessControlPlaneReport {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly cases: readonly MainHarnessControlPlaneCaseResult[];
}

type CaseRecorder = (step: string) => void;

export async function runMainHarnessControlPlaneHarness(): Promise<MainHarnessControlPlaneReport> {
  const caseFns: ReadonlyArray<{
    readonly id: string;
    readonly run: (record: CaseRecorder) => void;
  }> = [
    { id: 'main-harness-default-offisim-core', run: runDefaultCase },
    { id: 'main-harness-provider-lane-cannot-override', run: runProviderLaneCase },
    { id: 'main-harness-missing-audit-fields-blocked', run: runMissingAuditCase },
    { id: 'main-harness-invalid-override-rolls-back', run: runInvalidOverrideCase },
    { id: 'main-harness-driver-proposes-actions', run: runDriverProposalCase },
    { id: 'main-harness-replacement-without-evidence-blocked', run: runReplacementBlockedCase },
    { id: 'main-harness-browser-replacement-blocked', run: runBrowserReplacementCase },
    { id: 'main-harness-verified-driver-allowed', run: runVerifiedDriverCase },
    { id: 'main-harness-admin-status-exposes-verification', run: runAdminStatusCase },
  ];

  const cases: MainHarnessControlPlaneCaseResult[] = [];
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

function runDefaultCase(record: CaseRecorder): void {
  const resolution = resolveMainHarnessMode({
    scope: 'thread',
    scopeId: 'thread-1',
    executionMode: 'desktop-trusted',
  });
  assert(resolution.mode === 'offisim-core', 'default mode is not offisim-core');
  assert(resolution.status === 'default', 'default status mismatch');
  record('no-override-defaults-to-offisim-core');
}

function runProviderLaneCase(record: CaseRecorder): void {
  const resolution = resolveMainHarnessMode({
    scope: 'thread',
    scopeId: 'thread-1',
    executionMode: 'desktop-trusted',
    providerLane: 'claude-agent-sdk',
    employeeRuntimeBinding: { mode: 'engine', engineId: 'claude-engine' },
  });
  assert(resolution.mode === 'offisim-core', 'provider lane overrode main harness');
  assert(resolution.reason.includes('cannot override Offisim core'), 'provider boundary missing');
  record('provider-lane-and-employee-engine-ignored-without-policy');
}

function runMissingAuditCase(record: CaseRecorder): void {
  const badRecord = {
    ...overrideRecord('driver', 'verified'),
    actorId: '',
  };
  const resolution = resolveMainHarnessMode({
    policy: policy([badRecord]),
    scope: 'thread',
    scopeId: 'thread-1',
    executionMode: 'desktop-trusted',
  });
  assert(resolution.mode === 'offisim-core', 'missing audit field did not roll back');
  assert(resolution.status === 'blocked', 'missing audit field was not blocked');
  assert(resolution.reason.includes('actorId'), 'missing audit field not identified');
  record('missing-audit-field-blocked');
}

function runInvalidOverrideCase(record: CaseRecorder): void {
  const resolution = resolveMainHarnessMode({
    policy: policy([overrideRecord('driver', 'partial')]),
    scope: 'thread',
    scopeId: 'thread-1',
    executionMode: 'desktop-trusted',
  });
  assert(resolution.mode === 'offisim-core', 'unverified override selected non-default mode');
  assert(resolution.status === 'blocked', 'unverified override not blocked');
  record('unverified-override-rolls-back');
}

function runDriverProposalCase(record: CaseRecorder): void {
  const proposal = createAgentDriverProposal({
    proposalId: 'proposal-1',
    runtimeProfileId: 'driver-profile',
    title: 'Propose file edit',
    description: 'Driver proposes an edit; Offisim must execute it if approved.',
    action: { kind: 'file_edit', path: 'README.md' },
    createdAt: '2026-05-09T00:00:00.000Z',
  });
  assert(proposal.executesOffisimTool === false, 'driver proposal executes an Offisim tool');
  assert(proposal.mode === 'driver', 'proposal mode mismatch');
  record('driver-created-proposal-only');
}

function runReplacementBlockedCase(record: CaseRecorder): void {
  const resolution = resolveMainHarnessMode({
    policy: policy([overrideRecord('replacement', 'missing')]),
    scope: 'thread',
    scopeId: 'thread-1',
    executionMode: 'desktop-trusted',
  });
  assert(resolution.mode === 'offisim-core', 'replacement without evidence selected');
  assert(resolution.status === 'blocked', 'replacement without evidence not blocked');
  record('replacement-without-evidence-blocked');
}

function runBrowserReplacementCase(record: CaseRecorder): void {
  const resolution = resolveMainHarnessMode({
    policy: policy([overrideRecord('replacement', 'verified')]),
    scope: 'thread',
    scopeId: 'thread-1',
    executionMode: 'browser-limited',
  });
  assert(resolution.mode === 'offisim-core', 'browser-limited replacement selected');
  assert(resolution.reason.includes('Browser-limited'), 'browser-limited blocker missing');
  record('browser-limited-replacement-blocked');
}

function runVerifiedDriverCase(record: CaseRecorder): void {
  const resolution = resolveMainHarnessMode({
    policy: policy([overrideRecord('driver', 'verified')]),
    scope: 'thread',
    scopeId: 'thread-1',
    executionMode: 'desktop-trusted',
  });
  assert(resolution.mode === 'driver', 'verified driver was not selected');
  assert(resolution.overrideRecord?.rollbackCheckpoint === 'checkpoint-1', 'rollback missing');
  assert(resolution.overrideRecord?.rollbackPlan.includes('Offisim core'), 'rollback plan missing');
  record('verified-explicit-driver-allowed');
}

function runAdminStatusCase(record: CaseRecorder): void {
  const statuses = listMainHarnessRuntimeStatus(
    policy([overrideRecord('driver', 'verified'), overrideRecord('replacement', 'blocked')]),
  );
  assert(statuses.length === 2, 'admin status count mismatch');
  assert(statuses[0]?.selectable === true, 'verified driver not selectable');
  assert(statuses[1]?.selectable === false, 'blocked replacement selectable');
  record('admin-status-separates-selectable-and-blocked');
}

function policy(overrides: MainHarnessOverridePolicyRecord[]): MainHarnessPolicyConfig {
  return { defaultMode: 'offisim-core', overrides };
}

function overrideRecord(
  nextMode: MainHarnessOverridePolicyRecord['nextMode'],
  verificationStatus: MainHarnessOverridePolicyRecord['verificationStatus'],
): MainHarnessOverridePolicyRecord {
  return {
    overrideId: `override-${nextMode}-${verificationStatus}`,
    scope: 'thread',
    scopeId: 'thread-1',
    actorId: 'admin-1',
    reason: 'Harness control-plane verification.',
    previousMode: 'offisim-core',
    nextMode,
    runtimeProfileId: `${nextMode}-profile`,
    verificationStatus,
    trustedRuntimeAvailable: true,
    timestamp: '2026-05-09T00:00:00.000Z',
    rollbackCheckpoint: 'checkpoint-1',
    rollbackPlan: 'Disable the override and return ownership to Offisim core.',
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
