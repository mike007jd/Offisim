import { useUiState } from '@/app/ui-state.js';
import { useEmployees } from '@/data/queries.js';
import type { Employee, EmployeePresence } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { cn } from '@/lib/utils.js';
import { EmptyState, ErrorState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  PanelLeftClose,
  PanelLeftOpen,
  SearchX,
  Store,
  UserPlus,
  UsersRound,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { toast } from 'sonner';
import { AppearanceTab } from './AppearanceTab.js';
import { HistoryTab } from './HistoryTab.js';
import { MemoryTab } from './MemoryTab.js';
import { ProfileTab } from './ProfileTab.js';
import { RuntimeTab } from './RuntimeTab.js';
import { SkillsTab } from './SkillsTab.js';
import {
  type AppearanceDraft,
  type ProfileFormValues,
  type ToolPermissions,
  appearanceDraftFor,
  defaultToolPermissions,
  profileDefaults,
  profileFormSchema,
} from './personnel-data.js';

const INSPECTOR_TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'runtime', label: 'Runtime' },
  { key: 'skills', label: 'Skills' },
  { key: 'memory', label: 'Memory' },
  { key: 'history', label: 'History' },
] as const;
type InspectorTab = (typeof INSPECTOR_TABS)[number]['key'];

const LIVE_PILL: Record<Exclude<EmployeePresence, 'offline'>, { cls: string; label: string }> = {
  working: { cls: 'is-exec', label: 'executing' },
  idle: { cls: 'is-idle', label: 'idle' },
  blocked: { cls: 'is-block', label: 'blocked' },
  failed: { cls: 'is-fail', label: 'failed' },
};

function livePresence(employee: Employee): Exclude<EmployeePresence, 'offline'> {
  const presence = employee.presence ?? 'idle';
  if (presence === 'offline') return 'idle';
  return presence;
}

function RosterRow({
  employee,
  selected,
  collapsed,
  onSelect,
  onRetry,
}: {
  employee: Employee;
  selected: boolean;
  collapsed: boolean;
  onSelect: () => void;
  onRetry: () => void;
}) {
  const presence = livePresence(employee);
  const pill = LIVE_PILL[presence];
  return (
    <div className={cn('off-pers-emp-wrap', selected && 'is-sel')}>
      <button
        type="button"
        className={cn('off-pers-emp off-focusable', selected && 'is-sel')}
        title={collapsed ? employee.name : undefined}
        onClick={onSelect}
      >
        <EmployeeAvatar
          seed={employee.id}
          appearance={employee.appearance}
          colorA={employee.avatarA}
          colorB={employee.avatarB}
          size={30}
          brand={employee.kind === 'external'}
        />
        <span className="off-pers-emp-info">
          <span className="off-pers-emp-name-row">
            <span className="off-pers-emp-name">{employee.name}</span>
            {employee.disabled ? <span className="off-pers-emp-dis">disabled</span> : null}
            <span className={cn('off-pers-lp', pill.cls)}>{pill.label}</span>
          </span>
          <span className="off-pers-emp-meta">
            <span className="off-pers-emp-role">{employee.role}</span>
            {employee.kind === 'external' && employee.brandLabel ? (
              <span className="off-pers-emp-brand">{employee.brandLabel}</span>
            ) : null}
          </span>
        </span>
      </button>
      {presence === 'failed' && !collapsed ? (
        <button type="button" className="off-pers-retry-chip off-focusable" onClick={onRetry}>
          <Icon icon={Zap} size="sm" />
          Retry
        </button>
      ) : null}
    </div>
  );
}

