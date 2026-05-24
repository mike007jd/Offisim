import type { SkillMetadata } from '@offisim/shared-types';
import { Puzzle } from 'lucide-react';
import { useSkillsForEmployee } from '../../hooks/useEmployeeEditor';

interface SkillBindingListProps {
  companyId: string | null;
  employeeId: string | null;
}

export function SkillBindingList({ companyId, employeeId }: SkillBindingListProps) {
  const merged = useSkillsForEmployee(companyId, employeeId);

  if (merged.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-r-md border border-dashed border-line py-6 text-center">
        <Puzzle className="h-8 w-8 text-ink-4" />
        <p className="max-w-skill-binding-description text-fs-meta italic text-ink-4">
          No skills available. Skills installed from the marketplace or created locally will appear
          here.
        </p>
      </div>
    );
  }

  const employeeSlugs = new Set(merged.filter((s) => s.scope === 'employee').map((s) => s.slug));

  return (
    <div className="flex flex-col gap-2">
      {merged.map((skill) => (
        <SkillRow
          key={skill.id}
          skill={skill}
          overridden={skill.scope === 'company' && employeeSlugs.has(skill.slug)}
        />
      ))}
    </div>
  );
}

function SkillRow({ skill, overridden }: { skill: SkillMetadata; overridden: boolean }) {
  const scopeLabel = skill.scope === 'employee' ? 'personal' : 'global';
  return (
    <div className="flex items-start gap-sp-2 rounded-r-xs border border-transparent bg-transparent px-sp-2 py-sp-2 transition-colors hover:border-line-soft hover:bg-surface-1">
      <Puzzle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-fs-sm font-medium text-ink-1">{skill.name}</p>
          <span className="rounded-r-pill border border-line bg-surface-1 px-1.5 py-0.5 text-fs-meta text-ink-3">
            {scopeLabel}
          </span>
          {overridden && (
            <span className="rounded-r-pill border border-warn bg-warn-surface px-1.5 py-0.5 text-fs-meta text-warn">
              overridden by your own
            </span>
          )}
        </div>
        <p className="mt-1 text-fs-meta text-ink-3">{skill.description}</p>
      </div>
    </div>
  );
}
