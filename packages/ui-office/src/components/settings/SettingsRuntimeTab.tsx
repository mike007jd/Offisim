import type { RuntimeExecutionMode } from '@offisim/shared-types';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@offisim/ui-core';
import type { useSettingsWorkspaceController } from './SettingsWorkspaceSurface';
import { SectionLabel, SurfaceCard, surfaceInputProps } from './settings-primitives';

interface SettingsRuntimeTabProps {
  controller: ReturnType<typeof useSettingsWorkspaceController>;
}

export function SettingsRuntimeTab({ controller }: SettingsRuntimeTabProps) {
  const {
    density,
    executionMode,
    gitAutoCommit,
    handleSave,
    isSaveDisabled,
    isSaving,
    isSubscription,
    memoryConfidenceThreshold,
    memoryEnabled,
    memoryInjectionEnabled,
    memoryMaxFacts,
    model,
    preset,
    saveError,
    selectedPreset,
    setDensity,
    setExecutionMode,
    setGitAutoCommit,
    setMemoryConfidenceThreshold,
    setMemoryEnabled,
    setMemoryInjectionEnabled,
    setMemoryMaxFacts,
    setSummarizationEnabled,
    setSummarizationKeepRecentMessages,
    setSummarizationTriggerTokens,
    setToolSearchEnabled,
    summarizationEnabled,
    summarizationKeepRecentMessages,
    summarizationTriggerTokens,
    toolSearchEnabled,
  } = controller;

  return (
    <div className="space-y-4">
      {/* Bound model (read-only summary) */}
      <SurfaceCard title="Active model">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-mono text-cyan-100">
            {isSubscription ? 'default' : model || 'Unset'}
          </span>
          <span className="text-white/10">|</span>
          <span className="text-slate-400">{selectedPreset?.label ?? preset}</span>
        </div>
      </SurfaceCard>

      {/* Execution */}
      <SurfaceCard title="Execution">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <SectionLabel htmlFor="settings-execution-mode">Execution mode</SectionLabel>
            <Select
              value={executionMode}
              onValueChange={(value) => setExecutionMode(value as RuntimeExecutionMode)}
            >
              <SelectTrigger id="settings-execution-mode" className={surfaceInputProps()}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="desktop-trusted">Desktop trusted</SelectItem>
                <SelectItem value="browser-limited">Browser limited</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <SectionLabel htmlFor="settings-tool-search">Tool search</SectionLabel>
            <Select
              value={toolSearchEnabled ? 'enabled' : 'disabled'}
              onValueChange={(value) => setToolSearchEnabled(value === 'enabled')}
            >
              <SelectTrigger id="settings-tool-search" className={surfaceInputProps()}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">Enabled</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <SectionLabel htmlFor="settings-git-auto-commit">Git auto-commit</SectionLabel>
            <Select
              value={gitAutoCommit ? 'enabled' : 'disabled'}
              onValueChange={(value) => setGitAutoCommit(value === 'enabled')}
            >
              <SelectTrigger id="settings-git-auto-commit" className={surfaceInputProps()}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">Enabled</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </SurfaceCard>

      {/* Display density */}
      <SurfaceCard title="Display density">
        <div
          id="settings-density-group"
          className="grid gap-2 rounded-[20px] border border-white/10 bg-white/[0.04] p-2 md:grid-cols-3"
        >
          {[
            { value: 'compact', label: 'Compact' },
            { value: 'normal', label: 'Normal' },
            { value: 'spacious', label: 'Spacious' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setDensity(option.value as typeof density)}
              className={`rounded-2xl px-4 py-3 text-sm transition ${
                density === option.value
                  ? 'bg-cyan-400/15 text-cyan-100 ring-1 ring-cyan-300/30'
                  : 'bg-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </SurfaceCard>

      {/* Summarization */}
      <SurfaceCard title="Summarization">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <SectionLabel htmlFor="runtime-summarization-enabled">Enabled</SectionLabel>
            <Select
              value={summarizationEnabled ? 'enabled' : 'disabled'}
              onValueChange={(value) => setSummarizationEnabled(value === 'enabled')}
            >
              <SelectTrigger id="runtime-summarization-enabled" className={surfaceInputProps()}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">Enabled</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <SectionLabel htmlFor="runtime-summarization-trigger-tokens">
              Trigger tokens
            </SectionLabel>
            <Input
              id="runtime-summarization-trigger-tokens"
              type="number"
              value={summarizationTriggerTokens}
              onChange={(event) => setSummarizationTriggerTokens(event.target.value)}
              min={1}
              className={surfaceInputProps()}
            />
          </div>
          <div>
            <SectionLabel htmlFor="runtime-summarization-keep-recent">Keep recent</SectionLabel>
            <Input
              id="runtime-summarization-keep-recent"
              type="number"
              value={summarizationKeepRecentMessages}
              onChange={(event) => setSummarizationKeepRecentMessages(event.target.value)}
              min={0}
              className={surfaceInputProps()}
            />
          </div>
        </div>
      </SurfaceCard>

      {/* Memory */}
      <SurfaceCard title="Memory">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <SectionLabel htmlFor="runtime-memory-enabled">Enabled</SectionLabel>
            <Select
              value={memoryEnabled ? 'enabled' : 'disabled'}
              onValueChange={(value) => setMemoryEnabled(value === 'enabled')}
            >
              <SelectTrigger id="runtime-memory-enabled" className={surfaceInputProps()}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">Enabled</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <SectionLabel htmlFor="runtime-memory-injection-enabled">Prompt injection</SectionLabel>
            <Select
              value={memoryInjectionEnabled ? 'enabled' : 'disabled'}
              onValueChange={(value) => setMemoryInjectionEnabled(value === 'enabled')}
            >
              <SelectTrigger id="runtime-memory-injection-enabled" className={surfaceInputProps()}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled">Enabled</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <SectionLabel htmlFor="runtime-memory-max-facts">Max facts</SectionLabel>
            <Input
              id="runtime-memory-max-facts"
              type="number"
              value={memoryMaxFacts}
              onChange={(event) => setMemoryMaxFacts(event.target.value)}
              min={1}
              className={surfaceInputProps()}
            />
          </div>
          <div>
            <SectionLabel htmlFor="runtime-memory-confidence-threshold">
              Confidence threshold
            </SectionLabel>
            <Input
              id="runtime-memory-confidence-threshold"
              type="number"
              value={memoryConfidenceThreshold}
              onChange={(event) => setMemoryConfidenceThreshold(event.target.value)}
              min={0}
              max={1}
              step="0.1"
              className={surfaceInputProps()}
            />
          </div>
        </div>
      </SurfaceCard>

      {/* Save */}
      {saveError ? <p className="text-sm text-red-400">{saveError}</p> : null}

      <div className="flex justify-end pt-1">
        <Button
          variant="secondary"
          onClick={() => void handleSave()}
          disabled={isSaveDisabled}
          className="h-11 rounded-2xl border-emerald-400/40 bg-emerald-500/15 px-5 text-emerald-50 hover:border-emerald-300 hover:bg-emerald-500/25"
        >
          {isSaving ? 'Saving…' : 'Save runtime'}
        </Button>
      </div>
    </div>
  );
}
