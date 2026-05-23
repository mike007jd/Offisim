import type { EmployeeRow } from '@offisim/core/browser';
import type { RoleSlug } from '@offisim/shared-types';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TABS_RETAIN_STATE_CLASS,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  WorkspaceListSkeleton,
  cn,
} from '@offisim/ui-core';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type LayoutTier, useLayoutTier } from '../../hooks/use-layout-tier.js';
import { useEmployeeEditor } from '../../hooks/useEmployeeEditor';
import { lookupExternalBrand } from '../../lib/brand-registry';
import { ROLE_LABELS, ROLE_OPTIONS } from '../../lib/roles';
import { useSidebarCollapse } from '../../lib/sidebar-collapse-store.js';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context';
import { useCompany } from '../company/CompanyContext.js';
import { EmployeeAvatar } from '../shared/EmployeeAvatar';
import { AppearanceTab } from './personnel-tabs/AppearanceTab';
import { HistoryTab } from './personnel-tabs/HistoryTab';
import { MemoryTab } from './personnel-tabs/MemoryTab';
import { ProfileTab } from './personnel-tabs/ProfileTab';
import { RuntimeTab } from './personnel-tabs/RuntimeTab';
import { SkillsTab } from './personnel-tabs/SkillsTab';

export type PersonnelTabId = 'profile' | 'appearance' | 'runtime' | 'skills' | 'memory' | 'history';

export interface PersonnelSessionState {
  selectedEmployeeId: string | null;
  activeEmployeeTab: PersonnelTabId;
}

interface PersonnelPageProps {
  sessionState: PersonnelSessionState;
  onSessionStateChange: (updater: (prev: PersonnelSessionState) => PersonnelSessionState) => void;
  onOpenCreator?: () => void;
  onOpenMarket?: () => void;
}

const TABS: ReadonlyArray<{ value: PersonnelTabId; label: string }> = [
  { value: 'profile', label: 'Profile' },
  { value: 'appearance', label: 'Appearance' },
  { value: 'runtime', label: 'Runtime' },
  { value: 'skills', label: 'Skills' },
  { value: 'memory', label: 'Memory' },
  { value: 'history', label: 'History' },
];

function personnelLayoutClass(tier: LayoutTier, railCollapsed: boolean): string {
  if (tier === 'desktop') {
    return railCollapsed ? 'grid-personnel-desktop-collapsed' : 'grid-personnel-desktop-expanded';
  }
  if (tier === 'tablet') {
    return railCollapsed ? 'grid-personnel-tablet-collapsed' : 'grid-personnel-tablet-expanded';
  }
  return 'grid-cols-1';
}

