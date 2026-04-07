import type { ProjectRow, Zone } from '@offisim/shared-types';
import { ChatPanel, RightSidebar, TaskDashboard } from '@offisim/ui-office';
import type { AgentState } from '@offisim/ui-office';
import type { ComponentProps } from 'react';
import type { AppView } from '../lib/app-view-layout';
import { getWorkspaceRightRailMode } from './workspace-right-rail-mode';
import { WORKSPACE_SURFACE_META, type WorkspaceSurfaceView } from './workspace-surface-meta';

interface WorkspaceRightRailProps {
  view: AppView;
  zones: Zone[];
  officeSpaceEntryViews: WorkspaceSurfaceView[];
  agents: Map<string, AgentState>;
  activeProject: ProjectRow | null;
  selectedEmployeeId: string | null;
  selectedEmployeeName: string | null;
  focusOutputsToken: number;
  onboardingWelcome?: ComponentProps<typeof ChatPanel>['onboardingWelcome'];
  onboardingStarterPrompts?: ComponentProps<typeof ChatPanel>['onboardingStarterPrompts'];
  onSelectView: (view: AppView) => void;
  onOpenSettings: () => void;
  onToggleDashboard: () => void;
  onToggleKanban: () => void;
  onOpenEditor: () => void;
  onOpenStudio: () => void;
  onClearSelection: () => void;
  onUserMessage: (text: string) => void;
}

function CollaborationRail({
  activeProject,
  selectedEmployeeId,
  selectedEmployeeName,
  onboardingWelcome,
  onboardingStarterPrompts,
  onOpenSettings,
  onToggleDashboard,
  onToggleKanban,
  onOpenEditor,
  onOpenStudio,
  onClearSelection,
  onUserMessage,
}: Omit<
  WorkspaceRightRailProps,
  'view' | 'zones' | 'officeSpaceEntryViews' | 'agents' | 'focusOutputsToken' | 'onSelectView'
>) {
  return (
    <ChatPanel
      compact={false}
      onOpenSettings={onOpenSettings}
      selectedEmployeeId={selectedEmployeeId}
      selectedEmployeeName={selectedEmployeeName}
      onClearSelection={onClearSelection}
      onToggleDashboard={onToggleDashboard}
      onToggleKanban={onToggleKanban}
      onOpenEditor={onOpenEditor}
      onOpenStudio={onOpenStudio}
      activeProject={activeProject}
      onUserMessage={onUserMessage}
      onboardingWelcome={onboardingWelcome}
      onboardingStarterPrompts={onboardingStarterPrompts}
    />
  );
}

export function WorkspaceRightRail(props: WorkspaceRightRailProps) {
  const mode = getWorkspaceRightRailMode(props.view);

  if (mode === 'office') {
    return (
      <div className="flex h-full flex-col">
        <CollaborationRail {...props} />
        <div className="border-t border-white/5">
          <RightSidebar
            onOpenDashboard={props.onToggleDashboard}
            onOpenKanban={props.onToggleKanban}
            focusOutputsToken={props.focusOutputsToken}
            activeThreadId={props.activeProject?.thread_id ?? null}
          />
        </div>
      </div>
    );
  }

  if (mode === 'tasks') {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-b border-white/5 px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">
          Tasks
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TaskDashboard agents={props.agents} />
        </div>
      </div>
    );
  }

  if (mode === 'collaboration') {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-b border-white/5 px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">
          Collaboration
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CollaborationRail {...props} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {props.officeSpaceEntryViews.length > 0 && (
        <div className="border-b border-white/5 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
            Office Spaces
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2">
            {props.officeSpaceEntryViews.map((spaceView) => {
              const meta = WORKSPACE_SURFACE_META[spaceView];
              return (
                <button
                  key={spaceView}
                  type="button"
                  onClick={() => props.onSelectView(spaceView)}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-blue-400/30 hover:bg-blue-500/10"
                >
                  <div className="text-xs font-semibold text-slate-200">{meta.label}</div>
                  {meta.entryDescription ? (
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      {meta.entryDescription}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="border-b border-white/5 px-3 py-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">
        Collaboration
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <CollaborationRail {...props} />
      </div>
    </div>
  );
}
