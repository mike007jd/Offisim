import type { RoleSlug } from '@offisim/shared-types';
import { Button, cn } from '@offisim/ui-core';
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
          <Button
            key={role.value}
            type="button"
            variant="ghost"
            onClick={() => updateField('role_slug', role.value as RoleSlug)}
            className={cn(
              'h-auto flex-col items-center gap-2 border-2 p-4 text-left',
              isSelected
                ? 'border-border-focus bg-accent-muted text-accent-text'
                : 'border-border-default bg-surface-muted text-text-secondary hover:border-border-focus hover:bg-surface-hover',
            )}
          >
            <Icon className={cn('size-6', isSelected ? 'text-accent' : 'text-text-secondary')} />
            <span className="text-sm font-semibold">{role.label}</span>
            <span className="text-center text-xs text-text-muted">{role.description}</span>
          </Button>
        );
      })}
    </div>
  );
}
