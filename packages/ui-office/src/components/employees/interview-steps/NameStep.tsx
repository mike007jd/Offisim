import { Button, Input } from '@offisim/ui-core';
import { Dices } from 'lucide-react';
import { useCallback } from 'react';
import type { EmployeeFormData } from '../../../hooks/useEmployeeEditor';

const RANDOM_NAMES = [
  'Alex Chen',
  'Morgan Lee',
  'Sam Rivera',
  'Jordan Park',
  'Riley Kim',
  'Casey Nguyen',
  'Quinn Taylor',
  'Avery Zhang',
  'Drew Patel',
  'Blake Johnson',
  'Robin Garcia',
  'Sage Williams',
  'Harper Jones',
  'Emery Brown',
  'Finley Davis',
  'Rowan Miller',
];

interface NameStepProps {
  formData: EmployeeFormData;
  updateField: <K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) => void;
}

export function NameStep({ formData, updateField }: NameStepProps) {
  const randomizeName = useCallback(() => {
    const name = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)] ?? 'New Employee';
    updateField('name', name);
  }, [updateField]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Input
          value={formData.name}
          onChange={(e) => updateField('name', e.target.value)}
          placeholder="Enter employee name..."
          className="flex-1"
          autoFocus
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={randomizeName}
          title="Random name"
        >
          <Dices className="h-4 w-4" />
        </Button>
      </div>
      {formData.name.trim() === '' && (
        <p className="text-xs text-shell">A name is required to proceed.</p>
      )}
    </div>
  );
}
