import type { ToolApprovalMode, ToolPermissionPolicy } from '@offisim/core/browser';
import {
  Button,
  Input,
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

function normalizePolicy(value: ToolPermissionPolicy | null): ToolPermissionPolicy {
  return value ?? DEFAULT_POLICY;
}

export function ToolPermissionEditor({ value, onChange }: ToolPermissionEditorProps) {
  const policy = normalizePolicy(value);
  const defaultModeId = 'tool-permission-default-mode';

  const updateDefaultMode = (defaultMode: ToolApprovalMode) => {
    onChange({ ...policy, defaultMode });
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

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-default bg-surface-muted p-3">
      <div>
        <span id={defaultModeId} className="mb-1 block text-xs text-text-muted">
          Default approval mode
        </span>
        <Select
          value={policy.defaultMode}
          onValueChange={(mode) => updateDefaultMode(mode as ToolApprovalMode)}
        >
          <SelectTrigger aria-labelledby={defaultModeId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="ask_first_time">Ask First Time</SelectItem>
              <SelectItem value="always_ask">Always Ask</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-muted">Tool-specific overrides</p>
          <Button
            type="button"
            onClick={addOverride}
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs text-text-secondary"
          >
            Add override
          </Button>
        </div>

        {policy.overrides.length === 0 && (
          <p className="text-xs text-text-muted">No tool overrides configured.</p>
        )}

        {policy.overrides.map((override, index) => (
          <div key={`${override.pattern}-${index}`} className="grid grid-tool-overrides gap-2">
            <Input
              value={override.pattern}
              onChange={(event) => updateOverride(index, { pattern: event.target.value })}
              placeholder="calendar.*"
              className="border-border-default bg-surface text-sm text-text-primary"
            />
            <Select
              value={override.mode}
              onValueChange={(mode) => updateOverride(index, { mode: mode as ToolApprovalMode })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="ask_first_time">Ask First Time</SelectItem>
                  <SelectItem value="always_ask">Always Ask</SelectItem>
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
        ))}
      </div>
    </div>
  );
}
