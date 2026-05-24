import type { ProjectRow } from '@offisim/shared-types';
import { Button, EmptyState } from '@offisim/ui-core';
import {
  Activity,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardList,
  ContactRound,
  FileText,
  type LucideIcon,
  MessageSquare,
  Settings,
  Store,
  Video,
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
    <div className="workspace-suite">
      <aside className="workspace-suite-appbar">
        <span
          className="workspace-suite-appbar-id"
          title={activeProject?.name ?? 'Company workspace'}
        >
          <BriefcaseBusiness data-icon="appbar-id" aria-hidden="true" />
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
              className="workspace-suite-app-button"
              data-selected={selected || undefined}
              data-state={item.state}
            >
              {item.badge && item.badge > 0 ? (
                <span className="workspace-suite-app-badge">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              ) : null}
              <Icon data-icon="app" aria-hidden="true" />
              <span>{item.label}</span>
            </Button>
          );
        })}
      </aside>

      <section className="workspace-suite-body">
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
    <div className="workspace-surface-app">
      <div className="workspace-surface-head">
        <span className="workspace-surface-icon">
          <meta.icon data-icon="surface" aria-hidden="true" />
        </span>
        <div className="workspace-surface-copy">
          <h2>{meta.title}</h2>
          <p>{activeProject?.name ?? 'No project selected'}</p>
        </div>
      </div>
      <div className="workspace-surface-empty">
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
    <div className="workspace-home">
      <section className="workspace-home-hero">
        <h2>Workspace</h2>
        <p>{activeProject?.name ?? 'No project selected'} · company OS control surface</p>
        <div className="workspace-home-stats">
          {[
            ['To approve', String(pendingApprovals)],
            ['Active project', activeProject ? '1' : '0'],
            ['Company scope', activeCompanyId ? 'Active' : 'Missing'],
            ['Suite apps', '7'],
          ].map(([label, value]) => (
            <div key={label} className="workspace-home-stat">
              <div>{value}</div>
              <span>{label}</span>
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
          [
            'Office',
            'Live floor and team dock',
            BriefcaseBusiness,
            () => onOpenWorkspace?.('office'),
          ],
          [
            'SOPs',
            'Operational playbooks and runs',
            ClipboardList,
            () => onOpenWorkspace?.('sops'),
          ],
          [
            'Market',
            'Install employees, skills and layouts',
            Store,
            () => onOpenWorkspace?.('market'),
          ],
          [
            'Personnel',
            'Employee profiles and runtime controls',
            ContactRound,
            () => onOpenWorkspace?.('personnel'),
          ],
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
    <section className="workspace-tile-section">
      <h3>{title}</h3>
      <div className="workspace-tile-grid">
        {tiles.map(([name, description, Icon, onClick]) => (
          <Button
            key={name}
            type="button"
            variant="ghost"
            onClick={onClick}
            disabled={!onClick}
            className="workspace-tile"
          >
            <span className="workspace-tile-icon">
              <Icon data-icon="tile" aria-hidden="true" />
            </span>
            <span className="workspace-tile-title">{name}</span>
            <span className="workspace-tile-description">{description}</span>
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
