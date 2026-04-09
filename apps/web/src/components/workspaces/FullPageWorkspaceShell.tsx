import { Button } from '@offisim/ui-core';
import { ArrowLeft, BriefcaseBusiness, ClipboardList, Logs, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FullPageWorkspaceAppView } from '../../lib/app-view-layout';

const WORKSPACE_META: Record<
  FullPageWorkspaceAppView,
  { label: string; icon: typeof ClipboardList }
> = {
  sops: { label: 'SOPs', icon: ClipboardList },
  market: { label: 'Market', icon: BriefcaseBusiness },
  'activity-log': { label: 'Activity Log', icon: Logs },
  settings: { label: 'Settings', icon: Settings },
};

interface FullPageWorkspaceShellProps {
  activeWorkspace: FullPageWorkspaceAppView;
  companyName?: string | null;
  onBackToOffice: () => void;
  onWorkspaceSwitch: (workspace: FullPageWorkspaceAppView) => void;
  children: ReactNode;
}

export function FullPageWorkspaceShell({
  activeWorkspace,
  companyName,
  onBackToOffice,
  onWorkspaceSwitch,
  children,
}: FullPageWorkspaceShellProps) {
  return (
    <div className="flex h-screen min-h-0 flex-col bg-[radial-gradient(circle_at_top,#14203d_0%,#0a1022_38%,#050814_100%)] text-slate-100">
      <header className="border-b border-white/10 bg-slate-950/55 px-6 py-4 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1700px] flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onBackToOffice}
              className="border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Office
            </Button>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-400">
                Workspace
              </p>
              <div className="flex items-center gap-2">
                <span className="truncate text-base font-semibold text-white">
                  {companyName ?? 'Offisim'}
                </span>
                <span className="text-slate-500">/</span>
                <span className="text-sm text-slate-300">
                  {WORKSPACE_META[activeWorkspace].label}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(WORKSPACE_META) as Array<FullPageWorkspaceAppView>).map((workspace) => {
              const meta = WORKSPACE_META[workspace];
              const Icon = meta.icon;
              const active = workspace === activeWorkspace;
              return (
                <button
                  key={workspace}
                  type="button"
                  onClick={() => onWorkspaceSwitch(workspace)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition ${
                    active
                      ? 'border-cyan-400/60 bg-cyan-400/12 text-cyan-100'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 px-5 py-4">
        <div className="mx-auto flex h-full w-full max-w-[1700px] min-h-0 overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/40 shadow-[0_16px_48px_rgba(0,0,0,0.25)] backdrop-blur-xl">
          {children}
        </div>
      </main>
    </div>
  );
}
