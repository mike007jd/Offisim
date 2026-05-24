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
import {
  SettingsControlGrid,
  SettingsField,
  SettingsSection,
  SettingsStatCard,
  surfaceInputProps,
} from './settings-primitives';

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

const SUBSECTION_HEADING_CLASS = 'text-fs-micro font-bold uppercase tracking-ls-caps text-ink-3';

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
    <SettingsField id={id} label={label}>
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
    </SettingsField>
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
    <SettingsField id={id} label={label}>
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
    </SettingsField>
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
    <div className="settings-panel-stack">
      <SettingsSection title="Runtime defaults">
        <SettingsControlGrid columns={3}>
          <SettingsField id="settings-execution-mode" label="Execution mode">
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
              </SelectContent>
            </Select>
          </SettingsField>

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

          <SettingsField
            id="settings-theme-group"
            label="Theme"
            className="md:col-span-2 xl:col-span-3"
          >
            <SegmentedControl
              value={theme}
              onChange={(next) => setTheme(next as typeof theme)}
              items={[...THEME_ITEMS]}
              ariaLabel="Theme"
            />
            {theme === 'system' ? (
              <p className="settings-field-note">
                Following OS preference: {resolvedTheme === 'dark' ? 'Dark' : 'Light'}
              </p>
            ) : null}
          </SettingsField>

          <SettingsField
            id="settings-density-group"
            label="Display density"
            className="md:col-span-2 xl:col-span-3"
          >
            <SegmentedControl
              value={density}
              onChange={(next) => setDensity(next as typeof density)}
              items={[...DENSITY_ITEMS]}
              ariaLabel="Display density"
            />
          </SettingsField>

          <SettingsField
            id="settings-employee-runtime-default"
            label="Default employee runtime"
            className="md:col-span-2 xl:col-span-2"
          >
            <RuntimeBindingControl
              scope="company"
              value={employeeRuntimeDefault ?? null}
              onChange={(next) => setEmployeeRuntimeDefault(next ?? undefined)}
            />
          </SettingsField>
        </SettingsControlGrid>
      </SettingsSection>

      <SettingsSection title="Main harness control">
        <SettingsControlGrid columns={3}>
          <SettingsStatCard label="Default owner" value="Offisim core" />
          <SettingsStatCard
            label="Driver profiles"
            value={
              mainHarnessStatuses.filter((status) => status.mode === 'driver' && status.selectable)
                .length || 'None verified'
            }
          />
          <SettingsStatCard
            label="Replacement mode"
            value="Unavailable until release evidence"
            tone="warning"
          />
        </SettingsControlGrid>
        {mainHarnessStatuses.length > 0 ? (
          <div className="settings-runtime-status-list">
            {mainHarnessStatuses.map((status) => (
              <div
                key={`${status.mode}:${status.runtimeProfileId}`}
                className="settings-runtime-status-row"
              >
                <span>{status.runtimeProfileId}</span>
                <span data-state={status.selectable ? 'ok' : 'warn'}>
                  {status.selectable ? 'Verified' : status.reason}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Conversation memory & summarization">
        <div className="settings-runtime-groups">
          <div>
            <h4 className={SUBSECTION_HEADING_CLASS}>Memory</h4>
            <SettingsControlGrid columns={4} className="settings-runtime-control-grid">
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
            </SettingsControlGrid>
          </div>

          <div>
            <h4 className={SUBSECTION_HEADING_CLASS}>Summarization</h4>
            <p className="settings-muted-copy">Auto-compress long conversations.</p>
            <SettingsControlGrid columns={3} className="settings-runtime-control-grid">
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
            </SettingsControlGrid>
          </div>
        </div>
      </SettingsSection>

      <VaultDirectorySection notify={controller.notify} />

      <SceneDiagnosticsSection notify={controller.notify} />
    </div>
  );
}
