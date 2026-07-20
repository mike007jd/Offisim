import { useUiState } from '@/app/ui-state.js';
import {
  type AgentRuntimeModelOption,
  useAgentRuntimeModels,
} from '@/assistant/composer/usePiAgentModels.js';
import { SelectableCard } from '@/components/SelectableCard.js';
import { reposOrNull } from '@/data/adapters.js';
import { queryKeys } from '@/data/query-keys.js';
import {
  type ProjectChatThreadRow,
  loadProjectChatThreadRows,
  useEmployees,
  useMessages,
  useOfficeLayout,
  useReassignEmployee,
  useThreads,
  useUpdateEmployeeEnabled,
} from '@/data/queries.js';
import type { ChatThread, Employee, EmployeePresence } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Select } from '@/design-system/grammar/Select.js';
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
import { presenceFor } from '@/surfaces/office/employee-presence.js';
import {
  recordEmployeeVersionOnSave,
  useEmployeeMemories,
} from '@/surfaces/personnel/personnel-data.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronUp,
  ListChecks,
  ListFilter,
  MapPin,
  MessageSquare,
  Power,
  Search,
  Sparkles,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

const PRESENCE_CLS: Record<EmployeePresence, string> = {
  working: 'is-working',
  idle: 'is-idle',
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

interface TeamZoneOption {
  id: string;
  label: string;
}

interface EmployeeModelState {
  label: string;
  value: string;
  invalid: boolean;
}

function shortModelName(value: string): string {
  return value.split('/').at(-1) || value;
}

function employeeModelState(
  employee: Employee,
  models: readonly AgentRuntimeModelOption[] | undefined,
): EmployeeModelState {
  if (employee.kind === 'external') return { label: 'External', value: '', invalid: false };
  const value = employee.model?.trim() ?? '';
  if (!value) return { label: 'Conversation model', value: '', invalid: false };
  const option = models?.find((candidate) => candidate.value === value);
  return {
    label: option?.name ?? shortModelName(value),
    value,
    invalid: models !== undefined && !option,
  };
}

function companyModelSummary(
  employees: readonly Employee[],
  models: readonly AgentRuntimeModelOption[] | undefined,
): string {
  const counts = new Map<string, number>();
  for (const employee of employees) {
    const state = employeeModelState(employee, models);
    const label = state.invalid ? 'Conversation model' : state.label;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([labelA, countA], [labelB, countB]) => countB - countA || labelA.localeCompare(labelB))
    .slice(0, 3)
    .map(([label, count]) =>
      label === 'Conversation model'
        ? `${count} use conversation model`
        : label === 'External'
          ? `${count} external`
          : `${count} use ${label}`,
    )
    .join(' · ');
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
  models,
  modelsLoading,
  onModelChange,
  messaging,
  assigning,
  toggling,
  modelUpdating,
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
  models: readonly AgentRuntimeModelOption[] | undefined;
  modelsLoading: boolean;
  onModelChange: (model: string) => void;
  messaging: boolean;
  assigning: boolean;
  toggling: boolean;
  modelUpdating: boolean;
}) {
  const messages = useMessages(thread?.id ?? null);
  const memories = useEmployeeMemories(employee.id);
  const modelState = employeeModelState(employee, models);
  const capabilitySummary = [
    employee.model ? (modelState.invalid ? 'Saved model unavailable' : modelState.label) : null,
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
    ? `${PRESENCE_TEXT[presence]} · ${thread.subtitle}`
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
          <dt>Work setup</dt>
          <dd>{capabilitySummary}</dd>
        </div>
      </dl>
      {employee.kind === 'internal' ? (
        <section className="off-team-pop-section">
          <span className="off-team-pop-section-title">Model for new work</span>
          <Select
            value={modelState.value}
            onChange={(event) => onModelChange(event.target.value)}
            disabled={modelsLoading || models === undefined || modelUpdating}
            aria-label={`Model for new work by ${employee.name}`}
            className="w-full"
            options={[
              { value: '', label: 'Follow the conversation model' },
              ...(modelState.invalid && employee.model
                ? [
                    {
                      value: employee.model,
                      label: `Unavailable · ${shortModelName(employee.model)}`,
                    },
                  ]
                : []),
              ...(models ?? []).map((option) => ({
                value: option.value,
                label: `${option.accountName} · ${option.name}`,
              })),
            ]}
          />
          {modelState.invalid ? (
            <p className="off-team-pop-sub">
              The saved model is unavailable. New work follows the conversation model.
            </p>
          ) : null}
        </section>
      ) : null}
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="off-team-zone-trigger"
            disabled={assigning || zones.length === 0}
            aria-label="Move employee"
          >
            <span className="off-team-zone-title">
              <Icon icon={MapPin} size="sm" />
              Move to
            </span>
            <span className="off-team-zone-current">{currentZoneLabel ?? 'Unassigned'}</span>
            <Icon icon={ChevronDown} size="sm" className="off-team-zone-caret" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6}>
          <DropdownMenuLabel>Move to zone</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={currentZoneId ?? ''}
            onValueChange={(zoneId) => onAssignZone(zoneId)}
          >
            {zones.map((zone) => (
              <DropdownMenuRadioItem key={zone.id} value={zone.id}>
                {zone.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function TeamDock() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openThread = useUiState((s) => s.openThread);
  const openDraftThread = useUiState((s) => s.openDraftThread);
  const setSurface = useUiState((s) => s.setSurface);
  const requestHire = useUiState((s) => s.requestHire);
  const selectEmployee = useUiState((s) => s.selectEmployee);
  const queryClient = useQueryClient();
  const employees = useEmployees();
  const models = useAgentRuntimeModels();
  const threads = useThreads(projectId);
  const layout = useOfficeLayout(companyId);
  const assignZone = useReassignEmployee();
  const updateEnabled = useUpdateEmployeeEnabled();
  const updateModel = useMutation({
    mutationFn: async ({ employee, model }: { employee: Employee; model: string }) => {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Changing an employee model requires the desktop runtime');
      const row = await repos.employees.findById(employee.id);
      if (!row) throw new Error('Employee no longer exists');
      const option = models.data?.find((candidate) => candidate.value === model);
      if (model && !option) throw new Error('Selected model is no longer available');
      const thinkingLevel = model && option?.reasoning ? row.thinking_level : null;
      await recordEmployeeVersionOnSave({
        repos,
        employeeId: employee.id,
        performUpdate: () =>
          repos.employees.update(employee.id, {
            model: model || null,
            thinking_level: thinkingLevel,
          }),
      });
      return { employee, model, thinkingLevel };
    },
    onSuccess: ({ employee, model, thinkingLevel }) => {
      queryClient.setQueryData<Employee[]>(queryKeys.employees(companyId), (current) =>
        current?.map((candidate) =>
          candidate.id === employee.id
            ? { ...candidate, model: model || null, thinkingLevel }
            : candidate,
        ),
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.employees(companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.employeeVersions(employee.id) });
      toast.success(`${employee.name} model updated`);
    },
    onError: (error) => {
      toast.error('Could not update employee model', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });
  const directThread = useMutation({
    mutationFn: async (
      employee: Employee,
    ): Promise<{ kind: 'existing'; threadId: string } | { kind: 'draft'; employeeId: string }> => {
      if (!projectId) throw new Error('Select a project before messaging an employee.');
      const existingThread = threads.data?.find((thread) => thread.employeeId === employee.id);
      if (existingThread) return { kind: 'existing', threadId: existingThread.id };
      const cachedRows = queryClient.getQueryData<ProjectChatThreadRow[]>(
        queryKeys.threads(projectId),
      );
      const cachedExisting = cachedRows?.find((thread) => thread.employee_id === employee.id);
      if (cachedExisting) return { kind: 'existing', threadId: cachedExisting.thread_id };
      const currentRows = await queryClient.fetchQuery({
        queryKey: queryKeys.threads(projectId),
        queryFn: () => loadProjectChatThreadRows(projectId),
        staleTime: 5_000,
      });
      const existing = currentRows.find((thread) => thread.employee_id === employee.id);
      if (existing) return { kind: 'existing', threadId: existing.thread_id };

      // No thread for this employee yet — open a draft instead of inserting an
      // empty row. The "Chat with …" row is materialized from the first message.
      return { kind: 'draft', employeeId: employee.id };
    },
    onSuccess: (result) => {
      if (result.kind === 'existing') openThread(result.threadId);
      else openDraftThread(result.employeeId);
    },
    onError: (error) => {
      toast.error('Could not open the conversation', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showWorkingOnly, setShowWorkingOnly] = useState(false);
  const [sortMode, setSortMode] = useState<TeamSortMode>('seat');

  const threadByEmployee = useMemo(() => {
    const map = new Map<string, ChatThread>();
    for (const thread of threads.data ?? []) {
      if (thread.employeeId && !map.has(thread.employeeId)) map.set(thread.employeeId, thread);
    }
    return map;
  }, [threads.data]);
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
      return presenceFor(employee, threadByEmployee.get(employee.id)) === 'working';
    });
    if (sortMode === 'name') {
      return [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (sortMode === 'presence') {
      return [...list].sort((a, b) => {
        const presenceA = presenceFor(a, threadByEmployee.get(a.id));
        const presenceB = presenceFor(b, threadByEmployee.get(b.id));
        return PRESENCE_SORT_ORDER[presenceA] - PRESENCE_SORT_ORDER[presenceB];
      });
    }
    return list;
  }, [employees.data, query, showWorkingOnly, sortMode, threadByEmployee]);
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
  const modelSummary = companyModelSummary(employees.data ?? [], models.data);

  return (
    <div className={cn('off-team relative', collapsed && 'is-collapsed')} aria-label="Team">
      <div className="off-dock-label">
        <span className="off-dock-title">Team</span>
        <span className="off-dock-count">
          {rosterSize} people{modelSummary ? ` · ${modelSummary}` : ''}
        </span>
      </div>

      <div className="off-dock-strip">
        {roster.map((employee) => {
          const thread = threadByEmployee.get(employee.id);
          const active = Boolean(thread && thread.id === selectedThreadId);
          const presence = presenceFor(employee, thread);
          const modelState = employeeModelState(employee, models.data);
          const currentZone = zones.find((zone) => zone.id === employee.workstationId) ?? null;
          return (
            <Popover key={employee.id}>
              <PopoverTrigger asChild>
                <SelectableCard
                  type="button"
                  selected={active}
                  selectedClassName="is-active"
                  className="off-team-card off-focusable"
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
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="off-team-role min-w-0">{employee.role}</span>
                      {employee.model ? (
                        <span
                          className={cn(
                            'max-w-24 shrink-0 truncate rounded-[var(--off-radius-status)] border border-[var(--off-line-soft)] bg-[var(--off-surface-sunken)] px-1.5 py-px font-mono text-xs leading-none text-[var(--off-ink-3)]',
                            modelState.invalid && 'text-[var(--off-warn)]',
                          )}
                          title={
                            modelState.invalid
                              ? 'Saved model unavailable; following the conversation model'
                              : modelState.label
                          }
                        >
                          {modelState.invalid ? 'Model unavailable' : modelState.label}
                        </span>
                      ) : null}
                    </span>
                    <span className={cn('off-team-status', PRESENCE_CLS[presence])}>
                      <span className="off-team-dot" />
                      {PRESENCE_TEXT[presence]}
                    </span>
                  </span>
                </SelectableCard>
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
                  models={models.data}
                  modelsLoading={models.isLoading}
                  onModelChange={(model) => updateModel.mutate({ employee, model })}
                  assigning={
                    assignZone.isPending && assignZone.variables?.employeeId === employee.id
                  }
                  toggling={
                    updateEnabled.isPending && updateEnabled.variables?.employeeId === employee.id
                  }
                  modelUpdating={
                    updateModel.isPending && updateModel.variables?.employee.id === employee.id
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
          onClick={requestHire}
          aria-label="Hire employee"
        >
          <Icon icon={UserPlus} size="md" />
          <span>Hire</span>
        </button>
      </div>

      <div className="off-dock-tools items-start pt-3">
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
                  aria-label="Filter and sort"
                >
                  <Icon icon={ListFilter} size="sm" />
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
