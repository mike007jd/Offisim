import { listMainHarnessRuntimeStatus } from '@offisim/core/browser';
import type { RuntimeExecutionMode } from '@offisim/shared-types';
import {
  Input,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@offisim/ui-core';
import { RuntimeBindingControl } from '../runtime/RuntimeBindingControl.js';
import { SceneDiagnosticsSection } from './SceneDiagnosticsSection';
import type { useSettingsWorkspaceController } from './SettingsWorkspaceSurface';
import { VaultDirectorySection } from './VaultDirectorySection';
import { SectionLabel, SettingsSection, surfaceInputProps } from './settings-primitives';

interface SettingsRuntimeTabProps {
  controller: ReturnType<typeof useSettingsWorkspaceController>;
}

const DENSITY_ITEMS = [
  { value: 'compact', label: 'Compact' },
  { value: 'normal', label: 'Normal' },
  { value: 'spacious', label: 'Spacious' },
] as const;

const THEME_ITEMS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

function BooleanSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div>
      <SectionLabel htmlFor={id}>{label}</SectionLabel>
      <Select
        value={value ? 'enabled' : 'disabled'}
        onValueChange={(next) => onChange(next === 'enabled')}
      >
        <SelectTrigger id={id} className={surfaceInputProps()}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="enabled">Enabled</SelectItem>
          <SelectItem value="disabled">Disabled</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  id: string;
  label: string;
  value: string | number;
  onChange: (next: string) => void;
  min?: number;
  max?: number;
  step?: string;
}) {
  return (
    <div>
      <SectionLabel htmlFor={id}>{label}</SectionLabel>
      <Input
        id={id}
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        min={min}
        max={max}
        step={step}
        className={surfaceInputProps()}
      />
    </div>
  );
}

