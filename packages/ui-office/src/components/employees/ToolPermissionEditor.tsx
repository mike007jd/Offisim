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

const CORE_TOOL_ROWS: ReadonlyArray<{ label: string; pattern: string; hint: string }> = [
  { label: 'Read files', pattern: 'read_file', hint: 'Workspace file read access.' },
  { label: 'Write files', pattern: 'write_file', hint: 'Workspace file mutations.' },
  { label: 'Shell', pattern: 'bash', hint: 'Local command execution.' },
  { label: 'Web search', pattern: 'web_search', hint: 'Network research tool access.' },
  { label: 'Memory recall', pattern: 'recall', hint: 'Long-term context retrieval.' },
  { label: 'Git', pattern: 'git*', hint: 'Repository status and source-control actions.' },
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
    <div className="flex flex-col gap-sp-4">
      <div className="rounded-md border border-line-soft bg-surface-sunken p-sp-3">
        <span id={defaultModeId} className="mb-2 block text-fs-meta font-medium text-ink-2">
          Default mode
        </span>
        <SegmentedControl
          size="sm"
          ariaLabel="Default tool approval mode"
          value={displayMode(policy.defaultMode)}
          onChange={(mode) => updateDefaultMode(mode as ToolApprovalMode)}
          items={MODE_ITEMS}
        />
      </div>

      <div className="flex flex-col gap-2">
        {CORE_TOOL_ROWS.map((row) => {
          const override = policy.overrides.find((item) => item.pattern === row.pattern);
          const mode = override?.mode ?? policy.defaultMode;
          return (
            <div
              key={row.pattern}
              className="grid grid-tool-permission-row items-center gap-3 rounded-md border border-line-soft bg-surface-1 px-sp-3 py-sp-2"
            >
              <div className="min-w-0">
                <p className="truncate text-fs-sm font-medium text-ink-1">{row.label}</p>
                <p className="truncate text-caption text-ink-3">{row.hint}</p>
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

      <details className="rounded-md border border-line-soft bg-surface-1 p-sp-3">
        <summary className="cursor-pointer text-fs-meta font-medium text-ink-2">
          Advanced patterns
        </summary>
        <div className="mt-sp-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-caption text-ink-3">Glob overrides for non-standard tools.</p>
            <Button
              type="button"
              onClick={addOverride}
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs text-text-secondary"
            >
              Add pattern
            </Button>
          </div>

          {advancedOverrides.length === 0 && (
            <p className="rounded-md border border-dashed border-line-soft px-sp-3 py-sp-2 text-caption text-ink-3">
              No advanced overrides.
            </p>
          )}

          {policy.overrides.map((override, index) =>
            isCorePattern(override.pattern) ? null : (
              <div key={`${override.pattern}-${index}`} className="grid grid-tool-overrides gap-2">
                <Input
                  value={override.pattern}
                  onChange={(event) => updateOverride(index, { pattern: event.target.value })}
                  placeholder="calendar.*"
                  className="border-border-default bg-surface text-sm text-text-primary"
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
                  className="h-9 px-2 text-xs text-text-secondary"
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
