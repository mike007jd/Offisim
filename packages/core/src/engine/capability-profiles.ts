import type {
  EmployeeRuntimeBinding,
  EngineId,
  RuntimeEngineCapabilityProfile,
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
  const builtinProfile = findProfile(
    DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES,
    defaultRuntimeEngineProfileId(binding.engineId),
    binding.engineId,
  );
  const candidates = [
    ...policyProfiles,
    ...(adapterProfile ? [adapterProfile] : []),
    ...(builtinProfile ? [builtinProfile] : []),
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
  if (builtinProfile) return { profile: builtinProfile, source: 'builtin-default' };

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
  return profiles.find((profile) => profile.profileId === profileId && profile.engineId === engineId);
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
