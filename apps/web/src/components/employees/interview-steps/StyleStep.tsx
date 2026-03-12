import type { EmployeeFormData } from '../../../hooks/useEmployeeEditor';
import { cn } from '../../../lib/utils';
import { Textarea } from '../../ui/textarea';

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
            <button
              key={preset.label}
              type="button"
              onClick={() => togglePreset(preset.label)}
              className={cn(
                'flex flex-col items-start p-3 border-2 text-left transition-colors cursor-pointer',
                active
                  ? 'border-lobster-red bg-lobster-red/10'
                  : 'border-ocean-light bg-ocean-mid/50 hover:border-sea-blue',
              )}
            >
              <span className={cn('text-sm font-semibold', active ? 'text-pearl' : 'text-sand')}>
                {preset.label}
              </span>
              <span className="text-xs text-shell">{preset.description}</span>
            </button>
          );
        })}
      </div>

      <div>
        <label htmlFor="style-custom" className="text-xs text-shell mb-1 block">
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
