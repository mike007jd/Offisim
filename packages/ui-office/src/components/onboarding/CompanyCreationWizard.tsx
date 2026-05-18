import type { CompanyTemplate } from '@offisim/core/browser';
import { Button, Input, cn, useRegisterModal, useTopmostEscape } from '@offisim/ui-core';
import { DARK_SEMANTIC_COLORS } from '@offisim/ui-core/tokens';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCompanyCreation } from '../../hooks/useCompanyCreation.js';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context.js';
import {
  CREATE_YOUR_OWN_TEMPLATE,
  EMPLOYEE_BIOS,
  ROLE_DOT,
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

export function CompanyCreationWizard({
  mode = 'populate-existing',
  companyId,
  onComplete,
  onCreateYourOwn,
  onDismiss,
}: Props) {
  const { error: runtimeError, isReady, reinitRuntime } = useOffisimRuntime();
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
    runtimeReady: hookRuntimeReady,
    isCreating,
  } = useCompanyCreation({ mode, companyId });
  const runtimeReady = hookRuntimeReady && isReady;

  const templates = useMemo(() => [...coreTemplates, CREATE_YOUR_OWN_TEMPLATE], [coreTemplates]);
  const isCreateYourOwn = selectedTemplateId === 'create-your-own';
  const displayedError = error ?? runtimeError;
  const shouldRetryRuntime = !isCreateYourOwn && !runtimeReady && !!runtimeError;

  const prevStepRef = useRef(step);
  const [infoTab, setInfoTab] = useState<'team' | 'workflows'>('team');
  const [openStudioError, setOpenStudioError] = useState<string | null>(null);
  const [openingStudio, setOpeningStudio] = useState(false);

  useEffect(() => {
    if (prevStepRef.current === 'creating' && step === 'ready') {
      // handled explicitly on submit
    }
    prevStepRef.current = step;
  }, [step]);

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
      <div className="flex h-screen items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-accent" />
          <p className="text-caption text-text-muted">Loading templates...</p>
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

  return (
    <div className="fixed inset-0 z-modal flex flex-col overflow-hidden bg-surface">
      <div className="company-wizard-grid-bg pointer-events-none absolute inset-0" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {selected && meta ? (
          <>
            <div
              className="animate-wiz-fade-in-fast flex w-full shrink-0 flex-col border-b border-border-subtle lg:w-80 lg:border-r lg:border-b-0"
              key={`info-${selected.id}`}
            >
              <div className="flex shrink-0 flex-col gap-3 border-b border-border-subtle px-4 pt-4 pb-3">
                <div className="flex flex-col items-center gap-2 rounded-xl border border-border-subtle bg-surface-muted px-2 py-2.5">
                  <div className="flex w-full items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => switchTemplate(-1)}
                      className="size-10 shrink-0 text-text-muted hover:text-text-primary"
                      aria-label="Previous template"
                    >
                      <ChevronLeft className="size-6" aria-hidden="true" />
                    </Button>
                    <div className="flex min-w-0 flex-1 items-center justify-center gap-2.5">
                      <div className={`shrink-0 ${meta.accent}`}>{meta.icon}</div>
                      <h2 className="truncate text-lg font-semibold text-text-primary">
                        {selected.name}
                      </h2>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => switchTemplate(1)}
                      className="size-10 shrink-0 text-text-muted hover:text-text-primary"
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
                          index === currentTemplateIdx ? 'w-4 bg-accent' : 'w-1.5 bg-surface-hover',
                        )}
                        aria-label={`Select ${template.name}`}
                      />
                    ))}
                  </div>
                </div>

                {!isCreateYourOwn && (
                  <>
                    <div className="rounded-lg border border-border-subtle bg-surface-muted px-3 py-2">
                      <p className="text-caption font-semibold uppercase tracking-wider text-text-muted">
                        Zones · {zoneSummary.length}
                      </p>
                      <p className="mt-1 text-caption text-text-secondary">
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
                            ? 'border-b-2 border-accent text-text-primary'
                            : 'text-text-muted hover:text-text-secondary',
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
                              ? 'border-b-2 border-accent text-text-primary'
                              : 'text-text-muted hover:text-text-secondary',
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
                    <div className="text-success">{meta.iconLg}</div>
                    <p className="text-sm text-text-secondary">{meta.tagline}</p>
                    <div className="flex w-full flex-col gap-2">
                      {meta.capabilities.map((capability) => (
                        <div
                          key={capability}
                          className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-muted px-3 py-2"
                        >
                          <span className="size-1.5 shrink-0 rounded-full bg-success" />
                          <span className="text-caption text-text-secondary">{capability}</span>
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
                  <ProductionWorkflow sops={selected.sops} accentHex={meta.accentHex} />
                )}
              </div>
            </div>

            <div
              className="animate-wiz-fade-in flex min-h-80 min-w-0 flex-1 items-center justify-center p-4 lg:min-h-0"
              key={`fp-${selected.id}`}
            >
              <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated p-2">
                {isCreateYourOwn ? (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Wrench className="size-12 text-success/40" />
                    <p className="text-sm text-text-muted">
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
            <p className="text-sm text-text-muted">Select a template above</p>
          </div>
        )}
      </div>

      <div className="pb-safe-3 relative z-10 border-t border-border-subtle bg-surface-elevated/90 px-4 py-3 backdrop-blur-xl lg:px-6 lg:py-4">
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
                className="mb-1.5 block text-caption font-medium uppercase tracking-wider text-text-muted"
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
              {openingStudio ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Opening Studio...
                </span>
              ) : isCreateYourOwn ? (
                'Open Studio Editor'
              ) : shouldRetryRuntime ? (
                'Retry Runtime'
              ) : !runtimeReady ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Initializing...
                </span>
              ) : (
                'Start Company'
              )}
            </Button>
          </div>
        )}
        {visibleError && <p className="mt-2 text-center text-caption text-error">{visibleError}</p>}
      </div>
    </div>
  );
}

