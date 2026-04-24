import { resolveAvailableExecutionLanes, resolveProviderConfig } from '../../../lib/provider-config';
import type { Density } from '../../../theme';
import {
  getAvailableProviderPresets,
  getProviderProductAccess,
  getProviderPreset,
  listProviderVariantsForProduct,
} from '../provider-presets';
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

const AVAILABLE_PRODUCTS = getAvailableProviderPresets({ tauri: IS_DESKTOP });

function parseDefaultHeaders(value: string): Record<string, string> | undefined {
  if (!value) return undefined;

  try {
    return JSON.parse(value) as Record<string, string>;
  } catch {
    return undefined;
  }
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
  const selectedProduct = getProviderPreset(provider.productId);
  const selectedAccess = getProviderProductAccess(selectedProduct, provider.accessMode);
  const availableProviderVariants = listProviderVariantsForProduct(
    provider.productId,
    provider.accessMode,
  );
  const selectedVariant =
    availableProviderVariants.find(
      (variant) => variant.providerVariantId === provider.providerVariantId,
    ) ?? availableProviderVariants[0];
  const parsedDefaultHeaders = parseDefaultHeaders(provider.defaultHeaders);
  const resolvedSelection = resolveProviderConfig({
    productId: provider.productId,
    accessMode: provider.accessMode,
    executionLane: provider.executionLane,
    providerVariantId: provider.providerVariantId || undefined,
    endpointOverride: provider.endpointOverride || undefined,
    model: provider.model || selectedVariant?.defaultModel || 'pending-model',
    ...(parsedDefaultHeaders ? { defaultHeaders: parsedDefaultHeaders } : {}),
  });
  const verifiedExecutionLanes =
    selectedVariant?.supportedExecutionLanes ??
    selectedAccess?.supportedExecutionLanes ??
    ['gateway'];
  const supportedExecutionLanes = resolveAvailableExecutionLanes(
    verifiedExecutionLanes,
    runtimePolicy.executionMode,
    { tauri: IS_DESKTOP },
  );
  const requiresEndpoint = selectedAccess?.endpointOverrideMode === 'required';
  const isMissingApiKey =
    provider.accessMode === 'api-key' && !provider.apiKey && !provider.hasStoredSecret;
  const isMissingRequiredEndpoint = requiresEndpoint && !provider.endpointOverride.trim();
  const effectiveEndpoint =
    provider.endpointOverride || resolvedSelection?.transport.baseURL || selectedVariant?.baseURL || '';
  const isSaveDisabled =
    save.isSaving ||
    save.isReinitializing ||
    !provider.model ||
    isMissingApiKey ||
    isMissingRequiredEndpoint;

  return {
    accessMode: provider.accessMode,
    apiKey: provider.apiKey,
    availableAccessModes: selectedProduct?.accessModes ?? [],
    availableProducts: AVAILABLE_PRODUCTS,
    availableProviderVariants,
    defaultHeaders: provider.defaultHeaders,
    density,
    effectiveEndpoint,
    endpointOverride: provider.endpointOverride,
    executionLane: provider.executionLane,
    executionMode: runtimePolicy.executionMode,
    gitAutoCommit: runtimePolicy.gitAutoCommit,
    handleAccessModeChange: provider.handleAccessModeChange,
    handleProductChange: provider.handleProductChange,
    handleSave: save.handleSave,
    handleVariantChange: provider.handleVariantChange,
    hasStoredSecret: provider.hasStoredSecret,
    hasUnsavedChanges: dirty.hasUnsavedChanges,
    isHostResolvedProduct: provider.accessMode !== 'api-key',
    isSaveDisabled,
    isSaving: save.isSaving || save.isReinitializing,
    isThinkingProvider: selectedVariant?.capabilities.thinking === true,
    memoryConfidenceThreshold: runtimePolicy.memoryConfidenceThreshold,
    memoryEnabled: runtimePolicy.memoryEnabled,
    memoryInjectionEnabled: runtimePolicy.memoryInjectionEnabled,
    memoryMaxFacts: runtimePolicy.memoryMaxFacts,
    model: provider.model,
    notify: (message: string, variant: 'info' | 'success' | 'error' = 'info') =>
      onToast?.(message, variant),
    productId: provider.productId,
    providerVariantId: provider.providerVariantId,
    requestDismiss: dirty.requestDismiss,
    resolvedSelection,
    routingDescription:
      selectedProduct?.advancedRoutingDescription ?? 'Advanced routing is unavailable.',
    saveError: save.saveError,
    selectedAccess,
    selectedCapabilities: capabilitySummary(selectedVariant?.capabilities),
    selectedCompatibility: formatCompatibilityLabel(selectedVariant?.compatibility),
    selectedProduct,
    selectedRegion: selectedVariant?.region?.toUpperCase() ?? 'GLOBAL',
    selectedSurface: formatSurfaceLabel(selectedVariant?.surface),
    selectedVariant,
    selectedVendor: selectedVariant?.vendor ?? 'custom',
    setApiKey: provider.setApiKey,
    setDefaultHeaders: provider.setDefaultHeaders,
    setDensity,
    setEndpointOverride: provider.setEndpointOverride,
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
    showApiKeyField: provider.accessMode === 'api-key',
    showEndpointOverride: selectedAccess?.endpointOverrideMode !== 'hidden',
    showVariantSelector: availableProviderVariants.length > 1,
    supportedExecutionLanes,
    summarizationEnabled: runtimePolicy.summarizationEnabled,
    summarizationKeepRecentMessages: runtimePolicy.summarizationKeepRecentMessages,
    summarizationTriggerTokens: runtimePolicy.summarizationTriggerTokens,
    toolSearchEnabled: runtimePolicy.toolSearchEnabled,
    verifiedExecutionLanes,
  };
}
