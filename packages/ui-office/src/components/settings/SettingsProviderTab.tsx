import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@offisim/ui-core';
import { Bot, ShieldCheck, Sparkles } from 'lucide-react';
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
    <div className="grid min-h-0 gap-6 xl:grid-cols-[340px,minmax(0,1fr)]">
      <div className="space-y-4">
        <SurfaceCard
          title="Official compatibility"
          description="Pick the vendor preset first. Transport, headers, endpoint, and capability hints are derived from the provider's own documentation, not Anthropic or OpenAI marketing copy."
          icon={<ShieldCheck className="h-5 w-5" />}
        >
          <div className="rounded-[20px] border border-cyan-400/15 bg-cyan-400/10 px-4 py-4">
            <p className="text-sm font-semibold text-white">
              {selectedPreset?.label ?? 'Custom provider'}
            </p>
            <p className="mt-2 text-sm text-slate-300">
              {selectedCompatibility} • {selectedSurface} • {selectedRegion}
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-400">{selectedCapabilities}</p>
          </div>
        </SurfaceCard>

        <SurfaceCard
          title="Preset notes"
          description="Anthropic-compatible surfaces are preferred whenever the provider officially supports Claude Code style integration."
          icon={<Sparkles className="h-5 w-5" />}
        >
          <div className="space-y-3 text-sm text-slate-300">
            <p>
              Offisim stores vendor, region, compatibility surface, and capability matrix alongside
              the base transport.
            </p>
            <p>
              Custom mode remains available when you need a non-standard endpoint, but presets
              should be the default path.
            </p>
          </div>
        </SurfaceCard>
      </div>

      <div className="space-y-4">
        <SurfaceCard
          title="Models & Access"
          description="Configure the active provider surface, credentials, endpoint, and model profile."
          icon={<Bot className="h-5 w-5" />}
        >
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

            {isSubscription ? (
              <>
                <div className="lg:col-span-2 rounded-[20px] border border-blue-400/15 bg-blue-400/10 px-4 py-4">
                  <p className="text-sm font-semibold text-blue-100">Subscription runtime</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Use your local AI subscription runtime without storing an API key. This path is
                    desktop-only and keeps the ACP command explicit.
                  </p>
                </div>
                <div className="lg:col-span-2">
                  <SectionLabel htmlFor="settings-acp-command">ACP command</SectionLabel>
                  <Input
                    id="settings-acp-command"
                    value={acpCommand}
                    onChange={(event) => setAcpCommand(event.target.value)}
                    placeholder="claude"
                    className={surfaceInputProps('font-mono')}
                  />
                </div>
              </>
            ) : (
              <div className="lg:col-span-2">
                <SectionLabel htmlFor="settings-api-key">Secure API key</SectionLabel>
                <Input
                  id="settings-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={hasStoredSecret ? 'Stored securely on this device' : 'sk-ant-...'}
                  className={surfaceInputProps()}
                />
                {IS_DESKTOP && hasStoredSecret ? (
                  <p className="mt-2 text-xs text-slate-400">
                    Leave this empty to keep the existing secure credential.
                  </p>
                ) : null}
              </div>
            )}

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
                <p className="mt-2 text-xs text-slate-400">
                  Keep this aligned with the provider's official endpoint surface.
                </p>
              </div>
            ) : null}

            {!isSubscription ? (
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
            ) : null}
          </div>

          {isThinkingProvider ? (
            <div className="mt-4 rounded-[20px] border border-amber-400/20 bg-amber-400/10 px-4 py-4 text-sm leading-6 text-amber-100">
              Thinking-capable providers burn part of the token budget on reasoning. Keep employee
              max tokens at 1024 or higher to avoid clipped replies.
            </div>
          ) : null}

          {saveError ? <p className="mt-4 text-sm text-red-400">{saveError}</p> : null}

          <div className="mt-5 flex justify-end">
            <Button
              variant="secondary"
              onClick={() => void handleSave()}
              disabled={isSaveDisabled}
              className="h-11 rounded-2xl border-emerald-400/40 bg-emerald-500/15 px-5 text-emerald-50 hover:border-emerald-300 hover:bg-emerald-500/25"
            >
              {isSaving ? 'Saving…' : 'Save provider workspace'}
            </Button>
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
