import { DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES } from '@offisim/core/browser';
import { ENGINE_IDS, type EmployeeRuntimeBinding, type EngineId } from '@offisim/shared-types';
import { RadioGroup, RadioGroupItem, cn } from '@offisim/ui-core';
import { useAvailableEngineAdapters } from '../../runtime/offisim-runtime-context.js';

export type RuntimeBindingScope = 'employee' | 'company';

export type RuntimeBindingResolvedSource = 'override' | 'company-default' | 'baseline';

export interface RuntimeBindingControlProps {
  scope: RuntimeBindingScope;
  value: EmployeeRuntimeBinding | null;
  onChange: (next: EmployeeRuntimeBinding | null) => void;
  resolvedBinding?: EmployeeRuntimeBinding;
  resolvedSource?: RuntimeBindingResolvedSource;
  className?: string;
}

type FullAgentOptionId = `${EngineId}:sdk-native-full-power`;
type PickerOptionId = 'inherit' | 'provider' | EngineId | FullAgentOptionId;

interface PickerOption {
  id: PickerOptionId;
  label: string;
  description: string;
  engineId?: EngineId;
  profileId?: FullAgentOptionId;
}

const ENGINE_OPTIONS: Record<EngineId, Omit<PickerOption, 'id' | 'engineId'>> = {
  'claude-engine': {
    label: 'Claude text engine',
    description: 'Preview text/reasoning only; no Offisim local tools.',
  },
  'codex-engine': {
    label: 'Codex text engine',
    description: 'Preview text/reasoning only; no Offisim local tools.',
  },
  'openai-engine': {
    label: 'OpenAI text engine',
    description: 'Preview text/reasoning only; no Offisim local tools.',
  },
};

const CODEX_FULL_AGENT_PROFILE_ID = 'codex-engine:sdk-native-full-power' as const;

const ALL_OPTIONS: ReadonlyArray<PickerOption> = [
  {
    id: 'inherit',
    label: 'Inherit company default',
    description: 'Use the company capability profile.',
  },
  {
    id: 'provider',
    label: 'Offisim gateway tools',
    description: 'Default harness with Offisim file, shell, MCP, and evidence paths.',
  },
  ...ENGINE_IDS.map((engineId) => ({ id: engineId, engineId, ...ENGINE_OPTIONS[engineId] })),
  {
    id: CODEX_FULL_AGENT_PROFILE_ID,
    engineId: 'codex-engine',
    profileId: CODEX_FULL_AGENT_PROFILE_ID,
    label: 'Codex full-agent',
    description: 'Trusted native profile gated by release evidence.',
  },
];

const ENGINE_LABEL: Record<EngineId, string> = Object.fromEntries(
  ENGINE_IDS.map((engineId) => [engineId, ENGINE_OPTIONS[engineId].label]),
) as Record<EngineId, string>;

const SOURCE_SUFFIX: Record<RuntimeBindingResolvedSource, string> = {
  override: 'override',
  'company-default': 'from company default',
  baseline: 'baseline',
};

const ENGINE_UNAVAILABLE_HINT = 'Requires trusted desktop runtime';
const ENGINE_PROFILE_SUMMARY = Object.fromEntries(
  ENGINE_IDS.map((engineId) => {
    const profiles = DEFAULT_RUNTIME_ENGINE_CAPABILITY_PROFILES.filter(
      (profile) => profile.engineId === engineId,
    );
    const preview = profiles.find((profile) => profile.tier === 'text-only');
    const fullAgent = profiles.find((profile) => profile.tier === 'sdk-native-full-agent');
    return [engineId, { preview, fullAgent }];
  }),
);

function isEngineOptionId(id: PickerOptionId): id is EngineId {
  return (ENGINE_IDS as readonly string[]).includes(id);
}

function bindingToOptionId(
  value: EmployeeRuntimeBinding | null,
  scope: RuntimeBindingScope,
): PickerOptionId {
  if (value === null) return scope === 'employee' ? 'inherit' : 'provider';
  if (value.mode === 'provider') return 'provider';
  if (value.profileId === CODEX_FULL_AGENT_PROFILE_ID) return CODEX_FULL_AGENT_PROFILE_ID;
  return value.engineId;
}

function optionIdToBinding(id: PickerOptionId): EmployeeRuntimeBinding | null {
  switch (id) {
    case 'inherit':
      return null;
    case 'provider':
      return { mode: 'provider' };
    case CODEX_FULL_AGENT_PROFILE_ID:
      return {
        mode: 'engine',
        engineId: 'codex-engine',
        profileId: CODEX_FULL_AGENT_PROFILE_ID,
      };
    default:
      if (!isEngineOptionId(id)) return { mode: 'provider' };
      return { mode: 'engine', engineId: id };
  }
}

