import { resolveAvailableExecutionLanes } from '../../../lib/provider-config';
import type { Density } from '../../../theme';
import { PROVIDER_PRESETS } from '../provider-presets';
import {
  capabilitySummary,
  formatCompatibilityLabel,
  formatSurfaceLabel,
} from '../settings-primitives';
import type { useSettingsDirtyTracking } from './useSettingsDirtyTracking';
import { IS_DESKTOP } from './useSettingsProviderState';
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
  const selectedPreset = PROVIDER_PRESETS[provider.preset];
  const verifiedExecutionLanes = selectedPreset?.supportedExecutionLanes ?? ['gateway'];
  const supportedExecutionLanes = resolveAvailableExecutionLanes(
    verifiedExecutionLanes,
    runtimePolicy.executionMode,
    { tauri: IS_DESKTOP },
  );
  const isThinkingProvider = selectedPreset?.hasThinking === true;
  const showBaseURL =
    provider.preset === 'custom' ||
    PROVIDER_PRESETS[provider.preset]?.defaults.baseURL !== undefined;
  const isSaveDisabled =
    save.isSaving ||
    save.isReinitializing ||
    !provider.model ||
    (!provider.apiKey && !provider.hasStoredSecret);

  return {
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    defaultHeaders: provider.defaultHeaders,
    density,
    executionLane: provider.executionLane,
    executionMode: runtimePolicy.executionMode,
    gitAutoCommit: runtimePolicy.gitAutoCommit,
    handlePresetChange: provider.handlePresetChange,
    handleSave: save.handleSave,
    hasStoredSecret: provider.hasStoredSecret,
    hasUnsavedChanges: dirty.hasUnsavedChanges,
    isSaveDisabled,
    isSaving: save.isSaving || save.isReinitializing,
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
    verifiedExecutionLanes,
    selectedPreset,
    selectedRegion: selectedPreset?.region?.toUpperCase() ?? 'GLOBAL',
    selectedSurface: formatSurfaceLabel(selectedPreset?.surface),
    selectedVendor: selectedPreset?.vendor ?? 'custom',
    setApiKey: provider.setApiKey,
    setBaseURL: provider.setBaseURL,
    setDensity,
    setExecutionLane: provider.setExecutionLane,
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
    supportedExecutionLanes,
    summarizationEnabled: runtimePolicy.summarizationEnabled,
    summarizationKeepRecentMessages: runtimePolicy.summarizationKeepRecentMessages,
    summarizationTriggerTokens: runtimePolicy.summarizationTriggerTokens,
    toolSearchEnabled: runtimePolicy.toolSearchEnabled,
  };
}
