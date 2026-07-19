import { useUiState } from '@/app/ui-state.js';
import { useAgentRuntimeModels } from '@/assistant/composer/usePiAgentModels.js';
import { ListRow, ListRowMeta, ListRowTitle } from '@/components/ListRow.js';
import { displayRole, isTauriRuntime } from '@/data/adapters.js';
import { EMPLOYEE_CAPACITY_MESSAGE, MAX_COMPANY_EMPLOYEES } from '@/data/employee-capacity.js';
import { type EmployeeSeniority, employeeSeniorityLabel } from '@/data/employee-seniority.js';
import { useCompanies, useEmployees } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import {
  type EmployeeSeniorityRoster,
  seniorityForEmployee,
  useEmployeeSeniorityRoster,
} from '@/data/use-employee-seniority.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { cn } from '@/lib/utils.js';
import { PANEL_SIZE_TOKENS } from '@/styles/visual-tokens.js';
import {
  clearDiscardConfirm,
  showDiscardConfirm,
} from '@/surfaces/lifecycle/DiscardConfirmToast.js';
import { openFirstRunGuide } from '@/surfaces/onboarding/first-run-state.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import { PanelLeftClose, PanelLeftOpen, SearchX, Store, UserPlus, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { EmployeeDetail, type InspectorTab } from './EmployeeDetail.js';
import { HireEmployeeDialog } from './HireEmployeeDialog.js';
import { nextEmployeeIdAfterDelete } from './personnel-deletion.js';

function RosterRow({
  employee,
  seniority,
  validModels,
  selected,
  collapsed,
  onSelect,
}: {
  employee: Employee;
  seniority: EmployeeSeniority | undefined;
  validModels: ReadonlySet<string> | undefined;
  selected: boolean;
  collapsed: boolean;
  onSelect: () => void;
}) {
  const modelInvalid = Boolean(employee.model && validModels && !validModels.has(employee.model));
  return (
    <div className={cn('off-pers-emp-wrap', selected && 'is-sel')}>
      <ListRow
        type="button"
        selected={selected}
        selectedClassName="is-sel"
        className="off-pers-emp off-focusable"
        title={
          collapsed && seniority
            ? `${employee.name} · ${employeeSeniorityLabel(seniority)}`
            : collapsed
              ? employee.name
              : undefined
        }
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
          <ListRowTitle className="off-pers-emp-name-row">
            <span className="off-pers-emp-name">{employee.name}</span>
            {seniority ? (
              <span className={`off-pers-seniority-badge is-level-${seniority.level}`}>
                L{seniority.level} {seniority.title}
              </span>
            ) : null}
            {employee.disabled ? <span className="off-pers-emp-dis">disabled</span> : null}
          </ListRowTitle>
          <ListRowMeta className="off-pers-emp-meta">
            {displayRole(employee) ? (
              <span className="off-pers-emp-role">{employee.role}</span>
            ) : null}
            {employee.kind === 'external' && employee.brandLabel ? (
              <span className="off-pers-emp-brand">{employee.brandLabel}</span>
            ) : null}
            {employee.kind === 'internal' && (modelInvalid || employee.model) ? (
              <span className={cn('off-pers-emp-model', modelInvalid && 'is-invalid')}>
                {modelInvalid ? 'AI unavailable · uses conversation default' : employee.model}
              </span>
            ) : null}
          </ListRowMeta>
        </span>
      </ListRow>
    </div>
  );
}