function resolvedBindingLabel(
  binding: EmployeeRuntimeBinding,
  source: RuntimeBindingResolvedSource | undefined,
): string {
  const base = binding.mode === 'provider' ? 'Provider gateway' : ENGINE_LABEL[binding.engineId];
  if (!source) return base;
  return `${base} (${SOURCE_SUFFIX[source]})`;
}

export function RuntimeBindingControl({
  scope,
  value,
  onChange,
  resolvedBinding,
  resolvedSource,
  className = '',
}: RuntimeBindingControlProps) {
  const availableEngineAdapters = useAvailableEngineAdapters();
  const selectedId = bindingToOptionId(value, scope);
  const visibleOptions = ALL_OPTIONS.filter(
    (option) => option.id !== 'inherit' || scope === 'employee',
  );
  const disclosureBinding = scope === 'employee' ? resolvedBinding : value;
  const showPreviewDisclosure =
    disclosureBinding?.mode === 'engine' &&
    disclosureBinding.profileId !== CODEX_FULL_AGENT_PROFILE_ID;

  return (
    <fieldset className={cn('runtime-binding-control', className)}>
      <legend className="sr-only">Employee runtime capability</legend>
      <RadioGroup
        value={selectedId}
        onValueChange={(next) => onChange(optionIdToBinding(next as PickerOptionId))}
        className="runtime-binding-grid"
      >
        {visibleOptions.map((option) => {
          const engineUnavailable =
            option.engineId !== undefined && !availableEngineAdapters.has(option.engineId);
          const engineProfiles = option.engineId ? ENGINE_PROFILE_SUMMARY[option.engineId] : null;
          const selectedProfile = option.profileId
            ? engineProfiles?.fullAgent
            : engineProfiles?.preview;
          const profileBlocked =
            option.profileId !== undefined && selectedProfile?.availability === 'blocked';
          const optionDisabled = engineUnavailable || profileBlocked;
          const isSelected = option.id === selectedId;
          const description =
            profileBlocked && selectedProfile
              ? 'Blocked until selected-model release evidence passes.'
              : option.description;
          return (
            <RadioGroupItem key={option.id} value={option.id} disabled={optionDisabled} asChild>
              <div
                className="runtime-binding-option"
                data-selected={isSelected ? 'true' : 'false'}
                data-disabled={optionDisabled ? 'true' : 'false'}
              >
                <span data-slot="label">{option.label}</span>
                <span data-slot="description">{description}</span>
                {selectedProfile ? (
                  <span data-slot="profile">
                    {selectedProfile.profileId} · {selectedProfile.tier} ·{' '}
                    {selectedProfile.evidenceClass} · {selectedProfile.verification.status}
                  </span>
                ) : null}
                {engineProfiles?.fullAgent && !option.profileId ? (
                  <span data-slot="warning">
                    {engineProfiles.fullAgent.availability === 'production'
                      ? `Full-agent promoted: ${engineProfiles.fullAgent.profileId}`
                      : `Full-agent target unavailable: ${engineProfiles.fullAgent.profileId} · missing ${engineProfiles.fullAgent.verification.blockers
                          .slice(0, 2)
                          .join(' / ')}`}
                  </span>
                ) : null}
                {option.profileId && selectedProfile ? (
                  <span data-slot="profile-state" data-availability={selectedProfile.availability}>
                    {selectedProfile.availability === 'production'
                      ? 'Release verified'
                      : `Unavailable: ${selectedProfile.verification.blockers
                          .slice(0, 2)
                          .join(' / ')}`}
                  </span>
                ) : null}
                {engineUnavailable && (
                  <span data-slot="unavailable">{ENGINE_UNAVAILABLE_HINT}</span>
                )}
              </div>
            </RadioGroupItem>
          );
        })}
      </RadioGroup>

      {scope === 'employee' && resolvedBinding && (
        <p className="runtime-binding-resolved">
          Resolved:{' '}
          <span data-slot="value">{resolvedBindingLabel(resolvedBinding, resolvedSource)}</span>
        </p>
      )}

      {showPreviewDisclosure && (
        <p className="runtime-binding-disclosure">
          Text-only preview · SDK transport is model access, not a full-agent route. Gateway-bridged
          tools and SDK-native full-agent profiles become selectable only after deterministic,
          benchmark, trusted-host, release app, denied-path, cancellation, rollback, sandbox, and
          credential-boundary evidence passes.
        </p>
      )}
    </fieldset>
  );
}
