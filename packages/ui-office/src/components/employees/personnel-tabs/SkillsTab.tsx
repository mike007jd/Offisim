import { SkillBindingList } from '../SkillBindingList';
import { TabScrollShell } from './shared';

interface SkillsTabProps {
  companyId: string | null;
  employeeId: string | null;
}

export function SkillsTab({ companyId, employeeId }: SkillsTabProps) {
  return (
    <TabScrollShell>
      {employeeId ? (
        <SkillBindingList companyId={companyId} employeeId={employeeId} />
      ) : null}
    </TabScrollShell>
  );
}
