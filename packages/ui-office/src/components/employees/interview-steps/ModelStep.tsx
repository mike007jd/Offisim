import { Button, Input, SegmentedControl } from '@offisim/ui-core';
import type { EmployeeFormData } from '../../../hooks/useEmployeeEditor';

interface ModelStepProps {
  formData: EmployeeFormData;
  updateField: <K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) => void;
}

export function ModelStep({ formData, updateField }: ModelStepProps) {
  const modelMode = formData.modelPreference.trim() ? 'custom' : 'inherit';
  const useDefaults = () => {
    updateField('modelPreference', '');
    updateField('temperature', 0.7);
    updateField('maxTokens', 4096);
  };

  const setMode = (mode: string) => {
    if (mode === 'inherit') {
      updateField('modelPreference', '');
      return;
    }
    if (!formData.modelPreference.trim()) {
      updateField('modelPreference', 'MiniMax-M2.7');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Button type="button" variant="secondary" onClick={useDefaults} className="self-start">
        跟随统一设置
      </Button>

      <div>
        <p className="mb-2 block text-xs text-text-secondary">Model mode</p>
        <SegmentedControl
          size="sm"
          ariaLabel="Employee model mode"
          value={modelMode}
          onChange={setMode}
          items={[
            { value: 'inherit', label: '跟随统一设置' },
            { value: 'custom', label: '自定义模型' },
          ]}
        />
        <p className="mt-2 text-xs text-text-muted">
          {modelMode === 'inherit'
            ? 'This employee uses the company-wide provider setting.'
            : 'This employee uses the explicit model below.'}
        </p>
      </div>

      {modelMode === 'custom' && (
        <div>
          <label htmlFor="wizard-model" className="mb-1 block text-xs text-text-secondary">
            Override model
          </label>
          <Input
            id="wizard-model"
            list="wizard-model-suggestions"
            value={formData.modelPreference}
            onChange={(e) => updateField('modelPreference', e.target.value)}
            placeholder="MiniMax-M2.7, GLM-5.1, openai/gpt-oss-120b:free"
          />
          <datalist id="wizard-model-suggestions">
            <option value="MiniMax-M2.7" />
            <option value="GLM-5.1" />
            <option value="openai/gpt-oss-120b:free" />
          </datalist>
        </div>
      )}

      <div>
        <label htmlFor="wizard-temp" className="mb-1 block text-xs text-text-secondary">
          Temperature: {formData.temperature.toFixed(1)}
        </label>
        <Input
          id="wizard-temp"
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={formData.temperature}
          onChange={(e) => updateField('temperature', Number.parseFloat(e.target.value))}
          className="h-2 w-full accent-accent"
        />
        <div className="mt-1 flex justify-between text-xs text-text-muted">
          <span>Precise (0)</span>
          <span>Creative (2)</span>
        </div>
      </div>

      <div>
        <label htmlFor="wizard-tokens" className="mb-1 block text-xs text-text-secondary">
          Max Tokens
        </label>
        <Input
          id="wizard-tokens"
          type="number"
          min={256}
          max={100000}
          step={256}
          value={formData.maxTokens}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            updateField('maxTokens', Number.isFinite(n) && n > 0 ? n : 4096);
          }}
        />
        {formData.maxTokens < 1024 && (
          <p className="mt-1 text-caption text-warning">
            Some models (e.g. MiniMax) use tokens for thinking. Recommend max tokens ≥ 1024.
          </p>
        )}
      </div>
    </div>
  );
}
