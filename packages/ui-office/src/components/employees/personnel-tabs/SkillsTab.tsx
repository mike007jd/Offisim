import { SkillBindingList } from '../SkillBindingList';
import { TabScrollShell } from './shared';

interface SkillsTabProps {
  companyId: string | null;
  employeeId: string | null;
}

export function SkillsTab({ companyId, employeeId }: SkillsTabProps) {
  return (
    <TabScrollShell>
      <h3 className="text-lg font-semibold text-slate-100">Skills</h3>
      <p className="mt-2 text-sm text-slate-400">
        Bound skills appear below for context. The dedicated in-Personnel skills experience is
        pending.
      </p>
      <p className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">
        Available in a follow-up change
      </p>
      {employeeId && (
        <div className="mt-6">
          <SkillBindingList companyId={companyId} employeeId={employeeId} />
        </div>
      )}
    </TabScrollShell>
  );
}
