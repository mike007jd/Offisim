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
    <div className="binding-form">
      <div className="binding-form-head">
        <h3>Configure Model Bindings</h3>
        <p>Choose which models to use for each role. Optional bindings can be skipped.</p>
      </div>

      <div className="binding-form-list">
        {modelBindings.map((binding) => {
          const value = bindingValues.get(binding.bindingKey) ?? '';
          const isSkipped = value === '__skip__';

          return (
            <div key={binding.bindingKey} className="binding-form-row">
              {/* Binding header */}
              <div className="binding-form-row-head">
                <div>
                  <span data-slot="key">{binding.bindingKey.split(':').pop()}</span>
                  {!binding.required && <Badge variant="secondary">optional</Badge>}
                </div>
                {!binding.required && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="binding-form-skip"
                    onClick={() => onSetValue(binding.bindingKey, isSkipped ? '' : '__skip__')}
                  >
                    {isSkipped ? 'Configure' : 'Skip'}
                  </Button>
                )}
              </div>

              {/* Hint */}
              {binding.hint && <p className="binding-form-hint">Purpose: {binding.hint}</p>}

              {/* Input area */}
              {!isSkipped && (
                <div className="binding-form-input-stack">
                  <Input
                    placeholder="provider/model (e.g. openai/gpt-4o)"
                    value={value}
                    error={binding.required && !value.trim()}
                    helperText={binding.required && !value.trim() ? 'Required' : undefined}
                    onChange={(e) => onSetValue(binding.bindingKey, e.target.value)}
                  />
                  {/* Quick suggestions */}
                  <div className="binding-form-suggestions">
                    {MODEL_SUGGESTIONS.map((model) => (
                      <Button
                        key={model}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="binding-form-suggestion"
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
      <div className="binding-form-actions">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onSubmit}>Continue</Button>
      </div>
    </div>
  );
}
