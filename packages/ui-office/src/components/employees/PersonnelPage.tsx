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
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type LayoutTier, useLayoutTier } from '../../hooks/use-layout-tier.js';
import { useEmployeeEditor } from '../../hooks/useEmployeeEditor';
import { lookupExternalBrand } from '../../lib/brand-registry';
import { ROLE_LABELS, ROLE_OPTIONS } from '../../lib/roles';
import { useSidebarCollapse } from '../../lib/sidebar-collapse-store.js';
import { STATE_LABELS } from '../../lib/state-labels';
import { STATE_VARIANTS } from '../../lib/state-variants';
import {
  useOffisimRuntimeExecution,
  useOffisimRuntimeServices,
} from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
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

function personnelLayoutClass(
  tier: LayoutTier,
  railCollapsed: boolean,
  isFirstHireEmpty: boolean,
): string {
  if (tier === 'desktop') {
    if (isFirstHireEmpty) return 'grid-personnel-desktop-empty';
    return railCollapsed ? 'grid-personnel-desktop-collapsed' : 'grid-personnel-desktop-expanded';
  }
  if (tier === 'tablet') {
    return railCollapsed ? 'grid-personnel-tablet-collapsed' : 'grid-personnel-tablet-expanded';
  }
  return 'grid-personnel-narrow';
}

