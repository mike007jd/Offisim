import type { EmployeeRow } from '@offisim/core/browser';
import type { RoleSlug } from '@offisim/shared-types';
import { EmptyState, Tabs, TabsContent, TabsList, TabsTrigger } from '@offisim/ui-core';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEmployeeEditor } from '../../hooks/useEmployeeEditor';
import { lookupExternalBrand } from '../../lib/brand-registry';
import { ROLE_LABELS, ROLE_OPTIONS } from '../../lib/roles';
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
}

const TABS: ReadonlyArray<{ value: PersonnelTabId; label: string }> = [
  { value: 'profile', label: 'Profile' },
  { value: 'appearance', label: 'Appearance' },
  { value: 'runtime', label: 'Runtime' },
  { value: 'skills', label: 'Skills' },
  { value: 'memory', label: 'Memory' },
  { value: 'history', label: 'History' },
];

export function PersonnelPage({ sessionState, onSessionStateChange }: PersonnelPageProps) {
  const { repos, eventBus } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const editor = useEmployeeEditor();

  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleSlug | 'all'>('all');

  // Holds the latest roster so the selection→editor effect can short-circuit
  // the redundant `findById` when the row is already in hand from `findByCompany`.
  const employeesRef = useRef<EmployeeRow[]>(employees);
  employeesRef.current = employees;

  // Load roster
  useEffect(() => {
    if (!repos || !activeCompanyId) {
      setEmployees([]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const rows = await repos.employees.findByCompany(activeCompanyId);
      if (!cancelled) setEmployees(rows);
    };
    void refresh();
    const unsubscribe = eventBus?.on('employee', () => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [repos, eventBus, activeCompanyId]);

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

  return (
    <div className="grid h-full w-full grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]">
      {/* Left rail: list */}
      <aside className="flex min-h-0 flex-col border-r border-white/5 bg-slate-950/40">
        <div className="border-b border-white/5 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employees..."
              className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs text-slate-200 placeholder:text-slate-600 focus:border-blue-500/40 focus:outline-none"
            />
          </div>
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
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {filteredEmployees.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-slate-500">
              {employees.length === 0 ? 'No employees yet.' : 'No matches.'}
            </p>
          )}
          {filteredEmployees.map((row) => {
            const isSelected = row.employee_id === sessionState.selectedEmployeeId;
            const isExternal = row.is_external === 1;
            const brandLabel = isExternal ? lookupExternalBrand(row.brand_key).displayName : null;
            return (
              <button
                key={row.employee_id}
                type="button"
                onClick={() => handleSelectEmployee(row.employee_id)}
                className={`mb-1 flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? 'border-blue-400/40 bg-blue-500/10'
                    : 'border-transparent hover:border-white/10 hover:bg-white/5'
                }`}
              >
                <EmployeeAvatar agent={row} size={32} className="shrink-0" />
                <div className="min-w-0 flex-1">
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

      {/* Center: detail + preview */}
      <section className="flex min-h-0 flex-col border-r border-white/5">
        {selectedEmployee ? <DetailHeader employee={selectedEmployee} /> : <EmptyDetail />}
      </section>

      {/* Right: tabs inspector */}
      <section className="flex min-h-0 flex-col bg-slate-950/40">
        <Tabs
          value={sessionState.activeEmployeeTab}
          onValueChange={handleTabChange}
          className="flex h-full min-h-0 flex-1 flex-col"
        >
          <TabsList className="w-full shrink-0 justify-start overflow-x-auto rounded-none border-b border-white/5 bg-transparent px-2 py-1">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex min-h-0 flex-1 flex-col">
            <TabsContent value="profile" className="m-0 flex min-h-0 flex-1 flex-col">
              {selectedEmployee ? <ProfileTab editor={editor} /> : <EmptyTabPlaceholder />}
            </TabsContent>
            <TabsContent value="appearance" className="m-0 flex min-h-0 flex-1 flex-col">
              <AppearanceTab editor={editor} />
            </TabsContent>
            <TabsContent value="runtime" className="m-0 flex min-h-0 flex-1 flex-col">
              {selectedEmployee ? <RuntimeTab editor={editor} /> : <EmptyTabPlaceholder />}
            </TabsContent>
            <TabsContent value="skills" className="m-0 flex min-h-0 flex-1 flex-col">
              <SkillsTab companyId={activeCompanyId} employeeId={sessionState.selectedEmployeeId} />
            </TabsContent>
            <TabsContent value="memory" className="m-0 flex min-h-0 flex-1 flex-col">
              <MemoryTab companyId={activeCompanyId} employeeId={sessionState.selectedEmployeeId} />
            </TabsContent>
            <TabsContent value="history" className="m-0 flex min-h-0 flex-1 flex-col">
              <HistoryTab
                employeeId={sessionState.selectedEmployeeId}
                sourceAssetId={editor.sourceAssetId}
                sourcePackageId={editor.sourcePackageId}
              />
            </TabsContent>
          </div>
        </Tabs>
      </section>
    </div>
  );
}

function DetailHeader({ employee }: { employee: EmployeeRow }) {
  const isExternal = employee.is_external === 1;
  const brand = isExternal ? lookupExternalBrand(employee.brand_key) : null;
  return (
    <div className="flex flex-col items-center gap-4 border-b border-white/5 px-6 py-8">
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

function EmptyDetail() {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <EmptyState
        title="Select an employee on the left"
        description="Their profile, appearance, runtime, skills, memory, and history will appear here."
      />
    </div>
  );
}

function EmptyTabPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <EmptyState variant="compact" title="Select an employee on the left to edit." />
    </div>
  );
}
