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
    description: 'Use the company capability profile.',
  },
  {
    id: 'provider',
    label: 'Offisim gateway tools',
    description: 'Default harness with Offisim file, shell, MCP, and evidence paths.',
  },
  {
    id: 'claude-engine',
    label: 'Claude text engine',
    description: 'Preview text/reasoning only; no Offisim local tools.',
    engineId: 'claude-engine',
  },
  {
    id: 'codex-engine',
    label: 'Codex text engine',
    description: 'Preview text/reasoning only; no Offisim local tools.',
    engineId: 'codex-engine',
  },
];

const ENGINE_LABEL: Record<EngineId, string> = {
  'claude-engine': 'Claude text engine',
  'codex-engine': 'Codex text engine',
};

const SOURCE_SUFFIX: Record<RuntimeBindingResolvedSource, string> = {
  override: 'override',
  'company-default': 'from company default',
  baseline: 'baseline',
};

const ENGINE_UNAVAILABLE_HINT = 'Requires trusted desktop runtime';

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
      <legend className="sr-only">Employee runtime capability</legend>
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
                className={`flex h-auto min-h-[92px] w-auto flex-col items-start gap-1 rounded-lg border px-3 py-3 text-left transition ${
                  isSelected
                    ? 'border-border-focus bg-accent-muted text-accent-text'
                    : 'border-border-default bg-surface text-text-primary hover:border-border-strong hover:bg-surface-hover'
                } ${
                  engineUnavailable
                    ? 'cursor-not-allowed opacity-55 hover:border-border-default hover:bg-surface'
                    : 'cursor-pointer'
                }`}
              >
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-[11px] leading-snug text-text-secondary">
                  {option.description}
                </span>
                {engineUnavailable && (
                  <span className="mt-1 text-[10px] uppercase tracking-wider text-warning">
                    {ENGINE_UNAVAILABLE_HINT}
                  </span>
                )}
              </div>
            </RadioGroupItem>
          );
        })}
      </RadioGroup>

      {scope === 'employee' && resolvedBinding && (
        <p className="text-xs text-text-secondary">
          Resolved:{' '}
          <span className="font-medium text-text-primary">
            {resolvedBindingLabel(resolvedBinding, resolvedSource)}
          </span>
        </p>
      )}

      {showPreviewDisclosure && (
        <p className="rounded-lg border border-warning/30 bg-warning-muted px-3 py-2 text-[11px] leading-snug text-warning">
          Preview · limited tool telemetry. Engine sidecars stream text and reasoning today; tool
          execution stays on the Offisim gateway path until a verified gateway-capable profile
          exists.
        </p>
      )}
    </fieldset>
  );
}
