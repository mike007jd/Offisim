import { useUiState } from '@/app/ui-state.js';
import { isTauriRuntime, reposOrNull } from '@/data/adapters.js';
import { useCompanies, useEmployees } from '@/data/queries.js';
import type { Employee, EmployeeAppearance, EmployeePresence } from '@/data/types.js';
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
import { EmptyState, ErrorState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { zodResolver } from '@hookform/resolvers/zod';
import type { RoleSlug } from '@offisim/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import {
  PanelLeftClose,
  PanelLeftOpen,
  SearchX,
  Store,
  UserPlus,
  UsersRound,
  Zap,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
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
  profileDefaultsFromRecord,
  profileFormSchema,
} from './personnel-data.js';

const INSPECTOR_TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'runtime', label: 'Runtime' },
  { key: 'skills', label: 'Skills' },
  { key: 'memory', label: 'Memory' },
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

function titleizeRole(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function toolDefaultToRuntime(mode: ToolPermissions['defaultMode']): string {
  if (mode === 'auto-allow') return 'auto';
  if (mode === 'deny-all') return 'deny';
  return 'always_ask';
}

function toolStateToRuntime(state: string): string {
  if (state === 'allow') return 'auto';
  if (state === 'deny') return 'deny';
  return 'always_ask';
}

function runtimeDefaultToTool(mode: unknown): ToolPermissions['defaultMode'] {
  if (mode === 'auto') return 'auto-allow';
  if (mode === 'deny') return 'deny-all';
  return 'ask-each';
}

function runtimeStateToTool(mode: unknown): 'allow' | 'ask' | 'deny' {
  if (mode === 'auto') return 'allow';
  if (mode === 'deny') return 'deny';
  return 'ask';
}

function toolPermissionsFromConfig(config: Record<string, unknown>): ToolPermissions {
  const legacy = config.toolPermissions;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    const raw = legacy as { defaultMode?: unknown; overrides?: unknown };
    const fallback = defaultToolPermissions();
    return {
      defaultMode:
        raw.defaultMode === 'auto-allow' ||
        raw.defaultMode === 'ask-each' ||
        raw.defaultMode === 'deny-all'
          ? raw.defaultMode
          : fallback.defaultMode,
      overrides:
        raw.overrides && typeof raw.overrides === 'object' && !Array.isArray(raw.overrides)
          ? {
              ...fallback.overrides,
              ...(raw.overrides as Record<string, 'allow' | 'ask' | 'deny'>),
            }
          : fallback.overrides,
    };
  }

  const policy = config.toolPermissionPolicy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy))
    return defaultToolPermissions();
  const raw = policy as { defaultMode?: unknown; overrides?: unknown };
  const next = defaultToolPermissions();
  next.defaultMode = runtimeDefaultToTool(raw.defaultMode);
  if (Array.isArray(raw.overrides)) {
    for (const override of raw.overrides) {
      if (!override || typeof override !== 'object') continue;
      const item = override as { pattern?: unknown; mode?: unknown };
      if (typeof item.pattern !== 'string') continue;
      next.overrides[item.pattern] = runtimeStateToTool(item.mode);
    }
  }
  return next;
}

function toolPermissionPolicyFromUi(value: ToolPermissions) {
  return {
    defaultMode: toolDefaultToRuntime(value.defaultMode),
    overrides: Object.entries(value.overrides).map(([pattern, mode]) => ({
      pattern,
      mode: toolStateToRuntime(mode),
    })),
  };
}

function newEmployeePersona(role: string): Record<string, unknown> {
  return {
    profile: {
      expertise: [],
      workingStyle: 'Generalist',
      communication: 'Concise',
      risk: 'balanced',
      decisionStyle: 'Ask when scope changes',
      customInstructions: `${titleizeRole(role)} hired from Personnel.`,
    },
  };
}

function newEmployeeConfig(): Record<string, unknown> {
  return {
    modelPreference: null,
    modelSettings: {
      family: 'default',
      temperature: 0.4,
      maxTokens: 2048,
    },
    toolPermissionPolicy: toolPermissionPolicyFromUi(defaultToolPermissions()),
  };
}

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
}: {
  employee: Employee;
  selected: boolean;
  collapsed: boolean;
  onSelect: () => void;
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
        <output className="off-pers-retry-chip" aria-label="Recovery pending">
          <Icon icon={Zap} size="sm" />
          Recovery pending
        </output>
      ) : null}
    </div>
  );
}