export function PersonnelPage({
  sessionState,
  onSessionStateChange,
  onOpenCreator,
  onOpenMarket,
}: PersonnelPageProps) {
  const { repos, eventBus } = useOffisimRuntimeServices();
  const { failedRunError, retryLastMessage } = useOffisimRuntimeExecution();
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
  const agentStates = useAgentStates();

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

  const handleRetryEmployee = useCallback(
    async (id: string) => {
      onSessionStateChange((prev) => ({ ...prev, selectedEmployeeId: id }));
      if (failedRunError?.targetEmployeeId !== id) return;
      await retryLastMessage();
    },
    [failedRunError?.targetEmployeeId, onSessionStateChange, retryLastMessage],
  );

  const handleTabChange = (value: string) => {
    onSessionStateChange((prev) => ({
      ...prev,
      activeEmployeeTab: value as PersonnelTabId,
    }));
  };

  const hasRosterFilters = search.trim() !== '' || roleFilter !== 'all';
  const showFirstHireEmpty =
    !employeesLoading && !employeesError && employees.length === 0 && !hasRosterFilters;
  const railCollapsed =
    tier !== 'narrow' &&
    railState === 'collapsed' &&
    !employeesLoading &&
    !employeesError &&
    filteredEmployees.length > 0;
  const layoutClass = personnelLayoutClass(tier, railCollapsed, showFirstHireEmpty);

  const showInspectorInline = tier === 'desktop' && !showFirstHireEmpty;
  const showStackedInspector = tier !== 'desktop' && selectedEmployee !== null;
  const showListPane = tier !== 'narrow' || selectedEmployee === null;
  const showDetailPane = tier !== 'narrow' || selectedEmployee !== null;
  const handleBackToList = useCallback(() => {
    onSessionStateChange((prev) => ({ ...prev, selectedEmployeeId: null }));
  }, [onSessionStateChange]);

  return (
    <div
      className={`personnel-page ${layoutClass}`}
      data-layout-tier={tier}
      data-collapsed={railCollapsed || undefined}
    >
      {/* Left rail: list */}
      {showListPane && (
        <aside ref={listFocusRef} tabIndex={-1} className="personnel-list-pane">
          <div className="personnel-list-head" data-collapsed={railCollapsed || undefined}>
            <div className="personnel-search-row">
              {!railCollapsed && (
                <div className="personnel-search">
                  <Search className="personnel-search-icon" aria-hidden="true" />
                  <Input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search employees..."
                    disabled={showFirstHireEmpty}
                    className="personnel-search-input"
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
                  className="personnel-collapse-button"
                >
                  {railCollapsed ? (
                    <ChevronRight data-icon="collapse" aria-hidden="true" />
                  ) : (
                    <ChevronLeft data-icon="collapse" aria-hidden="true" />
                  )}
                </Button>
              )}
            </div>
            {!railCollapsed && (
              <label className="personnel-role-filter" htmlFor="personnel-role-filter">
                <span>Role filter</span>
                <Select
                  value={roleFilter}
                  onValueChange={(value) => setRoleFilter(value as RoleSlug | 'all')}
                  disabled={showFirstHireEmpty}
                >
                  <SelectTrigger id="personnel-role-filter" className="personnel-role-trigger">
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
          <div className="personnel-list-scroll">
            {employeesLoading ? (
              <WorkspaceListSkeleton rows={6} className="personnel-list-skeleton" />
            ) : employeesError ? (
              <ErrorState
                variant="page"
                title="Couldn't load employees"
                message="The roster could not be refreshed."
                technicalDetail={employeesError}
                primaryAction={{ label: 'Retry', onClick: () => void refreshEmployees() }}
              />
            ) : showFirstHireEmpty ? null : filteredEmployees.length === 0 ? (
              <EmptyState
                variant="compact"
                title="No matching employees"
                description="Reset the search or role filter to broaden the list."
                primaryAction={{
                  label: 'Reset filters',
                  onClick: () => {
                    setSearch('');
                    setRoleFilter('all');
                  },
                }}
              />
            ) : null}
            {filteredEmployees.map((row) => {
              const isSelected = row.employee_id === sessionState.selectedEmployeeId;
              const isExternal = row.is_external === 1;
              const brandLabel = isExternal ? lookupExternalBrand(row.brand_key).displayName : null;
              const liveState = agentStates.get(row.employee_id)?.state ?? 'idle';
              const showRetryChip = liveState === 'failed';
              const canRetryEmployee = failedRunError?.targetEmployeeId === row.employee_id;
              return (
                <div key={row.employee_id} className="personnel-roster-entry">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleSelectEmployee(row.employee_id)}
                    title={railCollapsed ? row.name : undefined}
                    className="personnel-roster-button"
                    data-selected={isSelected || undefined}
                    data-collapsed={railCollapsed || undefined}
                  >
                    <EmployeeAvatar agent={row} size={32} className="personnel-roster-avatar" />
                    <div className="personnel-roster-info">
                      <div className="personnel-roster-name-row">
                        <p className="personnel-roster-name">{row.name}</p>
                        {row.enabled === 0 && (
                          <span className="personnel-roster-disabled">disabled</span>
                        )}
                      </div>
                      <div className="personnel-roster-meta">
                        <span className="personnel-roster-role">
                          {ROLE_LABELS[row.role_slug] ?? row.role_slug}
                        </span>
                        <LiveStatePill state={liveState} />
                        {brandLabel && (
                          <Badge size="xs" variant="outline">
                            {brandLabel}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Button>
                  {!railCollapsed && showRetryChip ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!canRetryEmployee}
                      onClick={() => void handleRetryEmployee(row.employee_id)}
                      title={
                        canRetryEmployee
                          ? 'Retry the last failed run for this employee'
                          : 'Select the failed employee to inspect the run'
                      }
                      className="personnel-retry-button"
                    >
                      <RefreshCw data-icon="retry" aria-hidden="true" />
                      Retry
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </aside>
      )}

      {/* Center: detail + preview */}
      {showDetailPane && (
        <section className="personnel-detail-pane">
          {selectedEmployee ? (
            <DetailHeader
              employee={selectedEmployee}
              onBack={tier === 'narrow' ? handleBackToList : undefined}
            />
          ) : showFirstHireEmpty ? (
            <FirstHireEmpty onOpenCreator={onOpenCreator} onOpenMarket={onOpenMarket} />
          ) : (
            <EmptyDetail />
          )}
          {showStackedInspector && selectedEmployee && (
            <div className="personnel-stacked-inspector">
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
        <section className="personnel-inspector-pane">
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
  const tabBodyRef = useRef<HTMLDivElement | null>(null);
  const scrollKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const scrollKey = `${activeTab}:${selectedEmployeeId ?? ''}`;
    if (scrollKeyRef.current === scrollKey) return;
    scrollKeyRef.current = scrollKey;
    const frame = window.requestAnimationFrame(() => {
      const activeScroll = tabBodyRef.current?.querySelector<HTMLElement>(
        '[data-state="active"] [data-personnel-tab-scroll]',
      );
      activeScroll?.scrollTo({ left: 0, top: 0 });
    });
    return () => window.cancelAnimationFrame(frame);
  });

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="personnel-tabs">
      <TabsList className="personnel-tabs-list">
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="personnel-tab-trigger">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <div ref={tabBodyRef} className="personnel-tabs-body">
        <TabsContent
          value="profile"
          forceMount
          className={cn('personnel-tabs-content', TABS_RETAIN_STATE_CLASS)}
        >
          <ProfileTab editor={editor} />
        </TabsContent>
        <TabsContent
          value="appearance"
          forceMount
          className={cn('personnel-tabs-content', TABS_RETAIN_STATE_CLASS)}
        >
          <AppearanceTab editor={editor} />
        </TabsContent>
        <TabsContent
          value="runtime"
          forceMount
          className={cn('personnel-tabs-content', TABS_RETAIN_STATE_CLASS)}
        >
          <RuntimeTab editor={editor} />
        </TabsContent>
        <TabsContent
          value="skills"
          forceMount
          className={cn('personnel-tabs-content', TABS_RETAIN_STATE_CLASS)}
        >
          <SkillsTab companyId={activeCompanyId} employeeId={selectedEmployeeId} />
        </TabsContent>
        <TabsContent
          value="memory"
          forceMount
          className={cn('personnel-tabs-content', TABS_RETAIN_STATE_CLASS)}
        >
          <MemoryTab companyId={activeCompanyId} employeeId={selectedEmployeeId} />
        </TabsContent>
        <TabsContent
          value="history"
          forceMount
          className={cn('personnel-tabs-content', TABS_RETAIN_STATE_CLASS)}
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
    <div className="personnel-detail-head">
      {onBack ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onBack}
          className="personnel-back-button"
        >
          <ChevronLeft data-icon="back" aria-hidden="true" />
          Back
        </Button>
      ) : null}
      <EmployeeAvatar agent={employee} size={56} className="personnel-detail-avatar" />
      <div className="personnel-detail-id">
        <h2>{employee.name}</h2>
        <p>{ROLE_LABELS[employee.role_slug] ?? employee.role_slug}</p>
      </div>
      <div className="personnel-detail-pills">
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

function LiveStatePill({ state }: { state: string }) {
  const normalized = state || 'idle';
  if (normalized === 'idle') return null;
  return (
    <Badge size="xs" variant={STATE_VARIANTS[normalized] ?? 'secondary'}>
      {STATE_LABELS[normalized] ?? normalized}
    </Badge>
  );
}

function EmptyDetail() {
  return (
    <div className="personnel-empty-shell">
      <EmptyState title="Select an employee" />
    </div>
  );
}

function FirstHireEmpty({
  onOpenCreator,
  onOpenMarket,
}: {
  onOpenCreator?: () => void;
  onOpenMarket?: () => void;
}) {
  return (
    <div className="personnel-empty-shell">
      <EmptyState
        title="No employees yet"
        description="Hire the first teammate for this company or install a marketplace employee."
        primaryAction={{ label: 'Hire your first employee', onClick: onOpenCreator }}
        secondaryAction={
          onOpenMarket ? { label: 'Browse marketplace', onClick: onOpenMarket } : undefined
        }
      />
    </div>
  );
}