function RosterRail({
  employees,
  seniorityByEmployee,
  validModels,
  collapsed,
  onToggleCollapse,
  onHire,
  canHire,
  hireDisabledReason,
  onSelectEmployee,
  onVisibleEmployeeIdsChange,
}: {
  employees: Employee[];
  seniorityByEmployee: EmployeeSeniorityRoster | undefined;
  validModels: ReadonlySet<string> | undefined;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onHire: () => void;
  canHire: boolean;
  hireDisabledReason: string | undefined;
  onSelectEmployee: (id: string) => void;
  onVisibleEmployeeIdsChange: (ids: string[]) => void;
}) {
  const selectedEmployeeId = useUiState((s) => s.selectedEmployeeId);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');

  const roles = useMemo(() => Array.from(new Set(employees.map((e) => e.role))), [employees]);
  // Self-heal a stale role filter: if the active role disappears from the
  // roster (employee removed / company switched), fall back to 'all' so the
  // list doesn't strand on an empty filter.
  useEffect(() => {
    if (role !== 'all' && !roles.includes(role)) setRole('all');
  }, [role, roles]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter(
      (e) => (role === 'all' || e.role === role) && (!q || e.name.toLowerCase().includes(q)),
    );
  }, [employees, query, role]);

  useEffect(() => {
    onVisibleEmployeeIdsChange(filtered.map((employee) => employee.id));
  }, [filtered, onVisibleEmployeeIdsChange]);

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
              label={canHire ? 'Hire employee' : (hireDisabledReason ?? 'Hire unavailable')}
              variant="subtle"
              size="iconSm"
              disabled={!canHire}
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
              seniority={seniorityForEmployee(seniorityByEmployee, employee.id)}
              validModels={validModels}
              selected={employee.id === selectedEmployeeId}
              collapsed={collapsed}
              onSelect={() => onSelectEmployee(employee.id)}
            />
          ))
        )}
      </div>
    </>
  );
}

