import type { ReactNode } from 'react';
import { useTourTarget } from '../onboarding/tour-context';
import { ThreadList } from '../threads/ThreadList';
import { WorkspaceSearch } from '../workspace/WorkspaceSearch';

interface RightSidebarProps {
  chatPanel: ReactNode;
  projectSlot?: ReactNode;
  projectSummarySlot?: ReactNode;
  activeThreadId?: string | null;
  activeProjectId?: string | null;
  /** Thread switch must go through `updateWorkspaceState('office', …)` (SSOT). */
  onSelectThread?: (threadId: string) => void;
  onSelectEmployee?: (employeeId: string) => void;
}

/**
 * Single-axis Office right rail (V3). The legacy Chat/Inspector/Tasks/Git tab
 * shell is removed: the rail is now one conversation column. Inspector routes to
 * Personnel; Tasks content (Activity/Plan) is folded into the chat column's
 * run-record head and `.conv-outputs`; the Git widget moves to the left rail in
 * Phase 2 (`rebuild-office-shell-v3`). Thread switching stays via `ThreadList`,
 * routed through the SSOT `onSelectThread` writer.
 */
export function RightSidebar({
  chatPanel,
  projectSlot,
  projectSummarySlot,
  activeThreadId,
  activeProjectId,
  onSelectThread,
  onSelectEmployee,
}: RightSidebarProps) {
  const projectSelectorRef = useTourTarget('office:project-selector');

  return (
    <div className="box-border flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-surface-elevated text-text-primary">
      <div className="box-border w-full min-w-0 max-w-full overflow-hidden border-b border-border-default px-3 py-2.5">
        <p className="text-caption uppercase tracking-wide text-text-secondary">Workspace</p>
        {activeProjectId && onSelectThread && onSelectEmployee ? (
          <div className="mt-2 min-w-0 max-w-full overflow-hidden">
            <WorkspaceSearch
              projectId={activeProjectId}
              onSelectThread={onSelectThread}
              onSelectEmployee={onSelectEmployee}
            />
          </div>
        ) : null}
        {projectSlot ? (
          <div
            className="mt-2 flex min-w-0 max-w-full items-center gap-2 overflow-hidden"
            ref={projectSelectorRef}
          >
            <span className="shrink-0 text-caption font-semibold uppercase tracking-wide text-text-secondary">
              Project
            </span>
            <div className="min-w-0 max-w-full flex-1 overflow-hidden">{projectSlot}</div>
          </div>
        ) : null}
        {projectSummarySlot ? (
          <div className="mt-2 min-w-0 max-w-full overflow-hidden">{projectSummarySlot}</div>
        ) : null}
      </div>

      {activeProjectId && onSelectThread ? (
        <div className="box-border w-full shrink-0 border-b border-border-default">
          <ThreadList
            projectId={activeProjectId}
            selectedThreadId={activeThreadId ?? null}
            onSelectThread={onSelectThread}
          />
        </div>
      ) : null}

      <div className="flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col overflow-hidden">
        {chatPanel}
      </div>
    </div>
  );
}
