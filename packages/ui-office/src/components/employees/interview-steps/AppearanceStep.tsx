import type { EmployeeFormData } from '../../../hooks/useEmployeeEditor';
import { AvatarCustomizer } from '../AvatarCustomizer';

interface AppearanceStepProps {
  formData: EmployeeFormData;
  updateField: <K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) => void;
}

export function AppearanceStep({ formData, updateField }: AppearanceStepProps) {
  return (
    <AvatarCustomizer
      config={formData.appearance}
      onChange={(cfg) => updateField('appearance', cfg)}
    />
  );
}