export function PersonnelSurface() {
  const employees = useEmployees();
  const models = useAgentRuntimeModels();
  const companies = useCompanies();
  const companyId = useUiState((s) => s.companyId);
  const selectedEmployeeId = useUiState((s) => s.selectedEmployeeId);
  const selectEmployee = useUiState((s) => s.selectEmployee);
  const collapsed = useUiState((s) => s.personnelRailCollapsed);
  const setCollapsed = useUiState((s) => s.setPersonnelRailCollapsed);
  const pendingHire = useUiState((s) => s.pendingHire);
  const consumePendingHire = useUiState((s) => s.consumePendingHire);
  const [tab, setTab] = useState<InspectorTab>('profile');
  const [hireOpen, setHireOpen] = useState(false);
  // Bumped whenever guardedSelect blocks a switch, so the open detail can
  // pulse its save bar — local feedback at the click side of the guard.
  const [guardPulse, setGuardPulse] = useState(0);
  const listPanelRef = usePanelRef();
  // Tracks whether the open EmployeeDetail has unsaved edits, so switching the
  // selected employee can guard against silent data loss (PERS-03).
  const dirtyRef = useRef(false);
  const visibleEmployeeIdsRef = useRef<string[]>([]);

  const roster = employees.data ?? [];
  const seniority = useEmployeeSeniorityRoster(companyId, roster);
  const validModels = models.data ? new Set(models.data.map((option) => option.value)) : undefined;
  const selected = roster.find((e) => e.id === selectedEmployeeId) ?? null;

  const guardedSelect = useCallback(
    (id: string) => {
      if (dirtyRef.current && id !== selectedEmployeeId) {
        setGuardPulse((n) => n + 1);
        showDiscardConfirm({
          message: 'Discard unsaved changes?',
          detail: 'Switching employees will lose your edits to this profile.',
          onDiscard: () => {
            dirtyRef.current = false;
            selectEmployee(id);
          },
        });
        return;
      }
      selectEmployee(id);
    },
    [selectedEmployeeId, selectEmployee],
  );
  const trackVisibleEmployeeIds = useCallback((ids: string[]) => {
    visibleEmployeeIdsRef.current = ids;
  }, []);

  // Keep the inspector view stable while comparing employees. Clear any
  // lingering discard bar and dirty flag; the freshly-mounted EmployeeDetail
  // re-reports its own state for the selected employee.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on selection change only
  useEffect(() => {
    clearDiscardConfirm();
    dirtyRef.current = false;
  }, [selectedEmployeeId]);

  // Prefer the company record's display name; fall back to a slug munge only
  // while the company list is still loading or the record is unavailable.
  const activeCompanyName = (companies.data ?? []).find((c) => c.id === companyId)?.name;
  const companyName =
    activeCompanyName ?? companyId.replace(/^co-/, '').replace(/(^|\s)\S/g, (s) => s.toUpperCase());

  const onToggleList = () => {
    if (collapsed) listPanelRef.current?.expand();
    else listPanelRef.current?.collapse();
  };
  const atCapacity = roster.length >= MAX_COMPANY_EMPLOYEES;
  const canHire = isTauriRuntime() && !atCapacity;
  const hireDisabledReason = !isTauriRuntime()
    ? 'Employee creation requires the release desktop app'
    : atCapacity
      ? EMPLOYEE_CAPACITY_MESSAGE
      : undefined;

  // The Office "Hire" card navigates here with a one-shot intent; open the Hire
  // dialog on arrival, then clear the flag so a later manual visit doesn't
  // re-open it. SurfaceRouter remounts this surface per navigation, so the
  // consume fires once per Hire click.
  useEffect(() => {
    if (!pendingHire) return;
    consumePendingHire();
    if (canHire) setHireOpen(true);
  }, [pendingHire, canHire, consumePendingHire]);

  // Loading — rail skeleton.
  if (employees.isLoading) {
    return (
      <div className="off-pers flex">
        <div className="off-pers-rail is-fixed">
          <SkeletonRows rows={6} />
        </div>
      </div>
    );
  }

  // Error — page-level error in the roster column.
  if (employees.isError) {
    return (
      <div className="off-pers flex">
        <div className="off-pers-rail is-fixed">
          <ErrorState
            title="Couldn't load employees"
            detail={errorDetail(employees.error, 'The roster could not be refreshed.')}
            onRetry={() => employees.refetch()}
          />
        </div>
      </div>
    );
  }

  // Empty roster — first-hire page state.
  if (roster.length === 0) {
    return (
      <>
        <div className="off-pers off-pers-empty-page">
          <div className="off-state">
            <span className="off-state-glyph">
              <Icon icon={UsersRound} size="md" />
            </span>
            <p className="off-state-title">Hire your first employee</p>
            <p className="off-state-desc">
              Hire AI staff with their own persona, skills, and memory — from scratch or a
              marketplace template.
            </p>
            <div className="off-pers-empty-actions">
              <Button
                size="sm"
                onClick={() => setHireOpen(true)}
                disabled={!canHire}
                title={hireDisabledReason}
              >
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
              <Button variant="ghost" size="sm" onClick={openFirstRunGuide}>
                Show setup guide
              </Button>
            </div>
          </div>
        </div>
        <HireEmployeeDialog companyId={companyId} open={hireOpen} onOpenChange={setHireOpen} />
      </>
    );
  }

  return (
    <>
      <Group orientation="horizontal" className={cn('off-pers', collapsed && 'is-collapsed')}>
        <Panel
          panelRef={listPanelRef}
          className="off-pers-rail"
          defaultSize={PANEL_SIZE_TOKENS.personnelRailDefault}
          minSize={PANEL_SIZE_TOKENS.personnelRailMin}
          collapsible
          collapsedSize={PANEL_SIZE_TOKENS.personnelRailCollapsed}
          onResize={(size) => setCollapsed(size.inPixels < 120)}
        >
          <RosterRail
            employees={roster}
            seniorityByEmployee={seniority.data}
            validModels={validModels}
            collapsed={collapsed}
            onToggleCollapse={onToggleList}
            onHire={() => setHireOpen(true)}
            canHire={canHire}
            hireDisabledReason={hireDisabledReason}
            onSelectEmployee={guardedSelect}
            onVisibleEmployeeIdsChange={trackVisibleEmployeeIds}
          />
        </Panel>

        <Separator className="off-resize-handle" />

        <Panel className="off-pers-detail" defaultSize="82%" minSize="50%">
          {selected ? (
            <EmployeeDetail
              key={selected.id}
              employee={selected}
              seniority={seniorityForEmployee(seniority.data, selected.id)}
              companyName={companyName}
              models={models.data}
              modelsLoading={models.isLoading}
              tab={tab}
              onTabChange={setTab}
              onDirtyChange={(d) => {
                dirtyRef.current = d;
              }}
              onDeleted={() => {
                dirtyRef.current = false;
                selectEmployee(
                  nextEmployeeIdAfterDelete(visibleEmployeeIdsRef.current, selected.id),
                );
              }}
              guardPulse={guardPulse}
            />
          ) : (
            <div className="off-pers-detail-empty">
              <EmptyState
                icon={UsersRound}
                title="Select an employee"
                description="Pick someone from the roster to view and edit their profile."
              />
            </div>
          )}
        </Panel>
      </Group>
      <HireEmployeeDialog companyId={companyId} open={hireOpen} onOpenChange={setHireOpen} />
    </>
  );
}
