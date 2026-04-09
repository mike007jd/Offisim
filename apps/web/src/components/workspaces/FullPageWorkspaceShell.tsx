import type { ReactNode } from 'react';
import { WorkspacePageHeader } from './WorkspacePageHeader';

interface FullPageWorkspaceShellProps {
  title: string;
  onBackToOffice: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export function FullPageWorkspaceShell({
  title,
  onBackToOffice,
  actions,
  children,
}: FullPageWorkspaceShellProps) {
  return (
    <div className="fixed inset-0 flex flex-col bg-[radial-gradient(circle_at_top,#14203d_0%,#0a1022_38%,#050814_100%)] text-slate-100">
      <div className="shrink-0 p-3 pb-0">
        <WorkspacePageHeader title={title} onBack={onBackToOffice} actions={actions} />
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
