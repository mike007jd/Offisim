import type { Density } from '../../../theme';
import { PROVIDER_PRESETS } from '../provider-presets';
import {
  capabilitySummary,
  formatCompatibilityLabel,
  formatSurfaceLabel,
} from '../settings-primitives';
import type { useSettingsDirtyTracking } from './useSettingsDirtyTracking';
import type { useSettingsProviderState } from './useSettingsProviderState';
import type { useSettingsRuntimePolicy } from './useSettingsRuntimePolicy';
import type { useSettingsSaveOrchestrator } from './useSettingsSaveOrchestrator';

interface AssembleApiInput {
  density: Density;
  setDensity: (density: Density) => void;
  provider: ReturnType<typeof useSettingsProviderState>;
  runtimePolicy: ReturnType<typeof useSettingsRuntimePolicy>;
  save: ReturnType<typeof useSettingsSaveOrchestrator>;
  dirty: ReturnType<typeof useSettingsDirtyTracking>;
  onToast?: (message: string, variant?: 'info' | 'success' | 'error') => void;
}

export function assembleSettingsControllerApi({
  density,
  setDensity,
  provider,
  runtimePolicy,
  save,
  dirty,
  onToast,
}: AssembleApiInput) {
  const isSubscription = provider.preset === 'subscription';
  const selectedPreset = PROVIDER_PRESETS[provider.preset];
  const isThinkingProvider = selectedPreset?.hasThinking === true;
  const showBaseURL =
    provider.preset === 'custom' ||
    PROVIDER_PRESETS[provider.preset]?.defaults.baseURL !== undefined;
  const isSaveDisabled =
    save.isSaving ||
    save.isReinitializing ||
    !provider.model ||
    (!isSubscription && !provider.apiKey && !provider.hasStoredSecret);

  return {
    acpCommand: provider.acpCommand,
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    defaultHeaders: provider.defaultHeaders,
    density,
    executionMode: runtimePolicy.executionMode,
    gitAutoCommit: runtimePolicy.gitAutoCommit,
    handlePresetChange: provider.handlePresetChange,
    handleSave: save.handleSave,
    hasStoredSecret: provider.hasStoredSecret,
    hasUnsavedChanges: dirty.hasUnsavedChanges,
    isSaveDisabled,
    isSaving: save.isSaving || save.isReinitializing,
    isSubscription,
    isThinkingProvider,
    memoryConfidenceThreshold: runtimePolicy.memoryConfidenceThreshold,
    memoryEnabled: runtimePolicy.memoryEnabled,
    memoryInjectionEnabled: runtimePolicy.memoryInjectionEnabled,
    memoryMaxFacts: runtimePolicy.memoryMaxFacts,
    model: provider.model,
    notify: (message: string, variant: 'info' | 'success' | 'error' = 'info') =>
      onToast?.(message, variant),
    preset: provider.preset,
    requestDismiss: dirty.requestDismiss,
    saveError: save.saveError,
    selectedCapabilities: capabilitySummary(selectedPreset?.capabilities),
    selectedCompatibility: formatCompatibilityLabel(selectedPreset?.compatibility),
    selectedPreset,
    selectedRegion: selectedPreset?.region?.toUpperCase() ?? 'GLOBAL',
    selectedSurface: formatSurfaceLabel(selectedPreset?.surface),
    selectedVendor: selectedPreset?.vendor ?? 'custom',
    setAcpCommand: provider.setAcpCommand,
    setApiKey: provider.setApiKey,
    setBaseURL: provider.setBaseURL,
    setDensity,
    setExecutionMode: runtimePolicy.setExecutionMode,
    setGitAutoCommit: runtimePolicy.setGitAutoCommit,
    setMemoryConfidenceThreshold: runtimePolicy.setMemoryConfidenceThreshold,
    setMemoryEnabled: runtimePolicy.setMemoryEnabled,
    setMemoryInjectionEnabled: runtimePolicy.setMemoryInjectionEnabled,
    setMemoryMaxFacts: runtimePolicy.setMemoryMaxFacts,
    setModel: provider.setModel,
    setRuntimeModelDefault: runtimePolicy.setRuntimeModelDefault,
    setSummarizationEnabled: runtimePolicy.setSummarizationEnabled,
    setSummarizationKeepRecentMessages: runtimePolicy.setSummarizationKeepRecentMessages,
    setSummarizationTriggerTokens: runtimePolicy.setSummarizationTriggerTokens,
    setToolSearchEnabled: runtimePolicy.setToolSearchEnabled,
    showBaseURL,
    summarizationEnabled: runtimePolicy.summarizationEnabled,
    summarizationKeepRecentMessages: runtimePolicy.summarizationKeepRecentMessages,
    summarizationTriggerTokens: runtimePolicy.summarizationTriggerTokens,
    toolSearchEnabled: runtimePolicy.toolSearchEnabled,
  };
}
