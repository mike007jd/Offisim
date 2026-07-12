import { useUiState } from '@/app/ui-state.js';
import {
  type PiAgentModelOption,
  usePiAgentModels,
} from '@/assistant/composer/usePiAgentModels.js';
import { displayRole, isTauriRuntime, reposOrNull } from '@/data/adapters.js';
import { EMPLOYEE_CAPACITY_MESSAGE, MAX_COMPANY_EMPLOYEES } from '@/data/employee-capacity.js';
import { useCompanies, useEmployees } from '@/data/queries.js';
import type { Employee, EmployeeAppearance } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import { Input } from '@/design-system/primitives/input.js';
import { Tabs, TabsList, TabsTrigger } from '@/design-system/primitives/tabs.js';
import { cn } from '@/lib/utils.js';
import { PANEL_SIZE_TOKENS } from '@/styles/visual-tokens.js';
import {
  clearDiscardConfirm,
  showDiscardConfirm,
} from '@/surfaces/lifecycle/DiscardConfirmToast.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import { zodResolver } from '@hookform/resolvers/zod';
import type { RoleSlug } from '@offisim/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { PanelLeftClose, PanelLeftOpen, SearchX, Store, UserPlus, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { toast } from 'sonner';
import { AppearanceTab, CompactAppearanceEditor } from './AppearanceTab.js';
import { HistoryTab } from './HistoryTab.js';
import { McpToolsTab } from './McpToolsTab.js';
import { MemoryTab } from './MemoryTab.js';
import { ProfileTab } from './ProfileTab.js';
import { RuntimeTab } from './RuntimeTab.js';
import { SkillsTab } from './SkillsTab.js';
import {
  type AppearanceDraft,
  type ProfileFormValues,
  appearanceDraftFor,
  appearanceDraftForSeed,
  profileDefaults,
  profileDefaultsFromRecord,
  profileFormSchema,
  recordEmployeeVersionOnSave,
} from './personnel-data.js';

const INSPECTOR_TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'skills', label: 'Skills' },
  { key: 'tools', label: 'Tools' },
  { key: 'memory', label: 'Memory' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'runtime', label: 'Runtime' },
  { key: 'history', label: 'History' },
] as const;
type InspectorTab = (typeof INSPECTOR_TABS)[number]['key'];

function safeJsonRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function roleSlug(role: string): RoleSlug {
  const normalized = role.toLowerCase();
  if (normalized.includes('qa') || normalized.includes('test')) return 'qa';
  if (normalized.includes('frontend')) return 'frontend';
  if (normalized.includes('backend')) return 'backend';
  if (normalized.includes('fullstack')) return 'fullstack';
  if (normalized.includes('devops')) return 'devops';
  if (normalized.includes('engineering manager')) return 'engineering_manager';
  if (normalized.includes('engineer')) return 'engineer';
  if (normalized.includes('product manager')) return 'product_manager';
  if (normalized.includes('project manager')) return 'project_manager';
  if (normalized.includes('pm')) return 'pm';
  if (normalized.includes('ui')) return 'ui_designer';
  if (normalized.includes('ux')) return 'ux_designer';
  if (normalized.includes('design')) return 'designer';
  if (normalized.includes('research')) return 'researcher';
  if (normalized.includes('analyst')) return 'analyst';
  if (normalized.includes('market')) return 'marketer';
  if (normalized.includes('writer')) return 'writer';
  return 'developer';
}

function newEmployeePersona(appearance: AppearanceDraft): Record<string, unknown> {
  // Profile selectors still start empty. Appearance is the one intentional
  // persona field because the hire dialog previews and edits this exact look.
  return { appearance: appearancePayload(appearance) };
}

function createHireAppearance() {
  const seed = crypto.randomUUID();
  return { seed, draft: appearanceDraftForSeed(seed) };
}

