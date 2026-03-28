import type { RoleSlug } from '@offisim/shared-types';
import { cn } from '@offisim/ui-core';
import { Code2, LayoutDashboard, Palette, Search, Server, TrendingUp, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { EmployeeFormData } from '../../../hooks/useEmployeeEditor';

interface RoleCard {
  readonly value: RoleSlug;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

const ROLE_CARDS: readonly RoleCard[] = [
  {
    value: 'pm',
    label: 'Product Manager',
    description: 'Drives product vision and priorities',
    icon: LayoutDashboard,
  },
  {
    value: 'developer',
    label: 'Developer',
    description: 'Builds features and writes code',
    icon: Code2,
  },
  {
    value: 'designer',
    label: 'Designer',
    description: 'Crafts user experiences and visuals',
    icon: Palette,
  },
  {
    value: 'qa',
    label: 'QA Engineer',
    description: 'Ensures quality through testing',
    icon: Search,
  },
  {
    value: 'devops',
    label: 'DevOps Engineer',
    description: 'Manages infrastructure and deployments',
    icon: Server,
  },
  {
    value: 'analyst',
    label: 'Analyst',
    description: 'Extracts insights from data',
    icon: TrendingUp,
  },
  {
    value: 'engineering_manager',
    label: 'Engineering Manager',
    description: 'Leads teams and coordinates work',
    icon: Users,
  },
];

interface RoleStepProps {
  formData: EmployeeFormData;
  updateField: <K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) => void;
}

export function RoleStep({ formData, updateField }: RoleStepProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {ROLE_CARDS.map((role) => {
        const Icon = role.icon;
        const isSelected = formData.role_slug === role.value;
        return (
          <button
            key={role.value}
            type="button"
            onClick={() => updateField('role_slug', role.value)}
            className={cn(
              'flex flex-col items-center gap-2 p-4 border-2 text-left transition-colors cursor-pointer',
              isSelected
                ? 'border-lobster-red bg-lobster-red/10 text-pearl'
                : 'border-ocean-light bg-ocean-mid/50 text-sand hover:border-sea-blue hover:bg-ocean-mid',
            )}
          >
            <Icon className={cn('h-6 w-6', isSelected ? 'text-lobster-red' : 'text-shell')} />
            <span className="text-sm font-semibold">{role.label}</span>
            <span className="text-xs text-shell text-center">{role.description}</span>
          </button>
        );
      })}
    </div>
  );
}