function RosterRail({
  employees,
  collapsed,
  onToggleCollapse,
  onHire,
  canHire,
}: {
  employees: Employee[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onHire: () => void;
  canHire: boolean;
}) {
  const selectedEmployeeId = useUiState((s) => s.selectedEmployeeId);
  const selectEmployee = useUiState((s) => s.selectEmployee);
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
              label="Hire employee"
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
              selected={employee.id === selectedEmployeeId}
              collapsed={collapsed}
              onSelect={() => selectEmployee(employee.id)}
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

function appearancePayload(draft: AppearanceDraft): EmployeeAppearance {
  return {
    skinColor: draft.skinColor,
    hairColor: draft.hairColor,
    clothingColor: draft.clothingColor,
    accentColor: draft.accentColor,
    hairStyle: draft.hairStyle,
    bodyType: draft.bodyType,
    gender: draft.gender,
    accentVariant: draft.accentVariant,
  };
}

function appearanceKey(draft: AppearanceDraft): string {
  return JSON.stringify(appearancePayload(draft));
}

function EmployeeDetail({ employee }: { employee: Employee }) {
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
  const [appearance, setAppearance] = useState<AppearanceDraft>(appearanceDraftFor(employee));
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const baselineAppearance = appearanceDraftFor(employee);
  const appearanceDirty = appearanceKey(appearance) !== appearanceKey(baselineAppearance);

  const saveAppearance = async () => {
    setSavingAppearance(true);
    setAppearanceError(null);
    try {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Appearance save requires the desktop runtime');
      const row = await repos.employees.findById(employee.id);
      if (!row) throw new Error('Employee no longer exists');
      const persona = safeJsonRecord(row.persona_json);
      persona.appearance = appearancePayload(appearance);
      await repos.employees.update(employee.id, {
        persona_json: JSON.stringify(persona),
      });
      await queryClient.invalidateQueries({ queryKey: ['employees', companyId] });
      toast.success(`${employee.name} appearance saved`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Appearance save failed';
      setAppearanceError(message);
      toast.error('Appearance save failed', { description: message });
    } finally {
      setSavingAppearance(false);
    }
  };

  return (
    <>
      <DetailHeader employee={employee} />
      <div className="off-pers-detail-body">
        <AppearanceTab employee={employee} draft={appearance} onChange={setAppearance} />
      </div>
      <div className="off-pers-savebar">
        <span className="off-pers-savebar-left">
          {appearanceError ? <span className="off-pers-save-error">{appearanceError}</span> : null}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!appearanceDirty || savingAppearance}
          onClick={() => setAppearance(baselineAppearance)}
        >
          Reset
        </Button>
        <Button size="sm" disabled={!appearanceDirty || savingAppearance} onClick={saveAppearance}>
          {savingAppearance ? 'Saving...' : 'Save appearance'}
        </Button>
      </div>
    </>
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
  const queryClient = useQueryClient();
  const companyId = useUiState((s) => s.companyId);
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: profileDefaults(employee),
    mode: 'onChange',
  });
  const [toolPermissions, setToolPermissions] = useState<ToolPermissions>(defaultToolPermissions());
  const [toolPermissionsDirty, setToolPermissionsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isDirty = form.formState.isDirty || toolPermissionsDirty;

  // biome-ignore lint/correctness/useExhaustiveDependencies: form is stable from useForm; re-hydrate only when switching employees.
  useEffect(() => {
    let cancelled = false;
    setToolPermissions(defaultToolPermissions());
    setToolPermissionsDirty(false);
    void (async () => {
      const repos = await reposOrNull();
      const row = repos ? await repos.employees.findById(employee.id) : null;
      if (cancelled || !row) return;
      const persona = safeJsonRecord(row.persona_json);
      const config = safeJsonRecord(row.config_json);
      // Hydrate the form from the real saved persona so an untouched Save can't
      // overwrite it with the stub defaults; reset clears dirty state.
      form.reset(profileDefaultsFromRecord(employee, persona, config));
      setToolPermissions(toolPermissionsFromConfig(config));
      setToolPermissionsDirty(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [employee.id]);

  const onSave = async () => {
    const values = form.getValues();
    setIsSaving(true);
    setSaveError(null);
    try {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Employee profile save requires the desktop runtime');
      const row = await repos.employees.findById(employee.id);
      if (!row) throw new Error('Employee no longer exists');

      const persona = safeJsonRecord(row.persona_json);
      const config = safeJsonRecord(row.config_json);
      // persona.appearance already comes from the freshly-read row; do not
      // reinject the (possibly stale) query snapshot, which can clobber an
      // appearance just saved from the sibling appearance panel.
      persona.profile = {
        expertise: values.expertise,
        workingStyle: values.workingStyle,
        communication: values.communication,
        risk: values.risk,
        decisionStyle: values.decisionStyle,
        customInstructions: values.customInstructions,
      };
      config.modelPreference =
        values.modelMode === 'custom' && values.modelOverride.trim()
          ? values.modelOverride.trim()
          : null;
      config.modelSettings = {
        family: values.modelFamily,
        temperature: values.temperature,
        maxTokens: values.maxTokens,
      };
      if (toolPermissionsDirty) {
        config.toolPermissionPolicy = toolPermissionPolicyFromUi(toolPermissions);
        config.toolPermissions = undefined;
      }

      await repos.employees.update(employee.id, {
        name: values.name.trim(),
        role_slug: roleSlug(values.role),
        enabled: values.enabled ? 1 : 0,
        persona_json: JSON.stringify(persona),
        config_json: JSON.stringify(config),
      });
      await queryClient.invalidateQueries({ queryKey: ['employees', companyId] });
      form.reset(values);
      setToolPermissionsDirty(false);
      toast.success(`${employee.name} saved`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Employee save failed';
      setSaveError(message);
      toast.error('Employee save failed', { description: message });
    } finally {
      setIsSaving(false);
    }
  };

  const onDelete = async () => {
    try {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Employee deletion requires the desktop runtime');
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
        {tab === 'runtime' ? <RuntimeTab employee={employee} /> : null}
        {tab === 'skills' ? <SkillsTab employeeId={employee.id} /> : null}
        {tab === 'memory' ? <MemoryTab employeeId={employee.id} /> : null}
        {tab === 'history' ? <HistoryTab employeeId={employee.id} /> : null}
      </div>
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
  const nameInputId = useId();
  const roleInputId = useId();
  const [name, setName] = useState('');
  const [role, setRole] = useState('Developer');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const canSubmit = name.trim().length > 0 && role.trim().length > 0 && !isSaving;

  const reset = () => {
    setName('');
    setRole('Developer');
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
        persona_json: JSON.stringify(newEmployeePersona(slug)),
        config_json: JSON.stringify(newEmployeeConfig()),
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
            <label htmlFor={roleInputId}>Role</label>
            <Input
              id={roleInputId}
              value={role}
              onChange={(event) => setRole(event.target.value)}
              placeholder="Frontend Engineer"
            />
          </div>
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
  const companies = useCompanies();
  const companyId = useUiState((s) => s.companyId);
  const selectedEmployeeId = useUiState((s) => s.selectedEmployeeId);
  const collapsed = useUiState((s) => s.personnelRailCollapsed);
  const setCollapsed = useUiState((s) => s.setPersonnelRailCollapsed);
  const [tab, setTab] = useState<InspectorTab>('profile');
  const [hireOpen, setHireOpen] = useState(false);
  const listPanelRef = usePanelRef();

  const roster = employees.data ?? [];
  const selected = roster.find((e) => e.id === selectedEmployeeId) ?? null;

  // Reset to Profile when the selected employee changes (tab is local).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on selection change only
  useEffect(() => {
    setTab('profile');
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
  const canHire = isTauriRuntime();

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
      <>
        <div className="off-pers off-pers-empty-page">
          <div className="off-state">
            <span className="off-state-glyph">
              <Icon icon={UsersRound} size="md" />
            </span>
            <p className="off-state-title">Hire your first employee</p>
            <p className="off-state-desc">
              Build a roster of AI staff with their own persona, skills, memory, and runtime
              binding. Start from scratch or grab a vetted template from the marketplace.
            </p>
            <div className="off-pers-empty-actions">
              <Button
                size="sm"
                onClick={() => setHireOpen(true)}
                disabled={!canHire}
                title={canHire ? undefined : 'Employee creation requires the release desktop app'}
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
            collapsed={collapsed}
            onToggleCollapse={onToggleList}
            onHire={() => setHireOpen(true)}
            canHire={canHire}
          />
        </Panel>

        <Separator className="off-resize-handle" />

        <Panel className="off-pers-detail" defaultSize="44%" minSize="34%">
          {selected ? (
            <EmployeeDetail key={selected.id} employee={selected} />
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

        <Panel
          className="off-pers-insp"
          defaultSize="38%"
          minSize={PANEL_SIZE_TOKENS.personnelInspectorMin}
          maxSize={PANEL_SIZE_TOKENS.personnelInspectorMax}
        >
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
      <HireEmployeeDialog companyId={companyId} open={hireOpen} onOpenChange={setHireOpen} />
    </>
  );
}
