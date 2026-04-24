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
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-white/10 py-6 text-center">
        <Puzzle className="h-8 w-8 text-slate-500" />
        <p className="max-w-[260px] text-xs italic text-slate-400/70">
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
    <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-white/5 p-3">
      <Puzzle className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-100">{skill.name}</p>
          <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">
            {scopeLabel}
          </span>
          {overridden && (
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">
              overridden by your own
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-400">{skill.description}</p>
      </div>
    </div>
  );
}