function RosterRail({
  employees,
  collapsed,
  onToggleCollapse,
  onHire,
}: {
  employees: Employee[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onHire: () => void;
}) {
  const selectedEmployeeId = useUiState((s) => s.selectedEmployeeId);
  const selectEmployee = useUiState((s) => s.selectEmployee);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');

  const roles = useMemo(() => Array.from(new Set(employees.map((e) => e.role))), [employees]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter(
      (e) => (role === 'all' || e.role === role) && (!q || e.name.toLowerCase().includes(q)),
    );
  }, [employees, query, role]);

  const hasFilters = query.trim().length > 0 || role !== 'all';
  const resetFilters = () => {
    setQuery('');
    setRole('all');
  };

  return (
    <>
      <div className="off-pers-rail-head">
        <div className="off-pers-srch-row">
          <IconButton
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={collapsed ? 'Expand personnel list' : 'Collapse personnel list'}
            variant="subtle"
            size="iconSm"
            onClick={onToggleCollapse}
          />
          {!collapsed ? (
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search employees…"
              className="flex-1"
            />
          ) : null}
          {!collapsed ? (
            <IconButton
              icon={UserPlus}
              label="Hire employee"
              variant="subtle"
              size="iconSm"
              onClick={onHire}
            />
          ) : null}
        </div>
        {!collapsed ? (
          <label className="off-pers-filter" htmlFor="off-pers-role-filter">
            <span className="off-pers-filter-label">Role filter</span>
            <Select
              id="off-pers-role-filter"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full"
              options={[
                { value: 'all', label: 'All roles' },
                ...roles.map((r) => ({ value: r, label: r })),
              ]}
            />
          </label>
        ) : null}
      </div>

      <div className="off-pers-list">
        {filtered.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No matching employees"
            description="Reset the search or role filter to broaden the list."
            action={hasFilters ? { label: 'Reset filters', onClick: resetFilters } : undefined}
          />
        ) : (
          filtered.map((employee) => (
            <RosterRow
              key={employee.id}
              employee={employee}
              selected={employee.id === selectedEmployeeId}
              collapsed={collapsed}
              onSelect={() => selectEmployee(employee.id)}
              onRetry={() => toast(`Retrying ${employee.name}…`)}
            />
          ))
        )}
      </div>
    </>
  );
}

function DetailHeader({ employee }: { employee: Employee }) {
  const roleLine = [employee.role, employee.zoneLabel, employee.deskLabel]
    .filter(Boolean)
    .join(' · ');
  return (
    <header className="off-pers-detail-head">
      <EmployeeAvatar
        seed={employee.id}
        appearance={employee.appearance}
        colorA={employee.avatarA}
        colorB={employee.avatarB}
        size={56}
        brand={employee.kind === 'external'}
      />
      <div className="off-pers-id">
        <h2 className="off-pers-name">{employee.name}</h2>
        <span className="off-pers-role">{roleLine}</span>
      </div>
      <div className="off-pers-detail-pills">
        {employee.kind === 'external' ? (
          <span className="off-pers-st-pill is-brand">{employee.brandLabel ?? 'Brand'}</span>
        ) : (
          <span className={cn('off-pers-st-pill', employee.disabled ? 'is-off' : 'is-on')}>
            {employee.disabled ? 'Disabled' : 'Enabled'}
          </span>
        )}
      </div>
    </header>
  );
}

/** Right inspector tabs + per-employee form/appearance/permission state.
 *  Keyed by employee id at the parent so this remounts (fresh state) on switch. */
