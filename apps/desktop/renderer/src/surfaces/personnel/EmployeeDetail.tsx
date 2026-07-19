import { registerSurfaceLeaveGuard, useUiState } from '@/app/ui-state.js';
import type { AgentRuntimeModelOption } from '@/assistant/composer/usePiAgentModels.js';
import { displayRole, reposOrNull } from '@/data/adapters.js';
import { type EmployeeSeniority, employeeSeniorityLabel } from '@/data/employee-seniority.js';
import { queryKeys } from '@/data/query-keys.js';
import type { Employee, EmployeeAppearance } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/design-system/primitives/tabs.js';
import { cn } from '@/lib/utils.js';
import {
  clearDiscardConfirm,
  showDiscardConfirm,
} from '@/surfaces/lifecycle/DiscardConfirmToast.js';
import { zodResolver } from '@hookform/resolvers/zod';
import type { RoleSlug } from '@offisim/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { Ellipsis, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { AppearanceTab } from './AppearanceTab.js';
import { ExperienceTab } from './ExperienceTab.js';
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
  { key: 'experience', label: 'Experience' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'runtime', label: 'AI engine' },
  { key: 'history', label: 'History' },
] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number]['key'];

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

export function roleSlug(role: string): RoleSlug {
  const normalized = role.toLowerCase();
  if (
    normalized.includes('qa') ||
    normalized.includes('test') ||
    normalized.includes('audit') ||
    normalized.includes('quality')
  ) {
    return 'qa';
  }
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

export function newEmployeePersona(appearance: AppearanceDraft): Record<string, unknown> {
  // Profile selectors still start empty. Appearance is the one intentional
  // persona field because the hire dialog previews and edits this exact look.
  return { appearance: appearancePayload(appearance) };
}

export function createHireAppearance() {
  const seed = crypto.randomUUID();
  return { seed, draft: appearanceDraftForSeed(seed) };
}

function DetailHeader({
  employee,
  seniority,
  validModels,
  onDeleteRequest,
}: {
  employee: Employee;
  seniority: EmployeeSeniority | undefined;
  validModels: ReadonlySet<string> | undefined;
  onDeleteRequest: () => void;
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
      <div className="off-pers-detail-actions">
        <div className="off-pers-detail-pills">
          {seniority ? (
            <span className={`off-pers-career-pill is-level-${seniority.level}`}>
              {employeeSeniorityLabel(seniority)}
            </span>
          ) : null}
          {employee.kind === 'internal' ? (
            <span className={cn('off-pers-st-pill', invalidModel && 'is-off')}>
              {invalidModel
                ? 'AI unavailable · conversation default'
                : employee.model || 'Conversation default'}
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
        {employee.kind === 'internal' ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="iconSm"
                aria-label={`Actions for ${employee.name}`}
                title="Employee actions"
              >
                <Icon icon={Ellipsis} size="sm" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Danger Zone</DropdownMenuLabel>
              <DropdownMenuItem className="is-danger" onSelect={onDeleteRequest}>
                <Icon icon={Trash2} size="sm" />
                Delete employee…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
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
export function EmployeeDetail({
  employee,
  seniority,
  companyName,
  models,
  modelsLoading,
  tab,
  onTabChange,
  onDirtyChange,
  onDeleted,
  guardPulse = 0,
}: {
  employee: Employee;
  seniority: EmployeeSeniority | undefined;
  companyName: string;
  models: AgentRuntimeModelOption[] | undefined;
  modelsLoading: boolean;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onDeleted: () => void;
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
  const [isDeleting, setIsDeleting] = useState(false);
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
      await queryClient.invalidateQueries({ queryKey: queryKeys.employees(companyId) });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.employeeVersions(employee.id),
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

  const onReset = useCallback(() => {
    form.reset(baselineProfile.current);
    setAppearance(baselineAppearance.current);
    setModel(baselineRuntime.current.model);
    setThinkingLevel(baselineRuntime.current.thinkingLevel);
    setSaveError(null);
  }, [form]);

  useEffect(() => {
    if (!isDirty) return;
    const unregister = registerSurfaceLeaveGuard('personnel', ({ proceed, cancel }) => {
      showDiscardConfirm({
        message: 'Discard unsaved employee changes?',
        detail: 'Leaving Personnel will lose the edits you have not saved.',
        onDiscard: () => {
          onReset();
          proceed();
        },
        onKeep: cancel,
      });
      return false;
    });
    return () => {
      unregister();
      clearDiscardConfirm();
    };
  }, [isDirty, onReset]);

  const onDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      const repos = await reposOrNull();
      if (!repos) throw new Error('Employee deletion requires the desktop runtime');
      const row = await repos.employees.findById(employee.id);
      if (!row) {
        onDeleted();
        await queryClient.invalidateQueries({ queryKey: queryKeys.employees(companyId) });
        toast.info(`${employee.name} was already removed`);
        return;
      }
      await repos.employees.delete(employee.id);
      onDeleted();
      await queryClient.invalidateQueries({ queryKey: queryKeys.employees(companyId) });
      toast.success(`${employee.name} removed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Employee delete failed';
      toast.error('Employee delete failed', { description: message });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <DetailHeader
        employee={employee}
        seniority={seniority}
        validModels={models ? new Set(models.map((option) => option.value)) : undefined}
        onDeleteRequest={() => setConfirmingDelete(true)}
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
        <div className="off-pers-insp-body">
          <TabsContent value="profile" className="off-pers-tab-panel">
            <ProfileTab
              employee={employee}
              seniority={seniority}
              companyName={companyName}
              form={form}
            />
          </TabsContent>
          <TabsContent value="skills" className="off-pers-tab-panel">
            <SkillsTab employeeId={employee.id} />
          </TabsContent>
          <TabsContent value="tools" className="off-pers-tab-panel">
            <McpToolsTab employeeId={employee.id} />
          </TabsContent>
          <TabsContent value="memory" className="off-pers-tab-panel">
            <MemoryTab employeeId={employee.id} />
          </TabsContent>
          <TabsContent value="experience" className="off-pers-tab-panel">
            <ExperienceTab employeeId={employee.id} companyId={companyId} />
          </TabsContent>
          <TabsContent value="appearance" className="off-pers-tab-panel">
            <AppearanceTab employee={employee} draft={appearance} onChange={setAppearance} />
          </TabsContent>
          <TabsContent value="runtime" className="off-pers-tab-panel">
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
          </TabsContent>
          <TabsContent value="history" className="off-pers-tab-panel">
            <HistoryTab employeeId={employee.id} />
          </TabsContent>
        </div>
      </Tabs>
      {tab === 'profile' || tab === 'appearance' || tab === 'runtime' || isDirty ? (
        <>
          {saveError ? <div className="off-pers-save-error">{saveError}</div> : null}
          <div
            className={cn('off-pers-savebar', guardPulsing && 'is-guard-pulse')}
            onAnimationEnd={(e) => {
              if (e.animationName === 'off-pers-guard-flash') setGuardPulsing(false);
            }}
          >
            {isDirty ? <span className="off-pers-save-status">Unsaved changes</span> : <span />}
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
      <Dialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          if (!isDeleting) setConfirmingDelete(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {employee.name}?</DialogTitle>
            <DialogDescription>
              This removes {employee.name} from Personnel and Office. Past work and conversations
              stay readable, but this employee cannot be restored.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="subtle"
              onClick={() => setConfirmingDelete(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void onDelete()} disabled={isDeleting}>
              <Icon icon={Trash2} size="sm" />
              {isDeleting ? 'Deleting…' : `Delete ${employee.name}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
