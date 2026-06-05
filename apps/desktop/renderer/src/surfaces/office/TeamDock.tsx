import { useUiState } from '@/app/ui-state.js';
import { reposOrNull } from '@/data/adapters.js';
import {
  useEmployees,
  useMessages,
  useOfficeLayout,
  useReassignEmployee,
  useThreads,
  useUpdateEmployeeEnabled,
} from '@/data/queries.js';
import type { ChatThread, Employee, EmployeePresence, RunState } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/design-system/primitives/popover.js';
import { cn } from '@/lib/utils.js';
import { useEmployeeMemories } from '@/surfaces/personnel/personnel-data.js';
import { generateId } from '@offisim/core/browser';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronUp,
  ListChecks,
  MapPin,
  MessageSquare,
  Power,
  Search,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

const PRESENCE_CLS: Record<EmployeePresence, string> = {
  working: 'is-running',
  idle: '',
  blocked: 'is-blocked',
  failed: 'is-failed',
  offline: 'is-offline',
};

const PRESENCE_TEXT: Record<EmployeePresence, string> = {
  working: 'Working',
  idle: 'Idle',
  blocked: 'Blocked',
  failed: 'Failed',
  offline: 'Offline',
};

type TeamSortMode = 'seat' | 'name' | 'presence';

const PRESENCE_SORT_ORDER: Record<EmployeePresence, number> = {
  working: 0,
  blocked: 1,
  failed: 2,
  idle: 3,
  offline: 4,
};

const RUN_STATE_TEXT: Record<RunState, string> = {
  idle: 'Idle',
  running: 'Running',
  paused: 'Paused',
  error: 'Blocked',
  done: 'Done',
};

interface TeamZoneOption {
  id: string;
  label: string;
}

function presenceFor(employee: Employee, running: boolean): EmployeePresence {
  if (running) return 'working';
  return employee.presence ?? (employee.online ? 'idle' : 'offline');
}

