import type { ProjectRow } from '@offisim/shared-types';
import { Button, EmptyState, cn } from '@offisim/ui-core';
import {
  Activity,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  ContactRound,
  FileText,
  MessageSquare,
  Settings,
  Store,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { ApprovalsApp } from './ApprovalsApp';
import { MessengerApp } from './MessengerApp';
import type { WorkspaceAppKey } from './suite-types';
import { useApprovalsInbox } from './useApprovalsInbox';

export type WorkspaceSuiteOpenTarget = 'office' | 'sops' | 'market' | 'personnel' | 'activity-log';

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
  onOpenWorkspace?: (target: WorkspaceSuiteOpenTarget) => void;
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
    onOpenWorkspace,
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
      <aside className="flex w-workspace-suite-appbar shrink-0 flex-col items-center gap-1 border-r border-line bg-surface-0 pb-2 pt-2">
        <span
          className="workspace-appbar-id mb-2 grid place-items-center rounded-r-md bg-accent-surface text-accent shadow-elev-1 ring-1 ring-line"
          title={activeProject?.name ?? 'Company workspace'}
        >
          <BriefcaseBusiness className="size-4" aria-hidden="true" />
        </span>
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
            onSelectApp={onSelectApp}
            onOpenSettings={onOpenSettings}
            onOpenActivityLog={onOpenActivityLog}
            onOpenWorkspace={onOpenWorkspace}
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
  onSelectApp,
  onOpenSettings,
  onOpenActivityLog,
  onOpenWorkspace,
}: {
  app: Exclude<WorkspaceAppKey, 'messenger' | 'approvals'>;
  activeProject: ProjectRow | null;
  activeCompanyId: string | null;
  pendingApprovals: number;
  onSelectApp: (app: WorkspaceAppKey) => void;
  onOpenSettings: () => void;
  onOpenActivityLog?: () => void;
  onOpenWorkspace?: (target: WorkspaceSuiteOpenTarget) => void;
}) {
  if (app === 'workplace') {
    return (
      <WorkspaceHomeSurface
        activeProject={activeProject}
        activeCompanyId={activeCompanyId}
        pendingApprovals={pendingApprovals}
        onSelectApp={onSelectApp}
        onOpenSettings={onOpenSettings}
        onOpenActivityLog={onOpenActivityLog}
        onOpenWorkspace={onOpenWorkspace}
      />
    );
  }

  const meta = getSurfaceMeta(app);
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-2">
      <div className="flex items-center gap-sp-4 border-b border-line-soft bg-surface-1 px-sp-7 py-sp-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-r-md bg-accent-surface text-accent ring-1 ring-accent-ring">
          <meta.icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-fs-lg font-bold text-ink-1">{meta.title}</h2>
          <p className="mt-1 truncate text-fs-meta text-ink-3">
            {activeProject?.name ?? 'No project selected'}
          </p>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 place-items-center px-sp-7 py-sp-6">
        <EmptyState
          title={meta.emptyTitle}
          description={meta.emptyDescription}
          primaryAction={
            meta.action === 'activity' && onOpenActivityLog
              ? { label: 'Open Activity', onClick: onOpenActivityLog }
              : meta.action === 'personnel' && onOpenWorkspace
                ? { label: 'Open Personnel', onClick: () => onOpenWorkspace('personnel') }
              : meta.action === 'approvals' && pendingApprovals > 0
                ? { label: 'Review approvals', onClick: () => onSelectApp('approvals') }
                : meta.action === 'settings'
                  ? { label: 'Open Settings', onClick: onOpenSettings }
                  : undefined
          }
        />
      </div>
    </div>
  );
}

function getSurfaceMeta(app: Exclude<WorkspaceAppKey, 'messenger' | 'approvals' | 'workplace'>): {
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  icon: LucideIcon;
  action?: 'activity' | 'approvals' | 'personnel' | 'settings';
} {
  switch (app) {
    case 'docs':
      return {
        title: 'Docs',
        emptyTitle: 'No project documents yet',
        emptyDescription:
          'Generated deliverables and attached project files will appear here once they exist in the selected project.',
        icon: FileText,
        action: 'approvals',
      };
    case 'calendar':
      return {
        title: 'Calendar',
        emptyTitle: 'No scheduled work yet',
        emptyDescription:
          'Runs, review gates, and deadlines will appear here after they are created from real project activity.',
        icon: CalendarDays,
        action: 'activity',
      };
    case 'meetings':
      return {
        title: 'Meetings',
        emptyTitle: 'No meeting records yet',
        emptyDescription:
          'Meeting transcripts and action items will appear after real team sessions are captured.',
        icon: Video,
        action: 'activity',
      };
    case 'contacts':
      return {
        title: 'Contacts',
        emptyTitle: 'Directory lives in Personnel',
        emptyDescription:
          'Employee identity, runtime, skills, and direct-chat entry points are managed from the Personnel workspace.',
        icon: ContactRound,
        action: 'personnel',
      };
  }
}

