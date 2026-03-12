import type { EmployeeFormData } from '../../../hooks/useEmployeeEditor';
import { Textarea } from '../../ui/textarea';

interface InstructionsStepProps {
  formData: EmployeeFormData;
  updateField: <K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) => void;
}

export function InstructionsStep({ formData, updateField }: InstructionsStepProps) {
  return (
    <div className="flex flex-col gap-4">
      <Textarea
        value={formData.customInstructions}
        onChange={(e) => updateField('customInstructions', e.target.value)}
        placeholder={
          'Examples:\n' +
          '- Always write unit tests for new code\n' +
          '- Prefer functional programming patterns\n' +
          '- Keep responses concise and actionable\n' +
          '- Communicate in Chinese when interacting with the team'
        }
        rows={6}
      />
      <p className="text-xs text-shell">
        This is optional. Custom instructions shape how this employee behaves during tasks and conversations.
        You can always edit these later.
      </p>
    </div>
  );
}
