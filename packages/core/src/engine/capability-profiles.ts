import type {
  EmployeeRuntimeBinding,
  EngineId,
  RuntimeEngineCapabilityProfile,
  RuntimeEvidenceClass,
  RuntimePolicyConfig,
} from '@offisim/shared-types';
import type { TaskToolIntent } from '../agents/task-tool-intent.js';

export interface RuntimeEngineProfileResolution {
  readonly profile: RuntimeEngineCapabilityProfile;
  readonly source: 'binding' | 'runtime-policy' | 'adapter' | 'builtin-default';
}

export interface RuntimeEngineTaskFit {
  readonly allowed: boolean;
  readonly reason: string;
  readonly code?: 'ENGINE_PROFILE_BLOCKED' | 'ENGINE_PROFILE_CAPABILITY_GAP';
}

const TEXT_ONLY_UNSUPPORTED = [
  'local_file_read',
  'local_file_write',
  'shell_command',
  'workspace_tool',
  'mcp_tool',
  'verification_gate',
] as const;

export const DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES: ReadonlyArray<RuntimeEngineCapabilityProfile> =
  [
    textOnlyPreviewProfile('codex-engine', 'Codex engine text-only preview'),
    textOnlyPreviewProfile('claude-engine', 'Claude engine text-only preview'),
    textOnlyPreviewProfile('openai-engine', 'OpenAI engine text-only preview'),
    sdkNativeFullPowerBlockedProfile('codex-engine', 'Codex SDK-native full-power profile'),
    sdkNativeFullPowerBlockedProfile('claude-engine', 'Claude SDK-native full-power profile'),
    sdkNativeFullPowerBlockedProfile('openai-engine', 'OpenAI SDK-native full-power profile'),
  ];

export function defaultRuntimeEngineProfileId(engineId: EngineId): string {
  return `${engineId}:text-only-preview`;
}

export function resolveRuntimeEngineCapabilityProfile(
  binding: Extract<EmployeeRuntimeBinding, { mode: 'engine' }>,
  runtimePolicy: Pick<RuntimePolicyConfig, 'runtimeEngineProfiles'> | null | undefined,
  adapterProfile?: RuntimeEngineCapabilityProfile,
): RuntimeEngineProfileResolution {
  const policyProfiles = runtimePolicy?.runtimeEngineProfiles ?? [];
  const builtinProfiles = DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES.filter(
    (profile) => profile.engineId === binding.engineId,
  );
  const builtinDefaultProfile = findProfile(
    builtinProfiles,
    defaultRuntimeEngineProfileId(binding.engineId),
    binding.engineId,
  );
  const candidates = [
    ...policyProfiles,
    ...(adapterProfile ? [adapterProfile] : []),
    ...builtinProfiles,
  ];

  if (binding.profileId) {
    const profile = findProfile(candidates, binding.profileId, binding.engineId);
    if (!profile) {
      throw new Error(
        `Runtime engine profile "${binding.profileId}" is not configured for ${binding.engineId}.`,
      );
    }
    return {
      profile,
      source: policyProfiles.includes(profile) ? 'runtime-policy' : 'binding',
    };
  }

  const policyDefault = policyProfiles.find((profile) => profile.engineId === binding.engineId);
  if (policyDefault) return { profile: policyDefault, source: 'runtime-policy' };
  if (adapterProfile) return { profile: adapterProfile, source: 'adapter' };
  if (builtinDefaultProfile) return { profile: builtinDefaultProfile, source: 'builtin-default' };

  throw new Error(`No runtime engine capability profile is configured for ${binding.engineId}.`);
}

export function evaluateRuntimeEngineTaskFit(
  profile: RuntimeEngineCapabilityProfile,
  intent: TaskToolIntent,
): RuntimeEngineTaskFit {
  if (profile.availability === 'blocked') {
    return {
      allowed: false,
      code: 'ENGINE_PROFILE_BLOCKED',
      reason: `Runtime profile "${profile.profileId}" is blocked until required evidence exists.`,
    };
  }

  if (requiresGatewayEvidence(intent) && !hasGatewayBridge(profile)) {
    return {
      allowed: false,
      code: 'ENGINE_PROFILE_CAPABILITY_GAP',
      reason: [
        `Runtime profile "${profile.profileId}" is ${profile.tier} and cannot satisfy this tool/evidence task.`,
        'Use the default Offisim gateway harness or a verified gateway-bridged employee profile.',
      ].join(' '),
    };
  }

  if (profile.tier === 'full-agent-employee' && profile.verification.status !== 'verified') {
    return {
      allowed: false,
      code: 'ENGINE_PROFILE_BLOCKED',
      reason: `Full-agent profile "${profile.profileId}" is not verified for production use.`,
    };
  }

  return {
    allowed: true,
    reason:
      profile.availability === 'preview'
        ? `Runtime profile "${profile.profileId}" is allowed only as ${profile.tier} preview.`
        : `Runtime profile "${profile.profileId}" is allowed.`,
  };
}

