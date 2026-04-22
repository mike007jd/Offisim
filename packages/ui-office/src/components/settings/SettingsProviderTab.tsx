import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@offisim/ui-core';
import { Bot, ShieldCheck } from 'lucide-react';
import { isTauri } from '../../lib/env';
import { isLlmExecutionLane } from '../../lib/provider-config';
import type { useSettingsWorkspaceController } from './SettingsWorkspaceSurface';
import { getAvailableProviderPresets } from './provider-presets';
import { SectionLabel, SurfaceCard, surfaceInputProps } from './settings-primitives';

const IS_DESKTOP = isTauri();
const AVAILABLE_PRESETS = getAvailableProviderPresets({ tauri: IS_DESKTOP });
const EXECUTION_LANE_LABELS = {
  gateway: 'Gateway',
  'claude-agent-sdk': 'Claude Agent SDK',
  'openai-agents-sdk': 'OpenAI Agents SDK',
} as const;

interface SettingsProviderTabProps {
  controller: ReturnType<typeof useSettingsWorkspaceController>;
}

export function SettingsProviderTab({ controller }: SettingsProviderTabProps) {
  const {
    apiKey,
    baseURL,
    executionLane,
    handlePresetChange,
    hasStoredSecret,
    isThinkingProvider,
    model,
    preset,
    selectedCapabilities,
    selectedCompatibility,
    selectedPreset,
    selectedRegion,
    selectedSurface,
    setApiKey,
    setBaseURL,
    setExecutionLane,
    setModel,
    setRuntimeModelDefault,
    showBaseURL,
    supportedExecutionLanes,
    verifiedExecutionLanes,
  } = controller;
  const apiKeyPlaceholder = hasStoredSecret
    ? 'Stored securely on this device'
    : selectedPreset?.vendor === 'minimax'
      ? 'sk-cp-...'
      : 'sk-...';
  const compatibilitySummary =
    selectedPreset?.vendor === 'minimax'
      ? `${selectedSurface} • ${selectedRegion}`
      : `${selectedCompatibility} • ${selectedSurface} • ${selectedRegion}`;

  return (
    <div className="grid min-h-0 gap-6 xl:grid-cols-[340px,minmax(0,1fr)]">
      <div className="space-y-4">
        <SurfaceCard title="Official compatibility" icon={<ShieldCheck className="h-5 w-5" />}>
          <div className="rounded-[20px] border border-cyan-400/15 bg-cyan-400/10 px-4 py-4">
            <p className="text-sm font-semibold text-white">
              {selectedPreset?.label ?? 'Custom provider'}
            </p>
            <p className="mt-2 text-sm text-slate-300">{compatibilitySummary}</p>
            <p className="mt-3 text-xs leading-5 text-slate-400">{selectedCapabilities}</p>
          </div>
        </SurfaceCard>
      </div>

      <div className="space-y-4">
        <SurfaceCard title="Models & Access" icon={<Bot className="h-5 w-5" />}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="lg:col-span-2">
              <SectionLabel htmlFor="settings-provider">Official vendor preset</SectionLabel>
              <Select value={preset} onValueChange={handlePresetChange}>
                <SelectTrigger className={surfaceInputProps()}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(AVAILABLE_PRESETS).map(([key, providerPreset]) => (
                    <SelectItem key={key} value={key}>
                      {providerPreset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="lg:col-span-2">
              <SectionLabel htmlFor="settings-execution-lane">Execution lane</SectionLabel>
              <Select
                value={executionLane}
                onValueChange={(value) => {
                  if (isLlmExecutionLane(value)) {
                    setExecutionLane(value);
                  }
                }}
              >
                <SelectTrigger id="settings-execution-lane" className={surfaceInputProps()}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {supportedExecutionLanes.map((lane) => (
                    <SelectItem key={lane} value={lane}>
                      {EXECUTION_LANE_LABELS[lane]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs text-slate-400">
                {supportedExecutionLanes.includes('claude-agent-sdk')
                  ? 'Claude Agent SDK is verified for this preset in desktop-trusted mode and runs through the local trusted host sidecar.'
                  : verifiedExecutionLanes.length > supportedExecutionLanes.length
                    ? 'Additional lanes are verified in backend harness, but the current product host still exposes gateway only.'
                    : 'This preset currently verifies gateway execution only in the active runtime mode.'}
              </p>
            </div>

            <div className="lg:col-span-2">
              <SectionLabel htmlFor="settings-api-key">Secure API key</SectionLabel>
              <Input
                id="settings-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={apiKeyPlaceholder}
                className={surfaceInputProps()}
              />
              {IS_DESKTOP && hasStoredSecret ? (
                <p className="mt-2 text-xs text-slate-400">
                  Leave this empty to keep the existing secure credential.
                </p>
              ) : null}
            </div>

            {showBaseURL ? (
              <div className="lg:col-span-2">
                <SectionLabel htmlFor="settings-base-url">Base URL</SectionLabel>
                <Input
                  id="settings-base-url"
                  value={baseURL}
                  onChange={(event) => setBaseURL(event.target.value)}
                  placeholder="https://api.example.com/v1"
                  className={surfaceInputProps('font-mono text-sm')}
                />
              </div>
            ) : null}

            <div className="lg:col-span-2">
              <SectionLabel htmlFor="settings-model">Recommended model</SectionLabel>
              <Input
                id="settings-model"
                value={model}
                onChange={(event) => {
                  const nextModel = event.target.value;
                  setModel(nextModel);
                  setRuntimeModelDefault((prev) => ({
                    ...prev,
                    provider: selectedPreset?.defaults.provider ?? 'openai-compat',
                    model: nextModel,
                  }));
                }}
                placeholder="model-name"
                className={surfaceInputProps('font-mono text-sm')}
              />
            </div>
          </div>

          {isThinkingProvider ? (
            <div className="mt-4 rounded-[20px] border border-amber-400/20 bg-amber-400/10 px-4 py-4 text-sm text-amber-100">
              Thinking model — keep max tokens at 1024+ to avoid clipped replies.
            </div>
          ) : null}
        </SurfaceCard>
      </div>
    </div>
  );
}
