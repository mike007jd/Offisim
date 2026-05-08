import type {
  EmployeeRuntimeBinding,
  LlmExecutionLane,
  MainHarnessMode,
  MainHarnessOverridePolicyRecord,
  MainHarnessOverrideScope,
  MainHarnessPolicyConfig,
  RuntimeExecutionMode,
} from '@offisim/shared-types';

export interface MainHarnessResolutionInput {
  readonly policy?: MainHarnessPolicyConfig | null;
  readonly scope: MainHarnessOverrideScope;
  readonly scopeId: string;
  readonly executionMode: RuntimeExecutionMode;
  readonly providerLane?: LlmExecutionLane;
  readonly employeeRuntimeBinding?: EmployeeRuntimeBinding | null;
}

export interface MainHarnessModeResolution {
  readonly mode: MainHarnessMode;
  readonly status: 'default' | 'allowed' | 'blocked';
  readonly reason: string;
  readonly overrideRecord?: MainHarnessOverridePolicyRecord;
}

export interface AgentDriverProposal {
  readonly proposalId: string;
  readonly mode: 'driver';
  readonly runtimeProfileId: string;
  readonly title: string;
  readonly description: string;
  readonly action: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly executesOffisimTool: false;
}

export interface MainHarnessRuntimeStatus {
  readonly mode: MainHarnessMode;
  readonly runtimeProfileId: string;
  readonly verificationStatus: MainHarnessOverridePolicyRecord['verificationStatus'];
  readonly selectable: boolean;
  readonly reason: string;
}

const REQUIRED_OVERRIDE_FIELDS: ReadonlyArray<keyof MainHarnessOverridePolicyRecord> = [
  'overrideId',
  'scope',
  'scopeId',
  'actorId',
  'reason',
  'previousMode',
  'nextMode',
  'runtimeProfileId',
  'verificationStatus',
  'trustedRuntimeAvailable',
  'timestamp',
  'rollbackCheckpoint',
];

const SCOPE_RANK: Record<MainHarnessOverrideScope, number> = {
  system: 0,
  company: 1,
  thread: 2,
  employee: 3,
  task: 4,
};

export function resolveMainHarnessMode(
  input: MainHarnessResolutionInput,
): MainHarnessModeResolution {
  const policy = input.policy;
  const overrideRecord = selectOverride(policy?.overrides ?? [], input.scope, input.scopeId);
  if (!overrideRecord) {
    const ignoredSelectors = [
      input.providerLane && input.providerLane !== 'gateway'
        ? `provider lane "${input.providerLane}"`
        : '',
      input.employeeRuntimeBinding?.mode === 'engine'
        ? `employee engine "${input.employeeRuntimeBinding.engineId}"`
        : '',
    ].filter(Boolean);
    return {
      mode: 'offisim-core',
      status: 'default',
      reason:
        ignoredSelectors.length > 0
          ? `No explicit main harness override exists; ${ignoredSelectors.join(
              ' and ',
            )} cannot override Offisim core.`
          : 'No explicit main harness override exists; Offisim core owns the run.',
    };
  }

  const missingField = firstMissingOverrideField(overrideRecord);
  if (missingField) {
    return blocked(overrideRecord, `Override is missing required audit field "${missingField}".`);
  }

  if (overrideRecord.nextMode === 'offisim-core') {
    return {
      mode: 'offisim-core',
      status: 'allowed',
      reason: 'Explicit policy selects Offisim core.',
      overrideRecord,
    };
  }

  if (overrideRecord.verificationStatus !== 'verified') {
    return blocked(
      overrideRecord,
      `Runtime profile "${overrideRecord.runtimeProfileId}" is not verified.`,
    );
  }

  if (!overrideRecord.trustedRuntimeAvailable) {
    return blocked(
      overrideRecord,
      `Trusted runtime for "${overrideRecord.runtimeProfileId}" is unavailable.`,
    );
  }

  if (input.executionMode === 'browser-limited' && overrideRecord.nextMode === 'replacement') {
    return blocked(overrideRecord, 'Browser-limited runtime cannot enter replacement mode.');
  }

  return {
    mode: overrideRecord.nextMode,
    status: 'allowed',
    reason: `Explicit verified policy selects ${overrideRecord.nextMode}.`,
    overrideRecord,
  };
}

export function createAgentDriverProposal(input: {
  readonly proposalId: string;
  readonly runtimeProfileId: string;
  readonly title: string;
  readonly description: string;
  readonly action: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}): AgentDriverProposal {
  return {
    proposalId: input.proposalId,
    mode: 'driver',
    runtimeProfileId: input.runtimeProfileId,
    title: input.title,
    description: input.description,
    action: input.action,
    createdAt: input.createdAt,
    executesOffisimTool: false,
  };
}

export function listMainHarnessRuntimeStatus(
  policy: MainHarnessPolicyConfig | null | undefined,
): MainHarnessRuntimeStatus[] {
  return (policy?.overrides ?? []).map((override) => {
    const missingField = firstMissingOverrideField(override);
    const selectable =
      !missingField &&
      override.nextMode !== 'offisim-core' &&
      override.verificationStatus === 'verified' &&
      override.trustedRuntimeAvailable;
    return {
      mode: override.nextMode,
      runtimeProfileId: override.runtimeProfileId,
      verificationStatus: override.verificationStatus,
      selectable,
      reason: missingField
        ? `Missing audit field "${missingField}".`
        : selectable
          ? 'Verified explicit override is selectable.'
          : 'Override remains blocked until verification and trusted runtime evidence exist.',
    };
  });
}

function blocked(
  overrideRecord: MainHarnessOverridePolicyRecord,
  reason: string,
): MainHarnessModeResolution {
  return {
    mode: 'offisim-core',
    status: 'blocked',
    reason,
    overrideRecord,
  };
}

function selectOverride(
  overrides: ReadonlyArray<MainHarnessOverridePolicyRecord>,
  scope: MainHarnessOverrideScope,
  scopeId: string,
): MainHarnessOverridePolicyRecord | undefined {
  const scopeRank = SCOPE_RANK[scope];
  return [...overrides]
    .filter(
      (override) =>
        SCOPE_RANK[override.scope] <= scopeRank &&
        (override.scope === 'system' || override.scopeId === scopeId),
    )
    .sort((a, b) => SCOPE_RANK[b.scope] - SCOPE_RANK[a.scope])
    .at(0);
}

function firstMissingOverrideField(
  override: MainHarnessOverridePolicyRecord,
): keyof MainHarnessOverridePolicyRecord | null {
  for (const field of REQUIRED_OVERRIDE_FIELDS) {
    const value = override[field];
    if (typeof value === 'string' && value.trim() === '') return field;
    if (value === null || value === undefined) return field;
  }
  return null;
}