function BuildingAnimation() {
  return (
    <div className="animate-wiz-fade-in-slow flex flex-col items-center gap-3 py-2">
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 animate-spin text-accent" />
        <span className="animate-wiz-building-pulse text-sm font-medium text-text-primary">
          Building your office...
        </span>
      </div>
      <p className="text-caption text-text-muted">
        Setting up employees, workflows, and office layout
      </p>
    </div>
  );
}

function EmployeeCard({ name, role }: { name: string; role: string }) {
  const [expanded, setExpanded] = useState(false);
  const avatarUri = useMemo(() => getAvatar(name, 64), [name]);
  const dotColor = ROLE_DOT[role] ?? DARK_SEMANTIC_COLORS.textMuted;
  const roleLabel = ROLE_LABELS[role] ?? role;
  const bio = EMPLOYEE_BIOS[name];

  const toggleExpand = useCallback(() => setExpanded((value) => !value), []);

  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-muted">
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start gap-3 rounded-none px-3 py-2.5 text-left transition-all duration-200"
        onClick={toggleExpand}
      >
        <div className="relative shrink-0">
          <img src={avatarUri} alt="" className="size-11 rounded-full" />
          <div
            className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-surface"
            style={{ backgroundColor: dotColor }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium text-text-primary">{name}</div>
          <div className="mt-0.5 text-body-sm" style={{ color: dotColor }}>
            {roleLabel}
          </div>
          {bio && (
            <div className="mt-0.5 truncate text-caption italic text-text-muted">{bio.bio}</div>
          )}
        </div>
        <div className="shrink-0 text-text-muted">
          {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </div>
      </Button>

      {expanded && bio && (
        <div className="animate-wiz-slide-up border-t border-border-subtle px-3 pb-3 pt-0">
          <div className="mt-2 flex flex-wrap gap-1.5">
            {bio.expertise.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-border-subtle bg-surface-hover px-1.5 py-0.5 text-caption font-medium"
                style={{ color: dotColor }}
              >
                {tag}
              </span>
            ))}
            <span className="rounded-md border border-border-subtle bg-surface px-1.5 py-0.5 text-caption text-text-muted">
              {bio.style}
            </span>
          </div>
          <p className="mt-2 text-caption leading-relaxed text-text-muted">{bio.helpsWith}</p>
        </div>
      )}
    </div>
  );
}

function ProductionWorkflow({
  sops,
  accentHex,
}: {
  sops: CompanyTemplate['sops'];
  accentHex: string;
}) {
  return (
    <div className="flex flex-col items-center">
      {sops.map((sop, sopIdx) => (
        <div key={sop.sop_id} className="flex w-full flex-col items-center">
          {sops.length > 1 && sopIdx > 0 && (
            <div className="my-2 flex w-full items-center gap-2">
              <div className="h-px flex-1" style={{ backgroundColor: `${accentHex}15` }} />
              <span
                className="text-caption font-medium uppercase tracking-wider"
                style={{ color: `${accentHex}80` }}
              >
                Phase {sopIdx + 1}
              </span>
              <div className="h-px flex-1" style={{ backgroundColor: `${accentHex}15` }} />
            </div>
          )}
          {sops.length > 1 && sopIdx === 0 && (
            <div
              className="mb-2 text-caption font-medium uppercase tracking-wider"
              style={{ color: `${accentHex}80` }}
            >
              Phase 1
            </div>
          )}

          {sop.steps.map((step, idx) => {
            const stepColor = ROLE_DOT[step.role_slug] ?? DARK_SEMANTIC_COLORS.textMuted;
            const stepRole = ROLE_LABELS[step.role_slug] ?? step.role_slug;
            const isLastGlobal = sopIdx === sops.length - 1 && idx === sop.steps.length - 1;

            return (
              <div key={step.step_id} className="flex w-full flex-col items-center">
                <div
                  className="relative w-full overflow-hidden rounded-lg border px-3 py-2"
                  style={{ borderColor: `${stepColor}20`, backgroundColor: `${stepColor}06` }}
                >
                  <div
                    className="absolute bottom-0 left-0 top-0 w-1"
                    style={{ backgroundColor: stepColor }}
                  />
                  <div className="pl-2.5">
                    <div className="text-caption font-medium text-text-primary">{step.label}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-caption">
                      <span
                        className="size-1.5 rounded-full"
                        style={{ backgroundColor: stepColor }}
                      />
                      <span style={{ color: stepColor }}>{stepRole}</span>
                    </div>
                  </div>
                </div>

                {!isLastGlobal && (
                  <svg className="shrink-0" width="8" height="16" viewBox="0 0 8 16">
                    <title>Workflow connector</title>
                    <line
                      x1="4"
                      y1="0"
                      x2="4"
                      y2="12"
                      stroke="var(--color-border-subtle-val)"
                      strokeWidth={1}
                    />
                    <path
                      d="M2 10l2 4 2-4"
                      fill="none"
                      stroke="var(--color-text-muted-val)"
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
