import type { ToolApprovalMode, ToolPermissionPolicy } from '@offisim/core/browser';
import {
  Button,
  Input,
  SegmentedControl,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@offisim/ui-core';
import { BookOpen, FileText, GitBranch, Pencil, Search, Terminal } from 'lucide-react';

interface ToolPermissionEditorProps {
  value: ToolPermissionPolicy | null;
  onChange: (value: ToolPermissionPolicy) => void;
}

const DEFAULT_POLICY: ToolPermissionPolicy = {
  defaultMode: 'ask_first_time',
  overrides: [],
};

const MODE_ITEMS: Array<{ value: ToolApprovalMode; label: string }> = [
  { value: 'auto', label: 'Allow' },
  { value: 'ask_first_time', label: 'Ask' },
  { value: 'deny', label: 'Deny' },
];

const ADVANCED_MODE_ITEMS: Array<{ value: ToolApprovalMode; label: string }> = [
  ...MODE_ITEMS,
  { value: 'always_ask', label: 'Always Ask' },
];

const CORE_TOOL_ROWS: ReadonlyArray<{
  label: string;
  pattern: string;
  hint: string;
  Icon: typeof FileText;
}> = [
  {
    label: 'Read files',
    pattern: 'read_file',
    hint: 'Workspace file read access.',
    Icon: FileText,
  },
  { label: 'Write files', pattern: 'write_file', hint: 'Workspace file mutations.', Icon: Pencil },
  { label: 'Shell', pattern: 'bash', hint: 'Local command execution.', Icon: Terminal },
  {
    label: 'Web search',
    pattern: 'web_search',
    hint: 'Network research tool access.',
    Icon: Search,
  },
  {
    label: 'Memory recall',
    pattern: 'recall',
    hint: 'Long-term context retrieval.',
    Icon: BookOpen,
  },
  {
    label: 'Git',
    pattern: 'git*',
    hint: 'Repository status and source-control actions.',
    Icon: GitBranch,
  },
];

function normalizePolicy(value: ToolPermissionPolicy | null): ToolPermissionPolicy {
  return value ?? DEFAULT_POLICY;
}

function displayMode(mode: ToolApprovalMode): ToolApprovalMode {
  return mode === 'always_ask' ? 'ask_first_time' : mode;
}

function isCorePattern(pattern: string): boolean {
  return CORE_TOOL_ROWS.some((row) => row.pattern === pattern);
}

export function ToolPermissionEditor({ value, onChange }: ToolPermissionEditorProps) {
  const policy = normalizePolicy(value);
  const defaultModeId = 'tool-permission-default-mode';

  const updateDefaultMode = (defaultMode: ToolApprovalMode) => {
    onChange({ ...policy, defaultMode });
  };

  const setCoreToolMode = (pattern: string, mode: ToolApprovalMode) => {
    const nextOverrides = policy.overrides.filter((override) => override.pattern !== pattern);
    if (mode !== policy.defaultMode) {
      nextOverrides.push({ pattern, mode });
    }
    onChange({ ...policy, overrides: nextOverrides });
  };

  const updateOverride = (
    index: number,
    patch: Partial<{ pattern: string; mode: ToolApprovalMode }>,
  ) => {
    onChange({
      ...policy,
      overrides: policy.overrides.map((override, overrideIndex) =>
        overrideIndex === index ? { ...override, ...patch } : override,
      ),
    });
  };

  const addOverride = () => {
    onChange({
      ...policy,
      overrides: [...policy.overrides, { pattern: '', mode: 'ask_first_time' }],
    });
  };

  const removeOverride = (index: number) => {
    onChange({
      ...policy,
      overrides: policy.overrides.filter((_, overrideIndex) => overrideIndex !== index),
    });
  };

  const advancedOverrides = policy.overrides.filter((override) => !isCorePattern(override.pattern));

  return (
    <div className="tool-permission-editor">
      <div className="tool-permission-default">
        <span id={defaultModeId}>Default mode</span>
        <SegmentedControl
          size="sm"
          ariaLabel="Default tool approval mode"
          value={displayMode(policy.defaultMode)}
          onChange={(mode) => updateDefaultMode(mode as ToolApprovalMode)}
          items={MODE_ITEMS}
        />
      </div>

      <div className="tool-permission-core-list">
        {CORE_TOOL_ROWS.map((row) => {
          const override = policy.overrides.find((item) => item.pattern === row.pattern);
          const mode = override?.mode ?? policy.defaultMode;
          const Icon = row.Icon;
          return (
            <div key={row.pattern} className="tool-permission-row">
              <Icon data-icon="tool-kind" aria-hidden="true" />
              <div>
                <p data-slot="label">{row.label}</p>
                <p data-slot="hint">{row.hint}</p>
              </div>
              <SegmentedControl
                size="sm"
                ariaLabel={`${row.label} permission`}
                value={displayMode(mode)}
                onChange={(nextMode) => setCoreToolMode(row.pattern, nextMode as ToolApprovalMode)}
                items={MODE_ITEMS}
              />
            </div>
          );
        })}
      </div>

      <details className="tool-permission-advanced">
        <summary>Advanced patterns</summary>
        <div>
          <div className="tool-permission-advanced-head">
            <p>Glob overrides for non-standard tools.</p>
            <Button
              type="button"
              onClick={addOverride}
              variant="outline"
              size="sm"
              className="tool-permission-add-button"
            >
              Add pattern
            </Button>
          </div>

          {advancedOverrides.length === 0 && (
            <p className="tool-permission-empty">No advanced overrides.</p>
          )}

          {policy.overrides.map((override, index) =>
            isCorePattern(override.pattern) ? null : (
              <div key={`${override.pattern}-${index}`} className="tool-permission-override-row">
                <Input
                  value={override.pattern}
                  onChange={(event) => updateOverride(index, { pattern: event.target.value })}
                  placeholder="calendar.*"
                  className="tool-permission-pattern-input"
                />
                <Select
                  value={override.mode}
                  onValueChange={(mode) =>
                    updateOverride(index, { mode: mode as ToolApprovalMode })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {ADVANCED_MODE_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  onClick={() => removeOverride(index)}
                  variant="outline"
                  size="sm"
                  className="tool-permission-remove-button"
                >
                  Remove
                </Button>
              </div>
            ),
          )}
        </div>
      </details>
    </div>
  );
}
