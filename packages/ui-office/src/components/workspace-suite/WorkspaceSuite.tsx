import type { ProjectRow } from '@offisim/shared-types';
import { Button, cn } from '@offisim/ui-core';
import {
  Activity,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ClipboardList,
  ContactRound,
  Download,
  FileText,
  Grid2X2,
  PenLine,
  MessageSquare,
  Search,
  Store,
  Users,
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
}: {
  app: Exclude<WorkspaceAppKey, 'messenger' | 'approvals'>;
  activeProject: ProjectRow | null;
  activeCompanyId: string | null;
  pendingApprovals: number;
  onSelectApp: (app: WorkspaceAppKey) => void;
  onOpenSettings: () => void;
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

  if (app === 'calendar' || app === 'meetings') {
    return (
      <WorkspaceAgendaSurface
        app={app}
        activeProject={activeProject}
        pendingApprovals={pendingApprovals}
      />
    );
  }

  if (app === 'workplace') {
    return (
      <WorkspaceHomeSurface
        activeProject={activeProject}
        pendingApprovals={pendingApprovals}
        onSelectApp={onSelectApp}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <div className="flex w-workspace-suite-list shrink-0 flex-col border-r border-line bg-surface-1">
        <div className="flex flex-col gap-2 border-b border-line-soft px-3 pb-2 pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-fs-md font-bold text-ink-1">{appTitle[app]}</p>
            {app === 'contacts' ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-7 rounded-r-sm bg-surface-2 text-ink-3"
                onClick={onOpenSettings}
                aria-label="Open personnel settings"
              >
                <PenLine className="size-3.5" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          {app === 'docs' ? (
            <div className="inline-flex h-8 items-center gap-0.5 self-start rounded-r-md border border-line bg-surface-2 p-1 shadow-elev-1">
              <SurfaceFilter active label="All" count={rows.length} />
              <SurfaceFilter label="Documents" />
              <SurfaceFilter label="Files" />
            </div>
          ) : null}
          <div className="flex h-8 items-center gap-2 rounded-r-sm border border-line bg-surface-sunken px-2.5 text-fs-sm text-ink-4">
            <Search className="size-3.5" aria-hidden="true" />
            {app === 'contacts' ? 'Search by name or role' : 'Search title or contributor'}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
          {rows.map((row) => (
            <Button
              key={row.title}
              type="button"
              variant="ghost"
              className={cn(
                'grid h-auto w-full items-center justify-start gap-2 rounded-r-md border border-transparent px-3 py-2 text-left transition-colors hover:bg-surface-sunken',
                row === primary && 'border-accent-ring bg-accent-surface',
                app === 'docs' ? 'grid-workspace-doc-row' : 'grid-workspace-contact-row',
              )}
            >
              <span className="grid size-8 place-items-center rounded-r-sm bg-surface-sunken text-ink-3 ring-1 ring-line">
                {app === 'docs' ? (
                  <FileText className="size-3.5" aria-hidden="true" />
                ) : (
                  <ContactRound className="size-3.5" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-fs-sm font-semibold text-ink-1">
                  {row.title}
                </span>
                <span className="mt-0.5 block truncate text-fs-meta text-ink-4">{row.detail}</span>
              </span>
              <span className="justify-self-end rounded-r-xs bg-surface-sunken px-1.5 py-0.5 font-mono text-fs-micro font-bold uppercase tracking-wide text-ink-3">
                {row.meta}
              </span>
            </Button>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col bg-surface-2">
        {app === 'docs' ? (
          <DocsDetail
            title={primary?.title ?? 'Project documents'}
            projectName={activeProject?.name}
          />
        ) : (
          <ContactsDetail
            title={primary?.title ?? 'Team directory'}
            projectName={activeProject?.name}
            panels={panels}
          />
        )}
      </div>
    </div>
  );
}

function SurfaceFilter({
  active,
  label,
  count,
}: {
  active?: boolean;
  label: string;
  count?: number;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-r-sm px-2.5 text-fs-meta font-semibold',
        active ? 'bg-accent-surface text-accent ring-1 ring-inset ring-accent-ring' : 'text-ink-3',
      )}
    >
      {label}
      {count != null ? <span className="font-mono text-fs-micro opacity-80">{count}</span> : null}
    </span>
  );
}

function DocsDetail({ title, projectName }: { title: string; projectName?: string }) {
  return (
    <>
      <div className="border-b border-line-soft px-sp-7 py-sp-5">
        <div className="flex items-start justify-between gap-sp-4">
          <div className="min-w-0">
            <h2 className="truncate text-fs-lg font-bold text-ink-1">{title}</h2>
            <p className="mt-1 text-fs-meta text-ink-3">
              5 contributors · produced in {projectName ?? 'active project'} · just now
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" className="rounded-r-sm">
              Copy
            </Button>
            <Button type="button" variant="outline" size="sm" className="rounded-r-sm">
              <Download className="size-3.5" aria-hidden="true" />
              Export
            </Button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-sp-7 py-sp-6">
        <article className="max-w-workspace-doc-paper mx-auto rounded-r-md border border-line bg-surface-1 px-sp-8 py-sp-7 shadow-elev-1">
          <h1 className="text-fs-xl font-bold text-ink-1">Q3 Roadmap</h1>
          <p className="mt-sp-4 text-fs-md leading-relaxed text-ink-2">
            Goals for the quarter, distilled from the launch kickoff. Owners are AI employees; the
            boss approves scope changes.
          </p>
          <h2 className="mt-sp-7 text-fs-lg font-semibold text-ink-1">Workstreams</h2>
          <ul className="mt-sp-3 flex list-disc flex-col gap-1 pl-5 text-fs-md leading-relaxed text-ink-2">
            <li>Ship the doc-engine verify flow.</li>
            <li>Harden the attachment pipeline across caps, MIME, and non-UTF-8 inputs.</li>
            <li>Close the UX and information architecture debt batch.</li>
          </ul>
          <h2 className="mt-sp-7 text-fs-lg font-semibold text-ink-1">Milestones</h2>
          <p className="mt-sp-3 text-fs-md leading-relaxed text-ink-2">
            Week 1 — sandbox and parser verified. Week 2 — pipeline hardened. Week 3 — launch review
            and sign-off.
          </p>
        </article>
      </div>
    </>
  );
}

function ContactsDetail({
  title,
  projectName,
  panels,
}: {
  title: string;
  projectName?: string;
  panels: Array<{ kicker: string; title: string; body: string; wide?: boolean }>;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-line-soft bg-surface-1 px-sp-7 py-sp-6">
        <div className="flex items-center gap-sp-4">
          <span className="grid size-16 shrink-0 place-items-center rounded-r-md bg-accent-surface text-accent ring-1 ring-accent-ring">
            <Users className="size-6" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-fs-xl font-bold text-ink-1">{title}</h2>
            <p className="mt-1 text-fs-sm text-ink-3">
              Directory view · {projectName ?? 'active project'} · model and tool policy summary
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="rounded-r-sm">
            Direct chat
          </Button>
        </div>
      </div>
      <dl className="mx-sp-7 mt-sp-6 grid gap-2 rounded-r-md border border-line-soft bg-surface-1 p-sp-5 shadow-elev-1">
        {panels.map((panel) => (
          <div key={panel.title} className="flex gap-sp-4">
            <dt className="w-workspace-detail-label shrink-0 text-fs-meta font-semibold uppercase tracking-wide text-ink-4">
              {panel.kicker}
            </dt>
            <dd className="m-0 min-w-0 flex-1 text-fs-sm text-ink-2">{panel.body}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function WorkspaceAgendaSurface({
  app,
  activeProject,
  pendingApprovals,
}: {
  app: 'calendar' | 'meetings';
  activeProject: ProjectRow | null;
  pendingApprovals: number;
}) {
  const title = app === 'calendar' ? 'This week' : 'Meeting room';
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-1">
      <div className="flex items-center gap-sp-4 border-b border-line-soft px-sp-7 py-sp-5">
        <h2 className="text-fs-lg font-bold text-ink-1">{title}</h2>
        <div className="inline-flex h-8 items-center gap-0.5 rounded-r-md border border-line bg-surface-2 p-1 shadow-elev-1">
          <SurfaceFilter active label="Agenda" />
          <SurfaceFilter label="Week" />
        </div>
        <span className="ml-auto rounded-r-pill border border-line-soft bg-surface-sunken px-3 py-1 text-fs-meta font-semibold text-ink-3">
          {activeProject?.name ?? 'No project selected'}
        </span>
      </div>
      <div className="grid-workspace-agenda grid min-h-0 flex-1 gap-sp-7 overflow-y-auto bg-surface-2 px-sp-7 py-sp-6">
        <div className="flex flex-col gap-sp-5">
          {[
            ['Today', 'Q3 Launch standup', '09:30 · daily ceremony', 'bg-accent'],
            ['Today', 'Attachment pipeline run', '11:00 · live run', 'bg-violet'],
            ['Tomorrow', 'Design review', '14:00 · Sophie, Marcus', 'bg-success'],
            ['Monday', 'Weekly retro run', '10:00 · auto-scheduled SOP', 'bg-warn'],
          ].map(([day, eventTitle, meta, tone]) => (
            <div
              key={`${day}-${eventTitle}`}
              className="flex gap-sp-4 rounded-r-md border border-line-soft bg-surface-1 p-sp-4 shadow-elev-1"
            >
              <span className="w-workspace-agenda-day shrink-0 text-fs-meta font-bold uppercase tracking-wide text-ink-4">
                {day}
              </span>
              <span className={cn('w-1 rounded-r-pill', tone)} />
              <span className="min-w-0">
                <span className="block truncate text-fs-sm font-semibold text-ink-1">
                  {eventTitle}
                </span>
                <span className="mt-0.5 block text-fs-meta text-ink-3">{meta}</span>
              </span>
            </div>
          ))}
        </div>
        <aside className="self-start overflow-hidden rounded-r-lg border border-line-soft bg-surface-1 shadow-elev-1">
          <div className="border-b border-line-soft p-sp-5">
            <h3 className="text-fs-md font-bold text-ink-1">Q3 Launch standup</h3>
            <p className="mt-1 text-fs-meta text-ink-4">Today 09:30 · 4 attendees · ended</p>
          </div>
          <div className="flex flex-col gap-sp-3 p-sp-5">
            <div className="text-fs-micro font-bold uppercase tracking-wide text-ink-3">
              Action items <span className="font-mono">4</span>
            </div>
            {[
              ['done', 'Provision the harness sandbox'],
              ['todo', 'Review parser boundary cases'],
              ['todo', 'Draft pitch deck v2'],
              ['todo', `${pendingApprovals} approval gates waiting`],
            ].map(([state, text]) => (
              <div key={text} className="flex items-center gap-sp-3 text-fs-sm text-ink-2">
                <span
                  className={cn(
                    'grid size-4 place-items-center rounded-r-xs border border-line-soft',
                    state === 'done' && 'border-success bg-success text-accent-fg',
                  )}
                >
                  {state === 'done' ? <Check className="size-3" aria-hidden="true" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{text}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function WorkspaceHomeSurface({
  activeProject,
  pendingApprovals,
  onSelectApp,
  onOpenSettings,
}: {
  activeProject: ProjectRow | null;
  pendingApprovals: number;
  onSelectApp: (app: WorkspaceAppKey) => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="min-h-0 overflow-y-auto bg-surface-2 px-sp-7 py-sp-6">
      <section className="rounded-r-lg border border-line-soft bg-surface-1 p-sp-7 shadow-elev-1">
        <h2 className="text-fs-xl font-bold text-ink-1">Good afternoon</h2>
        <p className="mt-1 text-fs-sm text-ink-3">
          {activeProject?.name ?? 'No project selected'} · company OS control surface
        </p>
        <div className="grid-workspace-home-stats mt-sp-6 grid gap-sp-3">
          {[
            ['To approve', String(pendingApprovals)],
            ['Live runs', '1'],
            ['Docs', '14'],
            ['Spend today', '$0.00'],
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
          ['Office', 'Watch the team collaborate in 3D', BriefcaseBusiness],
          ['SOPs', 'Reusable process DAGs', Activity],
          ['Market', 'Install skills, employees and templates', Store],
          ['Personnel', 'Hire, edit and tune employees', Users, onOpenSettings],
          ['Studio', 'Edit the office layout', Grid2X2, onOpenSettings],
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
      { title: 'Alex Chen', detail: 'Developer · Engineering · working now', meta: 'busy' },
      { title: 'Maya Lin', detail: 'DevOps · Engineering · idle', meta: 'idle' },
      { title: 'Sophie Park', detail: 'Writer · Design · offline', meta: 'off' },
      { title: 'OpenClaw', detail: 'A2A render partner · external brand', meta: 'ext' },
    ];
  }
  if (app === 'workplace') {
    return [
      { title: 'Company hub', detail: 'Posts, notices, and activity', meta: 'company' },
      ...shared,
    ];
  }
  return [
    { title: 'Q3 Roadmap Outline', detail: 'Maya · Alex +2 · just now', meta: 'docx' },
    { title: 'Fixture Verification Report', detail: 'Marcus · Maya · 1h ago', meta: 'md' },
    { title: 'Launch metrics', detail: 'Sophie · 3h ago', meta: 'csv' },
    { title: 'Pitch deck v2', detail: `${project} · produced by the team`, meta: 'pptx' },
    { title: 'DevOps runbook', detail: 'Maya · onboarding', meta: 'pdf' },
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
