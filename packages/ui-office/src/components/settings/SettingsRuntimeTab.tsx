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
    setToolSearchEnabled,
    summarizationEnabled,
    summarizationKeepRecentMessages,
    summarizationTriggerTokens,
    toolSearchEnabled,
  } = controller;

  return (
    <div className="space-y-6">
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

      <SettingsSection title="Conversation memory & summarization">
        <div className="space-y-5">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
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
            <h4 className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
              Summarization
            </h4>
            <p className="mt-1 text-xs text-slate-500">Auto-compress long conversations.</p>
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
    </div>
  );
}
