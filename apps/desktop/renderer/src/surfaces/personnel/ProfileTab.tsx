import type { Employee } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { SegmentedControl } from '@/design-system/grammar/SegmentedControl.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Input } from '@/design-system/primitives/input.js';
import { Switch } from '@/design-system/primitives/switch.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { useId, useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import {
  COMMUNICATION_OPTIONS,
  DECISION_STYLE_OPTIONS,
  PERSONA_RUNTIME_DEFAULTS,
  type ProfileFormValues,
  RISK_OPTIONS,
  buildSystemPrompt,
} from './personnel-data.js';

/** The persona system prompt this employee's runs actually receive, shown
 *  verbatim so the inspector never promises behavior the runtime doesn't apply. */
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
        System prompt sent to this employee
      </button>
      {open ? <pre>{text}</pre> : null}
    </div>
  );
}

interface ProfileTabProps {
  employee: Employee;
  companyName: string;
  form: UseFormReturn<ProfileFormValues>;
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

export function ProfileTab({ employee, companyName, form }: ProfileTabProps) {
  const nameId = useId();
  const expertiseId = useId();
  const workingStyleId = useId();
  const ciId = useId();
  const statusId = useId();
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
            <div className="off-field">
              <span className="off-field-label">Current workstation</span>
              <div className="off-pers-ro-inp">
                {employee.zoneLabel
                  ? `${employee.zoneLabel}${employee.deskLabel ? ` · ${employee.deskLabel}` : ''}`
                  : employee.workstationId
                    ? 'Assigned'
                    : 'Unassigned — assign a desk in Office'}
              </div>
              <p className="off-field-hint">
                Managed by the Office zone assignment flow so tool scope stays tied to the real
                workstation.
              </p>
            </div>
          </section>

          {/* Persona — these fields compose the employee's real Pi system prompt. */}
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
              <Textarea
                id={workingStyleId}
                rows={2}
                placeholder="e.g. detail-oriented, collaborative"
                {...register('workingStyle')}
              />
            </div>
            <Controller
              control={control}
              name="communication"
              render={({ field }) => (
                <div className="off-field">
                  <span className="off-field-label">Communication frequency</span>
                  <SegmentedControl<ProfileFormValues['communication']>
                    options={COMMUNICATION_OPTIONS}
                    value={field.value}
                    onChange={field.onChange}
                    ariaLabel="Communication frequency"
                  />
                  {field.value === '' ? (
                    <p className="off-field-hint">
                      Not set — runs as {PERSONA_RUNTIME_DEFAULTS.communication} until you choose.
                    </p>
                  ) : null}
                </div>
              )}
            />
            <Controller
              control={control}
              name="risk"
              render={({ field }) => (
                <div className="off-field">
                  <span className="off-field-label">Risk preference</span>
                  <SegmentedControl<ProfileFormValues['risk']>
                    options={RISK_OPTIONS}
                    value={field.value}
                    onChange={field.onChange}
                    ariaLabel="Risk preference"
                  />
                  {field.value === '' ? (
                    <p className="off-field-hint">
                      Not set — runs as {PERSONA_RUNTIME_DEFAULTS.risk} until you choose.
                    </p>
                  ) : null}
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
                  {field.value === '' ? (
                    <p className="off-field-hint">
                      Not set — runs as {PERSONA_RUNTIME_DEFAULTS.decisionStyle} until you choose.
                    </p>
                  ) : null}
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
              <p className="off-field-hint">
                Added as system instructions every time this employee runs.
              </p>
            </div>
            <SystemPromptPreview text={buildSystemPrompt(values, companyName)} />
          </section>
        </div>
      </div>
    </div>
  );
}
