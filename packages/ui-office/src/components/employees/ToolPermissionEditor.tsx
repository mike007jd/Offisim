import type { ToolApprovalMode, ToolPermissionPolicy } from '@offisim/core/browser';

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
    <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
      <div>
        <label htmlFor={defaultModeId} className="mb-1 block text-xs text-slate-400">
          Default approval mode
        </label>
        <select
          id={defaultModeId}
          className="w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          value={policy.defaultMode}
          onChange={(event) => updateDefaultMode(event.target.value as ToolApprovalMode)}
        >
          <option value="auto">Auto</option>
          <option value="ask_first_time">Ask First Time</option>
          <option value="always_ask">Always Ask</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">Tool-specific overrides</p>
          <button
            type="button"
            onClick={addOverride}
            className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-200"
          >
            Add override
          </button>
        </div>

        {policy.overrides.length === 0 && (
          <p className="text-xs text-slate-500">No tool overrides configured.</p>
        )}

        {policy.overrides.map((override, index) => (
          <div
            key={`${override.pattern}-${index}`}
            className="grid grid-cols-[1fr_140px_auto] gap-2"
          >
            <input
              value={override.pattern}
              onChange={(event) => updateOverride(index, { pattern: event.target.value })}
              placeholder="calendar.*"
              className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
            <select
              value={override.mode}
              onChange={(event) =>
                updateOverride(index, { mode: event.target.value as ToolApprovalMode })
              }
              className="rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              <option value="auto">Auto</option>
              <option value="ask_first_time">Ask First Time</option>
              <option value="always_ask">Always Ask</option>
            </select>
            <button
              type="button"
              onClick={() => removeOverride(index)}
              className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-200"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
