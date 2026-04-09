import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@offisim/ui-core';
import { isTauri } from '../../lib/env';
import type { useSettingsWorkspaceController } from './SettingsWorkspaceSurface';
import { getAvailableProviderPresets } from './provider-presets';
import { SectionLabel, SurfaceCard, surfaceInputProps } from './settings-primitives';

const IS_DESKTOP = isTauri();
const AVAILABLE_PRESETS = getAvailableProviderPresets({ tauri: IS_DESKTOP });

interface SettingsProviderTabProps {
  controller: ReturnType<typeof useSettingsWorkspaceController>;
}

export function SettingsProviderTab({ controller }: SettingsProviderTabProps) {
  const {
    acpCommand,
    apiKey,
    baseURL,
    handlePresetChange,
    handleSave,
    hasStoredSecret,
    isSaveDisabled,
    isSaving,
    isSubscription,
    isThinkingProvider,
    model,
    preset,
    saveError,
    selectedCapabilities,
    selectedCompatibility,
    selectedPreset,
    selectedRegion,
    selectedSurface,
    setAcpCommand,
    setApiKey,
    setBaseURL,
    setModel,
    setRuntimeModelDefault,
    showBaseURL,
  } = controller;

  return (
    <div className="space-y-4">
      {/* Provider */}
      <SurfaceCard title="Provider">
        <div className="space-y-4">
          <div>
            <SectionLabel htmlFor="settings-provider">Vendor preset</SectionLabel>
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            <span>{selectedPreset?.label ?? 'Custom provider'}</span>
            <span className="text-white/10">|</span>
            <span>{selectedCompatibility}</span>
            <span className="text-white/10">|</span>
            <span>{selectedSurface}</span>
            <span className="text-white/10">|</span>
            <span>{selectedRegion}</span>
            <span className="text-white/10">|</span>
            <span>{selectedCapabilities}</span>
          </div>
        </div>
      </SurfaceCard>

      {/* Authentication */}
      {isSubscription ? (
        <SurfaceCard title="Subscription">
          <div>
            <SectionLabel htmlFor="settings-acp-command">ACP command</SectionLabel>
            <Input
              id="settings-acp-command"
              value={acpCommand}
              onChange={(event) => setAcpCommand(event.target.value)}
              placeholder="claude"
              className={surfaceInputProps('font-mono')}
            />
          </div>
        </SurfaceCard>
      ) : (
        <SurfaceCard title="Authentication">
          <div>
            <SectionLabel htmlFor="settings-api-key">API key</SectionLabel>
            <Input
              id="settings-api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={hasStoredSecret ? 'Stored securely on this device' : 'sk-ant-...'}
              className={surfaceInputProps()}
            />
            {IS_DESKTOP && hasStoredSecret ? (
              <p className="mt-2 text-xs text-slate-500">
                Leave empty to keep the existing credential.
              </p>
            ) : null}
          </div>
        </SurfaceCard>
      )}

      {/* Model */}
      {!isSubscription ? (
        <SurfaceCard title="Model">
          <div>
            <SectionLabel htmlFor="settings-model">Model identifier</SectionLabel>
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
        </SurfaceCard>
      ) : null}

      {/* Endpoint */}
      {showBaseURL ? (
        <SurfaceCard title="Endpoint">
          <div>
            <SectionLabel htmlFor="settings-base-url">Base URL</SectionLabel>
            <Input
              id="settings-base-url"
              value={baseURL}
              onChange={(event) => setBaseURL(event.target.value)}
              placeholder="https://api.example.com/v1"
              className={surfaceInputProps('font-mono text-sm')}
            />
          </div>
        </SurfaceCard>
      ) : null}

      {/* Thinking warning */}
      {isThinkingProvider ? (
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-xs text-amber-200/80">
          Thinking-capable provider — keep employee max tokens at 1024+ to avoid clipped replies.
        </div>
      ) : null}

      {/* Save */}
      {saveError ? <p className="text-sm text-red-400">{saveError}</p> : null}

      <div className="flex justify-end pt-1">
        <Button
          variant="secondary"
          onClick={() => void handleSave()}
          disabled={isSaveDisabled}
          className="h-11 rounded-2xl border-emerald-400/40 bg-emerald-500/15 px-5 text-emerald-50 hover:border-emerald-300 hover:bg-emerald-500/25"
        >
          {isSaving ? 'Saving…' : 'Save provider'}
        </Button>
      </div>
    </div>
  );
}