function WorkspaceHomeSurface({
  activeProject,
  activeCompanyId,
  pendingApprovals,
  onSelectApp,
  onOpenSettings,
  onOpenActivityLog,
  onOpenWorkspace,
}: {
  activeProject: ProjectRow | null;
  activeCompanyId: string | null;
  pendingApprovals: number;
  onSelectApp: (app: WorkspaceAppKey) => void;
  onOpenSettings: () => void;
  onOpenActivityLog?: () => void;
  onOpenWorkspace?: (target: WorkspaceSuiteOpenTarget) => void;
}) {
  return (
    <div className="min-h-0 overflow-y-auto bg-surface-2 px-sp-7 py-sp-6">
      <section className="rounded-r-lg border border-line-soft bg-surface-1 p-sp-7 shadow-elev-1">
        <h2 className="text-fs-xl font-bold text-ink-1">Workspace</h2>
        <p className="mt-1 text-fs-sm text-ink-3">
          {activeProject?.name ?? 'No project selected'} · company OS control surface
        </p>
        <div className="grid-workspace-home-stats mt-sp-6 grid gap-sp-3">
          {[
            ['To approve', String(pendingApprovals)],
            ['Active project', activeProject ? '1' : '0'],
            ['Company scope', activeCompanyId ? 'Active' : 'Missing'],
            ['Suite apps', '7'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-r-md border border-line-soft bg-surface-2 p-sp-4">
              <div className="text-fs-lg font-bold text-ink-1">{value}</div>
              <div className="mt-1 text-fs-meta font-semibold uppercase tracking-wide text-ink-4">
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <WorkspaceTileSection
        title="Suite apps"
        tiles={[
          [
            'Messenger',
            'Group and direct chats with your team',
            MessageSquare,
            () => onSelectApp('messenger'),
          ],
          [
            'Approvals',
            'Human-in-loop gates waiting on you',
            ClipboardList,
            () => onSelectApp('approvals'),
          ],
          ['Docs', 'Every deliverable, exportable', FileText, () => onSelectApp('docs')],
          [
            'Calendar',
            'Meetings, ceremonies and deadlines',
            CalendarDays,
            () => onSelectApp('calendar'),
          ],
          ['Contacts', 'The company directory', ContactRound, () => onSelectApp('contacts')],
        ]}
      />
      <WorkspaceTileSection
        title="Workspaces"
        tiles={[
          ['Office', 'Live floor and team dock', BriefcaseBusiness, () => onOpenWorkspace?.('office')],
          ['SOPs', 'Operational playbooks and runs', ClipboardList, () => onOpenWorkspace?.('sops')],
          ['Market', 'Install employees, skills and layouts', Store, () => onOpenWorkspace?.('market')],
          ['Personnel', 'Employee profiles and runtime controls', ContactRound, () => onOpenWorkspace?.('personnel')],
          ['Activity', 'Inspect real runtime events', Activity, onOpenActivityLog],
          ['Settings', 'Runtime, providers and external agents', Settings, onOpenSettings],
        ]}
      />
    </div>
  );
}

function WorkspaceTileSection({
  title,
  tiles,
}: {
  title: string;
  tiles: Array<[string, string, LucideIcon, (() => void)?]>;
}) {
  return (
    <section className="mt-sp-7">
      <h3 className="mb-sp-3 text-fs-micro font-bold uppercase tracking-wide text-ink-3">
        {title}
      </h3>
      <div className="grid-workspace-home-tiles grid gap-sp-3">
        {tiles.map(([name, description, Icon, onClick]) => (
          <Button
            key={name}
            type="button"
            variant="ghost"
            onClick={onClick}
            disabled={!onClick}
            className="grid h-auto justify-start gap-sp-2 rounded-r-md border border-line-soft bg-surface-1 p-sp-4 text-left shadow-elev-1 transition-colors hover:bg-surface-sunken"
          >
            <span className="grid size-9 place-items-center rounded-r-sm bg-accent-surface text-accent">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="text-fs-sm font-bold text-ink-1">{name}</span>
            <span className="text-fs-meta text-ink-3">{description}</span>
          </Button>
        ))}
      </div>
    </section>
  );
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
