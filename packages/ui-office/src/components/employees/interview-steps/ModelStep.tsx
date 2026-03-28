import { Button, Input } from '@offisim/ui-core';
import type { EmployeeFormData } from '../../../hooks/useEmployeeEditor';

interface ModelStepProps {
  formData: EmployeeFormData;
  updateField: <K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) => void;
}

export function ModelStep({ formData, updateField }: ModelStepProps) {
  const useDefaults = () => {
    updateField('modelPreference', '');
    updateField('temperature', 0.7);
    updateField('maxTokens', 4096);
  };

  return (
    <div className="flex flex-col gap-4">
      <Button type="button" variant="secondary" onClick={useDefaults} className="self-start">
        Use Defaults
      </Button>

      <div>
        <label htmlFor="wizard-model" className="text-xs text-shell mb-1 block">
          Model Preference
        </label>
        <Input
          id="wizard-model"
          value={formData.modelPreference}
          onChange={(e) => updateField('modelPreference', e.target.value)}
          placeholder="e.g. gpt-4o, claude-3-opus (leave empty for default)"
        />
      </div>

      <div>
        <label htmlFor="wizard-temp" className="text-xs text-shell mb-1 block">
          Temperature: {formData.temperature.toFixed(1)}
        </label>
        <input
          id="wizard-temp"
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={formData.temperature}
          onChange={(e) => updateField('temperature', Number.parseFloat(e.target.value))}
          className="w-full accent-lobster-red"
        />
        <div className="flex justify-between text-xs text-shell mt-1">
          <span>Precise (0)</span>
          <span>Creative (2)</span>
        </div>
      </div>

      <div>
        <label htmlFor="wizard-tokens" className="text-xs text-shell mb-1 block">
          Max Tokens
        </label>
        <Input
          id="wizard-tokens"
          type="number"
          min={256}
          max={100000}
          step={256}
          value={formData.maxTokens}
          onChange={(e) => updateField('maxTokens', Number.parseInt(e.target.value, 10) || 4096)}
        />
        {formData.maxTokens < 1024 && (
          <p className="mt-1 text-[10px] text-amber-400">
            部分模型（如 MiniMax）的 thinking 会消耗 token 预算，建议 ≥ 1024
          </p>
        )}
      </div>
    </div>
  );
}
