import type { CompanyTemplate } from '@offisim/core/browser';
import { Button, Input, cn, useRegisterModal, useTopmostEscape } from '@offisim/ui-core';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCompanyCreation } from '../../hooks/useCompanyCreation.js';
import { useOffisimRuntimeExecution } from '../../runtime/offisim-runtime-context.js';
import {
  CREATE_YOUR_OWN_TEMPLATE,
  EMPLOYEE_BIOS,
  ROLE_LABELS,
  TEMPLATE_META,
  getAvatar,
  getTemplateZoneSummary,
} from './company-creation-wizard-data.js';
import { Office2DPreview } from './company-creation-wizard-preview.js';
import { ensureCompanyCreationWizardKeyframes } from './company-creation-wizard-styles.js';

interface Props {
  mode?: 'create-new' | 'populate-existing';
  companyId?: string | null;
  onComplete?: (companyId: string) => void;
  /** Activate + open Studio in edit mode. Throwing keeps the wizard open. */
  onCreateYourOwn?: (companyId: string) => void | Promise<void>;
  /** Optional dismiss callback. When provided, enables Escape-to-close and a back button. */
  onDismiss?: () => void;
}

const ROLE_TONE_CLASSES: Record<
  string,
  { dot: string; text: string; border: string; surface: string; rail: string }
> = {
  developer: {
    dot: 'bg-info',
    text: 'text-info',
    border: 'border-info-muted',
    surface: 'bg-info-muted',
    rail: 'bg-info',
  },
  backend: {
    dot: 'bg-info',
    text: 'text-info',
    border: 'border-info-muted',
    surface: 'bg-info-muted',
    rail: 'bg-info',
  },
  frontend: {
    dot: 'bg-accent',
    text: 'text-accent',
    border: 'border-accent-muted',
    surface: 'bg-accent-muted',
    rail: 'bg-accent',
  },
  fullstack: {
    dot: 'bg-accent',
    text: 'text-accent',
    border: 'border-accent-muted',
    surface: 'bg-accent-muted',
    rail: 'bg-accent',
  },
  pm: {
    dot: 'bg-accent',
    text: 'text-accent',
    border: 'border-accent-muted',
    surface: 'bg-accent-muted',
    rail: 'bg-accent',
  },
  product_manager: {
    dot: 'bg-accent',
    text: 'text-accent',
    border: 'border-accent-muted',
    surface: 'bg-accent-muted',
    rail: 'bg-accent',
  },
  manager: {
    dot: 'bg-accent',
    text: 'text-accent',
    border: 'border-accent-muted',
    surface: 'bg-accent-muted',
    rail: 'bg-accent',
  },
  designer: {
    dot: 'bg-warning',
    text: 'text-warning',
    border: 'border-warning-muted',
    surface: 'bg-warning-muted',
    rail: 'bg-warning',
  },
  ui_designer: {
    dot: 'bg-warning',
    text: 'text-warning',
    border: 'border-warning-muted',
    surface: 'bg-warning-muted',
    rail: 'bg-warning',
  },
  ux_designer: {
    dot: 'bg-warning',
    text: 'text-warning',
    border: 'border-warning-muted',
    surface: 'bg-warning-muted',
    rail: 'bg-warning',
  },
  artist: {
    dot: 'bg-warning',
    text: 'text-warning',
    border: 'border-warning-muted',
    surface: 'bg-warning-muted',
    rail: 'bg-warning',
  },
  analyst: {
    dot: 'bg-success',
    text: 'text-success',
    border: 'border-success-muted',
    surface: 'bg-success-muted',
    rail: 'bg-success',
  },
  qa: {
    dot: 'bg-success',
    text: 'text-success',
    border: 'border-success-muted',
    surface: 'bg-success-muted',
    rail: 'bg-success',
  },
  researcher: {
    dot: 'bg-info',
    text: 'text-info',
    border: 'border-info-muted',
    surface: 'bg-info-muted',
    rail: 'bg-info',
  },
  devops: {
    dot: 'bg-ink-4',
    text: 'text-ink-3',
    border: 'border-line',
    surface: 'bg-surface-sunken',
    rail: 'bg-ink-4',
  },
  engineering_manager: {
    dot: 'bg-accent',
    text: 'text-accent',
    border: 'border-accent-muted',
    surface: 'bg-accent-muted',
    rail: 'bg-accent',
  },
  writer: {
    dot: 'bg-success',
    text: 'text-success',
    border: 'border-success-muted',
    surface: 'bg-success-muted',
    rail: 'bg-success',
  },
  seo_specialist: {
    dot: 'bg-warning',
    text: 'text-warning',
    border: 'border-warning-muted',
    surface: 'bg-warning-muted',
    rail: 'bg-warning',
  },
  project_manager: {
    dot: 'bg-accent',
    text: 'text-accent',
    border: 'border-accent-muted',
    surface: 'bg-accent-muted',
    rail: 'bg-accent',
  },
  account_manager: {
    dot: 'bg-error',
    text: 'text-error',
    border: 'border-error-muted',
    surface: 'bg-error-muted',
    rail: 'bg-error',
  },
  graphic_designer: {
    dot: 'bg-warning',
    text: 'text-warning',
    border: 'border-warning-muted',
    surface: 'bg-warning-muted',
    rail: 'bg-warning',
  },
};