function Inspector({
  employee,
  companyName,
  tab,
  onTabChange,
}: {
  employee: Employee;
  companyName: string;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
}) {
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: profileDefaults(employee),
    mode: 'onChange',
  });
  const [toolPermissions, setToolPermissions] = useState<ToolPermissions>(defaultToolPermissions());
  const [toolPermissionsDirty, setToolPermissionsDirty] = useState(false);
  const [appearance, setAppearance] = useState<AppearanceDraft>(appearanceDraftFor(employee));
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isDirty = form.formState.isDirty || toolPermissionsDirty;

  const onSave = () => {
    setIsSaving(true);
    setSaveError(null);
    window.setTimeout(() => {
      setIsSaving(false);
      form.reset(form.getValues());
      setToolPermissionsDirty(false);
      toast.success(`${employee.name} saved`);
    }, 320);
  };

  const onDelete = () => {
    toast.success(`${employee.name} removed`);
  };

  return (
    <>
      <div className="off-pers-insp-tabs" role="tablist" aria-label="Employee inspector">
        {INSPECTOR_TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            className={cn('off-pers-tab off-focusable', tab === entry.key && 'is-active')}
            onClick={() => onTabChange(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div className="off-pers-insp-body">
        {tab === 'profile' ? (
          <ProfileTab
            employee={employee}
            companyName={companyName}
            form={form}
            toolPermissions={toolPermissions}
            onToolPermissionsChange={(next) => {
              setToolPermissions(next);
              setToolPermissionsDirty(true);
            }}
            isDirty={isDirty}
            isSaving={isSaving}
            saveError={saveError}
            onSave={onSave}
            onDelete={onDelete}
          />
        ) : null}
        {tab === 'appearance' ? (
          <AppearanceTab employee={employee} draft={appearance} onChange={setAppearance} />
        ) : null}
        {tab === 'runtime' ? <RuntimeTab employee={employee} /> : null}
        {tab === 'skills' ? <SkillsTab employeeId={employee.id} /> : null}
        {tab === 'memory' ? <MemoryTab employeeId={employee.id} /> : null}
        {tab === 'history' ? <HistoryTab employeeId={employee.id} /> : null}
      </div>
    </>
  );
}

export function PersonnelSurface() {
  const employees = useEmployees();
  const companyId = useUiState((s) => s.companyId);
  const selectedEmployeeId = useUiState((s) => s.selectedEmployeeId);
  const collapsed = useUiState((s) => s.personnelRailCollapsed);
  const setCollapsed = useUiState((s) => s.setPersonnelRailCollapsed);
  const [tab, setTab] = useState<InspectorTab>('profile');
  const listPanelRef = usePanelRef();

  const roster = employees.data ?? [];
  const selected = roster.find((e) => e.id === selectedEmployeeId) ?? null;

  // Reset to Profile when the selected employee changes (tab is local).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on selection change only
  useEffect(() => {
    setTab('profile');
  }, [selectedEmployeeId]);

  const companyName = companyId.replace(/^co-/, '').replace(/(^|\s)\S/g, (s) => s.toUpperCase());

  const onToggleList = () => {
    if (collapsed) listPanelRef.current?.expand();
    else listPanelRef.current?.collapse();
  };

  const hire = () => toast('Hire flow opens the employee creator overlay.');

  // Loading — rail skeleton.
  if (employees.isLoading) {
    return (
      <div className="off-pers flex">
        <div className="off-pers-rail" style={{ width: 280 }}>
          <SkeletonRows rows={6} />
        </div>
      </div>
    );
  }

  // Error — page-level error in the roster column.
  if (employees.isError) {
    return (
      <div className="off-pers flex">
        <div className="off-pers-rail" style={{ width: 280 }}>
          <ErrorState
            title="Couldn't load employees"
            detail={
              employees.error instanceof Error
                ? employees.error.message
                : 'The roster could not be refreshed.'
            }
            onRetry={() => employees.refetch()}
          />
        </div>
      </div>
    );
  }

  // Empty roster — first-hire page state.
  if (roster.length === 0) {
    return (
      <div className="off-pers off-pers-empty-page">
        <div className="off-state">
          <span className="off-state-glyph">
            <Icon icon={UsersRound} size="md" />
          </span>
          <p className="off-state-title">Hire your first employee</p>
          <p className="off-state-desc">
            Build a roster of AI staff with their own persona, skills, memory, and runtime binding.
            Start from scratch or grab a vetted template from the marketplace.
          </p>
          <div className="off-pers-empty-actions">
            <Button size="sm" onClick={hire}>
              <Icon icon={UserPlus} size="sm" />
              Hire employee
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => useUiState.getState().setSurface('market')}
            >
              <Icon icon={Store} size="sm" />
              Browse marketplace
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Group orientation="horizontal" className={cn('off-pers', collapsed && 'is-collapsed')}>
      <Panel
        panelRef={listPanelRef}
        className="off-pers-rail"
        defaultSize="18%"
        minSize="180px"
        collapsible
        collapsedSize="64px"
        onResize={(size) => setCollapsed(size.inPixels < 120)}
      >
        <RosterRail
          employees={roster}
          collapsed={collapsed}
          onToggleCollapse={onToggleList}
          onHire={hire}
        />
      </Panel>

      <Separator className="off-resize-handle" />

      <Panel className="off-pers-detail" defaultSize="44%" minSize="34%">
        {selected ? (
          <DetailHeader employee={selected} />
        ) : (
          <div className="off-pers-detail-empty">
            <EmptyState
              icon={UsersRound}
              title="Select an employee"
              description="Pick someone from the list to view and edit their profile."
            />
          </div>
        )}
      </Panel>

      <Separator className="off-resize-handle" />

      <Panel className="off-pers-insp" defaultSize="38%" minSize="320px" maxSize="460px">
        {selected ? (
          <Inspector
            key={selected.id}
            employee={selected}
            companyName={companyName}
            tab={tab}
            onTabChange={setTab}
          />
        ) : null}
      </Panel>
    </Group>
  );
}
