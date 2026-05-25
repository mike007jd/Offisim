import { useCompanyTemplates } from '@/data/queries.js';
import type { CompanyTemplate, TemplateEmployee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, Wrench } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { clearDiscardConfirm, showDiscardConfirm } from './DiscardConfirmToast.js';
import { TemplatePreview } from './TemplatePreview.js';
import { roleDot, roleLabel, templateZones } from './lifecycle-data.js';
import { CREATE_YOUR_OWN_TEMPLATE, EMPLOYEE_BIOS, TEMPLATE_META } from './wizard-data.js';

type CreateStep = 'ready' | 'creating' | 'opening-studio';

interface CompanyCreationWizardProps {
  /** Return to the portal (create-new mode). Guarded by the dirty check. */
  onDismiss: () => void;
  /** Fired after a real template build completes — hands the new company id up. */
  onComplete: (company: { id: string; name: string }) => void;
  /** Fired for the create-your-own → Studio handoff. */
  onOpenStudio: () => void;
}

function EmployeeCard({ template, employee }: { template: string; employee: TemplateEmployee }) {
  const [expanded, setExpanded] = useState(false);
  const bio = EMPLOYEE_BIOS[employee.name];
  const dot = roleDot(employee.role);
  return (
    <div className="off-wiz-emp">
      <button
        type="button"
        className="off-wiz-emp-trigger off-focusable"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="off-wiz-emp-av">
          <EmployeeAvatar
            seed={`${template}:${employee.name}`}
            appearance={employee.appearance}
            colorA={employee.appearance.clothingColor ?? '#3c4a60'}
            colorB={
              employee.appearance.accentColor ?? employee.appearance.clothingColor ?? '#1f2937'
            }
            size={40}
          />
          <span className="off-wiz-emp-st" style={{ background: dot }} />
        </span>
        <span className="off-wiz-emp-copy">
          <span className="off-wiz-emp-name">{employee.name}</span>
          <span className="off-wiz-emp-role" style={{ color: dot }}>
            {roleLabel(employee.role)}
          </span>
          {bio ? <span className="off-wiz-emp-bio">{bio.bio}</span> : null}
        </span>
        <Icon icon={expanded ? ChevronUp : ChevronDown} size="sm" className="off-wiz-emp-caret" />
      </button>
      {expanded && bio ? (
        <div className="off-wiz-emp-detail">
          <div className="off-wiz-emp-tags">
            {bio.expertise.map((tag) => (
              <span key={tag} className="off-wiz-tag" style={{ color: dot }}>
                {tag}
              </span>
            ))}
            <span className="off-wiz-tag is-neutral">{bio.style}</span>
          </div>
          <p>{bio.helpsWith}</p>
        </div>
      ) : null}
    </div>
  );
}