export function PersonnelPage({
  sessionState,
  onSessionStateChange,
  onOpenCreator,
  onOpenMarket,
}: PersonnelPageProps) {
  const { repos, eventBus } = useOffisimRuntimeServices();
  const { activeCompanyId } = useCompany();
  const editor = useEmployeeEditor();
  const { tier } = useLayoutTier();
  const [railState, setRailState] = useSidebarCollapse('personnel');

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleSlug | 'all'>('all');
  const listFocusRef = useRef<HTMLElement | null>(null);

  // Holds the latest roster so the selection→editor effect can short-circuit
  // the redundant `findById` when the row is already in hand from `findByCompany`.
  const employeesRef = useRef<EmployeeRow[]>(employees);
  employeesRef.current = employees;

  const refreshEmployees = useCallback(
    async (shouldCommit: () => boolean = () => true) => {
      if (!repos || !activeCompanyId) {
        if (!shouldCommit()) return;
        setEmployees([]);
        setEmployeesLoading(false);
        setEmployeesError(null);
        return;
      }
      setEmployeesLoading(true);
      setEmployeesError(null);
      try {
        const rows = await repos.employees.findByCompany(activeCompanyId);
        if (!shouldCommit()) return;
        setEmployees(rows);
      } catch (err) {
        if (!shouldCommit()) return;
        setEmployeesError(err instanceof Error ? err.message : 'Failed to load employees.');
      } finally {
        if (shouldCommit()) setEmployeesLoading(false);
      }
    },
    [repos, activeCompanyId],
  );

  // Load roster
  useEffect(() => {
    let cancelled = false;
    const guardedRefresh = async () => {
      await refreshEmployees(() => !cancelled);
    };
    void guardedRefresh();
    const unsubscribe = eventBus?.on('employee', () => {
      void guardedRefresh();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [eventBus, refreshEmployees]);

  // Sync selection → editor. Re-loads after save (which clears editor.employeeId),
  // and clears editor when selection drops.
  useEffect(() => {
    const id = sessionState.selectedEmployeeId;
    if (!id) {
      if (editor.employeeId !== null) editor.close();
      return;
    }
    if (editor.employeeId === id) return;
    const preloaded = employeesRef.current.find((e) => e.employee_id === id) ?? null;
    void editor.openForEdit(id, preloaded);
  }, [sessionState.selectedEmployeeId, editor.employeeId, editor.openForEdit, editor.close]);

  // Drop stale selection when the selected employee disappears from the roster
  // (e.g. after delete). Skips while the roster hasn't loaded yet.
  useEffect(() => {
    const id = sessionState.selectedEmployeeId;
    if (!id || employees.length === 0) return;
    if (!employees.some((e) => e.employee_id === id)) {
      onSessionStateChange((prev) => ({ ...prev, selectedEmployeeId: null }));
    }
  }, [employees, sessionState.selectedEmployeeId, onSessionStateChange]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q) && !e.role_slug.toLowerCase().includes(q)) {
        return false;
      }
      if (roleFilter !== 'all' && e.role_slug !== roleFilter) return false;
      return true;
    });
  }, [employees, search, roleFilter]);

  const selectedEmployee = useMemo(
    () =>
      sessionState.selectedEmployeeId
        ? (employees.find((e) => e.employee_id === sessionState.selectedEmployeeId) ?? null)
        : null,
    [employees, sessionState.selectedEmployeeId],
  );

  useEffect(() => {
    if (tier === 'narrow' || employeesLoading || employeesError) return;
    const firstEmployee = filteredEmployees[0];
    if (sessionState.selectedEmployeeId || !firstEmployee) return;
    onSessionStateChange((prev) =>
      prev.selectedEmployeeId ? prev : { ...prev, selectedEmployeeId: firstEmployee.employee_id },
    );
  }, [
    employeesError,
    employeesLoading,
    filteredEmployees,
    onSessionStateChange,
    sessionState.selectedEmployeeId,
    tier,
  ]);

  const handleSelectEmployee = (id: string) => {
    onSessionStateChange((prev) => ({ ...prev, selectedEmployeeId: id }));
  };

  const handleTabChange = (value: string) => {
    onSessionStateChange((prev) => ({
      ...prev,
      activeEmployeeTab: value as PersonnelTabId,
    }));
  };

  const railCollapsed =
    tier !== 'narrow' &&
    railState === 'collapsed' &&
    !employeesLoading &&
    !employeesError &&
    filteredEmployees.length > 0;
  const layoutClass = personnelLayoutClass(tier, railCollapsed);

  const showInspectorInline = tier === 'desktop';
  const showStackedInspector = tier !== 'desktop' && selectedEmployee !== null;
  const showListPane = tier !== 'narrow' || selectedEmployee === null;
  const showDetailPane = tier !== 'narrow' || selectedEmployee !== null;
  const handleBackToList = useCallback(() => {
    onSessionStateChange((prev) => ({ ...prev, selectedEmployeeId: null }));
  }, [onSessionStateChange]);

  return (
    <div
      className={cn('grid h-full min-h-0 w-full bg-surface text-text-primary', layoutClass)}
      data-layout-tier={tier}
    >
      {/* Left rail: list */}
      {showListPane && (
        <aside
          ref={listFocusRef}
          tabIndex={-1}
          className="flex min-h-0 flex-col border-r border-border-default bg-surface-elevated focus:outline-none focus:ring-2 focus:ring-border-focus"
        >
          <div className={cn('border-b border-border-default', railCollapsed ? 'p-2' : 'p-3')}>
            <div className="flex items-center justify-between gap-2">
              {!railCollapsed && (
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                  <Input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search employees..."
                    className="h-9 w-full py-1.5 pl-8 pr-3 text-sm"
                  />
                </div>
              )}
              {tier !== 'narrow' && (
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label={railCollapsed ? 'Expand personnel list' : 'Collapse personnel list'}
                  onClick={() => setRailState(railCollapsed ? 'expanded' : 'collapsed')}
                  className="size-8 shrink-0 rounded-lg"
                >
                  {railCollapsed ? (
                    <ChevronRight className="size-4" aria-hidden="true" />
                  ) : (
                    <ChevronLeft className="size-4" aria-hidden="true" />
                  )}
                </Button>
              )}
            </div>
            {!railCollapsed && (
              <label className="mt-3 block" htmlFor="personnel-role-filter">
                <span className="mb-1 block text-caption font-semibold uppercase tracking-wide text-text-muted">
                  Role filter
                </span>
                <Select
                  value={roleFilter}
                  onValueChange={(value) => setRoleFilter(value as RoleSlug | 'all')}
                >
                  <SelectTrigger id="personnel-role-filter" className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All roles</SelectItem>
                    {ROLE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {employeesLoading ? (
              <WorkspaceListSkeleton rows={6} className="p-0" />
            ) : employeesError ? (
              <ErrorState
                variant="page"
                title="Couldn't load employees"
                message="The roster could not be refreshed."
                technicalDetail={employeesError}
                primaryAction={{ label: 'Retry', onClick: () => void refreshEmployees() }}
              />
            ) : filteredEmployees.length === 0 ? (
              <EmptyState
                variant="compact"
                title={employees.length === 0 ? 'No employees yet' : 'No matching employees'}
                description={
                  employees.length === 0
                    ? 'Hire the first teammate for this company.'
                    : 'Reset the search or role filter to broaden the list.'
                }
                primaryAction={
                  employees.length === 0
                    ? { label: 'Hire your first employee', onClick: onOpenCreator }
                    : {
                        label: 'Reset filters',
                        onClick: () => {
                          setSearch('');
                          setRoleFilter('all');
                        },
                      }
                }
                secondaryAction={
                  employees.length === 0 && onOpenMarket
                    ? { label: 'Browse marketplace', onClick: onOpenMarket }
                    : undefined
                }
              />
            ) : null}
            {filteredEmployees.map((row) => {
              const isSelected = row.employee_id === sessionState.selectedEmployeeId;
              const isExternal = row.is_external === 1;
              const brandLabel = isExternal ? lookupExternalBrand(row.brand_key).displayName : null;
              return (
                <Button
                  key={row.employee_id}
                  type="button"
                  variant="ghost"
                  onClick={() => handleSelectEmployee(row.employee_id)}
                  title={railCollapsed ? row.name : undefined}
                  className={cn(
                    'mb-2 min-h-14 w-full rounded-lg border text-left transition-colors',
                    isSelected
                      ? 'border-border-focus bg-accent-muted'
                      : 'border-transparent hover:border-border-default hover:bg-surface-hover',
                    railCollapsed ? 'justify-center px-1 py-2' : 'justify-start gap-3 px-3 py-2',
                  )}
                >
                  <EmployeeAvatar agent={row} size={32} className="shrink-0" />
                  <div className={cn('min-w-0 flex-1', railCollapsed && 'sr-only')}>
                    <div className="flex items-baseline gap-2">
                      <p className="truncate text-sm font-medium text-text-primary">{row.name}</p>
                      {row.enabled === 0 && (
                        <span className="text-caption text-text-muted">disabled</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-caption text-text-secondary">
                        {ROLE_LABELS[row.role_slug] ?? row.role_slug}
                      </span>
                      {brandLabel && (
                        <Badge size="xs" variant="outline">
                          {brandLabel}
                        </Badge>
                      )}
                    </div>
                  </div>
                </Button>
              );
            })}
          </div>
        </aside>
      )}

      {/* Center: detail + preview */}
      {showDetailPane && (
        <section className="flex min-h-0 flex-col border-r border-border-default bg-surface">
          {selectedEmployee ? (
            <DetailHeader
              employee={selectedEmployee}
              onBack={tier === 'narrow' ? handleBackToList : undefined}
            />
          ) : (
            <EmptyDetail />
          )}
          {showStackedInspector && selectedEmployee && (
            <div className="min-h-0 flex-1 border-t border-border-default">
              <PersonnelTabs
                activeTab={sessionState.activeEmployeeTab}
                onTabChange={handleTabChange}
                editor={editor}
                activeCompanyId={activeCompanyId}
                selectedEmployeeId={sessionState.selectedEmployeeId}
              />
            </div>
          )}
        </section>
      )}

      {/* Right: tabs inspector */}
      {showInspectorInline && selectedEmployee && (
        <section className="flex min-h-0 flex-col bg-surface-elevated">
          <PersonnelTabs
            activeTab={sessionState.activeEmployeeTab}
            onTabChange={handleTabChange}
            editor={editor}
            activeCompanyId={activeCompanyId}
            selectedEmployeeId={sessionState.selectedEmployeeId}
          />
        </section>
      )}
    </div>
  );
}

function PersonnelTabs({
  activeTab,
  onTabChange,
  editor,
  activeCompanyId,
  selectedEmployeeId,
}: {
  activeTab: PersonnelTabId;
  onTabChange: (value: string) => void;
  editor: ReturnType<typeof useEmployeeEditor>;
  activeCompanyId: string | null;
  selectedEmployeeId: string | null;
}) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={onTabChange}
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <TabsList className="h-11 w-full shrink-0 items-center justify-start gap-1 overflow-x-auto rounded-none border-0 border-b border-line-soft bg-transparent px-sp-5 py-0">
        {TABS.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className="h-7 shrink-0 rounded-r-sm border border-transparent bg-transparent px-3 text-fs-sm font-medium text-ink-3 transition-colors hover:bg-surface-sunken hover:text-ink-1 data-[state=active]:border-line-soft data-[state=active]:bg-surface-1 data-[state=active]:font-semibold data-[state=active]:text-accent"
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="flex min-h-0 flex-1 flex-col">
        <TabsContent
          value="profile"
          forceMount
          className={cn('m-0 flex min-h-0 flex-1 flex-col', TABS_RETAIN_STATE_CLASS)}
        >
          <ProfileTab editor={editor} />
        </TabsContent>
        <TabsContent
          value="appearance"
          forceMount
          className={cn('m-0 flex min-h-0 flex-1 flex-col', TABS_RETAIN_STATE_CLASS)}
        >
          <AppearanceTab editor={editor} />
        </TabsContent>
        <TabsContent
          value="runtime"
          forceMount
          className={cn('m-0 flex min-h-0 flex-1 flex-col', TABS_RETAIN_STATE_CLASS)}
        >
          <RuntimeTab editor={editor} />
        </TabsContent>
        <TabsContent
          value="skills"
          forceMount
          className={cn('m-0 flex min-h-0 flex-1 flex-col', TABS_RETAIN_STATE_CLASS)}
        >
          <SkillsTab companyId={activeCompanyId} employeeId={selectedEmployeeId} />
        </TabsContent>
        <TabsContent
          value="memory"
          forceMount
          className={cn('m-0 flex min-h-0 flex-1 flex-col', TABS_RETAIN_STATE_CLASS)}
        >
          <MemoryTab companyId={activeCompanyId} employeeId={selectedEmployeeId} />
        </TabsContent>
        <TabsContent
          value="history"
          forceMount
          className={cn('m-0 flex min-h-0 flex-1 flex-col', TABS_RETAIN_STATE_CLASS)}
        >
          <HistoryTab
            employeeId={selectedEmployeeId}
            sourceAssetId={editor.sourceAssetId}
            sourcePackageId={editor.sourcePackageId}
          />
        </TabsContent>
      </div>
    </Tabs>
  );
}

function DetailHeader({ employee, onBack }: { employee: EmployeeRow; onBack?: () => void }) {
  const isExternal = employee.is_external === 1;
  const brand = isExternal ? lookupExternalBrand(employee.brand_key) : null;
  return (
    <div className="flex shrink-0 items-center gap-4 border-b border-border-default bg-surface px-sp-7 py-sp-5">
      {onBack ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onBack}
          className="shrink-0 gap-1.5 px-2.5 py-1.5 text-xs text-text-secondary"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          Back
        </Button>
      ) : null}
      <EmployeeAvatar agent={employee} size={64} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="truncate text-lg font-semibold text-text-primary">{employee.name}</h2>
        <p className="truncate text-xs text-text-secondary">
          {ROLE_LABELS[employee.role_slug] ?? employee.role_slug}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Badge variant={employee.enabled ? 'success' : 'secondary'} size="xs">
          {employee.enabled ? 'Enabled' : 'Disabled'}
        </Badge>
        {brand && (
          <Badge variant="outline" size="xs">
            External · {brand.displayName}
          </Badge>
        )}
      </div>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <EmptyState title="Select an employee" />
    </div>
  );
}
