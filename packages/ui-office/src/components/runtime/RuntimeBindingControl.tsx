import type { EmployeeRuntimeBinding, EngineId } from '@offisim/shared-types';
import { RadioGroup, RadioGroupItem } from '@offisim/ui-core';
import { useAvailableEngineAdapters } from '../../runtime/offisim-runtime-context.js';

export type RuntimeBindingScope = 'employee' | 'company';

export type RuntimeBindingResolvedSource = 'override' | 'company-default' | 'baseline';

export interface RuntimeBindingControlProps {
  scope: RuntimeBindingScope;
  value: EmployeeRuntimeBinding | null;
  onChange: (next: EmployeeRuntimeBinding | null) => void;
  resolvedBinding?: EmployeeRuntimeBinding;
  resolvedSource?: RuntimeBindingResolvedSource;
  className?: string;
}

type PickerOptionId = 'inherit' | 'provider' | 'claude-engine' | 'codex-engine';

interface PickerOption {
  id: PickerOptionId;
  label: string;
  description: string;
  engineId?: EngineId;
}

const ALL_OPTIONS: ReadonlyArray<PickerOption> = [
  {
    id: 'inherit',
    label: 'Inherit company default',
    description: 'Follow the company-wide runtime default set in Settings.',
  },
  {
    id: 'provider',
    label: 'Provider gateway',
    description: 'Run inside the Offisim LangGraph employee node via the configured provider lane.',
  },
  {
    id: 'claude-engine',
    label: 'Claude engine',
    description: 'Delegate the assigned task to the Claude Agent runtime sidecar.',
    engineId: 'claude-engine',
  },
  {
    id: 'codex-engine',
    label: 'Codex engine',
    description: 'Delegate the assigned task to the Codex Agent runtime sidecar.',
    engineId: 'codex-engine',
  },
];

const ENGINE_LABEL: Record<EngineId, string> = {
  'claude-engine': 'Claude engine',
  'codex-engine': 'Codex engine',
};

const SOURCE_SUFFIX: Record<RuntimeBindingResolvedSource, string> = {
  override: 'override',
  'company-default': 'from company default',
  baseline: 'baseline',
};

const ENGINE_UNAVAILABLE_HINT = 'Available on trusted desktop runtime';

function bindingToOptionId(
  value: EmployeeRuntimeBinding | null,
  scope: RuntimeBindingScope,
): PickerOptionId {
  if (value === null) return scope === 'employee' ? 'inherit' : 'provider';
  if (value.mode === 'provider') return 'provider';
  return value.engineId;
}

function optionIdToBinding(id: PickerOptionId): EmployeeRuntimeBinding | null {
  switch (id) {
    case 'inherit':
      return null;
    case 'provider':
      return { mode: 'provider' };
    case 'claude-engine':
      return { mode: 'engine', engineId: 'claude-engine' };
    case 'codex-engine':
      return { mode: 'engine', engineId: 'codex-engine' };
  }
}

function resolvedBindingLabel(
  binding: EmployeeRuntimeBinding,
  source: RuntimeBindingResolvedSource | undefined,
): string {
  const base = binding.mode === 'provider' ? 'Provider gateway' : ENGINE_LABEL[binding.engineId];
  if (!source) return base;
  return `${base} (${SOURCE_SUFFIX[source]})`;
}

export function RuntimeBindingControl({
  scope,
  value,
  onChange,
  resolvedBinding,
  resolvedSource,
  className = '',
}: RuntimeBindingControlProps) {
  const availableEngineAdapters = useAvailableEngineAdapters();
  const selectedId = bindingToOptionId(value, scope);
  const visibleOptions = ALL_OPTIONS.filter(
    (option) => option.id !== 'inherit' || scope === 'employee',
  );
  const showPreviewDisclosure =
    scope === 'employee' ? resolvedBinding?.mode === 'engine' : value?.mode === 'engine';

  return (
    <fieldset className={`flex flex-col gap-3 border-0 p-0 ${className}`}>
      <legend className="sr-only">Runtime binding</legend>
      <RadioGroup
        value={selectedId}
        onValueChange={(next) => onChange(optionIdToBinding(next as PickerOptionId))}
        className="grid gap-2 md:grid-cols-2"
      >
        {visibleOptions.map((option) => {
          const engineUnavailable =
            option.engineId !== undefined && !availableEngineAdapters.has(option.engineId);
          const isSelected = option.id === selectedId;
          return (
            <RadioGroupItem key={option.id} value={option.id} disabled={engineUnavailable} asChild>
              <div
                className={`flex h-auto w-auto flex-col items-start gap-1 rounded-2xl border px-4 py-3 text-left transition ${
                  isSelected
                    ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-50'
                    : 'border-white/10 bg-white/[0.03] text-slate-200 hover:border-white/20 hover:bg-white/[0.06]'
                } ${
                  engineUnavailable
                    ? 'cursor-not-allowed opacity-50 hover:border-white/10 hover:bg-white/[0.03]'
                    : 'cursor-pointer'
                }`}
              >
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-[11px] leading-snug text-slate-400">
                  {option.description}
                </span>
                {engineUnavailable && (
                  <span className="mt-1 text-[10px] uppercase tracking-wider text-amber-300/80">
                    {ENGINE_UNAVAILABLE_HINT}
                  </span>
                )}
              </div>
            </RadioGroupItem>
          );
        })}
      </RadioGroup>

      {scope === 'employee' && resolvedBinding && (
        <p className="text-xs text-slate-300">
          Resolved:{' '}
          <span className="font-medium text-slate-100">
            {resolvedBindingLabel(resolvedBinding, resolvedSource)}
          </span>
        </p>
      )}

      {showPreviewDisclosure && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-snug text-amber-200/90">
          Preview · limited tool telemetry. Engine sidecars stream text and reasoning today; tool
          execution events and handoff proposals are not yet wired.
        </p>
      )}
    </fieldset>
  );
}
