import type { EmployeeRow } from '@offisim/core/browser';
import type { RoleSlug } from '@offisim/shared-types';
import {
  EmptyState,
  ErrorState,
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
import { useLayoutTier } from '../../hooks/use-layout-tier.js';
import { useEmployeeEditor } from '../../hooks/useEmployeeEditor';
import { lookupExternalBrand } from '../../lib/brand-registry';
import { ROLE_LABELS, ROLE_OPTIONS } from '../../lib/roles';
import { useSidebarCollapse } from '../../lib/sidebar-collapse-store.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
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

export function PersonnelPage({
  sessionState,
  onSessionStateChange,
  onOpenCreator,
  onOpenMarket,
}: PersonnelPageProps) {
  const { repos, eventBus } = useOffisimRuntime();
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

  const handleSelectEmployee = (id: string) => {
    onSessionStateChange((prev) => ({ ...prev, selectedEmployeeId: id }));
  };

  const handleTabChange = (value: string) => {
    onSessionStateChange((prev) => ({
      ...prev,
      activeEmployeeTab: value as PersonnelTabId,
    }));
  };

  const focusList = useCallback(() => {
    listFocusRef.current?.focus();
  }, []);

  const railCollapsed =
    tier !== 'narrow' &&
    railState === 'collapsed' &&
    !employeesLoading &&
    !employeesError &&
    filteredEmployees.length > 0;
  const layoutClass =
    tier === 'desktop'
      ? railCollapsed
        ? 'grid-cols-[64px_minmax(0,1fr)_minmax(0,420px)]'
        : 'grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]'
      : tier === 'tablet'
        ? railCollapsed
          ? 'grid-cols-[64px_minmax(0,1fr)]'
          : 'grid-cols-[220px_minmax(0,1fr)]'
        : 'grid-cols-1';

  const showInspectorInline = tier === 'desktop';
  const showStackedInspector = tier !== 'desktop' && selectedEmployee !== null;
  const showListPane = tier !== 'narrow' || selectedEmployee === null;
  const showDetailPane = tier !== 'narrow' || selectedEmployee !== null;
  const handleBackToList = useCallback(() => {
    onSessionStateChange((prev) => ({ ...prev, selectedEmployeeId: null }));
  }, [onSessionStateChange]);

  return (
    <div className={cn('grid h-full w-full min-h-0', layoutClass)} data-layout-tier={tier}>
      {/* Left rail: list */}
      {showListPane && (
        <aside
          ref={listFocusRef}
          tabIndex={-1}
          className="flex min-h-0 flex-col border-r border-white/5 bg-slate-950/40 focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
        >
          <div className={cn('border-b border-white/5', railCollapsed ? 'p-2' : 'p-4')}>
            <div className="flex items-center justify-between gap-2">
              {!railCollapsed && (
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search employees..."
                    className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs text-slate-200 placeholder:text-slate-600 focus:border-blue-500/40 focus:outline-none"
                  />
                </div>
              )}
              {tier !== 'narrow' && (
                <button
                  type="button"
                  aria-label={railCollapsed ? 'Expand personnel list' : 'Collapse personnel list'}
                  onClick={() => setRailState(railCollapsed ? 'expanded' : 'collapsed')}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                >
                  {railCollapsed ? (
                    <ChevronRight className="h-4 w-4" />
                  ) : (
                    <ChevronLeft className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
            {!railCollapsed && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setRoleFilter('all')}
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-colors ${
                    roleFilter === 'all'
                      ? 'border-blue-400 bg-blue-500/15 text-blue-200'
                      : 'border-slate-700 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  All
                </button>
                {ROLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRoleFilter(opt.value as RoleSlug)}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-colors ${
                      roleFilter === opt.value
                        ? 'border-blue-400 bg-blue-500/15 text-blue-200'
                        : 'border-slate-700 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
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
                <button
                  key={row.employee_id}
                  type="button"
                  onClick={() => handleSelectEmployee(row.employee_id)}
                  title={railCollapsed ? row.name : undefined}
                  className={`mb-1 flex w-full items-center rounded-lg border text-left transition-colors ${
                    isSelected
                      ? 'border-blue-400/40 bg-blue-500/10'
                      : 'border-transparent hover:border-white/10 hover:bg-white/5'
                  } ${railCollapsed ? 'justify-center px-1 py-2' : 'gap-3 px-3 py-2'}`}
                >
                  <EmployeeAvatar agent={row} size={32} className="shrink-0" />
                  <div className={cn('min-w-0 flex-1', railCollapsed && 'sr-only')}>
                    <div className="flex items-baseline gap-2">
                      <p className="truncate text-sm font-medium text-slate-100">{row.name}</p>
                      {row.enabled === 0 && (
                        <span className="text-[10px] text-slate-500">disabled</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-slate-400">
                        {ROLE_LABELS[row.role_slug] ?? row.role_slug}
                      </span>
                      {brandLabel && (
                        <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-px text-[10px] text-slate-300">
                          {brandLabel}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
      )}

      {/* Center: detail + preview */}
      {showDetailPane && (
        <section className="flex min-h-0 flex-col border-r border-white/5">
          {selectedEmployee ? (
            <DetailHeader
              employee={selectedEmployee}
              onBack={tier === 'narrow' ? handleBackToList : undefined}
            />
          ) : (
            <EmptyDetail onFocusList={focusList} />
          )}
          {showStackedInspector && (
            <div className="min-h-0 flex-1 border-t border-white/5">
              <PersonnelTabs
                activeTab={sessionState.activeEmployeeTab}
                onTabChange={handleTabChange}
                selectedEmployee={selectedEmployee}
                editor={editor}
                activeCompanyId={activeCompanyId}
                selectedEmployeeId={sessionState.selectedEmployeeId}
                onFocusList={focusList}
              />
            </div>
          )}
        </section>
      )}

      {/* Right: tabs inspector */}
      {showInspectorInline && (
        <section className="flex min-h-0 flex-col bg-slate-950/40">
          <PersonnelTabs
            activeTab={sessionState.activeEmployeeTab}
            onTabChange={handleTabChange}
            selectedEmployee={selectedEmployee}
            editor={editor}
            activeCompanyId={activeCompanyId}
            selectedEmployeeId={sessionState.selectedEmployeeId}
            onFocusList={focusList}
          />
        </section>
      )}
    </div>
  );
}

function PersonnelTabs({
  activeTab,
  onTabChange,
  selectedEmployee,
  editor,
  activeCompanyId,
  selectedEmployeeId,
  onFocusList,
}: {
  activeTab: PersonnelTabId;
  onTabChange: (value: string) => void;
  selectedEmployee: EmployeeRow | null;
  editor: ReturnType<typeof useEmployeeEditor>;
  activeCompanyId: string | null;
  selectedEmployeeId: string | null;
  onFocusList: () => void;
}) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={onTabChange}
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <TabsList className="w-full shrink-0 justify-start overflow-x-auto rounded-none border-b border-white/5 bg-transparent px-2 py-1">
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="text-xs">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="flex min-h-[560px] flex-1 flex-col">
        <TabsContent
          value="profile"
          forceMount
          className={cn('m-0 flex min-h-[520px] flex-1 flex-col', TABS_RETAIN_STATE_CLASS)}
        >
          {selectedEmployee ? (
            <ProfileTab editor={editor} />
          ) : (
            <EmptyTabPlaceholder onFocusList={onFocusList} />
          )}
        </TabsContent>
        <TabsContent
          value="appearance"
          forceMount
          className={cn('m-0 flex min-h-[520px] flex-1 flex-col', TABS_RETAIN_STATE_CLASS)}
        >
          <AppearanceTab editor={editor} />
        </TabsContent>
        <TabsContent
          value="runtime"
          forceMount
          className={cn('m-0 flex min-h-[520px] flex-1 flex-col', TABS_RETAIN_STATE_CLASS)}
        >
          {selectedEmployee ? (
            <RuntimeTab editor={editor} />
          ) : (
            <EmptyTabPlaceholder onFocusList={onFocusList} />
          )}
        </TabsContent>
        <TabsContent
          value="skills"
          forceMount
          className={cn('m-0 flex min-h-[520px] flex-1 flex-col', TABS_RETAIN_STATE_CLASS)}
        >
          <SkillsTab companyId={activeCompanyId} employeeId={selectedEmployeeId} />
        </TabsContent>
        <TabsContent
          value="memory"
          forceMount
          className={cn('m-0 flex min-h-[520px] flex-1 flex-col', TABS_RETAIN_STATE_CLASS)}
        >
          <MemoryTab companyId={activeCompanyId} employeeId={selectedEmployeeId} />
        </TabsContent>
        <TabsContent
          value="history"
          forceMount
          className={cn('m-0 flex min-h-[520px] flex-1 flex-col', TABS_RETAIN_STATE_CLASS)}
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
    <div className="flex flex-col items-center gap-4 border-b border-white/5 px-6 py-8">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="self-start inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back
        </button>
      ) : null}
      <EmployeeAvatar agent={employee} size={120} />
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h2 className="text-xl font-semibold text-slate-100">{employee.name}</h2>
        <p className="text-sm text-slate-400">
          {ROLE_LABELS[employee.role_slug] ?? employee.role_slug}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              employee.enabled
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : 'border-slate-600 bg-slate-800/40 text-slate-400'
            }`}
          >
            {employee.enabled ? 'Enabled' : 'Disabled'}
          </span>
          {brand && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">
              External · {brand.displayName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyDetail({ onFocusList }: { onFocusList: () => void }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <EmptyState
        title="Select an employee on the left"
        description="Their profile, appearance, runtime, skills, memory, and history will appear here."
        primaryAction={{ label: 'Pick someone on the left', onClick: onFocusList }}
      />
    </div>
  );
}

function EmptyTabPlaceholder({ onFocusList }: { onFocusList: () => void }) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <EmptyState
        variant="compact"
        title="Select an employee on the left to edit."
        primaryAction={{ label: 'Pick someone on the left', onClick: onFocusList }}
      />
    </div>
  );
}
