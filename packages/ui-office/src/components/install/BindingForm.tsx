import { Badge, Button, Input } from '@offisim/ui-core';
/**
 * BindingForm — lets users configure model_profile bindings before install.
 * MVP: model_profile type only. Future: mcp_endpoint, secret_slot.
 */

import type { BindingRequirement } from '@offisim/install-core';

interface BindingFormProps {
  bindings: readonly BindingRequirement[];
  bindingValues: Map<string, string>;
  onSetValue: (key: string, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/** Common model suggestions for quick selection */
const MODEL_SUGGESTIONS = [
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'anthropic/claude-sonnet-4',
  'google/gemini-2.5-flash',
];

export function BindingForm({
  bindings,
  bindingValues,
  onSetValue,
  onSubmit,
  onCancel,
}: BindingFormProps) {
  // Only show model_profile bindings for now
  const modelBindings = bindings.filter((b) => b.bindingType === 'model_profile');

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-ink-1">Configure Model Bindings</h3>
        <p className="text-sm text-ink-2 mt-1">
          Choose which models to use for each role. Optional bindings can be skipped.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {modelBindings.map((binding) => {
          const value = bindingValues.get(binding.bindingKey) ?? '';
          const isSkipped = value === '__skip__';

          return (
            <div key={binding.bindingKey} className="border-2 border-line p-3 flex flex-col gap-2">
              {/* Binding header */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-ink-1 truncate">
                    {binding.bindingKey.split(':').pop()}
                  </span>
                  {!binding.required && <Badge variant="secondary">optional</Badge>}
                </div>
                {!binding.required && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-xs"
                    onClick={() => onSetValue(binding.bindingKey, isSkipped ? '' : '__skip__')}
                  >
                    {isSkipped ? 'Configure' : 'Skip'}
                  </Button>
                )}
              </div>

              {/* Hint */}
              {binding.hint && <p className="text-xs text-ink-3">Purpose: {binding.hint}</p>}

              {/* Input area */}
              {!isSkipped && (
                <div className="flex flex-col gap-2">
                  <Input
                    placeholder="provider/model (e.g. openai/gpt-4o)"
                    value={value}
                    error={binding.required && !value.trim()}
                    helperText={binding.required && !value.trim() ? 'Required' : undefined}
                    onChange={(e) => onSetValue(binding.bindingKey, e.target.value)}
                  />
                  {/* Quick suggestions */}
                  <div className="flex flex-wrap gap-1">
                    {MODEL_SUGGESTIONS.map((model) => (
                      <Button
                        key={model}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-2 border-line px-2 py-0.5 text-xs text-ink-2 hover:bg-surface-sunken hover:text-ink-1 transition-colors"
                        onClick={() => onSetValue(binding.bindingKey, model)}
                      >
                        {model}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-line">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onSubmit}>Continue</Button>
      </div>
    </div>
  );
}