const DEFAULT_ROLE_TONE = {
  dot: 'bg-ink-4',
  text: 'text-ink-3',
  border: 'border-line',
  surface: 'bg-surface-sunken',
  rail: 'bg-ink-4',
};

function getRoleTone(role: string) {
  return ROLE_TONE_CLASSES[role] ?? DEFAULT_ROLE_TONE;
}

export function CompanyCreationWizard({
  mode = 'populate-existing',
  companyId,
  onComplete,
  onCreateYourOwn,
  onDismiss,
}: Props) {
  const { error: runtimeError, reinitRuntime } = useOffisimRuntimeExecution();
  const {
    step,
    templates: coreTemplates,
    selectedTemplateId,
    companyName,
    setSelectedTemplateId,
    setCompanyName,
    create,
    createCustomCompany,
    error,
    runtimeReady,
    isCreating,
  } = useCompanyCreation({ mode, companyId });

  const templates = useMemo(() => [...coreTemplates, CREATE_YOUR_OWN_TEMPLATE], [coreTemplates]);
  const isCreateYourOwn = selectedTemplateId === 'create-your-own';
  const displayedError = error ?? runtimeError;
  const shouldRetryRuntime = !isCreateYourOwn && !runtimeReady && !!runtimeError;

  const [infoTab, setInfoTab] = useState<'team' | 'workflows'>('team');
  const [openStudioError, setOpenStudioError] = useState<string | null>(null);
  const [openingStudio, setOpeningStudio] = useState(false);

  useEffect(() => {
    const defaultTemplateId = templates[0]?.id;
    if (!selectedTemplateId && typeof defaultTemplateId === 'string') {
      setSelectedTemplateId(defaultTemplateId);
    }
  }, [selectedTemplateId, templates, setSelectedTemplateId]);

  useEffect(() => {
    if (selectedTemplateId) {
      setInfoTab('team');
    }
  }, [selectedTemplateId]);

  useEffect(() => {
    ensureCompanyCreationWizardKeyframes();
  }, []);

  // Register in the shared modal stack so Office shortcuts gate on wizard
  // activity, and so Escape targets topmost only. `isCreating` blocks dismiss
  // while the create promise is in flight.
  const wizardStackId = 'company-creation-wizard';
  useRegisterModal(onDismiss ? wizardStackId : null, 'overlay');
  useTopmostEscape(
    onDismiss && !isCreating && !openingStudio ? wizardStackId : null,
    () => onDismiss?.(),
    { enabled: Boolean(onDismiss) && !isCreating && !openingStudio },
  );

  const currentTemplateIdx = useMemo(
    () => templates.findIndex((template) => template.id === selectedTemplateId),
    [templates, selectedTemplateId],
  );

  const switchTemplate = useCallback(
    (direction: -1 | 1) => {
      if (templates.length === 0) {
        return;
      }
      const idx = templates.findIndex((template) => template.id === selectedTemplateId);
      const next = (idx + direction + templates.length) % templates.length;
      const nextTemplate = templates[next];
      if (nextTemplate) {
        setSelectedTemplateId(nextTemplate.id);
      }
    },
    [selectedTemplateId, templates, setSelectedTemplateId],
  );

  const handlePrimaryAction = useCallback(async () => {
    if (shouldRetryRuntime) {
      reinitRuntime();
      return;
    }

    if (!isCreateYourOwn && !runtimeReady) {
      if (runtimeError) {
        reinitRuntime();
      }
      return;
    }

    if (isCreateYourOwn) {
      setOpenStudioError(null);
      const newCompanyId = await createCustomCompany();
      if (!newCompanyId) return;
      if (!onCreateYourOwn) return;
      setOpeningStudio(true);
      try {
        await onCreateYourOwn(newCompanyId);
      } catch (err) {
        setOpenStudioError(err instanceof Error ? err.message : 'Failed to open Studio editor');
      } finally {
        setOpeningStudio(false);
      }
      return;
    }

    const createdCompanyId = await create();
    if (createdCompanyId) {
      onComplete?.(createdCompanyId);
    }
  }, [
    create,
    createCustomCompany,
    isCreateYourOwn,
    onComplete,
    onCreateYourOwn,
    reinitRuntime,
    runtimeError,
    runtimeReady,
    shouldRetryRuntime,
  ]);

  if (step === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-wiz-bg">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-wiz-blue" />
          <p className="text-caption text-wiz-ink-3">Loading templates...</p>
        </div>
      </div>
    );
  }
  if (step === 'ready') {
    return null;
  }

  const selected = templates.find((template) => template.id === selectedTemplateId);
  const meta = selected ? TEMPLATE_META[selected.id] : null;
  const zoneSummary = selected && !isCreateYourOwn ? getTemplateZoneSummary(selected) : [];
  const primaryDisabled =
    !selectedTemplateId || (!isCreateYourOwn && !runtimeReady) || !companyName.trim();
  const visibleError = openStudioError ?? displayedError;

  const primaryActionContent = (() => {
    if (openingStudio) {
      return (
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Opening Studio...
        </span>
      );
    }
    if (isCreateYourOwn) return 'Open Studio Editor';
    if (shouldRetryRuntime) return 'Retry Runtime';
    if (!runtimeReady) {
      return (
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Initializing...
        </span>
      );
    }
    return 'Start Company';
  })();

  return (
    <div className="fixed inset-0 z-modal flex flex-col overflow-hidden bg-wiz-bg text-wiz-ink-1">
      <div className="company-wizard-grid-bg pointer-events-none absolute inset-0" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {selected && meta ? (
          <>
            <div
              className="animate-wiz-fade-in-fast flex w-full shrink-0 flex-col border-b border-wiz-line lg:w-80 lg:border-r lg:border-b-0"
              key={`info-${selected.id}`}
            >
              <div className="flex shrink-0 flex-col gap-3 border-b border-wiz-line px-4 pt-4 pb-3">
                <div className="flex flex-col items-center gap-2 rounded-xl border border-wiz-line bg-wiz-surface px-2 py-2.5">
                  <div className="flex w-full items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => switchTemplate(-1)}
                      className="size-10 shrink-0 text-wiz-ink-3 hover:text-wiz-ink-1"
                      aria-label="Previous template"
                    >
                      <ChevronLeft className="size-6" aria-hidden="true" />
                    </Button>
                    <div className="flex min-w-0 flex-1 items-center justify-center gap-2.5">
                      <div className={`shrink-0 ${meta.accent}`}>{meta.icon}</div>
                      <h2 className="truncate text-lg font-semibold text-wiz-ink-1">
                        {selected.name}
                      </h2>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => switchTemplate(1)}
                      className="size-10 shrink-0 text-wiz-ink-3 hover:text-wiz-ink-1"
                      aria-label="Next template"
                    >
                      <ChevronRight className="size-6" aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {templates.map((template, index) => (
                      <Button
                        key={template.id}
                        type="button"
                        variant="ghost"
                        onClick={() => setSelectedTemplateId(template.id)}
                        className={cn(
                          'h-1.5 rounded-full border-0 p-0 transition-all',
                          index === currentTemplateIdx
                            ? 'w-4 bg-wiz-blue'
                            : 'w-1.5 bg-wiz-line-2',
                        )}
                        aria-label={`Select ${template.name}`}
                      />
                    ))}
                  </div>
                </div>

                {!isCreateYourOwn && (
                  <>
                    <div className="rounded-lg border border-wiz-line bg-wiz-surface px-3 py-2">
                      <p className="text-caption font-semibold uppercase tracking-wider text-wiz-ink-4">
                        Zones · {zoneSummary.length}
                      </p>
                      <p className="mt-1 text-caption text-wiz-ink-2">
                        {zoneSummary.join(' • ')}
                      </p>
                    </div>
                    <div className="mt-3 flex">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setInfoTab('team')}
                        className={cn(
                          'h-auto rounded-none px-0 pb-2 pr-4 text-caption font-semibold uppercase tracking-wider',
                          infoTab === 'team'
                            ? 'border-b-2 border-wiz-blue text-wiz-ink-1'
                            : 'text-wiz-ink-4 hover:text-wiz-ink-2',
                        )}
                      >
                        Team · {selected.employees.length}
                      </Button>
                      {selected.sops.length > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setInfoTab('workflows')}
                          className={cn(
                            'h-auto rounded-none px-4 pb-2 text-caption font-semibold uppercase tracking-wider',
                            infoTab === 'workflows'
                              ? 'border-b-2 border-wiz-blue text-wiz-ink-1'
                              : 'text-wiz-ink-4 hover:text-wiz-ink-2',
                          )}
                        >
                          Workflows · {selected.sops.length}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3">
                {isCreateYourOwn ? (
                  <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
                    <div className="text-wiz-emerald">{meta.iconLg}</div>
                    <p className="text-sm text-wiz-ink-2">{meta.tagline}</p>
                    <div className="flex w-full flex-col gap-2">
                      {meta.capabilities.map((capability) => (
                        <div
                          key={capability}
                          className="flex items-center gap-2 rounded-lg border border-wiz-line bg-wiz-surface px-3 py-2"
                        >
                          <span className="size-1.5 shrink-0 rounded-full bg-wiz-emerald" />
                          <span className="text-caption text-wiz-ink-2">{capability}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : infoTab === 'team' || selected.sops.length === 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {selected.employees.map((employee) => (
                      <div key={employee.name} className="animate-wiz-card-in">
                        <EmployeeCard name={employee.name} role={employee.role_slug} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <ProductionWorkflow sops={selected.sops} />
                )}
              </div>
            </div>

            <div
              className="animate-wiz-fade-in flex min-h-80 min-w-0 flex-1 items-center justify-center p-4 lg:min-h-0"
              key={`fp-${selected.id}`}
            >
              <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-xl border border-wiz-line bg-wiz-surface p-2">
                {isCreateYourOwn ? (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Wrench className="size-12 text-wiz-emerald/40" />
                    <p className="text-sm text-wiz-ink-3">
                      Your custom office will be designed in the 3D Studio editor
                    </p>
                  </div>
                ) : (
                  <Office2DPreview
                    template={selected}
                    highlightZones={meta.highlightZones}
                    accentHex={meta.accentHex}
                  />
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-wiz-ink-3">Select a template above</p>
          </div>
        )}
      </div>

      <div className="pb-safe-3 relative z-10 border-t border-wiz-line bg-wiz-bg/90 px-4 py-3 backdrop-blur-xl lg:px-6 lg:py-4">
        {step === 'creating' ? (
          <BuildingAnimation />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col items-stretch gap-3 lg:flex-row lg:items-end lg:gap-4">
            {onDismiss && (
              <Button
                type="button"
                variant="outline"
                onClick={onDismiss}
                disabled={isCreating || openingStudio}
                aria-label="Back"
                className="h-11 shrink-0 gap-1.5 px-4 font-mono text-caption uppercase tracking-wider lg:self-end"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                Back
              </Button>
            )}
            <div className="flex-1">
              <label
                htmlFor="company-name"
                className="mb-1.5 block text-caption font-medium uppercase tracking-wider text-wiz-ink-4"
              >
                Company Name
              </label>
              <Input
                id="company-name"
                type="text"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="My AI Company"
                className="h-11 text-sm"
              />
            </div>
            <Button
              type="button"
              size="lg"
              onClick={() => {
                void handlePrimaryAction();
              }}
              disabled={primaryDisabled || openingStudio}
              className={cn(
                'w-full shrink-0 lg:w-auto lg:px-8',
                (isCreateYourOwn || runtimeReady) && selectedTemplateId && !openingStudio
                  ? 'animate-wiz-cta-pulse'
                  : '',
              )}
            >
              {primaryActionContent}
            </Button>
          </div>
        )}
        {visibleError && (
          <p className="mt-2 text-center text-caption text-danger">{visibleError}</p>
        )}
      </div>
    </div>
  );
}

function BuildingAnimation() {
  return (
    <div className="animate-wiz-fade-in-slow flex flex-col items-center gap-3 py-2">
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 animate-spin text-wiz-blue" />
        <span className="animate-wiz-building-pulse text-sm font-medium text-wiz-ink-1">
          Building your office...
        </span>
      </div>
      <p className="text-caption text-wiz-ink-3">
        Setting up employees, workflows, and office layout
      </p>
    </div>
  );
}

function EmployeeCard({ name, role }: { name: string; role: string }) {
  const [expanded, setExpanded] = useState(false);
  const avatarUri = useMemo(() => getAvatar(name, 64), [name]);
  const roleTone = getRoleTone(role);
  const roleLabel = ROLE_LABELS[role] ?? role;
  const bio = EMPLOYEE_BIOS[name];

  const toggleExpand = useCallback(() => setExpanded((value) => !value), []);

  return (
    <div className="overflow-hidden rounded-xl border border-wiz-line bg-wiz-surface">
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start gap-3 rounded-none px-3 py-2.5 text-left transition-all duration-200"
        onClick={toggleExpand}
      >
        <div className="relative shrink-0">
          <img src={avatarUri} alt="" className="size-11 rounded-full" />
          <div
            className={cn('absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-wiz-bg', roleTone.dot)}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium text-wiz-ink-1">{name}</div>
          <div className={cn('mt-0.5 text-body-sm', roleTone.text)}>
            {roleLabel}
          </div>
          {bio && (
            <div className="mt-0.5 truncate text-caption italic text-wiz-ink-4">
              {bio.bio}
            </div>
          )}
        </div>
        <div className="shrink-0 text-wiz-ink-3">
          {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </div>
      </Button>

      {expanded && bio && (
        <div className="animate-wiz-slide-up border-t border-wiz-line px-3 pb-3 pt-0">
          <div className="mt-2 flex flex-wrap gap-1.5">
            {bio.expertise.map((tag) => (
              <span
                key={tag}
                className={cn(
                  'rounded-md border px-1.5 py-0.5 text-caption font-medium',
                  roleTone.border,
                  roleTone.surface,
                  roleTone.text,
                )}
              >
                {tag}
              </span>
            ))}
            <span className="rounded-md border border-wiz-line bg-wiz-surface px-1.5 py-0.5 text-caption text-wiz-ink-3">
              {bio.style}
            </span>
          </div>
          <p className="mt-2 text-caption leading-relaxed text-wiz-ink-3">
            {bio.helpsWith}
          </p>
        </div>
      )}
    </div>
  );
}

function ProductionWorkflow({
  sops,
}: {
  sops: CompanyTemplate['sops'];
}) {
  return (
    <div className="flex flex-col items-center">
      {sops.map((sop, sopIdx) => (
        <div key={sop.sop_id} className="flex w-full flex-col items-center">
          {sops.length > 1 && sopIdx > 0 && (
            <div className="my-2 flex w-full items-center gap-2">
              <div className="h-px flex-1 bg-wiz-line-2" />
              <span className="text-caption font-medium uppercase tracking-wider text-wiz-blue">
                Phase {sopIdx + 1}
              </span>
              <div className="h-px flex-1 bg-wiz-line-2" />
            </div>
          )}
          {sops.length > 1 && sopIdx === 0 && (
            <div className="mb-2 text-caption font-medium uppercase tracking-wider text-wiz-blue">
              Phase 1
            </div>
          )}

          {sop.steps.map((step, idx) => {
            const stepTone = getRoleTone(step.role_slug);
            const stepRole = ROLE_LABELS[step.role_slug] ?? step.role_slug;
            const isLastGlobal = sopIdx === sops.length - 1 && idx === sop.steps.length - 1;

            return (
              <div key={step.step_id} className="flex w-full flex-col items-center">
                <div
                  className={cn(
                    'relative w-full overflow-hidden rounded-lg border px-3 py-2',
                    stepTone.border,
                    stepTone.surface,
                  )}
                >
                  <div className={cn('absolute bottom-0 left-0 top-0 w-1', stepTone.rail)} />
                  <div className="pl-2.5">
                    <div className="text-caption font-medium text-wiz-ink-1">
                      {step.label}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-caption">
                      <span className={cn('size-1.5 rounded-full', stepTone.dot)} />
                      <span className={stepTone.text}>{stepRole}</span>
                    </div>
                  </div>
                </div>

                {!isLastGlobal && (
                  <svg className="shrink-0 text-line" width="8" height="16" viewBox="0 0 8 16">
                    <title>Workflow connector</title>
                    <line x1="4" y1="0" x2="4" y2="12" stroke="currentColor" strokeWidth={1} />
                    <path
                      d="M2 10l2 4 2-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={0.8}
                    />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