export function CompanyCreationWizard({
  onDismiss,
  onComplete,
  onOpenStudio,
}: CompanyCreationWizardProps) {
  const templatesQuery = useCompanyTemplates();

  const templates = useMemo<CompanyTemplate[]>(
    () => [...(templatesQuery.data ?? []), CREATE_YOUR_OWN_TEMPLATE],
    [templatesQuery.data],
  );

  const [index, setIndex] = useState(0);
  const [companyName, setCompanyName] = useState('');
  const [description, setDescription] = useState('');
  const [step, setStep] = useState<CreateStep>('ready');

  const safeIndex = templates.length ? Math.min(index, templates.length - 1) : 0;
  const selected = templates[safeIndex] ?? null;
  const meta = selected ? TEMPLATE_META[selected.id] : null;
  const isCustom = selected?.id === 'create-your-own';
  const zones = selected ? templateZones(selected.id) : [];

  // Dirty = name typed OR template moved off the default (index 0).
  const isDirty = companyName.trim().length > 0 || description.trim().length > 0 || safeIndex !== 0;
  const busy = step !== 'ready';

  function attemptDismiss() {
    if (busy) return;
    if (!isDirty) {
      onDismiss();
      return;
    }
    // Dirty: arm (or re-arm) the discard guard. Esc while it is already armed
    // replaces the single instance rather than force-closing the wizard.
    showDiscardConfirm({
      detail: 'esc · close attempt while name or template is dirty',
      onDiscard: onDismiss,
    });
  }

  // Esc routes through the dirty guard. Re-binds when the guard inputs change so
  // the handler always reads the current dirty/busy state.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      if (!isDirty) {
        onDismiss();
        return;
      }
      showDiscardConfirm({
        detail: 'esc · close attempt while name or template is dirty',
        onDiscard: onDismiss,
      });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDirty, busy, onDismiss]);

  // Always clear any armed discard toast when the wizard unmounts.
  useEffect(() => () => clearDiscardConfirm(), []);

  function move(delta: number) {
    if (busy || templates.length === 0) return;
    setIndex((i) => {
      const next =
        (Math.min(i, templates.length - 1) + delta + templates.length) % templates.length;
      return next;
    });
  }

  function start() {
    if (!selected) return;
    if (isCustom) {
      setStep('opening-studio');
      window.setTimeout(() => {
        clearDiscardConfirm();
        onOpenStudio();
      }, 700);
      return;
    }
    if (!companyName.trim()) return;
    setStep('creating');
    const name = companyName.trim();
    window.setTimeout(() => {
      clearDiscardConfirm();
      onComplete({ id: `co-new-${Date.now().toString(36)}`, name });
    }, 1400);
  }

  const primaryDisabled = !selected || (!isCustom && !companyName.trim());

  let ctaLabel = 'Start Company';
  if (isCustom) ctaLabel = step === 'opening-studio' ? 'Opening Studio…' : 'Open Studio Editor';
  else if (step === 'creating') ctaLabel = 'Initializing…';

  return (
    <motion.div
      className="off-wiz"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
    >
      <div className="off-wiz-body">
        <div className="off-wiz-info">
          <div className="off-wiz-info-h">
            <div className="off-wiz-carousel">
              <div className="off-wiz-carousel-row">
                <button
                  type="button"
                  className="off-wiz-nav off-focusable"
                  aria-label="Previous template"
                  disabled={busy}
                  onClick={() => move(-1)}
                >
                  <Icon icon={ChevronLeft} size="md" />
                </button>
                <div className="off-wiz-carousel-ctr">
                  <span className="off-wiz-carousel-ic" style={{ color: meta?.accentHex }}>
                    <Icon icon={meta?.icon ?? Wrench} size="md" />
                  </span>
                  <span className="off-wiz-carousel-nm">{selected?.name}</span>
                </div>
                <button
                  type="button"
                  className="off-wiz-nav off-focusable"
                  aria-label="Next template"
                  disabled={busy}
                  onClick={() => move(1)}
                >
                  <Icon icon={ChevronRight} size="md" />
                </button>
              </div>
              <div className="off-wiz-dots" role="tablist" aria-label="Template pager">
                {templates.map((t, i) => {
                  const active = i === safeIndex;
                  const m = TEMPLATE_META[t.id];
                  return (
                    <button
                      type="button"
                      key={t.id}
                      role="tab"
                      aria-selected={active}
                      aria-label={t.name}
                      className={cn('off-wiz-dot off-focusable', active && 'is-active')}
                      style={active ? { background: m?.accentHex ?? '#3b82f6' } : undefined}
                      disabled={busy}
                      onClick={() => setIndex(i)}
                    />
                  );
                })}
              </div>
            </div>

            <div className="off-wiz-zonebox">
              <div className="off-wiz-zonebox-l">Zones · {zones.length}</div>
              <div className="off-wiz-zonebox-v">{zones.join(' • ')}</div>
            </div>

            {!isCustom && selected ? (
              <div className="off-wiz-tabs">
                <span className="off-wiz-tab is-on">Team · {selected.employees.length}</span>
              </div>
            ) : null}
          </div>

          <div className="off-wiz-info-b">
            {isCustom ? (
              <div className="off-wiz-cyo">
                <span className="off-wiz-cyo-ic">
                  <Icon icon={Wrench} size="md" />
                </span>
                <p>Design your office from scratch in the 3D Studio editor.</p>
                <div className="off-wiz-cyo-caps">
                  {(meta?.capabilities ?? []).map((c) => (
                    <span key={c} className="off-wiz-cyo-cap">
                      <span className="off-wiz-cyo-dot" />
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            ) : selected ? (
              selected.employees.map((e) => (
                <EmployeeCard key={e.name} template={selected.id} employee={e} />
              ))
            ) : null}
          </div>
        </div>

        <div className="off-wiz-stage">
          <div className="off-wiz-stage-frame">
            {isCustom ? (
              <div className="off-wiz-studio-empty">
                <Icon icon={Wrench} size="md" />
                <p>Your custom office will be designed in the 3D Studio editor.</p>
              </div>
            ) : selected ? (
              <TemplatePreview template={selected} accentHex={meta?.accentHex ?? '#4d82ff'} />
            ) : null}
          </div>
        </div>
      </div>

      <div className="off-wiz-foot">
        {step === 'creating' ? (
          <div className="off-wiz-building">
            <div className="off-wiz-building-ln">
              <Loader2 className="off-wiz-spin" size={18} />
              Building your office…
            </div>
            <div className="off-wiz-building-sub">
              Setting up employees, zones, and office layout
            </div>
          </div>
        ) : (
          <div className="off-wiz-foot-in">
            <button
              type="button"
              className="off-wiz-back off-focusable"
              disabled={busy}
              onClick={attemptDismiss}
            >
              <Icon icon={ChevronLeft} size="sm" />
              Back
            </button>
            {!isCustom ? (
              <div className="off-wiz-fields">
                <div className="off-wiz-name">
                  <label htmlFor="off-wiz-name">Company Name</label>
                  <input
                    id="off-wiz-name"
                    placeholder="My AI Company"
                    value={companyName}
                    disabled={busy}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </div>
                <div className="off-wiz-desc">
                  <label htmlFor="off-wiz-desc">Description</label>
                  <textarea
                    id="off-wiz-desc"
                    rows={2}
                    placeholder="What does this company do? (optional)"
                    value={description}
                    disabled={busy}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="off-wiz-fields off-wiz-fields-custom" />
            )}
            <button
              type="button"
              className={cn(
                'off-wiz-cta off-focusable',
                isCustom && 'is-cyo',
                !primaryDisabled && !busy && 'is-pulse',
              )}
              disabled={primaryDisabled || busy}
              onClick={start}
            >
              {step === 'opening-studio' ? <Loader2 className="off-wiz-spin" size={16} /> : null}
              {ctaLabel}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
