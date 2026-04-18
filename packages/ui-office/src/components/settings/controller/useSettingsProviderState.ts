import { useMemo, useState } from 'react';
import { isTauri } from '../../../lib/env';
import type { ProviderConfig } from '../../../lib/provider-config';
import {
  findProviderPresetKeyByConfig,
  getDefaultProviderPresetKey,
  getProviderPreset,
} from '../provider-presets';

const IS_DESKTOP = isTauri();
const DEFAULT_PRESET_KEY = getDefaultProviderPresetKey({ tauri: IS_DESKTOP });

export interface ProviderStateSnapshot {
  preset: string;
  apiKey: string;
  baseURL: string;
  model: string;
  defaultHeaders: string;
  acpCommand: string;
}

export interface ApplyFromSavedResult {
  usedSubscriptionFallback: boolean;
}

export function useSettingsProviderState() {
  const [preset, setPreset] = useState<string>(DEFAULT_PRESET_KEY);
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [defaultHeaders, setDefaultHeaders] = useState('');
  const [acpCommand, setAcpCommand] = useState('claude');
  const [hasStoredSecret, setHasStoredSecret] = useState(false);

  function handlePresetChange(value: string) {
    setPreset(value);
    const providerPreset = getProviderPreset(value);
    if (providerPreset) {
      setBaseURL(providerPreset.defaults.baseURL ?? '');
      setModel(providerPreset.defaults.model ?? '');
      setDefaultHeaders(
        providerPreset.defaults.defaultHeaders
          ? JSON.stringify(providerPreset.defaults.defaultHeaders)
          : '',
      );
      setAcpCommand(providerPreset.defaults.acpCommand ?? 'claude');
    }
  }

  function applyFromSaved(saved: ProviderConfig): ApplyFromSavedResult {
    setApiKey(saved.apiKey ?? '');
    setBaseURL(saved.baseURL ?? '');
    setModel(saved.model ?? '');
    setDefaultHeaders(saved.defaultHeaders ? JSON.stringify(saved.defaultHeaders) : '');
    setAcpCommand(saved.acpCommand ?? 'claude');
    const matchKey = findProviderPresetKeyByConfig(saved);
    if (matchKey) {
      if (!IS_DESKTOP && matchKey === 'subscription') {
        setPreset(DEFAULT_PRESET_KEY);
        return { usedSubscriptionFallback: true };
      }
      setPreset(matchKey);
      return { usedSubscriptionFallback: false };
    }
    setPreset(DEFAULT_PRESET_KEY);
    return { usedSubscriptionFallback: false };
  }

  function applyDefaults(presetKey: string = DEFAULT_PRESET_KEY): void {
    const targetPreset = getProviderPreset(presetKey);
    setPreset(presetKey);
    setBaseURL(targetPreset?.defaults.baseURL ?? '');
    setModel(targetPreset?.defaults.model ?? '');
    setDefaultHeaders(
      targetPreset?.defaults.defaultHeaders
        ? JSON.stringify(targetPreset.defaults.defaultHeaders)
        : '',
    );
    setAcpCommand(targetPreset?.defaults.acpCommand ?? 'claude');
  }

  const snapshot = useMemo<ProviderStateSnapshot>(
    () => ({ preset, apiKey, baseURL, model, defaultHeaders, acpCommand }),
    [preset, apiKey, baseURL, model, defaultHeaders, acpCommand],
  );

  return {
    preset,
    apiKey,
    baseURL,
    model,
    defaultHeaders,
    acpCommand,
    hasStoredSecret,
    setPreset,
    setApiKey,
    setBaseURL,
    setModel,
    setDefaultHeaders,
    setAcpCommand,
    setHasStoredSecret,
    handlePresetChange,
    applyFromSaved,
    applyDefaults,
    snapshot,
  };
}

export { DEFAULT_PRESET_KEY, IS_DESKTOP };