function EmployeeDockPopover({
  employee,
  presence,
  thread,
  zones,
  currentZoneId,
  currentZoneLabel,
  onOpenThread,
  onViewProfile,
  onAssignZone,
  onToggleEnabled,
  messaging,
  assigning,
  toggling,
}: {
  employee: Employee;
  presence: EmployeePresence;
  thread: ChatThread | null;
  zones: TeamZoneOption[];
  currentZoneId: string | null;
  currentZoneLabel: string | null;
  onOpenThread: () => void;
  onViewProfile: () => void;
  onAssignZone: (zoneId: string) => void;
  onToggleEnabled: () => void;
  messaging: boolean;
  assigning: boolean;
  toggling: boolean;
}) {
  const messages = useMessages(thread?.id ?? null);
  const memories = useEmployeeMemories(employee.id);
  const capabilitySummary = [
    employee.modelLabel,
    `${employee.skillCount} skills`,
    employee.kind === 'external' ? (employee.brandLabel ?? 'External') : employee.discipline,
  ]
    .filter(Boolean)
    .join(' · ');
  const latestRun = useMemo(
    () =>
      [...(messages.data ?? [])].reverse().find((message) => message.runRecord)?.runRecord ?? null,
    [messages.data],
  );
  const runSteps = latestRun?.steps ?? [];
  const activeStep = runSteps.find((step) => step.state === 'running' || step.state === 'error');
  const completedSteps = runSteps.filter((step) => step.state === 'done').length;
  const topMemories = useMemo(
    () => [...(memories.data ?? [])].sort((a, b) => b.importance - a.importance).slice(0, 2),
    [memories.data],
  );
  const focusTitle =
    thread?.title ?? (presence === 'working' ? 'Active assignment' : 'Ready for assignment');
  const focusMeta = thread
    ? `${RUN_STATE_TEXT[thread.runState]} · ${thread.subtitle}`
    : PRESENCE_TEXT[presence];

  return (
    <div className="off-team-pop">
      <header className="off-team-pop-head">
        <EmployeeAvatar
          seed={employee.id}
          appearance={employee.appearance}
          colorA={employee.avatarA}
          colorB={employee.avatarB}
          size={42}
          brand={employee.kind === 'external'}
        />
        <span className="off-team-pop-id">
          <b>{employee.name}</b>
          <span>{employee.role}</span>
        </span>
        <span className={cn('off-team-status', PRESENCE_CLS[presence])}>
          <span className="off-team-dot" />
          {PRESENCE_TEXT[presence]}
        </span>
      </header>
      <dl className="off-team-pop-meta">
        <div>
          <dt>Seat</dt>
          <dd>
            {[currentZoneLabel ?? employee.zoneLabel, employee.deskLabel]
              .filter(Boolean)
              .join(' · ') || 'Unassigned'}
          </dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{capabilitySummary}</dd>
        </div>
      </dl>
      <section className="off-team-pop-section">
        <span className="off-team-pop-section-title">
          <Icon icon={ListChecks} size="sm" />
          Current focus
        </span>
        <p className="off-team-pop-focus">{focusTitle}</p>
        <p className="off-team-pop-sub">{activeStep?.label ?? focusMeta}</p>
        {runSteps.length > 0 ? (
          <div className="off-team-pop-progress" aria-label="Run progress">
            <span>
              {completedSteps}/{runSteps.length} steps
            </span>
            <span>{latestRun?.costLabel}</span>
          </div>
        ) : null}
      </section>
      <section className="off-team-pop-section">
        <span className="off-team-pop-section-title">
          <Icon icon={Sparkles} size="sm" />
          Memory
        </span>
        {memories.isLoading ? (
          <p className="off-team-pop-sub">Loading memory…</p>
        ) : topMemories.length > 0 ? (
          <ul className="off-team-pop-memory">
            {topMemories.map((memory) => (
              <li key={memory.id}>{memory.content}</li>
            ))}
          </ul>
        ) : (
          <p className="off-team-pop-sub">No employee memory yet.</p>
        )}
      </section>
      <div className="off-team-pop-actions">
        <Button size="sm" variant="outline" disabled={messaging} onClick={onOpenThread}>
          <Icon icon={MessageSquare} size="sm" />
          Message
        </Button>
        <Button size="sm" variant="outline" onClick={onViewProfile}>
          <Icon icon={UserRound} size="sm" />
          Profile
        </Button>
        <Button size="sm" variant="subtle" disabled={toggling} onClick={onToggleEnabled}>
          <Icon icon={Power} size="sm" />
          {employee.disabled ? 'Enable' : 'Disable'}
        </Button>
      </div>
      <div className="off-team-zone-picker" aria-label="Move employee">
        <span className="off-team-zone-title">
          <Icon icon={MapPin} size="sm" />
          Move
        </span>
        <div className="off-team-zone-grid">
          {zones.map((zone) => (
            <Button
              key={zone.id}
              size="sm"
              variant={zone.id === currentZoneId ? 'accentSoft' : 'outline'}
              disabled={assigning}
              onClick={() => onAssignZone(zone.id)}
            >
              {zone.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TeamDock() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openThread = useUiState((s) => s.openThread);
  const setSurface = useUiState((s) => s.setSurface);
  const selectEmployee = useUiState((s) => s.selectEmployee);
  const queryClient = useQueryClient();
  const employees = useEmployees();
  const threads = useThreads(projectId);
  const layout = useOfficeLayout(companyId);
  const assignZone = useReassignEmployee();
  const updateEnabled = useUpdateEmployeeEnabled();
  const directThread = useMutation({
    mutationFn: async (employee: Employee) => {
      if (!projectId) throw new Error('Select a project before messaging an employee.');
      const currentThreads = queryClient.getQueryData<ChatThread[]>(['threads', projectId]);
      const existing = currentThreads?.find((thread) => thread.employeeId === employee.id);
      if (existing) return existing.id;

      const repos = await reposOrNull();
      if (!repos) throw new Error('Employee messaging requires the desktop runtime.');
      const row = await repos.chatThreads.create({
        thread_id: generateId('thread'),
        project_id: projectId,
        employee_id: employee.id,
        title: `Chat with ${employee.name}`,
      });
      await queryClient.invalidateQueries({ queryKey: ['threads', projectId] });
      return row.thread_id;
    },
    onSuccess: (threadId) => {
      openThread(threadId);
      toast.success('Employee thread opened');
    },
    onError: (error) => {
      toast.error('Employee thread failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showWorkingOnly, setShowWorkingOnly] = useState(false);
  const [sortMode, setSortMode] = useState<TeamSortMode>('seat');

  const runningEmployeeIds = useMemo(
    () =>
      new Set(
        (threads.data ?? [])
          .filter((thread) => thread.runState === 'running' && thread.employeeId)
          .map((thread) => thread.employeeId as string),
      ),
    [threads.data],
  );
  const roster = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (employees.data ?? []).filter((employee) => {
      const matchesQuery =
        !q ||
        employee.name.toLowerCase().includes(q) ||
        employee.role.toLowerCase().includes(q) ||
        employee.discipline.toLowerCase().includes(q);
      if (!matchesQuery) return false;
      if (!showWorkingOnly) return true;
      return presenceFor(employee, runningEmployeeIds.has(employee.id)) === 'working';
    });
    if (sortMode === 'name') {
      return [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sortMode === 'presence') {
      return [...list].sort((a, b) => {
        const presenceA = presenceFor(a, runningEmployeeIds.has(a.id));
        const presenceB = presenceFor(b, runningEmployeeIds.has(b.id));
        return PRESENCE_SORT_ORDER[presenceA] - PRESENCE_SORT_ORDER[presenceB];
      });
    }
    return list;
  }, [employees.data, query, runningEmployeeIds, showWorkingOnly, sortMode]);
  const zones = useMemo<TeamZoneOption[]>(
    () =>
      (layout.data?.zones ?? []).map((zone) => ({
        id: zone.zone_id,
        label: zone.label,
      })),
    [layout.data?.zones],
  );

  // Search / filter / sort are noise for a handful of people; only surface the
  // list-options control once the roster is large enough to need it.
  const rosterSize = employees.data?.length ?? 0;
  const showListControls = rosterSize > 6;

  return (
    <div className={cn('off-team', collapsed && 'is-collapsed')} aria-label="Team">
      <div className="off-dock-label">
        <span className="off-dock-title">Team</span>
        <span className="off-dock-count">{rosterSize} people</span>
      </div>

      <div className="off-dock-strip">
        {roster.map((employee) => {
          const thread = threads.data?.find((t) => t.employeeId === employee.id);
          const running = thread?.runState === 'running';
          const active = Boolean(thread && thread.id === selectedThreadId);
          const presence = presenceFor(employee, running);
          const currentZone = zones.find((zone) => zone.id === employee.workstationId) ?? null;
          return (
            <Popover key={employee.id}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn('off-team-card off-focusable', active && 'is-active')}
                >
                  <EmployeeAvatar
                    seed={employee.id}
                    appearance={employee.appearance}
                    colorA={employee.avatarA}
                    colorB={employee.avatarB}
                    size={36}
                    brand={employee.kind === 'external'}
                  />
                  <span className="off-team-info">
                    <span className="off-team-name">{employee.name}</span>
                    <span className="off-team-role">{employee.role}</span>
                    <span className={cn('off-team-status', PRESENCE_CLS[presence])}>
                      <span className="off-team-dot" />
                      {PRESENCE_TEXT[presence]}
                    </span>
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="off-team-popover">
                <EmployeeDockPopover
                  employee={employee}
                  presence={presence}
                  thread={thread ?? null}
                  zones={zones}
                  currentZoneId={employee.workstationId ?? null}
                  currentZoneLabel={currentZone?.label ?? null}
                  onOpenThread={() => {
                    directThread.mutate(employee);
                  }}
                  onViewProfile={() => {
                    selectEmployee(employee.id);
                    setSurface('personnel');
                  }}
                  onAssignZone={(zoneId) => {
                    assignZone.mutate({ employeeId: employee.id, zoneId });
                  }}
                  onToggleEnabled={() => {
                    updateEnabled.mutate({
                      employeeId: employee.id,
                      enabled: Boolean(employee.disabled),
                    });
                  }}
                  assigning={
                    assignZone.isPending && assignZone.variables?.employeeId === employee.id
                  }
                  toggling={
                    updateEnabled.isPending && updateEnabled.variables?.employeeId === employee.id
                  }
                  messaging={directThread.isPending && directThread.variables?.id === employee.id}
                />
              </PopoverContent>
            </Popover>
          );
        })}
        <button
          type="button"
          className="off-team-add off-focusable"
          onClick={() => setSurface('personnel')}
          aria-label="Hire employee"
        >
          <Icon icon={UserPlus} size="md" />
          <span>Hire</span>
        </button>
      </div>

      <div className="off-dock-tools">
        {showListControls ? (
          <>
            {showSearch ? (
              <input
                className="off-dock-search"
                value={query}
                placeholder="Search team…"
                onChange={(e) => setQuery(e.target.value)}
                // biome-ignore lint/a11y/noAutofocus: opens on explicit user action
                autoFocus
                onBlur={() => !query && setShowSearch(false)}
              />
            ) : (
              <IconButton
                icon={Search}
                label="Search team"
                size="iconSm"
                onClick={() => setShowSearch(true)}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={showWorkingOnly || sortMode !== 'seat' ? 'subtle' : 'ghost'}
                  size="iconSm"
                  aria-label="List options"
                >
                  <Icon icon={SlidersHorizontal} size="sm" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuCheckboxItem
                  checked={showWorkingOnly}
                  onCheckedChange={(value) => setShowWorkingOnly(Boolean(value))}
                >
                  Working only
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={sortMode}
                  onValueChange={(value) => setSortMode(value as TeamSortMode)}
                >
                  <DropdownMenuRadioItem value="seat">Seat</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="presence">Presence</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
        <IconButton
          icon={collapsed ? ChevronUp : ChevronDown}
          label={collapsed ? 'Expand dock' : 'Collapse dock'}
          size="iconSm"
          onClick={() => setCollapsed((v) => !v)}
        />
      </div>
    </div>
  );
}
