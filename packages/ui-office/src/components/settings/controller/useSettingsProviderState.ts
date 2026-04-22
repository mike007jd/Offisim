import type { LlmExecutionLane } from '@offisim/shared-types';
import { useMemo, useState } from 'react';
import { isTauri } from '../../../lib/env';
import type { ProviderConfig } from '../../../lib/provider-config';
import {
  findProviderPresetKeyByConfig,
  getDefaultProviderPresetKey,
  getProviderPreset,
  getSupportedExecutionLanesForPreset,
} from '../provider-presets';

const IS_DESKTOP = isTauri();
const DEFAULT_PRESET_KEY = getDefaultProviderPresetKey({ tauri: IS_DESKTOP });

export interface ProviderStateSnapshot {
  preset: string;
  executionLane: LlmExecutionLane;
  apiKey: string;
  baseURL: string;
  model: string;
  defaultHeaders: string;
}

export function useSettingsProviderState() {
  const [preset, setPreset] = useState<string>(DEFAULT_PRESET_KEY);
  const [executionLane, setExecutionLane] = useState<LlmExecutionLane>('gateway');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [defaultHeaders, setDefaultHeaders] = useState('');
  const [hasStoredSecret, setHasStoredSecret] = useState(false);

  function handlePresetChange(value: string) {
    const prevVendor = getProviderPreset(preset)?.vendor;
    const nextPreset = getProviderPreset(value);
    setPreset(value);
    if (nextPreset) {
      setBaseURL(nextPreset.defaults.baseURL ?? '');
      setModel(nextPreset.defaults.model ?? '');
      setExecutionLane(getSupportedExecutionLanesForPreset(nextPreset)[0] ?? 'gateway');
      setDefaultHeaders(
        nextPreset.defaults.defaultHeaders
          ? JSON.stringify(nextPreset.defaults.defaultHeaders)
          : '',
      );
    }
    // Stored secret is bound to the previous vendor's credentials. Switching
    // vendors requires a fresh key; otherwise Save would reuse the stale
    // secret under a new baseURL and every request would 401 at the provider.
    if (prevVendor && nextPreset?.vendor && prevVendor !== nextPreset.vendor) {
      setApiKey('');
      setHasStoredSecret(false);
    }
  }

  function applyFromSaved(saved: ProviderConfig): void {
    setApiKey(saved.apiKey ?? '');
    setBaseURL(saved.baseURL ?? '');
    setModel(saved.model ?? '');
    setExecutionLane(saved.executionLane);
    setDefaultHeaders(saved.defaultHeaders ? JSON.stringify(saved.defaultHeaders) : '');
    const matchKey = findProviderPresetKeyByConfig(saved);
    if (matchKey) {
      setPreset(matchKey);
      return;
    }
    setPreset(DEFAULT_PRESET_KEY);
  }

  function applyDefaults(presetKey: string = DEFAULT_PRESET_KEY): void {
    const targetPreset = getProviderPreset(presetKey);
    setPreset(presetKey);
    setBaseURL(targetPreset?.defaults.baseURL ?? '');
    setModel(targetPreset?.defaults.model ?? '');
    setExecutionLane(getSupportedExecutionLanesForPreset(targetPreset)[0] ?? 'gateway');
    setDefaultHeaders(
      targetPreset?.defaults.defaultHeaders
        ? JSON.stringify(targetPreset.defaults.defaultHeaders)
        : '',
    );
  }

  const snapshot = useMemo<ProviderStateSnapshot>(
    () => ({ preset, executionLane, apiKey, baseURL, model, defaultHeaders }),
    [preset, executionLane, apiKey, baseURL, model, defaultHeaders],
  );

  return {
    preset,
    executionLane,
    apiKey,
    baseURL,
    model,
    defaultHeaders,
    hasStoredSecret,
    setPreset,
    setExecutionLane,
    setApiKey,
    setBaseURL,
    setModel,
    setDefaultHeaders,
    setHasStoredSecret,
    handlePresetChange,
    applyFromSaved,
    applyDefaults,
    snapshot,
  };
}

export { DEFAULT_PRESET_KEY, IS_DESKTOP };
