import { useEffect, useRef, useState } from 'react';
import { getRuntimeSecretStatus, setRuntimeSecret } from '../../../lib/desktop-provider-secrets';
import { isTauri } from '../../../lib/env';
import {
  type ProviderConfig,
  loadProviderConfig,
  normalizeRuntimePolicy,
  saveProviderConfig,
} from '../../../lib/provider-config';
import { useOffisimRuntimeStatus } from '../../../runtime/offisim-runtime-context';
import { PROVIDER_PRESETS, getProviderPreset } from '../provider-presets';
import { DEFAULT_PRESET_KEY } from './useSettingsProviderState';
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

  // Separate timeout: fires once when isReinitializing becomes true,
  // not reset by intermediate runtimeVersion bumps.
  useEffect(() => {
    if (!isReinitializing) return;
    const timer = window.setTimeout(() => {
      setIsReinitializing(false);
      reinitBaseVersionRef.current = null;
      setSaveError('Runtime failed to reinitialize. Check your provider settings and try again.');
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [isReinitializing]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: load runs once when isActive flips. provider/runtimePolicy apply helpers only call stable React setters, and markLoaded is a useCallback([], []) from the dirty-tracking hook wrapping a stable setState — all have stable identities across renders, so stale closures do not leak state.
  useEffect(() => {
    if (!isActive) return;

    let cancelled = false;

    async function loadState() {
      const saved = loadProviderConfig();
      if (saved) {
        provider.applyFromSaved(saved);
        const normalizedPolicy = normalizeRuntimePolicy(
          saved.runtimePolicy,
          saved.provider,
          saved.model,
        );
        runtimePolicy.applyFromSaved(normalizedPolicy);
      } else {
        const defaultPreset = getProviderPreset(DEFAULT_PRESET_KEY);
        provider.applyDefaults(DEFAULT_PRESET_KEY);
        runtimePolicy.applyDefaults({
          provider: defaultPreset?.defaults.provider,
          model: defaultPreset?.defaults.model,
        });
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
      const providerPreset = PROVIDER_PRESETS[provider.preset];
      const effectiveBaseURL = provider.baseURL || providerPreset?.defaults.baseURL;

      let parsedHeaders: Record<string, string> | undefined;
      if (provider.defaultHeaders) {
        try {
          parsedHeaders = JSON.parse(provider.defaultHeaders);
        } catch {
          setSaveError('Invalid JSON in Default Headers field.');
          return;
        }
      }

      if (isTauri()) {
        if (provider.apiKey.trim()) {
          await setRuntimeSecret(provider.apiKey.trim());
          provider.setHasStoredSecret(true);
        } else if (!provider.hasStoredSecret) {
          setSaveError('API Key is required.');
          return;
        }
      } else if (!provider.apiKey.trim()) {
        setSaveError('API Key is required.');
        return;
      }

      const runtimePolicyConfig = runtimePolicy.buildRuntimePolicy(providerPreset, provider.model);

      const config: ProviderConfig = {
        provider: providerPreset?.defaults.provider ?? 'openai-compat',
        executionLane: provider.executionLane,
        ...(providerPreset
          ? {
              providerVariantId: provider.preset,
              vendor: providerPreset.vendor,
              region: providerPreset.region,
              compatibility: providerPreset.compatibility,
              surface: providerPreset.surface,
              capabilities: providerPreset.capabilities,
            }
          : {}),
        apiKey: provider.apiKey.trim() || undefined,
        model: provider.model,
        ...(effectiveBaseURL ? { baseURL: effectiveBaseURL } : {}),
        ...(parsedHeaders
          ? { defaultHeaders: parsedHeaders }
          : providerPreset?.defaults.defaultHeaders
            ? { defaultHeaders: providerPreset.defaults.defaultHeaders }
            : {}),
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