export function SettingsRuntimeTab({ controller }: SettingsRuntimeTabProps) {
  const {
    density,
    employeeRuntimeDefault,
    executionMode,
    gitAutoCommit,
    memoryConfidenceThreshold,
    memoryEnabled,
    memoryInjectionEnabled,
    memoryMaxFacts,
    mainHarnessPolicy,
    resolvedTheme,
    setDensity,
    setEmployeeRuntimeDefault,
    setExecutionMode,
    setGitAutoCommit,
    setMemoryConfidenceThreshold,
    setMemoryEnabled,
    setMemoryInjectionEnabled,
    setMemoryMaxFacts,
    setSummarizationEnabled,
    setSummarizationKeepRecentMessages,
    setSummarizationTriggerTokens,
    setTheme,
    setToolSearchEnabled,
    summarizationEnabled,
    summarizationKeepRecentMessages,
    summarizationTriggerTokens,
    toolSearchEnabled,
    theme,
  } = controller;
  const mainHarnessStatuses = listMainHarnessRuntimeStatus(mainHarnessPolicy);

  return (
    <div className="space-y-4">
      <SettingsSection title="Runtime defaults">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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

          <BooleanSelect
            id="settings-tool-search"
            label="Tool search"
            value={toolSearchEnabled}
            onChange={setToolSearchEnabled}
          />

          <BooleanSelect
            id="settings-git-auto-commit"
            label="Git auto-commit"
            value={gitAutoCommit}
            onChange={setGitAutoCommit}
          />

          <div className="md:col-span-2 xl:col-span-3">
            <SectionLabel htmlFor="settings-theme-group">Theme</SectionLabel>
            <SegmentedControl
              value={theme}
              onChange={(next) => setTheme(next as typeof theme)}
              items={[...THEME_ITEMS]}
              ariaLabel="Theme"
            />
            {theme === 'system' ? (
              <p className="mt-2 text-xs text-text-muted">
                Following OS preference: {resolvedTheme === 'dark' ? 'Dark' : 'Light'}
              </p>
            ) : null}
          </div>

          <div className="md:col-span-2 xl:col-span-3">
            <SectionLabel htmlFor="settings-density-group">Display density</SectionLabel>
            <SegmentedControl
              value={density}
              onChange={(next) => setDensity(next as typeof density)}
              items={[...DENSITY_ITEMS]}
              ariaLabel="Display density"
            />
          </div>

          <div className="md:col-span-2 xl:col-span-2">
            <SectionLabel htmlFor="settings-employee-runtime-default">
              Default employee runtime
            </SectionLabel>
            <RuntimeBindingControl
              scope="company"
              value={employeeRuntimeDefault ?? null}
              onChange={(next) => setEmployeeRuntimeDefault(next ?? undefined)}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Main harness control">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-md border border-border-default bg-surface px-3 py-3">
            <div className="text-xs font-medium text-text-secondary">Default owner</div>
            <div className="mt-1 text-sm font-semibold text-text-primary">Offisim core</div>
          </div>
          <div className="rounded-md border border-border-default bg-surface px-3 py-3">
            <div className="text-xs font-medium text-text-secondary">Driver profiles</div>
            <div className="mt-1 text-sm font-semibold text-text-primary">
              {mainHarnessStatuses.filter((status) => status.mode === 'driver' && status.selectable)
                .length || 'None verified'}
            </div>
          </div>
          <div className="rounded-md border border-warning/30 bg-warning-muted px-3 py-3">
            <div className="text-xs font-medium text-warning">Replacement mode</div>
            <div className="mt-1 text-sm font-semibold text-warning">
              Unavailable until release evidence
            </div>
          </div>
        </div>
        {mainHarnessStatuses.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {mainHarnessStatuses.map((status) => (
              <div
                key={`${status.mode}:${status.runtimeProfileId}`}
                className="flex items-center justify-between rounded-md border border-border-default px-3 py-2 text-xs"
              >
                <span className="font-medium text-text-primary">{status.runtimeProfileId}</span>
                <span className={status.selectable ? 'text-success' : 'text-warning'}>
                  {status.selectable ? 'Verified' : status.reason}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Conversation memory & summarization">
        <div className="space-y-5">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              Memory
            </h4>
            <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <BooleanSelect
                id="runtime-memory-enabled"
                label="Enabled"
                value={memoryEnabled}
                onChange={setMemoryEnabled}
              />
              <BooleanSelect
                id="runtime-memory-injection-enabled"
                label="Prompt injection"
                value={memoryInjectionEnabled}
                onChange={setMemoryInjectionEnabled}
              />
              <NumberField
                id="runtime-memory-max-facts"
                label="Max facts"
                value={memoryMaxFacts}
                onChange={setMemoryMaxFacts}
                min={1}
              />
              <NumberField
                id="runtime-memory-confidence-threshold"
                label="Confidence threshold"
                value={memoryConfidenceThreshold}
                onChange={setMemoryConfidenceThreshold}
                min={0}
                max={1}
                step="0.1"
              />
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
              Summarization
            </h4>
            <p className="mt-1 text-xs text-text-muted">Auto-compress long conversations.</p>
            <div className="mt-3 grid gap-4 md:grid-cols-3">
              <BooleanSelect
                id="runtime-summarization-enabled"
                label="Enabled"
                value={summarizationEnabled}
                onChange={setSummarizationEnabled}
              />
              <NumberField
                id="runtime-summarization-trigger-tokens"
                label="Trigger tokens"
                value={summarizationTriggerTokens}
                onChange={setSummarizationTriggerTokens}
                min={1}
              />
              <NumberField
                id="runtime-summarization-keep-recent"
                label="Keep recent"
                value={summarizationKeepRecentMessages}
                onChange={setSummarizationKeepRecentMessages}
                min={0}
              />
            </div>
          </div>
        </div>
      </SettingsSection>

      <VaultDirectorySection notify={controller.notify} />

      <SceneDiagnosticsSection notify={controller.notify} />
    </div>
  );
}
