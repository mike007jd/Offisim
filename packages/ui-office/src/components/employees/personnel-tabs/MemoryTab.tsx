import { MemoryPanel } from '../MemoryPanel';
import { TabScrollShell, TabSelectionEmpty } from './shared';

interface MemoryTabProps {
  companyId: string | null;
  employeeId: string | null;
}

export function MemoryTab({ companyId, employeeId }: MemoryTabProps) {
  if (!employeeId || !companyId) {
    return <TabSelectionEmpty message="Select an employee to view memories." />;
  }
  return (
    <TabScrollShell>
      <MemoryPanel employeeId={employeeId} companyId={companyId} />
    </TabScrollShell>
  );
}
