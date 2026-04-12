import type { CompanyTemplate } from '@offisim/core/browser';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCompanyCreation } from '../../hooks/useCompanyCreation.js';
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
  onCreateYourOwn?: (companyId: string) => void;
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
  } = useCompanyCreation({ mode, companyId });

  const templates = useMemo(() => [...coreTemplates, CREATE_YOUR_OWN_TEMPLATE], [coreTemplates]);
  const isCreateYourOwn = selectedTemplateId === 'create-your-own';

  const prevStepRef = useRef(step);
  const [infoTab, setInfoTab] = useState<'team' | 'workflows'>('team');

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

  useEffect(() => {
    // Gate: no dismiss during in-flight creation — the pending create() promise
    // would still resolve after unmount and bounce the user into the new company.
    if (!onDismiss || step === 'creating') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Capture-phase + stopImmediatePropagation so App.tsx's global Escape
        // handler (registered first, bubble phase) does not also fire and
        // inadvertently flip view back to 'office'.
        e.preventDefault();
        e.stopImmediatePropagation();
        onDismiss();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onDismiss, step]);

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
    if (isCreateYourOwn) {
      const newCompanyId = await createCustomCompany();
      if (newCompanyId) {
        onCreateYourOwn?.(newCompanyId);
      }
      return;
    }

    const createdCompanyId = await create();
    if (createdCompanyId) {
      onComplete?.(createdCompanyId);
    }
  }, [create, createCustomCompany, isCreateYourOwn, onComplete, onCreateYourOwn]);

  if (step === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
          <p className="text-xs text-slate-500">Loading templates...</p>
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-surface">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle, var(--surface-lighter) 0.5px, transparent 0.5px)',
          backgroundSize: '24px 24px',
        }}
      />

      {onDismiss && step !== 'creating' && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Back"
          className="absolute left-4 top-4 z-20 flex h-9 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-xs font-mono uppercase tracking-wider text-slate-400 transition-colors hover:border-white/20 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
      )}

      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        {selected && meta ? (
          <>
            <div
              className="flex w-[340px] shrink-0 flex-col border-r border-white/[0.06]"
              key={`info-${selected.id}`}
              style={{ animation: 'wiz-fade-in 0.3s ease-out' }}
            >
              <div className="shrink-0 space-y-3 border-b border-white/[0.06] px-4 pt-4 pb-3">
                <div className="flex flex-col items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-2 py-2.5">
                  <div className="flex w-full items-center">
                    <button
                      type="button"
                      onClick={() => switchTemplate(-1)}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                    <div className="flex min-w-0 flex-1 items-center justify-center gap-2.5">
                      <div className={`shrink-0 ${meta.accent}`}>{meta.icon}</div>
                      <h2 className="truncate text-lg font-semibold text-white">{selected.name}</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => switchTemplate(1)}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      <ChevronRight className="h-6 w-6" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {templates.map((template, index) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => setSelectedTemplateId(template.id)}
                        className="rounded-full transition-all"
                        style={{
                          width: index === currentTemplateIdx ? 16 : 6,
                          height: 6,
                          backgroundColor:
                            index === currentTemplateIdx
                              ? meta.accentHex
                              : 'rgba(255,255,255,0.12)',
                        }}
                      />
                    ))}
                  </div>
                </div>

                {!isCreateYourOwn && (
                  <>
                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Zones · {zoneSummary.length}
                      </p>
                      <p className="mt-1 text-xs text-slate-300">{zoneSummary.join(' • ')}</p>
                    </div>
                    <div className="mt-3 flex">
                      <button
                        type="button"
                        onClick={() => setInfoTab('team')}
                        className={`pb-2 pr-4 text-xs font-semibold uppercase tracking-wider transition-colors ${
                          infoTab === 'team'
                            ? 'border-b-2 border-blue-400 text-white'
                            : 'text-slate-600 hover:text-slate-400'
                        }`}
                      >
                        Team · {selected.employees.length}
                      </button>
                      {selected.sops.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setInfoTab('workflows')}
                          className={`px-4 pb-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                            infoTab === 'workflows'
                              ? 'border-b-2 border-blue-400 text-white'
                              : 'text-slate-600 hover:text-slate-400'
                          }`}
                        >
                          Workflows · {selected.sops.length}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3">
                {isCreateYourOwn ? (
                  <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
                    <div className="text-emerald-400">{meta.iconLg}</div>
                    <p className="text-sm text-slate-400">{meta.tagline}</p>
                    <div className="w-full space-y-2">
                      {meta.capabilities.map((capability) => (
                        <div
                          key={capability}
                          className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                          <span className="text-xs text-slate-300">{capability}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : infoTab === 'team' || selected.sops.length === 0 ? (
                  <div className="space-y-1.5">
                    {selected.employees.map((employee, index) => (
                      <div
                        key={employee.name}
                        style={{ animation: `wiz-card-in 0.4s ease-out ${index * 50}ms both` }}
                      >
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
              className="flex min-w-0 flex-1 items-center justify-center p-4"
              key={`fp-${selected.id}`}
              style={{ animation: 'wiz-fade-in 0.4s ease-out' }}
            >
              <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.01] p-2">
                {isCreateYourOwn ? (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Wrench className="h-12 w-12 text-emerald-400/40" />
                    <p className="text-sm text-slate-500">
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
            <p className="text-sm text-slate-700">Select a template above</p>
          </div>
        )}
      </div>

      <div className="relative z-10 border-t border-white/[0.06] bg-black/60 px-6 py-4 backdrop-blur-xl">
        {step === 'creating' ? (
          <BuildingAnimation />
        ) : (
          <div className="mx-auto flex max-w-3xl items-center gap-4">
            <div className="flex-1">
              <label
                htmlFor="company-name"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-500"
              >
                Company Name
              </label>
              <input
                id="company-name"
                type="text"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder="My AI Company"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm text-white transition-all placeholder:text-slate-700 focus:border-blue-500/40 focus:shadow-[0_0_16px_2px_rgba(59,130,246,0.1)] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                void handlePrimaryAction();
              }}
              disabled={
                !selectedTemplateId || (!isCreateYourOwn && !runtimeReady) || !companyName.trim()
              }
              className="mt-5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-8 py-3 text-sm font-semibold text-white transition-all hover:from-blue-500 hover:to-blue-400 disabled:cursor-not-allowed disabled:opacity-30"
              style={
                (isCreateYourOwn || runtimeReady) && selectedTemplateId
                  ? { animation: 'wiz-cta-pulse 3s ease-in-out infinite' }
                  : undefined
              }
            >
              {isCreateYourOwn ? (
                'Open Studio Editor'
              ) : !runtimeReady ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Initializing...
                </span>
              ) : (
                'Start Company'
              )}
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-center text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function BuildingAnimation() {
  return (
    <div
      className="flex flex-col items-center gap-3 py-2"
      style={{ animation: 'wiz-fade-in 0.5s ease-out' }}
    >
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
        <span
          className="text-sm font-medium text-white"
          style={{ animation: 'wiz-building-pulse 2s ease-in-out infinite' }}
        >
          Building your office...
        </span>
      </div>
      <p className="text-xs text-slate-500">Setting up employees, workflows, and office layout</p>
    </div>
  );
}

function EmployeeCard({ name, role }: { name: string; role: string }) {
  const [expanded, setExpanded] = useState(false);
  const avatarUri = useMemo(() => getAvatar(name, 64), [name]);
  const dotColor = ROLE_DOT[role] ?? '#64748b';
  const roleLabel = ROLE_LABELS[role] ?? role;
  const bio = EMPLOYEE_BIOS[name];

  const toggleExpand = useCallback(() => setExpanded((value) => !value), []);

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-all duration-200 hover:bg-white/[0.04]"
        onClick={toggleExpand}
      >
        <div className="relative shrink-0">
          <img src={avatarUri} alt="" className="h-11 w-11 rounded-full" />
          <div
            className="absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface"
            style={{ backgroundColor: dotColor }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-medium text-slate-200">{name}</div>
          <div className="mt-0.5 text-[13px]" style={{ color: dotColor }}>
            {roleLabel}
          </div>
          {bio && <div className="mt-0.5 truncate text-xs italic text-slate-500">{bio.bio}</div>}
        </div>
        <div className="shrink-0 text-slate-700">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </button>

      {expanded && bio && (
        <div
          className="border-t border-white/[0.04] px-3 pt-0 pb-3"
          style={{ animation: 'wiz-slide-up 0.25s ease-out' }}
        >
          <div className="mt-2 flex flex-wrap gap-1.5">
            {bio.expertise.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-white/[0.06] bg-white/[0.05] px-1.5 py-0.5 text-[11px] font-medium"
                style={{ color: dotColor }}
              >
                {tag}
              </span>
            ))}
            <span className="rounded-md border border-white/[0.04] bg-white/[0.03] px-1.5 py-0.5 text-[11px] text-slate-500">
              {bio.style}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">{bio.helpsWith}</p>
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
            <div className="my-2 flex w-[90%] items-center gap-2">
              <div className="h-px flex-1" style={{ backgroundColor: `${accentHex}15` }} />
              <span
                className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: `${accentHex}80` }}
              >
                Phase {sopIdx + 1}
              </span>
              <div className="h-px flex-1" style={{ backgroundColor: `${accentHex}15` }} />
            </div>
          )}
          {sops.length > 1 && sopIdx === 0 && (
            <div
              className="mb-2 text-[11px] font-medium uppercase tracking-wider"
              style={{ color: `${accentHex}80` }}
            >
              Phase 1
            </div>
          )}

          {sop.steps.map((step, idx) => {
            const stepColor = ROLE_DOT[step.role_slug] ?? '#64748b';
            const stepRole = ROLE_LABELS[step.role_slug] ?? step.role_slug;
            const isLastGlobal = sopIdx === sops.length - 1 && idx === sop.steps.length - 1;

            return (
              <div key={step.step_id} className="flex w-full flex-col items-center">
                <div
                  className="relative w-[90%] overflow-hidden rounded-lg border px-3 py-2"
                  style={{ borderColor: `${stepColor}20`, backgroundColor: `${stepColor}06` }}
                >
                  <div
                    className="absolute top-0 left-0 bottom-0 w-[3px]"
                    style={{ backgroundColor: stepColor }}
                  />
                  <div className="pl-2.5">
                    <div className="text-xs font-medium text-slate-200">{step.label}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
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
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth={1}
                    />
                    <path
                      d="M2 10l2 4 2-4"
                      fill="none"
                      stroke="rgba(255,255,255,0.2)"
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
