import { useEffect, useRef, useState } from 'react';
import {
  clearRuntimeSecret,
  getRuntimeSecretStatus,
  setRuntimeSecret,
} from '../../../lib/desktop-provider-secrets';
import { isTauri } from '../../../lib/env';
import {
  type ProviderConfig,
  loadProviderConfig,
  normalizeRuntimePolicy,
  resolveProviderConfig,
  saveProviderConfig,
} from '../../../lib/provider-config';
import { useOffisimRuntimeStatus } from '../../../runtime/offisim-runtime-context';
import {
  getDefaultProviderAccessMode,
  getDefaultProviderVariantId,
  getProviderPreset,
  getProviderVariantById,
} from '../provider-presets';
import { DEFAULT_PRODUCT_ID } from './useSettingsProviderState';
import type { useSettingsProviderState } from './useSettingsProviderState';
import type { useSettingsRuntimePolicy } from './useSettingsRuntimePolicy';

interface SaveOrchestratorOptions {
  isActive: boolean;
  closeOnSave?: boolean;
  onDismiss: () => void;
  onSave: (config: ProviderConfig) => void;
  onSaveSuccess?: () => void;
  provider: ReturnType<typeof useSettingsProviderState>;
  runtimePolicy: ReturnType<typeof useSettingsRuntimePolicy>;
  snapshotJson: string;
  markLoaded: () => void;
  resetLoadedSnapshot: (snapshot: string) => void;
}

function getDefaultRuntimeSelection() {
  const defaultProduct = getProviderPreset(DEFAULT_PRODUCT_ID);
  const defaultAccessMode =
    defaultProduct?.defaultAccessMode ?? getDefaultProviderAccessMode(DEFAULT_PRODUCT_ID);
  const defaultVariantId =
    getDefaultProviderVariantId(DEFAULT_PRODUCT_ID, defaultAccessMode) ??
    defaultProduct?.variantIds[0];
  const defaultVariant = getProviderVariantById(defaultVariantId);

  return {
    provider: defaultVariant?.provider ?? 'openai-compat',
    model: defaultVariant?.defaultModel ?? '',
  };
}

export function useSettingsSaveOrchestrator({
  isActive,
  closeOnSave = false,
  onDismiss,
  onSave,
  onSaveSuccess,
  provider,
  runtimePolicy,
  snapshotJson,
  markLoaded,
  resetLoadedSnapshot,
}: SaveOrchestratorOptions) {
  const [isSaving, setIsSaving] = useState(false);
  const [isReinitializing, setIsReinitializing] = useState(false);
  const [saveError, setSaveError] = useState('');
  const savingRef = useRef(false);
  const reinitBaseVersionRef = useRef<number | null>(null);
  const { version: runtimeVersion } = useOffisimRuntimeStatus();

  useEffect(() => {
    if (!isReinitializing || reinitBaseVersionRef.current === null) return;
    if (runtimeVersion > reinitBaseVersionRef.current) {
      setIsReinitializing(false);
      reinitBaseVersionRef.current = null;
    }
  }, [runtimeVersion, isReinitializing]);

  useEffect(() => {
    if (!isReinitializing) return;
    const timer = window.setTimeout(() => {
      setIsReinitializing(false);
      reinitBaseVersionRef.current = null;
      setSaveError('Runtime failed to reinitialize. Check your provider settings and try again.');
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [isReinitializing]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load runs once when isActive flips. Provider/runtime apply helpers only call stable React setters; markLoaded is a stable callback from the dirty-tracking hook.
  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;

    async function loadState() {
      const saved = loadProviderConfig();
      if (saved) {
        provider.applyFromSaved(saved);
        const resolved = resolveProviderConfig(saved);
        const normalizedPolicy = normalizeRuntimePolicy(
          saved.runtimePolicy,
          resolved?.provider ?? saved.provider ?? 'openai-compat',
          saved.model,
        );
        runtimePolicy.applyFromSaved(normalizedPolicy);
      } else {
        provider.applyDefaults(DEFAULT_PRODUCT_ID);
        runtimePolicy.applyDefaults(getDefaultRuntimeSelection());
      }

      setSaveError('');

      if (isTauri()) {
        try {
          const status = await getRuntimeSecretStatus();
          if (!cancelled) {
            provider.setHasStoredSecret(status.hasSecret);
          }
        } catch {
          if (!cancelled) {
            provider.setHasStoredSecret(false);
          }
        }
      } else {
        provider.setHasStoredSecret(false);
      }

      markLoaded();
    }

    void loadState();

    return () => {
      cancelled = true;
    };
  }, [isActive]);

  async function handleSave() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaveError('');
    try {
      setIsSaving(true);
      const trimmedApiKey = provider.apiKey.trim();

      let parsedHeaders: Record<string, string> | undefined;
      if (provider.defaultHeaders) {
        try {
          parsedHeaders = JSON.parse(provider.defaultHeaders);
        } catch {
          setSaveError('Invalid JSON in Default Headers field.');
          return;
        }
      }

      if (provider.accessMode === 'api-key') {
        if (isTauri()) {
          if (trimmedApiKey) {
            await setRuntimeSecret(trimmedApiKey);
            provider.setHasStoredSecret(true);
          } else if (!provider.hasStoredSecret) {
            setSaveError('API Key is required.');
            return;
          }
        } else if (!trimmedApiKey) {
          setSaveError('API Key is required.');
          return;
        }
      } else if (isTauri()) {
        await clearRuntimeSecret();
        provider.setHasStoredSecret(false);
      } else {
        provider.setHasStoredSecret(false);
      }

      const draftConfig: ProviderConfig = {
        productId: provider.productId,
        accessMode: provider.accessMode,
        executionLane: provider.executionLane,
        model: provider.model,
        ...(provider.providerVariantId ? { providerVariantId: provider.providerVariantId } : {}),
        ...(provider.endpointOverride.trim()
          ? { endpointOverride: provider.endpointOverride.trim() }
          : {}),
        ...(parsedHeaders ? { defaultHeaders: parsedHeaders } : {}),
        ...(provider.accessMode === 'api-key' && trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
      };

      const resolved = resolveProviderConfig(draftConfig);
      if (!resolved) {
        setSaveError('Unable to resolve the selected provider product.');
        return;
      }
      if (!resolved.availability.available) {
        setSaveError(
          resolved.availability.message ?? 'The selected provider configuration is invalid.',
        );
        return;
      }

      const runtimePolicyConfig = runtimePolicy.buildRuntimePolicy(
        resolved.provider,
        provider.model,
      );
      const config: ProviderConfig = {
        ...draftConfig,
        runtimePolicy: runtimePolicyConfig,
      };

      saveProviderConfig(config);
      reinitBaseVersionRef.current = runtimeVersion;
      setIsReinitializing(true);
      onSave(loadProviderConfig() ?? config);
      resetLoadedSnapshot(snapshotJson);
      if (closeOnSave) {
        onDismiss();
      }
      onSaveSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSaveError(message);
    } finally {
      setIsSaving(false);
      savingRef.current = false;
    }
  }

  return {
    isSaving,
    isReinitializing,
    saveError,
    handleSave,
  };
}
