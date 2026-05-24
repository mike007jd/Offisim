import type { CompanyTemplate } from '@offisim/core/browser';
import { Button, Input, useRegisterModal, useTopmostEscape } from '@offisim/ui-core';
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

type RoleTone = 'accent' | 'warn' | 'ok' | 'neutral' | 'danger';

const ROLE_TONES: Record<string, RoleTone> = {
  developer: 'accent',
  backend: 'accent',
  frontend: 'accent',
  fullstack: 'accent',
  pm: 'accent',
  product_manager: 'accent',
  manager: 'accent',
  designer: 'warn',
  ui_designer: 'warn',
  ux_designer: 'warn',
  artist: 'warn',
  analyst: 'ok',
  qa: 'ok',
  researcher: 'accent',
  devops: 'neutral',
  engineering_manager: 'accent',
  writer: 'ok',
  seo_specialist: 'warn',
  project_manager: 'accent',
  account_manager: 'danger',
  graphic_designer: 'warn',
};

const DEFAULT_ROLE_TONE: RoleTone = 'neutral';

function getRoleTone(role: string) {
  return ROLE_TONES[role] ?? DEFAULT_ROLE_TONE;
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
      <div className="company-wizard-checking">
        <div>
          <Loader2 data-icon="loading" aria-hidden="true" />
          <p>Loading templates...</p>
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
        <span className="company-wizard-inline-status">
          <Loader2 data-icon="inline-loading" aria-hidden="true" /> Opening Studio...
        </span>
      );
    }
    if (isCreateYourOwn) return 'Open Studio Editor';
    if (shouldRetryRuntime) return 'Retry Runtime';
    if (!runtimeReady) {
      return (
        <span className="company-wizard-inline-status">
          <Loader2 data-icon="inline-loading" aria-hidden="true" /> Initializing...
        </span>
      );
    }
    return 'Start Company';
  })();

  return (
    <div className="company-wizard-shell">
      <div className="company-wizard-grid-bg" />

      <div className="company-wizard-body">
        {selected && meta ? (
          <>
            <div className="company-wizard-info" key={`info-${selected.id}`}>
              <div className="company-wizard-info-head">
                <div className="company-wizard-template-switcher">
                  <div className="company-wizard-template-row">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => switchTemplate(-1)}
                      className="company-wizard-switch-button"
                      aria-label="Previous template"
                    >
                      <ChevronLeft data-icon="template-prev" aria-hidden="true" />
                    </Button>
                    <div className="company-wizard-template-title">
                      <div className="company-wizard-template-icon" data-tone={meta.tone}>
                        {meta.icon}
                      </div>
                      <h2>{selected.name}</h2>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => switchTemplate(1)}
                      className="company-wizard-switch-button"
                      aria-label="Next template"
                    >
                      <ChevronRight data-icon="template-next" aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="company-wizard-template-dots">
                    {templates.map((template, index) => (
                      <Button
                        key={template.id}
                        type="button"
                        variant="ghost"
                        onClick={() => setSelectedTemplateId(template.id)}
                        className="company-wizard-template-dot"
                        data-active={index === currentTemplateIdx || undefined}
                        aria-label={`Select ${template.name}`}
                      />
                    ))}
                  </div>
                </div>

                {!isCreateYourOwn && (
                  <>
                    <div className="company-wizard-zone-summary">
                      <p>Zones · {zoneSummary.length}</p>
                      <p>{zoneSummary.join(' • ')}</p>
                    </div>
                    <div className="company-wizard-info-tabs">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setInfoTab('team')}
                        className="company-wizard-info-tab"
                        data-active={infoTab === 'team' || undefined}
                      >
                        Team · {selected.employees.length}
                      </Button>
                      {selected.sops.length > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setInfoTab('workflows')}
                          className="company-wizard-info-tab"
                          data-active={infoTab === 'workflows' || undefined}
                        >
                          Workflows · {selected.sops.length}
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="company-wizard-info-scroll">
                {isCreateYourOwn ? (
                  <div className="company-wizard-custom-info">
                    <div className="company-wizard-template-icon-large" data-tone={meta.tone}>
                      {meta.iconLg}
                    </div>
                    <p>{meta.tagline}</p>
                    <div>
                      {meta.capabilities.map((capability) => (
                        <div key={capability} className="company-wizard-capability">
                          <span />
                          <span>{capability}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : infoTab === 'team' || selected.sops.length === 0 ? (
                  <div className="company-wizard-team-list">
                    {selected.employees.map((employee) => (
                      <div key={employee.name} className="company-wizard-team-card">
                        <EmployeeCard name={employee.name} role={employee.role_slug} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <ProductionWorkflow sops={selected.sops} />
                )}
              </div>
            </div>

            <div className="company-wizard-preview" key={`fp-${selected.id}`}>
              <div className="company-wizard-preview-frame">
                {isCreateYourOwn ? (
                  <div className="company-wizard-studio-empty">
                    <Wrench data-icon="studio-empty" aria-hidden="true" />
                    <p>Your custom office will be designed in the 3D Studio editor</p>
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
          <div className="company-wizard-empty">
            <p>Select a template above</p>
          </div>
        )}
      </div>

      <div className="company-wizard-footer pb-safe-3">
        {step === 'creating' ? (
          <BuildingAnimation />
        ) : (
          <div className="company-wizard-footer-form">
            {onDismiss && (
              <Button
                type="button"
                variant="outline"
                onClick={onDismiss}
                disabled={isCreating || openingStudio}
                aria-label="Back"
                className="company-wizard-back-button"
              >
                <ChevronLeft data-icon="back" aria-hidden="true" />
                Back
              </Button>
            )}
            <div className="company-wizard-name-field">
              <label htmlFor="company-name">Company Name</label>
              <Input
                id="company-name"
                type="text"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="My AI Company"
                className="company-wizard-name-input"
              />
            </div>
            <Button
              type="button"
              size="lg"
              onClick={() => {
                void handlePrimaryAction();
              }}
              disabled={primaryDisabled || openingStudio}
              className="company-wizard-primary-button"
              data-pulse={
                (isCreateYourOwn || runtimeReady) && selectedTemplateId && !openingStudio
                  ? true
                  : undefined
              }
            >
              {primaryActionContent}
            </Button>
          </div>
        )}
        {visibleError && <p className="company-wizard-error">{visibleError}</p>}
      </div>
    </div>
  );
}

function BuildingAnimation() {
  return (
    <div className="company-wizard-building">
      <div>
        <Loader2 data-icon="building" aria-hidden="true" />
        <span>Building your office...</span>
      </div>
      <p>Setting up employees, workflows, and office layout</p>
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
    <div className="company-wizard-employee-card" data-tone={roleTone}>
      <Button
        type="button"
        variant="ghost"
        className="company-wizard-employee-trigger"
        onClick={toggleExpand}
      >
        <div className="company-wizard-employee-avatar">
          <img src={avatarUri} alt="" />
          <div />
        </div>
        <div className="company-wizard-employee-copy">
          <div>{name}</div>
          <div>{roleLabel}</div>
          {bio && <div>{bio.bio}</div>}
        </div>
        <div className="company-wizard-employee-caret">
          {expanded ? (
            <ChevronUp data-icon="employee-collapse" aria-hidden="true" />
          ) : (
            <ChevronDown data-icon="employee-expand" aria-hidden="true" />
          )}
        </div>
      </Button>

      {expanded && bio && (
        <div className="company-wizard-employee-detail">
          <div>
            {bio.expertise.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
            <span data-neutral>{bio.style}</span>
          </div>
          <p>{bio.helpsWith}</p>
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
    <div className="company-wizard-workflow">
      {sops.map((sop, sopIdx) => (
        <div key={sop.sop_id}>
          {sops.length > 1 && sopIdx > 0 && (
            <div className="company-wizard-phase-divider">
              <div />
              <span>Phase {sopIdx + 1}</span>
              <div />
            </div>
          )}
          {sops.length > 1 && sopIdx === 0 && (
            <div className="company-wizard-phase-label">Phase 1</div>
          )}

          {sop.steps.map((step, idx) => {
            const stepTone = getRoleTone(step.role_slug);
            const stepRole = ROLE_LABELS[step.role_slug] ?? step.role_slug;
            const isLastGlobal = sopIdx === sops.length - 1 && idx === sop.steps.length - 1;

            return (
              <div key={step.step_id} className="company-wizard-workflow-step">
                <div className="company-wizard-workflow-card" data-tone={stepTone}>
                  <div />
                  <div>
                    <div>{step.label}</div>
                    <div>
                      <span />
                      <span>{stepRole}</span>
                    </div>
                  </div>
                </div>

                {!isLastGlobal && (
                  <svg
                    className="company-wizard-workflow-connector"
                    width="8"
                    height="16"
                    viewBox="0 0 8 16"
                  >
                    <title>Workflow connector</title>
                    <line x1="4" y1="0" x2="4" y2="12" stroke="currentColor" strokeWidth={1} />
                    <path d="M2 10l2 4 2-4" fill="none" stroke="currentColor" strokeWidth={0.8} />
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