function RosterRow({
  employee,
  validModels,
  selected,
  collapsed,
  onSelect,
}: {
  employee: Employee;
  validModels: ReadonlySet<string> | undefined;
  selected: boolean;
  collapsed: boolean;
  onSelect: () => void;
}) {
  const modelInvalid = Boolean(employee.model && validModels && !validModels.has(employee.model));
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
          </span>
          <span className="off-pers-emp-meta">
            {displayRole(employee) ? (
              <span className="off-pers-emp-role">{employee.role}</span>
            ) : null}
            {employee.kind === 'external' && employee.brandLabel ? (
              <span className="off-pers-emp-brand">{employee.brandLabel}</span>
            ) : null}
            {employee.kind === 'internal' ? (
              <span className={cn('off-pers-emp-model', modelInvalid && 'is-invalid')}>
                {modelInvalid
                  ? 'Model unavailable · inherits'
                  : employee.model || 'Inherits conversation model'}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </div>
  );
}

function RosterRail({
  employees,
  validModels,
  collapsed,
  onToggleCollapse,
  onHire,
  canHire,
  hireDisabledReason,
  onSelectEmployee,
}: {
  employees: Employee[];
  validModels: ReadonlySet<string> | undefined;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onHire: () => void;
  canHire: boolean;
  hireDisabledReason: string | undefined;
  onSelectEmployee: (id: string) => void;
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

function DetailHeader({
  employee,
  validModels,
}: {
  employee: Employee;
  validModels: ReadonlySet<string> | undefined;
}) {
  const roleLine = [displayRole(employee), employee.zoneLabel, employee.deskLabel]
    .filter(Boolean)
    .join(' · ');
  const invalidModel = Boolean(employee.model && validModels && !validModels.has(employee.model));
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
        {employee.kind === 'internal' ? (
          <span className={cn('off-pers-st-pill', invalidModel && 'is-off')}>
            {invalidModel ? 'Model unavailable · inherits' : employee.model || 'Inherits model'}
          </span>
        ) : null}
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

function appearancePayload(draft: AppearanceDraft): EmployeeAppearance {
  return {
    skinColor: draft.skinColor,
    hairColor: draft.hairColor,
    clothingColor: draft.clothingColor,
    accentColor: draft.accentColor,
    hairStyle: draft.hairStyle,
    bodyType: draft.bodyType,
    headShape: draft.headShape,
    gender: draft.gender,
    outfit: draft.outfit,
  };
}

function appearanceKey(draft: AppearanceDraft): string {
  return JSON.stringify(appearancePayload(draft));
}

/** Detail panel: identity header + inspector tabs + one unified save bar.
 *  Holds all editable per-employee state (profile form, tool permissions, and
 *  appearance) so a single Save persists everything together. Keyed by employee
 *  id at the parent so this remounts (fresh state) on switch. */
function EmployeeDetail({
  employee,
  companyName,
  models,
  modelsLoading,
  tab,
  onTabChange,
  onDirtyChange,
  guardPulse = 0,
}: {
  employee: Employee;
  companyName: string;
  models: PiAgentModelOption[] | undefined;
  modelsLoading: boolean;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Counter bumped by the roster's guarded select when a switch is blocked
   *  by unsaved edits; each bump pulses the save bar once. */
  guardPulse?: number;
}) {
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: profileDefaults(employee),
    mode: 'onChange',
  });
  const baselineProfile = useRef<ProfileFormValues>(profileDefaults(employee));
  // Held in a ref (like profile) and advanced explicitly on save, so the
  // dirty/reset baseline doesn't lag behind the post-save query refetch.
  const baselineAppearance = useRef<AppearanceDraft>(appearanceDraftFor(employee));
  const [appearance, setAppearance] = useState<AppearanceDraft>(appearanceDraftFor(employee));
  const baselineRuntime = useRef({
    model: employee.model ?? '',
    thinkingLevel: employee.thinkingLevel ?? '',
  });
  const [model, setModel] = useState(employee.model ?? '');
  const [thinkingLevel, setThinkingLevel] = useState(employee.thinkingLevel ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [guardPulsing, setGuardPulsing] = useState(false);
  // Initialize to the mount-time value so a remount (employee switch) doesn't
  // replay a pulse from a previous block.
  const lastGuardPulse = useRef(guardPulse);

  useEffect(() => {
    if (guardPulse === lastGuardPulse.current) return;
    lastGuardPulse.current = guardPulse;
    // Drop the class for one frame so a repeat block restarts the animation;
    // the save bar's onAnimationEnd clears it when the CSS pulse finishes, so
    // the duration lives only in personnel.css.
    setGuardPulsing(false);
    const raf = requestAnimationFrame(() => setGuardPulsing(true));
    return () => cancelAnimationFrame(raf);
  }, [guardPulse]);

  const appearanceDirty = appearanceKey(appearance) !== appearanceKey(baselineAppearance.current);
  const runtimeDirty =
    model !== baselineRuntime.current.model ||
    thinkingLevel !== baselineRuntime.current.thinkingLevel;
  const isDirty = form.formState.isDirty || appearanceDirty || runtimeDirty;
  const nameValid = form.watch('name').trim().length > 0;
  const canSave = isDirty && !isSaving && employee.kind !== 'external' && nameValid;

  // Report dirty state up so the roster can guard against discarding unsaved
  // edits on an employee switch. Clear on unmount so a stale flag can't block.
  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: form is stable from useForm; re-hydrate only when switching employees.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const repos = await reposOrNull();
      const row = repos ? await repos.employees.findById(employee.id) : null;
      if (cancelled || !row) return;
      const persona = safeJsonRecord(row.persona_json);
      // Hydrate the form from the real saved persona so an untouched Save can't
      // overwrite it with the stub defaults; reset clears dirty state.
      const hydrated = profileDefaultsFromRecord(employee, persona);
      baselineProfile.current = hydrated;
      const hydratedRuntime = {
        model: row.model?.trim() ?? '',
        thinkingLevel: row.thinking_level?.trim() ?? '',
      };
      baselineRuntime.current = hydratedRuntime;
      setModel(hydratedRuntime.model);
      setThinkingLevel(hydratedRuntime.thinkingLevel);
      form.reset(hydrated);
    })();
    return () => {
      cancelled = true;
    };
  }, [employee.id]);

  const onSave = async () => {
    if (!canSave) return;
    const values = form.getValues();
    setIsSaving(true);
    setSaveError(null);
    try {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Saving an employee requires the desktop runtime');
      const row = await repos.employees.findById(employee.id);
      if (!row) throw new Error('Employee no longer exists');

      const persona = safeJsonRecord(row.persona_json);
      persona.profile = {
        expertise: values.expertise,
        workingStyle: values.workingStyle,
        communication: values.communication,
        risk: values.risk,
        decisionStyle: values.decisionStyle,
        customInstructions: values.customInstructions,
      };
      if (appearanceDirty) persona.appearance = appearancePayload(appearance);

      // Snapshot a version around the save so the History tab reflects this
      // real edit (PE1). The employee.update itself is the `performUpdate` body.
      await recordEmployeeVersionOnSave({
        repos,
        employeeId: employee.id,
        performUpdate: () =>
          repos.employees.update(employee.id, {
            name: values.name.trim(),
            role_slug: roleSlug(values.role),
            enabled: values.enabled ? 1 : 0,
            persona_json: JSON.stringify(persona),
            model: model || null,
            thinking_level: model && thinkingLevel ? thinkingLevel : null,
          }),
      });
      await queryClient.invalidateQueries({ queryKey: ['employees', companyId] });
      await queryClient.invalidateQueries({
        queryKey: ['personnel', 'versions', employee.id],
      });
      baselineProfile.current = values;
      baselineAppearance.current = appearance;
      baselineRuntime.current = { model, thinkingLevel: model ? thinkingLevel : '' };
      if (!model) setThinkingLevel('');
      form.reset(values);
      toast.success(`${employee.name} saved`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Employee save failed';
      setSaveError(message);
      toast.error('Employee save failed', { description: message });
    } finally {
      setIsSaving(false);
    }
  };

  const onReset = () => {
    form.reset(baselineProfile.current);
    setAppearance(baselineAppearance.current);
    setModel(baselineRuntime.current.model);
    setThinkingLevel(baselineRuntime.current.thinkingLevel);
    setSaveError(null);
  };

  const onDelete = async () => {
    try {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Employee deletion requires the desktop runtime');
      const row = await repos.employees.findById(employee.id);
      if (!row) {
        useUiState.getState().selectEmployee(null);
        await queryClient.invalidateQueries({ queryKey: ['employees', companyId] });
        toast.error('Employee no longer exists');
        return;
      }
      await repos.employees.delete(employee.id);
      useUiState.getState().selectEmployee(null);
      await queryClient.invalidateQueries({ queryKey: ['employees', companyId] });
      toast.success(`${employee.name} removed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Employee delete failed';
      toast.error('Employee delete failed', { description: message });
    }
  };

  return (
    <>
      <DetailHeader
        employee={employee}
        validModels={models ? new Set(models.map((option) => option.value)) : undefined}
      />
      <Tabs value={tab} onValueChange={(value) => onTabChange(value as InspectorTab)}>
        <TabsList className="off-pers-insp-tabs" aria-label="Employee inspector">
          {INSPECTOR_TABS.map((entry) => (
            <TabsTrigger
              key={entry.key}
              value={entry.key}
              className={cn('off-pers-tab off-focusable', tab === entry.key && 'is-active')}
            >
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="off-pers-insp-body">
        {tab === 'profile' ? (
          <ProfileTab employee={employee} companyName={companyName} form={form} />
        ) : null}
        {tab === 'skills' ? <SkillsTab employeeId={employee.id} /> : null}
        {tab === 'tools' ? <McpToolsTab employeeId={employee.id} /> : null}
        {tab === 'memory' ? <MemoryTab employeeId={employee.id} /> : null}
        {tab === 'appearance' ? (
          <AppearanceTab employee={employee} draft={appearance} onChange={setAppearance} />
        ) : null}
        {tab === 'runtime' ? (
          <RuntimeTab
            employee={employee}
            models={models}
            modelsLoading={modelsLoading}
            model={model}
            thinkingLevel={thinkingLevel}
            onModelChange={(value) => {
              setModel(value);
              if (!value) setThinkingLevel('');
            }}
            onThinkingLevelChange={setThinkingLevel}
          />
        ) : null}
        {tab === 'history' ? <HistoryTab employeeId={employee.id} /> : null}
      </div>
      {tab === 'profile' || tab === 'appearance' || tab === 'runtime' ? (
        <>
          {saveError ? <div className="off-pers-save-error">{saveError}</div> : null}
          <div
            className={cn('off-pers-savebar', guardPulsing && 'is-guard-pulse')}
            onAnimationEnd={(e) => {
              if (e.animationName === 'off-pers-guard-pulse') setGuardPulsing(false);
            }}
          >
            <div className="off-pers-savebar-left">
              {employee.kind === 'external' ? null : confirmingDelete ? (
                <div className="off-pers-del-confirm">
                  <span>Delete {employee.name}? This cannot be undone.</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      void onDelete();
                      setConfirmingDelete(false);
                    }}
                  >
                    Delete
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="destructive" size="sm" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex items-center gap-[var(--off-sp-3)]">
              <Button variant="outline" size="sm" disabled={!isDirty || isSaving} onClick={onReset}>
                Reset
              </Button>
              <Button size="sm" disabled={!canSave} onClick={() => void onSave()}>
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

function HireEmployeeDialog({
  companyId,
  open,
  onOpenChange,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const models = usePiAgentModels();
  const nameInputId = useId();
  const roleInputId = useId();
  const [name, setName] = useState('');
  const [role, setRole] = useState('Developer');
  const [model, setModel] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState('');
  const [appearanceSetup, setAppearanceSetup] = useState(createHireAppearance);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const canSubmit = name.trim().length > 0 && role.trim().length > 0 && !isSaving;

  const reset = () => {
    setName('');
    setRole('Developer');
    setModel('');
    setThinkingLevel('');
    setAppearanceSetup(createHireAppearance());
    setError(null);
    setIsSaving(false);
  };

  const onSubmit = async () => {
    if (!canSubmit) return;
    setIsSaving(true);
    setError(null);
    try {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Employee creation requires the release desktop app');
      const slug = roleSlug(role);
      const { employee_id } = await repos.employees.create({
        company_id: companyId,
        name: name.trim(),
        role_slug: slug,
        source_asset_id: null,
        source_package_id: null,
        persona_json: JSON.stringify(newEmployeePersona(appearanceSetup.draft)),
        config_json: '{}',
        model: model || null,
        thinking_level: model && thinkingLevel ? thinkingLevel : null,
      });
      await queryClient.invalidateQueries({ queryKey: ['employees', companyId] });
      useUiState.getState().selectEmployee(employee_id);
      toast.success(`${name.trim()} hired`);
      onOpenChange(false);
      reset();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Employee creation failed';
      setError(message);
      toast.error('Employee creation failed', { description: message });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="off-pers-hire-dialog">
        <DialogHeader>
          <DialogTitle>Hire employee</DialogTitle>
          <DialogDescription>
            Create an internal AI employee in the active company roster.
          </DialogDescription>
        </DialogHeader>
        <div className="off-pers-hire-form">
          <div className="off-pers-hire-field">
            <label htmlFor={nameInputId}>Name</label>
            <Input
              id={nameInputId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Mara Quinn"
              autoFocus
            />
          </div>
          <div className="off-pers-hire-field">
            <label htmlFor={`${roleInputId}-model`}>Model</label>
            <Select
              id={`${roleInputId}-model`}
              value={model}
              onChange={(event) => {
                const next = event.target.value;
                setModel(next);
                if (models.data?.find((option) => option.value === next)?.reasoning !== true) {
                  setThinkingLevel('');
                }
              }}
              disabled={models.isLoading}
              options={[
                {
                  value: '',
                  label: models.isLoading ? 'Loading Pi models…' : 'Inherit conversation model',
                },
                ...(models.data ?? []).map((option) => ({
                  value: option.value,
                  label: `${option.provider} · ${option.name}`,
                })),
              ]}
            />
          </div>
          <div className="off-pers-hire-field">
            <label htmlFor={`${roleInputId}-thinking`}>Thinking level</label>
            <Select
              id={`${roleInputId}-thinking`}
              value={thinkingLevel}
              onChange={(event) => setThinkingLevel(event.target.value)}
              disabled={
                !model || models.data?.find((option) => option.value === model)?.reasoning !== true
              }
              options={[
                { value: '', label: 'Use conversation level' },
                ...(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const).map((level) => ({
                  value: level,
                  label: level,
                })),
              ]}
            />
          </div>
          <div className="off-pers-hire-field">
            <label htmlFor={roleInputId}>Role</label>
            <Input
              id={roleInputId}
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="Frontend Engineer"
            />
          </div>
          <CompactAppearanceEditor
            seed={appearanceSetup.seed}
            role={role}
            draft={appearanceSetup.draft}
            onChange={(draft) => setAppearanceSetup((current) => ({ ...current, draft }))}
          />
          {error ? <p className="off-pers-hire-error">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="subtle" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            <Icon icon={UserPlus} size="sm" />
            {isSaving ? 'Hiring...' : 'Hire'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PersonnelSurface() {
  const employees = useEmployees();
  const models = usePiAgentModels();
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

  const roster = employees.data ?? [];
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

  // Reset to Profile when the selected employee changes (tab is local). Also
  // clear any lingering discard bar and the dirty flag — the freshly-mounted
  // EmployeeDetail re-reports its own dirty state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on selection change only
  useEffect(() => {
    setTab('profile');
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
          defaultSize="18%"
          minSize={PANEL_SIZE_TOKENS.personnelRailMin}
          collapsible
          collapsedSize={PANEL_SIZE_TOKENS.personnelRailCollapsed}
          onResize={(size) => setCollapsed(size.inPixels < 120)}
        >
          <RosterRail
            employees={roster}
            validModels={validModels}
            collapsed={collapsed}
            onToggleCollapse={onToggleList}
            onHire={() => setHireOpen(true)}
            canHire={canHire}
            hireDisabledReason={hireDisabledReason}
            onSelectEmployee={guardedSelect}
          />
        </Panel>

        <Separator className="off-resize-handle" />

        <Panel className="off-pers-detail" defaultSize="82%" minSize="50%">
          {selected ? (
            <EmployeeDetail
              key={selected.id}
              employee={selected}
              companyName={companyName}
              models={models.data}
              modelsLoading={models.isLoading}
              tab={tab}
              onTabChange={setTab}
              onDirtyChange={(d) => {
                dirtyRef.current = d;
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
