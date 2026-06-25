import { useUiState } from '@/app/ui-state.js';
import { useProjects } from '@/data/queries.js';
import { type CreateMissionResult, useCreateMission } from '@/data/missions.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { FieldRow } from '@/design-system/grammar/FieldRow.js';
import { Select } from '@/design-system/grammar/Select.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Input } from '@/design-system/primitives/input.js';
import { Switch } from '@/design-system/primitives/switch.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Plus, Target, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { EVALUATORS } from './mission-domain.js';

/**
 * UX-001 Mission Composer (PRD §24.2). A schema-backed form (RHF + Zod) that
 * authors a Verified Mission: a goal + ≥1 done-when criterion (description +
 * registered evaluator + declarative config + required toggle), plus optional
 * title / team strategy / permission mode / token budget. On submit it builds a
 * CreateMissionInput and calls MissionService.createMission + markReady through
 * the repos (`useCreateMission`), then navigates to the new mission's Control
 * view. It does NOT start the live agent loop.
 */

const TEAM_STRATEGIES = [
  { value: 'auto-team', label: 'Auto team' },
  { value: 'single', label: 'Single agent' },
  { value: 'team-required', label: 'Team required' },
] as const;

const PERMISSION_MODES = [
  { value: 'plan', label: 'Plan' },
  { value: 'ask', label: 'Ask' },
  { value: 'auto', label: 'Auto' },
  { value: 'full', label: 'Full' },
] as const;

const EVALUATOR_OPTIONS = EVALUATORS.map((e) => ({ value: e.id, label: e.label }));

// A criterion's config is authored as raw JSON text (the evaluator-appropriate
// shape); we validate it parses to an object on submit. The default per
// evaluator is injected when the evaluator changes.
const criterionSchema = z.object({
  description: z.string().trim().min(1, 'Describe what "done" means'),
  evaluatorId: z.string().min(1),
  configJson: z
    .string()
    .refine((v) => {
      try {
        const parsed = JSON.parse(v || '{}');
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
      } catch {
        return false;
      }
    }, 'Config must be a JSON object'),
  required: z.boolean(),
});

const schema = z.object({
  title: z.string().trim().max(120).optional(),
  goal: z.string().trim().min(1, 'A mission needs a goal'),
  teamStrategy: z.enum(['auto-team', 'single', 'team-required']),
  permissionMode: z.enum(['plan', 'ask', 'auto', 'full']),
  tokenBudget: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) > 0), 'Enter a positive number')
    .optional(),
  criteria: z.array(criterionSchema).min(1, 'Add at least one done-when criterion'),
});

type ComposerForm = z.infer<typeof schema>;

function defaultConfigFor(evaluatorId: string): string {
  const meta = EVALUATORS.find((e) => e.id === evaluatorId);
  return JSON.stringify(meta?.defaultConfig ?? {}, null, 2);
}

const FIRST_EVALUATOR = EVALUATORS[0]?.id ?? 'command_exit_zero';

function blankCriterion(): ComposerForm['criteria'][number] {
  return {
    description: '',
    evaluatorId: FIRST_EVALUATOR,
    configJson: defaultConfigFor(FIRST_EVALUATOR),
    required: true,
  };
}

interface MissionComposerProps {
  onCancel: () => void;
  onCreated: (result: CreateMissionResult) => void;
}