export function profileToolTelemetryType(
  profile: RuntimeEngineCapabilityProfile,
): 'runtime-profile' | 'workstation' {
  return profile.toolModel === 'gateway-bridged' ? 'workstation' : 'runtime-profile';
}

export function profileEvidenceClass(
  profile: RuntimeEngineCapabilityProfile,
): RuntimeEvidenceClass {
  return profile.evidenceClass;
}

function requiresGatewayEvidence(intent: TaskToolIntent): boolean {
  return intent.requiresLocalTools || intent.needsVerification;
}

function hasGatewayBridge(profile: RuntimeEngineCapabilityProfile): boolean {
  return profile.toolModel === 'gateway-bridged' || profile.toolModel === 'mixed';
}

function findProfile(
  profiles: ReadonlyArray<RuntimeEngineCapabilityProfile>,
  profileId: string,
  engineId: EngineId,
): RuntimeEngineCapabilityProfile | undefined {
  return profiles.find(
    (profile) => profile.profileId === profileId && profile.engineId === engineId,
  );
}

function textOnlyPreviewProfile(
  engineId: EngineId,
  displayName: string,
): RuntimeEngineCapabilityProfile {
  return {
    profileId: defaultRuntimeEngineProfileId(engineId),
    engineId,
    displayName,
    tier: 'text-only',
    availability: 'preview',
    trustTier: 'text-only',
    supportedTaskClasses: ['text_answer', 'reasoning', 'draft_handoff'],
    unsupportedTaskClasses: [...TEXT_ONLY_UNSUPPORTED],
    toolNamespace: 'none',
    toolModel: 'none',
    evidenceClass: 'sdk-native',
    sandbox: {
      boundary: 'engine-sandbox',
      workspaceAccess: 'none',
    },
    permissions: {
      model: 'none',
      deniedPath: 'missing',
    },
    contextRetention: 'partial',
    cancellation: 'partial',
    checkpoint: 'missing',
    telemetry: 'partial',
    rollback: 'missing',
    failureTaxonomy: 'partial',
    nativeCapabilities: {
      tools: false,
      mcp: false,
      subagents: false,
      handoffs: false,
      sessionResume: false,
    },
    verification: {
      status: 'partial',
      evidence: ['adapter text/reasoning streaming events'],
      blockers: [
        'no Offisim gateway tool bridge',
        'no denied-path evidence',
        'no checkpoint/resume evidence',
        'no release full-agent evidence',
      ],
    },
  };
}

function sdkNativeFullPowerBlockedProfile(
  engineId: EngineId,
  displayName: string,
): RuntimeEngineCapabilityProfile {
  return {
    profileId: `${engineId}:sdk-native-full-power`,
    engineId,
    displayName,
    tier: 'full-agent-employee',
    availability: 'blocked',
    trustTier: 'trusted-full-agent',
    supportedTaskClasses: [
      'text_answer',
      'reasoning',
      'native_tool_call',
      'mcp_tool',
      'session_resume',
      'session_fork',
      'subagent_handoff',
      'guardrail_hook',
      'checkpoint_rollback',
    ],
    unsupportedTaskClasses: ['production_local_tool_work_without_release_evidence'],
    toolNamespace: 'native-engine',
    toolModel: 'native-sdk',
    evidenceClass: 'sdk-native',
    sandbox: {
      boundary: 'engine-sandbox',
      workspaceAccess: 'write',
    },
    permissions: {
      model: 'engine-native',
      deniedPath: 'blocked',
    },
    contextRetention: 'blocked',
    cancellation: 'blocked',
    checkpoint: 'blocked',
    telemetry: 'blocked',
    rollback: 'blocked',
    failureTaxonomy: 'blocked',
    nativeCapabilities: {
      tools: true,
      mcp: true,
      subagents: true,
      handoffs: true,
      sessionResume: true,
    },
    verification: {
      status: 'blocked',
      evidence: [
        'profile exists as a blocked SDK-native employee runtime target',
        'native SDK tool/MCP/session/handoff events must be normalized before availability',
      ],
      blockers: [
        'no release .app SDK-native success evidence',
        'no denied native tool path evidence',
        'no SDK-native cancellation evidence',
        'no session resume/fork evidence',
        'no checkpoint rollback evidence',
        'no MCP status/call/failure/cancellation evidence',
        'no hook/guardrail allow/deny evidence',
        'no handoff/subagent telemetry evidence',
        'no budget exhaustion evidence',
        'no sandbox escape denial evidence',
        'no usage/cost evidence',
        'no cross-route benchmark against offisim-core',
      ],
    },
  };
}
