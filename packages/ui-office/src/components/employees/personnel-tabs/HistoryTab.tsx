import { VersionHistoryTab } from '../VersionHistoryTab';
import { TabScrollShell, TabSelectionEmpty } from './shared';

interface HistoryTabProps {
  employeeId: string | null;
  sourceAssetId: string | null;
  sourcePackageId: string | null;
}

export function HistoryTab({ employeeId, sourceAssetId, sourcePackageId }: HistoryTabProps) {
  if (!employeeId) {
    return <TabSelectionEmpty message="Select an employee to view version history." />;
  }
  return (
    <TabScrollShell>
      <VersionHistoryTab
        employeeId={employeeId}
        forkOrigin={sourceAssetId ? { sourceAssetId, sourcePackageId } : null}
      />
    </TabScrollShell>
  );
}
