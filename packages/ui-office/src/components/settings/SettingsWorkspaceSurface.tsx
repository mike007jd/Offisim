import { useEffect, useMemo } from 'react';
import {
  DEFAULT_EXECUTION_LANE,
  type ProviderConfig,
  resolveAvailableExecutionLanes,
} from '../../lib/provider-config';
import { useTheme } from '../../theme';
import { assembleSettingsControllerApi } from './controller/assembleSettingsControllerApi';
import { useSettingsDirtyTracking } from './controller/useSettingsDirtyTracking';
import { IS_DESKTOP, useSettingsProviderState } from './controller/useSettingsProviderState';
import { useSettingsRuntimePolicy } from './controller/useSettingsRuntimePolicy';
import { useSettingsSaveOrchestrator } from './controller/useSettingsSaveOrchestrator';
import { getProviderPreset, getSupportedExecutionLanesForPreset } from './provider-presets';

export type SettingsTab = 'provider' | 'runtime' | 'mcp' | 'external';

interface SettingsWorkspaceControllerOptions {
  isActive: boolean;
  closeOnSave?: boolean;
  onDismiss: () => void;
  onSave: (config: ProviderConfig) => void;
  onSaveSuccess?: () => void;
  onToast?: (message: string, variant?: 'info' | 'success' | 'error') => void;
}

export function useSettingsWorkspaceController({
  isActive,
  closeOnSave = false,
  onDismiss,
  onSave,
  onSaveSuccess,
  onToast,
}: SettingsWorkspaceControllerOptions) {
  const { density, resolvedTheme, setDensity, setTheme, theme } = useTheme();
  const provider = useSettingsProviderState();
  const runtimePolicy = useSettingsRuntimePolicy();
  const selectedProduct = getProviderPreset(provider.productId);
  const availableExecutionLanes = useMemo(
    () =>
      resolveAvailableExecutionLanes(
        getSupportedExecutionLanesForPreset(
          selectedProduct,
          provider.accessMode,
          provider.providerVariantId,
        ),
        runtimePolicy.executionMode,
        { tauri: IS_DESKTOP },
      ),
    [selectedProduct, provider.accessMode, provider.providerVariantId, runtimePolicy.executionMode],
  );

  useEffect(() => {
    if (availableExecutionLanes.includes(provider.executionLane)) return;
    provider.setExecutionLane(availableExecutionLanes[0] ?? DEFAULT_EXECUTION_LANE);
  }, [availableExecutionLanes, provider.executionLane, provider.setExecutionLane]);

  const snapshotJson = useMemo(
    () => JSON.stringify({ ...provider.snapshot, ...runtimePolicy.snapshot, density }),
    [provider.snapshot, runtimePolicy.snapshot, density],
  );
  const dirty = useSettingsDirtyTracking({ isActive, snapshotJson, onDismiss });
  const save = useSettingsSaveOrchestrator({
    isActive,
    closeOnSave,
    onDismiss,
    onSave,
    onSaveSuccess,
    provider,
    runtimePolicy,
    snapshotJson,
    markLoaded: dirty.markLoaded,
    resetLoadedSnapshot: dirty.resetLoadedSnapshot,
  });
  return assembleSettingsControllerApi({
    density,
    resolvedTheme,
    setDensity,
    setTheme,
    theme,
    provider,
    runtimePolicy,
    save,
    dirty,
    onToast,
  });
}
