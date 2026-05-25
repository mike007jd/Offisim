import { useEmployeeSkills } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Chip } from '@/design-system/grammar/Chip.js';
import { SegmentedControl } from '@/design-system/grammar/SegmentedControl.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { Input } from '@/design-system/primitives/input.js';
import { Switch } from '@/design-system/primitives/switch.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { cn } from '@/lib/utils.js';
import {
  Bolt,
  ChevronDown,
  ChevronRight,
  FileText,
  Link2,
  Lock,
  Puzzle,
  Save,
  Search,
} from 'lucide-react';
import { useId, useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import {
  BUILTIN_TOOLS,
  type BuiltinTool,
  COMMUNICATION_OPTIONS,
  DECISION_STYLE_OPTIONS,
  MODEL_FAMILY_OPTIONS,
  MODEL_MODE_OPTIONS,
  MODEL_SUGGESTION_CHIPS,
  type ProfileFormValues,
  RISK_OPTIONS,
  TOOL_DEFAULT_MODE_OPTIONS,
  type ToolDefaultMode,
  type ToolPermissionState,
  type ToolPermissions,
  WORKSTATION_OPTIONS,
  buildSystemPrompt,
} from './personnel-data.js';

const TOOL_ICONS = {
  read: FileText,
  write: Save,
  bash: Bolt,
  grep: Search,
  fetch: Link2,
} as const;

const TRI_OPTIONS: ReadonlyArray<{ value: ToolPermissionState; label: string }> = [
  { value: 'allow', label: 'Allow' },
  { value: 'ask', label: 'Ask' },
  { value: 'deny', label: 'Deny' },
];

function TriStateSeg({
  value,
  onChange,
}: {
  value: ToolPermissionState;
  onChange: (v: ToolPermissionState) => void;
}) {
  return (
    <div className="off-pers-tri">
      {TRI_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          className={cn(
            'off-pers-tri-btn off-focusable',
            option.value === value && `is-on is-${option.value}`,
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ToolPermissionEditor({
  value,
  onChange,
}: {
  value: ToolPermissions;
  onChange: (next: ToolPermissions) => void;
}) {
  return (
    <section className="off-pers-prof-sec">
      <CapsLabel>Default approval mode</CapsLabel>
      <SegmentedControl<ToolDefaultMode>
        options={TOOL_DEFAULT_MODE_OPTIONS}
        value={value.defaultMode}
        onChange={(mode) => onChange({ ...value, defaultMode: mode })}
        ariaLabel="Default approval mode"
      />
      <CapsLabel className="mt-[var(--off-sp-1)]">Per-tool overrides</CapsLabel>
      <div className="off-pers-toolperm">
        {BUILTIN_TOOLS.map((tool: BuiltinTool) => (
          <div key={tool.id} className="off-pers-toolperm-row">
            <Icon icon={TOOL_ICONS[tool.icon]} size="sm" className="text-[var(--off-ink-3)]" />
            <div className="off-pers-toolperm-meta">
              <div className="off-pers-toolperm-name">{tool.name}</div>
              <div className="off-pers-toolperm-desc">{tool.description}</div>
            </div>
            <TriStateSeg
              value={value.overrides[tool.id] ?? 'ask'}
              onChange={(state) =>
                onChange({ ...value, overrides: { ...value.overrides, [tool.id]: state } })
              }
            />
          </div>
        ))}
      </div>
      <p className="off-field-hint">
        External brand peers don't expose this — their tool surface is owned by the remote A2A
        endpoint.
      </p>
    </section>
  );
}

function SystemPromptPreview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="off-pers-sysprompt">
      <button
        type="button"
        className="off-focusable"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon icon={open ? ChevronDown : ChevronRight} size="sm" />
        System Prompt Preview
      </button>
      {open ? <pre>{text}</pre> : null}
    </div>
  );
}

function EmbeddedSkills({ employeeId }: { employeeId: string }) {
  const skills = useEmployeeSkills(employeeId);
  if (!skills.data?.length) {
    return (
      <div className="off-pers-sk-empty">
        <Icon icon={Puzzle} size="md" />
        <p>
          No skills available. Skills installed from the marketplace or created locally will appear
          here.
        </p>
      </div>
    );
  }
  return (
    <>
      {skills.data.map((skill) => (
        <div key={skill.id} className="off-pers-skrow">
          <Icon icon={Puzzle} size="sm" />
          <div className="off-pers-skrow-main">
            <div className="off-pers-skrow-top">
              <span className="off-pers-skrow-name">{skill.name}</span>
              <span className="off-pers-scope-tag">{skill.scope}</span>
            </div>
            <p className="off-pers-skrow-desc">{skill.description}</p>
          </div>
        </div>
      ))}
    </>
  );
}

interface ProfileTabProps {
  employee: Employee;
  companyName: string;
  form: UseFormReturn<ProfileFormValues>;
  toolPermissions: ToolPermissions;
  onToolPermissionsChange: (next: ToolPermissions) => void;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
  onSave: () => void;
  onDelete: () => void;
}

/** Read-only external (A2A) profile — brand-managed, no form/save. */
function ExternalProfile({ employee }: { employee: Employee }) {
  return (
    <div className="off-pers-prof-grid">
      <div className="off-pers-brand-banner">
        <Icon icon={Lock} size="sm" />
        <span>
          Brand-managed · <b>{employee.brandLabel ?? employee.role}</b> · agent card — fields are
          read-only here.
        </span>
      </div>
      <div className="off-field">
        <span className="off-field-label">Name</span>
        <div className="off-pers-ro-inp">{employee.name}</div>
      </div>
      <div className="off-field">
        <span className="off-field-label">Role</span>
        <div className="off-pers-ro-inp">{employee.role}</div>
      </div>
      <div className="off-field">
        <span className="off-field-label">Capabilities</span>
        <div className="off-pers-ro-inp is-area">{(employee.expertise ?? []).join(' · ')}</div>
      </div>
    </div>
  );
}

export function ProfileTab({
  employee,
  companyName,
  form,
  toolPermissions,
  onToolPermissionsChange,
  isDirty,
  isSaving,
  saveError,
  onSave,
  onDelete,
}: ProfileTabProps) {
  const nameId = useId();
  const expertiseId = useId();
  const workingStyleId = useId();
  const tempId = useId();
  const maxTokensId = useId();
  const overrideId = useId();
  const ciId = useId();
  const statusId = useId();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (employee.kind === 'external') {
    return (
      <div className="off-pers-tab-shell">
        <div className="off-pers-tab-scroll">
          <ExternalProfile employee={employee} />
        </div>
      </div>
    );
  }

  const { control, register, watch, formState } = form;
  const values = watch();
  const nameError = formState.errors.name?.message;
  const canSave = isDirty && values.name.trim().length > 0 && !isSaving;
  const modelMode = values.modelMode;

  return (
    <div className="off-pers-tab-shell">
      <div className="off-pers-tab-scroll">
        <div className="off-pers-prof-grid">
          {/* Identity */}
          <section className="off-pers-prof-sec">
            <CapsLabel>Identity</CapsLabel>
            <div className="off-field">
              <label className="off-field-label" htmlFor={nameId}>
                Name
              </label>
              <Input id={nameId} {...register('name')} aria-invalid={Boolean(nameError)} />
              {nameError ? <p className="off-field-hint is-warn">{nameError}</p> : null}
            </div>
            <div className="off-field">
              <label className="off-field-label" htmlFor={`${nameId}-role`}>
                Role
              </label>
              <Input id={`${nameId}-role`} {...register('role')} />
            </div>
            <div className="off-field">
              <label className="off-field-label" htmlFor={statusId}>
                Status
              </label>
              <Controller
                control={control}
                name="enabled"
                render={({ field }) => (
                  <div className="off-pers-switch-row">
                    <Switch id={statusId} checked={field.value} onCheckedChange={field.onChange} />
                    <span>{field.value ? 'Enabled' : 'Disabled'}</span>
                  </div>
                )}
              />
            </div>
            <Controller
              control={control}
              name="workstation"
              render={({ field }) => (
                <div className="off-field">
                  <label className="off-field-label" htmlFor={`${nameId}-ws`}>
                    Assign workstation
                  </label>
                  <Select
                    id={`${nameId}-ws`}
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    options={WORKSTATION_OPTIONS}
                  />
                  <p className="off-field-hint">MCP tools enabled</p>
                </div>
              )}
            />
          </section>

          {/* Persona */}
          <section className="off-pers-prof-sec">
            <CapsLabel>Persona</CapsLabel>
            <div className="off-field">
              <label className="off-field-label" htmlFor={expertiseId}>
                Expertise
              </label>
              <Textarea id={expertiseId} rows={2} {...register('expertise')} />
            </div>
            <div className="off-field">
              <label className="off-field-label" htmlFor={workingStyleId}>
                Working style
              </label>
              <Textarea id={workingStyleId} rows={2} {...register('workingStyle')} />
            </div>
            <Controller
              control={control}
              name="communication"
              render={({ field }) => (
                <div className="off-field">
                  <span className="off-field-label">Communication frequency</span>
                  <SegmentedControl
                    options={COMMUNICATION_OPTIONS}
                    value={field.value}
                    onChange={field.onChange}
                    ariaLabel="Communication frequency"
                  />
                </div>
              )}
            />
            <Controller
              control={control}
              name="risk"
              render={({ field }) => (
                <div className="off-field">
                  <span className="off-field-label">Risk preference</span>
                  <SegmentedControl
                    options={RISK_OPTIONS}
                    value={field.value}
                    onChange={field.onChange}
                    ariaLabel="Risk preference"
                  />
                </div>
              )}
            />
            <Controller
              control={control}
              name="decisionStyle"
              render={({ field }) => (
                <div className="off-field">
                  <label className="off-field-label" htmlFor={`${expertiseId}-ds`}>
                    Decision style
                  </label>
                  <Select
                    id={`${expertiseId}-ds`}
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    options={DECISION_STYLE_OPTIONS}
                  />
                </div>
              )}
            />
            <div className="off-field">
              <label className="off-field-label" htmlFor={ciId}>
                Custom instructions
              </label>
              <Textarea
                id={ciId}
                rows={3}
                placeholder="Additional instructions for this employee's behavior…"
                {...register('customInstructions')}
              />
            </div>
            <SystemPromptPreview text={buildSystemPrompt(values, companyName)} />
          </section>

          {/* Permissions */}
          <ToolPermissionEditor value={toolPermissions} onChange={onToolPermissionsChange} />

          {/* Config */}
          <section className="off-pers-prof-sec">
            <CapsLabel>Config</CapsLabel>
            <Controller
              control={control}
              name="modelMode"
              render={({ field }) => (
                <div className="off-field">
                  <span className="off-field-label">Model mode</span>
                  <SegmentedControl
                    options={MODEL_MODE_OPTIONS}
                    value={field.value}
                    onChange={field.onChange}
                    wrap
                    ariaLabel="Model mode"
                  />
                  <p className="off-field-hint">
                    {field.value === 'inherit'
                      ? 'Uses the company-wide model from Settings > Provider.'
                      : 'This employee will use the explicit model below.'}
                  </p>
                </div>
              )}
            />
            {modelMode === 'custom' ? (
              <>
                <Controller
                  control={control}
                  name="modelFamily"
                  render={({ field }) => (
                    <div className="off-field">
                      <label className="off-field-label" htmlFor={`${overrideId}-fam`}>
                        Model family
                      </label>
                      <Select
                        id={`${overrideId}-fam`}
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        options={MODEL_FAMILY_OPTIONS}
                      />
                    </div>
                  )}
                />
                <div className="off-field">
                  <label className="off-field-label" htmlFor={overrideId}>
                    Override model
                  </label>
                  <Input
                    id={overrideId}
                    placeholder="e.g. MiniMax-M2.7, GLM-5.1, openai/gpt-oss-120b:free"
                    {...register('modelOverride')}
                  />
                  <div className="off-pers-chips">
                    {MODEL_SUGGESTION_CHIPS.map((chip) => (
                      <Chip
                        key={chip}
                        as="button"
                        onClick={() =>
                          form.setValue('modelOverride', chip, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                      >
                        {chip}
                      </Chip>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
            <div className="off-field">
              <label className="off-field-label" htmlFor={tempId}>
                Temperature
              </label>
              <Input
                id={tempId}
                type="number"
                step="0.1"
                {...register('temperature', { valueAsNumber: true })}
              />
            </div>
            <div className="off-field">
              <label className="off-field-label" htmlFor={maxTokensId}>
                Max tokens
              </label>
              <Input
                id={maxTokensId}
                type="number"
                {...register('maxTokens', { valueAsNumber: true })}
              />
              {modelMode === 'custom' && Number(values.maxTokens) < 1024 ? (
                <p className="off-field-hint is-warn">
                  Some models (e.g. MiniMax) use tokens for thinking. Recommend max tokens ≥ 1024.
                </p>
              ) : null}
            </div>
          </section>

          {/* Embedded skills */}
          <section className="off-pers-prof-sec">
            <CapsLabel>Skills</CapsLabel>
            <EmbeddedSkills employeeId={employee.id} />
          </section>
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="off-pers-savebar">
        <div className="off-pers-savebar-left">
          {confirmingDelete ? (
            <div className="off-pers-del-confirm">
              <span>Delete {employee.name}? This cannot be undone.</span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  onDelete();
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
        <Button size="sm" disabled={!canSave} onClick={onSave}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {saveError ? <div className="off-pers-save-error">{saveError}</div> : null}
    </div>
  );
}
