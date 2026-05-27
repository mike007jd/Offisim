import { type SurfaceKey, type WorkspaceApp, useUiState } from '@/app/ui-state.js';
import { useCompanies, useEmployees, useProjects, useRunCost } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import {
  Building2,
  CalendarDays,
  CheckSquare,
  ClipboardList,
  type LucideIcon,
  MessageSquare,
  SquarePen,
  Store,
  Users,
} from 'lucide-react';
import { useWsApprovals, useWsMeetings } from '../workspace-data.js';

type Tone = 'accent' | 'violet' | 'ok' | 'warn' | 'ink';

interface Tile {
  key: string;
  icon: LucideIcon;
  tone: Tone;
  name: string;
  desc: string;
  badge?: { label: string; tone?: 'accent' | 'warn' };
  go: () => void;
}

export function WorkplaceApp() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const setSurface = useUiState((s) => s.setSurface);
  const setApp = useUiState((s) => s.setWorkspaceApp);
  const companies = useCompanies();
  const projects = useProjects(companyId);
  const employees = useEmployees();
  const approvals = useWsApprovals();
  const meetings = useWsMeetings();
  const runCost = useRunCost();

  const company = companies.data?.find((c) => c.id === companyId) ?? null;
  const project = projects.data?.find((p) => p.id === projectId) ?? projects.data?.[0] ?? null;
  const headcount = employees.data?.length ?? 0;
  const workingNow = employees.data?.filter((e) => e.presence === 'working').length ?? 0;
  const toApprove = approvals.data?.filter((a) => a.status === 'pending').length ?? 0;
  const activeRuns = meetings.data?.filter((m) => m.status === 'live').length ?? 1;
  const spend = runCost.data?.costLabel ?? '$0.00';

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const stats = [
    { label: 'To approve', value: String(toApprove), alert: toApprove > 0 },
    { label: 'Active runs', value: String(activeRuns), alert: false },
    { label: 'Spend today', value: spend, alert: false },
  ];

  function goApp(app: WorkspaceApp) {
    setApp(app);
  }
  function goSurface(surface: SurfaceKey) {
    setSurface(surface);
  }

  const suiteTiles: Tile[] = [
    {
      key: 'messenger',
      icon: MessageSquare,
      tone: 'accent',
      name: 'Messenger',
      desc: 'Group & direct chats with your team',
      badge: { label: `${(employees.data?.length ?? 0) > 0 ? 12 : 0} unread`, tone: 'accent' },
      go: () => goApp('messenger'),
    },
    {
      key: 'approvals',
      icon: ClipboardList,
      tone: 'warn',
      name: 'Approvals',
      desc: 'Human-in-loop gates waiting on you',
      badge: toApprove > 0 ? { label: `${toApprove} to do`, tone: 'warn' } : undefined,
      go: () => goApp('approvals'),
    },
    {
      key: 'calendar',
      icon: CalendarDays,
      tone: 'accent',
      name: 'Calendar',
      desc: 'Meetings, ceremonies & deadlines',
      go: () => goApp('calendar'),
    },
    {
      key: 'contacts',
      icon: Users,
      tone: 'violet',
      name: 'Contacts',
      desc: 'The company directory',
      go: () => goApp('contacts'),
    },
  ];

  const workspaceTiles: Tile[] = [
    {
      key: 'office',
      icon: Building2,
      tone: 'accent',
      name: 'Office',
      desc: 'Watch the team collaborate in 3D',
      go: () => goSurface('office'),
    },
    {
      key: 'market',
      icon: Store,
      tone: 'ok',
      name: 'Market',
      desc: 'Install skills, employees & templates',
      go: () => goSurface('market'),
    },
    {
      key: 'personnel',
      icon: Users,
      tone: 'ink',
      name: 'Personnel',
      desc: 'Hire, edit & tune employees',
      go: () => goSurface('personnel'),
    },
    {
      key: 'studio',
      icon: SquarePen,
      tone: 'ink',
      name: 'Studio',
      desc: 'Edit the office layout',
      go: () => goSurface('studio'),
    },
  ];

  const recent = [
    {
      id: 'r1',
      level: 'success' as const,
      icon: CheckSquare,
      text: 'Orion produced “Fixture Verification Report” in Relay Launch · Team',
      time: '1m',
    },
    {
      id: 'r2',
      level: 'warning' as const,
      icon: ClipboardList,
      text: 'Mara requested approval — bash outside workspace root',
      time: '2m',
    },
    {
      id: 'r3',
      level: 'info' as const,
      icon: Store,
      text: 'Installed skill “PDF Table Extractor”',
      time: '13m',
    },
  ];

  function TileGrid({ tiles }: { tiles: Tile[] }) {
    return (
      <div className="off-ws-wp-tiles">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            className="off-ws-wp-tile off-focusable"
            onClick={tile.go}
          >
            <span className={cn('off-ws-wp-tile-ic', `is-${tile.tone}`)}>
              <Icon icon={tile.icon} size="md" />
            </span>
            <span className="off-ws-wp-tile-nm">{tile.name}</span>
            <span className="off-ws-wp-tile-ds">{tile.desc}</span>
            {tile.badge ? (
              <span className={cn('off-ws-wp-tile-nb', tile.badge.tone === 'warn' && 'is-warn')}>
                {tile.badge.label}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="off-ws-detail off-ws-detail-full">
      <div className="off-ws-wp">
        <div className="off-ws-wp-hero">
          <div className="off-ws-wp-hi">
            {greeting}
            <span className="off-ws-wp-hi-sub">
              {company?.name ?? 'Company'} · {project?.name ?? 'Project'} · {headcount} employees,{' '}
              {workingNow} working now
            </span>
          </div>
          <div className="off-ws-wp-stats">
            {stats.map((s) => (
              <div key={s.label} className={cn('off-ws-wp-stat', s.alert && 'is-alert')}>
                <div className="off-ws-wp-stat-v">{s.value}</div>
                <div className="off-ws-wp-stat-k">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="off-ws-wp-sec-h">Suite apps</div>
        <TileGrid tiles={suiteTiles} />

        <div className="off-ws-wp-sec-h">Workspaces</div>
        <TileGrid tiles={workspaceTiles} />

        <div className="off-ws-wp-sec-h">Recent</div>
        <div className="off-ws-act-entries off-ws-wp-recent">
          {recent.map((r) => (
            <div key={r.id} className={cn('off-ws-act-entry', `is-${r.level}`)}>
              <Icon icon={r.icon} size="sm" />
              <span>{r.text}</span>
              <span className="off-ws-act-x">{r.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