export function MissionComposer({ onCancel, onCreated }: MissionComposerProps) {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const projects = useProjects(companyId || null);
  const activeProject = projects.data?.find((p) => p.id === projectId) ?? null;

  const createMission = useCreateMission();
  const titleId = useId();
  const goalId = useId();

  const form = useForm<ComposerForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      goal: '',
      teamStrategy: 'auto-team',
      permissionMode: 'ask',
      tokenBudget: '',
      criteria: [blankCriterion()],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'criteria' });

  async function onSubmit(values: ComposerForm) {
    if (!companyId) {
      toast.error('Select or create a company first.');
      return;
    }
    const runtimePolicy = {
      teamStrategy: values.teamStrategy,
      permissionMode: values.permissionMode,
    };
    const budget = values.tokenBudget ? { tokenBudget: Number(values.tokenBudget) } : {};
    try {
      const result = await createMission.mutateAsync({
        companyId,
        projectId: projectId || null,
        title: values.title?.trim() || 'Untitled mission',
        goal: values.goal.trim(),
        runtimeId: 'pi',
        runtimePolicyJson: JSON.stringify(runtimePolicy),
        budgetJson: JSON.stringify(budget),
        criteria: values.criteria.map((c, index) => ({
          description: c.description.trim(),
          evaluatorId: c.evaluatorId,
          evaluatorConfigJson: c.configJson,
          required: c.required,
          orderIndex: index,
        })),
      });
      toast.success('Mission created', { description: 'Ready to run.' });
      onCreated(result);
    } catch (error) {
      toast.error('Could not create mission', { description: safeErrorMessage(error) });
    }
  }

  const criteriaError = form.formState.errors.criteria?.message;

  return (
    <div className="off-mission-composer">
      <div className="off-mission-composer-head">
        <IconButton icon={ArrowLeft} label="Back to missions" variant="subtle" onClick={onCancel} />
        <div className="off-mission-composer-title">
          <Icon icon={Target} size="sm" />
          New mission
        </div>
      </div>

      <form className="off-mission-composer-body" onSubmit={form.handleSubmit(onSubmit)}>
        <section className="off-mission-form-sec">
          <FieldRow label="Title" hint="Optional — defaults to “Untitled mission.”" htmlFor={titleId}>
            {({ id }) => (
              <Input id={id} placeholder="Ship the onboarding flow" {...form.register('title')} />
            )}
          </FieldRow>

          <FieldRow
            label="Goal"
            hint={form.formState.errors.goal?.message ?? 'What should be true when this is done.'}
            warn={Boolean(form.formState.errors.goal)}
            htmlFor={goalId}
          >
            {({ id }) => (
              <Textarea
                id={id}
                rows={3}
                placeholder="Describe the outcome the mission must achieve…"
                {...form.register('goal')}
              />
            )}
          </FieldRow>
        </section>

        <section className="off-mission-form-sec">
          <div className="off-mission-form-sec-head">
            <CapsLabel>Done-when criteria</CapsLabel>
            <Button
              type="button"
              variant="subtle"
              size="sm"
              onClick={() => append(blankCriterion())}
            >
              <Icon icon={Plus} size="sm" />
              Add criterion
            </Button>
          </div>
          {criteriaError ? <p className="off-field-hint is-warn">{criteriaError}</p> : null}

          <div className="off-mission-criteria">
            {fields.map((field, index) => {
              const errors = form.formState.errors.criteria?.[index];
              const evaluatorId = form.watch(`criteria.${index}.evaluatorId`);
              const meta = EVALUATORS.find((e) => e.id === evaluatorId);
              return (
                <div key={field.id} className="off-mission-criterion-card">
                  <div className="off-mission-criterion-row">
                    <Input
                      placeholder="e.g. The test suite passes"
                      aria-label={`Criterion ${index + 1} description`}
                      {...form.register(`criteria.${index}.description`)}
                    />
                    <IconButton
                      icon={Trash2}
                      label="Remove criterion"
                      variant="subtle"
                      size="iconSm"
                      disabled={fields.length === 1}
                      title={fields.length === 1 ? 'A mission needs at least one criterion' : undefined}
                      onClick={() => remove(index)}
                    />
                  </div>
                  {errors?.description ? (
                    <p className="off-field-hint is-warn">{errors.description.message}</p>
                  ) : null}

                  <div className="off-mission-criterion-grid">
                    <FieldRow label="Check with">
                      {() => (
                        <Controller
                          control={form.control}
                          name={`criteria.${index}.evaluatorId`}
                          render={({ field: f }) => (
                            <Select
                              options={EVALUATOR_OPTIONS}
                              value={f.value}
                              onChange={(e) => {
                                f.onChange(e.target.value);
                                // Reset config to the new evaluator's default
                                // shape (the prior shape no longer applies).
                                form.setValue(
                                  `criteria.${index}.configJson`,
                                  defaultConfigFor(e.target.value),
                                  { shouldValidate: true },
                                );
                              }}
                              onBlur={f.onBlur}
                            />
                          )}
                        />
                      )}
                    </FieldRow>
                    <FieldRow
                      label="Required"
                      hint="Required criteria must pass to complete the mission."
                    >
                      {() => (
                        <Controller
                          control={form.control}
                          name={`criteria.${index}.required`}
                          render={({ field: f }) => (
                            <Switch
                              checked={f.value}
                              onCheckedChange={f.onChange}
                              aria-label="Required criterion"
                            />
                          )}
                        />
                      )}
                    </FieldRow>
                  </div>

                  <FieldRow
                    label="Config"
                    hint={errors?.configJson?.message ?? meta?.blurb ?? 'Declarative evaluator config (JSON).'}
                    warn={Boolean(errors?.configJson)}
                  >
                    {() => (
                      <Textarea
                        className="off-mission-config-input"
                        rows={3}
                        spellCheck={false}
                        aria-label={`Criterion ${index + 1} config JSON`}
                        {...form.register(`criteria.${index}.configJson`)}
                      />
                    )}
                  </FieldRow>
                </div>
              );
            })}
          </div>
        </section>

        <section className="off-mission-form-sec">
          <CapsLabel>Run options</CapsLabel>
          <div className="off-mission-options-grid">
            <FieldRow label="Runtime" hint="Pi is the only runtime for now.">
              {() => <Input value="Pi" readOnly disabled />}
            </FieldRow>
            <FieldRow label="Team strategy">
              {() => (
                <Controller
                  control={form.control}
                  name="teamStrategy"
                  render={({ field: f }) => (
                    <Select
                      options={TEAM_STRATEGIES.map((t) => ({ value: t.value, label: t.label }))}
                      value={f.value}
                      onChange={(e) => f.onChange(e.target.value)}
                      onBlur={f.onBlur}
                    />
                  )}
                />
              )}
            </FieldRow>
            <FieldRow label="Permission mode">
              {() => (
                <Controller
                  control={form.control}
                  name="permissionMode"
                  render={({ field: f }) => (
                    <Select
                      options={PERMISSION_MODES.map((p) => ({ value: p.value, label: p.label }))}
                      value={f.value}
                      onChange={(e) => f.onChange(e.target.value)}
                      onBlur={f.onBlur}
                    />
                  )}
                />
              )}
            </FieldRow>
            <FieldRow
              label="Token budget"
              hint={form.formState.errors.tokenBudget?.message ?? 'Optional cap per mission.'}
              warn={Boolean(form.formState.errors.tokenBudget)}
            >
              {({ id }) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  placeholder="No limit"
                  {...form.register('tokenBudget')}
                />
              )}
            </FieldRow>
          </div>
          {!projectId ? (
            <p className="off-field-hint">
              No project is bound — criteria that read the workspace (files, commands, git) need a
              project with a workspace folder to verify.
            </p>
          ) : !activeProject?.workspaceRoot ? (
            <p className="off-field-hint is-warn">
              This project has no workspace folder bound. Workspace-reading criteria will report
              setup errors until you bind one.
            </p>
          ) : null}
        </section>

        <div className="off-mission-composer-actions">
          <Button type="button" variant="subtle" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={createMission.isPending || !companyId}>
            {createMission.isPending ? 'Creating…' : 'Create mission'}
          </Button>
        </div>
      </form>
    </div>
  );
}
