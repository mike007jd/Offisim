import type { ProjectRow } from '@offisim/shared-types';
import { Button, cn } from '@offisim/ui-core';
import {
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  ContactRound,
  FileText,
  MessageSquare,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { ApprovalsApp } from './ApprovalsApp';
import { MessengerApp } from './MessengerApp';
import type { WorkspaceAppKey } from './suite-types';
import { useApprovalsInbox } from './useApprovalsInbox';

export interface WorkspaceSuiteProps {
  activeApp: WorkspaceAppKey;
  onSelectApp: (app: WorkspaceAppKey) => void;
  activeCompanyId: string | null;
  activeProject: ProjectRow | null;
  activeThreadId: string | null;
  selectedEmployeeId: string | null;
  /** Thread switch writer — MUST clamp to Office `selectedThreadId` SSOT. */
  onSelectThread: (threadId: string) => void;
  /** Direct-chat employee selection — clamps Office `selectedEmployeeId` SSOT. */
  onSelectEmployee: (employeeId: string | null) => void;
  onOpenSettings: () => void;
  onFocusEmployee?: (employeeId: string) => void;
  onOpenActivityLog?: () => void;
  /** Approvals detail selection (resolved item) — session state. */
  approvalsFilter: 'todo' | 'done';
  onApprovalsFilterChange: (filter: 'todo' | 'done') => void;
  approvalsSelectedHistoryId: string | null;
  onApprovalsSelectHistory: (historyId: string | null) => void;
}

interface AppRailItem {
  key: WorkspaceAppKey;
  label: string;
  icon: LucideIcon;
  badge?: number;
  state?: 'deep' | 'surface';
}

/**
 * Workspace collaboration suite shell — the company's business-software layer
 * over the same company, projects, employees, conversations and approvals that
 * Office shows live in 3D. Messenger and Approvals are deep apps; Docs,
 * Calendar, Meetings, Contacts and Workplace still render complete framework
 * surfaces so the suite rail and layout are no longer a two-app stub.
 */
export function WorkspaceSuite(props: WorkspaceSuiteProps) {
  const {
    activeApp,
    onSelectApp,
    activeCompanyId,
    activeProject,
    activeThreadId,
    selectedEmployeeId,
    onSelectThread,
    onSelectEmployee,
    onOpenSettings,
    onFocusEmployee,
    onOpenActivityLog,
    approvalsFilter,
    onApprovalsFilterChange,
    approvalsSelectedHistoryId,
    onApprovalsSelectHistory,
  } = props;

  const inbox = useApprovalsInbox(activeCompanyId);
  const pendingCount = inbox.pending.length;

  const railItems: AppRailItem[] = [
    { key: 'messenger', label: 'Chats', icon: MessageSquare, state: 'deep' },
    { key: 'approvals', label: 'Approve', icon: ClipboardList, badge: pendingCount, state: 'deep' },
    { key: 'docs', label: 'Docs', icon: FileText, state: 'surface' },
    { key: 'calendar', label: 'Calendar', icon: CalendarDays, state: 'surface' },
    { key: 'meetings', label: 'Meet', icon: Video, state: 'surface' },
    { key: 'contacts', label: 'Contacts', icon: ContactRound, state: 'surface' },
    { key: 'workplace', label: 'Workplace', icon: BriefcaseBusiness, state: 'surface' },
  ];

  return (
    <div className="flex h-full min-h-0 w-full bg-surface-1 text-ink-1">
      <aside className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-0 pb-2 pt-2">
        {railItems.map((item) => {
          const Icon = item.icon;
          const selected = item.key === activeApp;
          return (
            <Button
              key={item.key}
              type="button"
              variant="ghost"
              onClick={() => onSelectApp(item.key)}
              aria-current={selected ? 'page' : undefined}
              aria-label={`${item.label} app`}
              className={cn(
                'relative flex h-auto w-12 flex-col items-center gap-1 rounded-r-md border border-transparent pb-1.5 pt-1.5 transition-colors',
                selected
                  ? 'bg-accent-surface text-accent ring-1 ring-inset ring-accent-ring'
                  : 'text-ink-3 hover:bg-surface-sunken hover:text-ink-1',
              )}
            >
              {item.badge && item.badge > 0 ? (
                <span className="absolute right-1.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-r-pill bg-danger px-1 text-fs-micro font-bold leading-none text-accent-fg shadow-elev-1">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              ) : null}
              <Icon className="size-4" aria-hidden="true" />
              <span className="text-fs-micro font-semibold">{item.label}</span>
            </Button>
          );
        })}
      </aside>

      <section className="min-h-0 min-w-0 flex-1">
        {activeApp === 'messenger' ? (
          <MessengerApp
            activeProject={activeProject}
            activeThreadId={activeThreadId}
            selectedEmployeeId={selectedEmployeeId}
            onSelectThread={onSelectThread}
            onSelectEmployee={onSelectEmployee}
            onOpenSettings={onOpenSettings}
            onFocusEmployee={onFocusEmployee}
            onOpenActivityLog={onOpenActivityLog}
          />
        ) : activeApp === 'approvals' ? (
          <ApprovalsApp
            inbox={inbox}
            filter={approvalsFilter}
            onFilterChange={onApprovalsFilterChange}
            selectedHistoryId={approvalsSelectedHistoryId}
            onSelectHistory={onApprovalsSelectHistory}
            activeThreadId={activeThreadId}
            onOpenThread={onSelectThread}
          />
        ) : (
          <WorkspaceSurfaceApp
            app={activeApp}
            activeProject={activeProject}
            activeCompanyId={activeCompanyId}
            pendingApprovals={pendingCount}
          />
        )}
      </section>
    </div>
  );
}

function WorkspaceSurfaceApp({
  app,
  activeProject,
  activeCompanyId,
  pendingApprovals,
}: {
  app: Exclude<WorkspaceAppKey, 'messenger' | 'approvals'>;
  activeProject: ProjectRow | null;
  activeCompanyId: string | null;
  pendingApprovals: number;
}) {
  const appTitle: Record<typeof app, string> = {
    docs: 'Docs',
    calendar: 'Calendar',
    meetings: 'Meetings',
    contacts: 'Contacts',
    workplace: 'Workplace',
  };
  const rows = createWorkspaceRows(app, activeProject, activeCompanyId, pendingApprovals);
  const panels = createWorkspacePanels(app, activeProject, activeCompanyId, pendingApprovals);
  const primary = rows[0];
  return (
    <div className="flex h-full min-h-0 min-w-0">
      <div className="flex w-80 shrink-0 flex-col border-r border-line bg-surface-1">
        <div className="border-b border-line-soft px-3 pb-2 pt-2.5">
          <p className="text-fs-md font-bold text-ink-1">{appTitle[app]}</p>
          <p className="mt-1 text-fs-meta text-ink-3">Company workspace</p>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
          {rows.map((row) => (
            <div
              key={row.title}
              className="rounded-r-md border border-line-soft bg-surface-1 px-3 py-2 shadow-elev-1"
            >
              <p className="truncate text-fs-sm font-semibold text-ink-1">{row.title}</p>
              <p className="mt-1 line-clamp-2 text-fs-meta text-ink-3">{row.detail}</p>
              <p className="mt-2 text-fs-micro font-semibold uppercase tracking-wide text-ink-4">
                {row.meta}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col bg-surface-2">
        <div className="border-b border-line-soft px-sp-7 py-sp-5">
          <p className="text-fs-micro font-bold uppercase tracking-wide text-ink-3">
            {appTitle[app]} hub
          </p>
          <h2 className="mt-1 text-fs-lg font-bold text-ink-1">
            {primary?.title ?? activeProject?.name ?? 'Company workspace'}
          </h2>
          <p className="mt-1 max-w-2xl text-fs-sm text-ink-3">
            {primary?.detail ?? 'Workspace evidence will appear here as the company works.'}
          </p>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-sp-4 overflow-y-auto px-sp-7 py-sp-6">
          {panels.map((panel) => (
            <section
              key={panel.title}
              className={cn(
                'rounded-r-md border border-line-soft bg-surface-1 p-sp-5 shadow-elev-1',
                panel.wide ? 'col-span-2' : '',
              )}
            >
              <p className="text-fs-micro font-bold uppercase tracking-wide text-ink-3">
                {panel.kicker}
              </p>
              <h3 className="mt-1 text-fs-md font-bold text-ink-1">{panel.title}</h3>
              <p className="mt-2 text-fs-sm leading-relaxed text-ink-3">{panel.body}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function createWorkspaceRows(
  app: Exclude<WorkspaceAppKey, 'messenger' | 'approvals'>,
  activeProject: ProjectRow | null,
  activeCompanyId: string | null,
  pendingApprovals: number,
): Array<{ title: string; detail: string; meta: string }> {
  const project = activeProject?.name ?? 'No project selected';
  const company = activeCompanyId ? 'Company scoped' : 'No company selected';
  const shared = [
    { title: project, detail: 'Active project context', meta: 'project' },
    { title: company, detail: 'Company scoped workspace', meta: 'company' },
  ];
  if (app === 'calendar') {
    return [
      { title: 'Review queue', detail: `${pendingApprovals} approval items`, meta: 'today' },
      ...shared,
    ];
  }
  if (app === 'meetings') {
    return [
      { title: 'Live run standup', detail: 'Conversation and activity evidence', meta: 'active' },
      ...shared,
    ];
  }
  if (app === 'contacts') {
    return [
      { title: 'Team directory', detail: 'Employee identities and status', meta: 'people' },
      ...shared,
    ];
  }
  if (app === 'workplace') {
    return [
      { title: 'Company hub', detail: 'Posts, notices, and activity', meta: 'company' },
      ...shared,
    ];
  }
  return [
    { title: 'Project docs', detail: 'Workspace files and deliverables', meta: 'library' },
    ...shared,
  ];
}

function createWorkspacePanels(
  app: Exclude<WorkspaceAppKey, 'messenger' | 'approvals'>,
  activeProject: ProjectRow | null,
  activeCompanyId: string | null,
  pendingApprovals: number,
): Array<{ kicker: string; title: string; body: string; wide?: boolean }> {
  const projectName = activeProject?.name ?? 'No project selected';
  const companyState = activeCompanyId ? 'company context is active' : 'company context is missing';
  if (app === 'calendar') {
    return [
      {
        kicker: 'review',
        title: `${pendingApprovals} approvals waiting`,
        body: 'Review gates, live runs, and team decisions are grouped as calendar pressure, not generic inbox text.',
      },
      {
        kicker: 'project',
        title: projectName,
        body: `Scheduling context follows the selected project; ${companyState}.`,
      },
      {
        kicker: 'cadence',
        title: 'Run rhythm',
        body: 'Planning, execution, reporting, and review blocks share the same rail language as Office.',
        wide: true,
      },
    ];
  }
  if (app === 'meetings') {
    return [
      {
        kicker: 'live',
        title: 'Standup room',
        body: 'Meeting evidence is organized around participants, transcript, and delegated follow-up work.',
      },
      {
        kicker: 'actions',
        title: 'Action items',
        body: 'Follow-ups use the same employee and thread identity as Messenger instead of a separate meeting store.',
      },
      {
        kicker: 'context',
        title: projectName,
        body: `Meeting context remains tied to the active project; ${companyState}.`,
        wide: true,
      },
    ];
  }
  if (app === 'contacts') {
    return [
      {
        kicker: 'directory',
        title: 'Team identity',
        body: 'Employees, external agents, roles, and direct chat entry points share the Personnel source of truth.',
      },
      {
        kicker: 'presence',
        title: 'Work state',
        body: 'Status, assignment, and blocked state are designed as scan-friendly directory metadata.',
      },
      {
        kicker: 'scope',
        title: projectName,
        body: `Directory filtering follows the active project and ${companyState}.`,
        wide: true,
      },
    ];
  }
  if (app === 'workplace') {
    return [
      {
        kicker: 'feed',
        title: 'Company notices',
        body: 'Posts, system notices, approvals, and activity are grouped as company communication rather than chat messages.',
      },
      {
        kicker: 'activity',
        title: 'Operational pulse',
        body: 'Workplace uses the same Activity Log events so it does not become a second notification system.',
      },
      {
        kicker: 'scope',
        title: projectName,
        body: `Company hub state is scoped to the current company; ${companyState}.`,
        wide: true,
      },
    ];
  }
  return [
    {
      kicker: 'library',
      title: 'Project documents',
      body: 'Workspace files, generated deliverables, and run artifacts are grouped by project evidence.',
    },
    {
      kicker: 'handoff',
      title: 'Deliverables',
      body: 'Documents share Pitch Hall and artifact metadata instead of a separate document-only store.',
    },
    {
      kicker: 'scope',
      title: projectName,
      body: `Document surfaces follow the selected project; ${companyState}.`,
      wide: true,
    },
  ];
}

/**
 * Escape-driven internal drill-back for the suite. Messenger has no suite-local
 * selection (it is clamped to the Office `selectedThreadId` SSOT); Approvals
 * resolved-detail collapses to the list. Returns `true` when consumed.
 */
export function useSuiteEscape(opts: {
  enabled: boolean;
  activeApp: WorkspaceAppKey;
  approvalsSelectedHistoryId: string | null;
  onApprovalsSelectHistory: (historyId: string | null) => void;
}): void {
  const { enabled, activeApp, approvalsSelectedHistoryId, onApprovalsSelectHistory } = opts;
  const handler = useCallback(
    (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (activeApp === 'approvals' && approvalsSelectedHistoryId !== null) {
        event.stopPropagation();
        onApprovalsSelectHistory(null);
      }
    },
    [activeApp, approvalsSelectedHistoryId, onApprovalsSelectHistory],
  );
  useEffect(() => {
    if (!enabled) return;
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [enabled, handler]);
}
