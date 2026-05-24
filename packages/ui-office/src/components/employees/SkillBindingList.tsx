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
      <div className="skill-binding-empty">
        <Puzzle data-icon="empty" aria-hidden="true" />
        <p>
          No skills available. Skills installed from the marketplace or created locally will appear
          here.
        </p>
      </div>
    );
  }

  const employeeSlugs = new Set(merged.filter((s) => s.scope === 'employee').map((s) => s.slug));

  return (
    <div className="skill-binding-list">
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
    <div className="skill-binding-row">
      <Puzzle data-icon="skill" aria-hidden="true" />
      <div>
        <div className="skill-binding-row-head">
          <p>{skill.name}</p>
          <span data-tone="neutral">{scopeLabel}</span>
          {overridden && <span data-tone="warn">overridden by your own</span>}
        </div>
        <p data-slot="description">{skill.description}</p>
      </div>
    </div>
  );
}
