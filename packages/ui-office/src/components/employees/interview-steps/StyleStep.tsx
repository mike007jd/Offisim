import { Button, Textarea, cn } from '@offisim/ui-core';
import type { EmployeeFormData } from '../../../hooks/useEmployeeEditor';

const STYLE_PRESETS = [
  { label: 'Detail-oriented', description: 'Thorough, careful, precise' },
  { label: 'Fast & iterative', description: 'Quick prototypes, rapid feedback loops' },
  { label: 'Collaborative', description: 'Team-first, communicative, consensus-driven' },
  { label: 'Independent', description: 'Self-directed, autonomous, minimal oversight' },
  { label: 'Creative', description: 'Innovative, experimental, outside-the-box' },
  { label: 'Systematic', description: 'Process-driven, structured, methodical' },
] as const;

interface StyleStepProps {
  formData: EmployeeFormData;
  updateField: <K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) => void;
}

export function StyleStep({ formData, updateField }: StyleStepProps) {
  const togglePreset = (label: string) => {
    const current = formData.style.trim();
    const parts = current
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const idx = parts.findIndex((p) => p.toLowerCase() === label.toLowerCase());
    if (idx >= 0) {
      parts.splice(idx, 1);
    } else {
      parts.push(label);
    }
    updateField('style', parts.join(', '));
  };

  const isPresetActive = (label: string) => {
    const parts = formData.style.split(',').map((s) => s.trim().toLowerCase());
    return parts.includes(label.toLowerCase());
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        {STYLE_PRESETS.map((preset) => {
          const active = isPresetActive(preset.label);
          return (
            <Button
              key={preset.label}
              type="button"
              variant="ghost"
              onClick={() => togglePreset(preset.label)}
              className={cn(
                'h-auto flex-col items-start border-2 p-3 text-left',
                active
                  ? 'border-border-focus bg-accent-muted'
                  : 'border-border-default bg-surface-muted hover:border-border-focus',
              )}
            >
              <span
                className={cn(
                  'text-sm font-semibold',
                  active ? 'text-accent-text' : 'text-text-primary',
                )}
              >
                {preset.label}
              </span>
              <span className="text-xs text-text-muted">{preset.description}</span>
            </Button>
          );
        })}
      </div>

      <div>
        <label htmlFor="style-custom" className="mb-1 block text-xs text-text-secondary">
          Or describe a custom working style:
        </label>
        <Textarea
          id="style-custom"
          value={formData.style}
          onChange={(e) => updateField('style', e.target.value)}
          placeholder="e.g. Methodical but flexible, prefers written communication..."
          rows={3}
        />
      </div>
    </div>
  );
}
