import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FullPageWorkspaceAppView } from '../../lib/app-view-layout';

interface FullPageWorkspaceShellProps {
  activeWorkspace: FullPageWorkspaceAppView;
  companyName?: string | null;
  onBackToOffice: () => void;
  onWorkspaceSwitch: (workspace: FullPageWorkspaceAppView) => void;
  children: ReactNode;
}

export function FullPageWorkspaceShell({
  activeWorkspace: _activeWorkspace,
  companyName: _companyName,
  onBackToOffice,
  onWorkspaceSwitch: _onWorkspaceSwitch,
  children,
}: FullPageWorkspaceShellProps) {
  return (
    <div
      className="flex h-screen min-h-0 flex-col text-slate-100"
      style={{
        background: `
          radial-gradient(circle at top, #14203d 0%, #0a1022 38%, #050814 100%),
          radial-gradient(circle, rgba(100,200,255,0.03) 1px, transparent 1px)
        `,
        backgroundSize: '100% 100%, 24px 24px',
      }}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Back button — fixed left edge */}
        <button
          type="button"
          onClick={onBackToOffice}
          className="absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-1.5 text-[12px] text-slate-300 backdrop-blur-md hover:bg-white/10 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Office
        </button>

        {children}
      </div>
    </div>
  );
}
