import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { useCompanyTemplates } from '@/data/queries.js';
import type { CompanyTemplate, TemplateEmployee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Tabs, TabsList, TabsTrigger } from '@/design-system/primitives/tabs.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { cn } from '@/lib/utils.js';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, Wrench } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { clearDiscardConfirm, showDiscardConfirm } from './DiscardConfirmToast.js';
import { TemplatePreview } from './TemplatePreview.js';
import { roleDot, roleLabel, templateZones } from './lifecycle-data.js';
import { CREATE_YOUR_OWN_TEMPLATE, EMPLOYEE_BIOS, TEMPLATE_META } from './wizard-data.js';

type CreateStep = 'ready' | 'creating' | 'opening-studio';

function roleAccentStyle(color: string): CSSProperties {
  return { '--off-wiz-role-accent': color } as CSSProperties;
}

export interface CreateCompanyRequest {
  name: string;
  description: string | null;
  template: CompanyTemplate;
  openStudio: boolean;
}

interface CompanyCreationWizardProps {
  /** Return to the portal (create-new mode). Guarded by the dirty check. */
  onDismiss: () => void;
  /** Fired after a real repository-backed company build completes. */
  onComplete: (request: CreateCompanyRequest) => Promise<void>;
  /**
   * Whether the wizard can be closed. False on the cold-start front door (no
   * companies exist yet) — there is nowhere to dismiss to, so the Back/Esc
   * affordances are hidden. Defaults to true.
   */
  dismissible?: boolean;
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
            colorA={employee.appearance.clothingColor ?? UI_DATA_COLORS.ink3}
            colorB={
              employee.appearance.accentColor ?? employee.appearance.clothingColor ?? UI_DATA_COLORS.ink2
            }
            size={40}
          />
          <span className="off-wiz-emp-st" style={roleAccentStyle(dot)} />
        </span>
        <span className="off-wiz-emp-copy">
          <span className="off-wiz-emp-name">{employee.name}</span>
          <span className="off-wiz-emp-role" style={roleAccentStyle(dot)}>
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
              <span key={tag} className="off-wiz-tag" style={roleAccentStyle(dot)}>
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
  dismissible = true,
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
  const [createError, setCreateError] = useState<string | null>(null);

  const safeIndex = templates.length ? Math.min(index, templates.length - 1) : 0;
  const selected = templates[safeIndex] ?? null;
  const meta = selected ? TEMPLATE_META[selected.id] : null;
  const isCustom = selected?.id === 'create-your-own';
  const zones = selected ? templateZones(selected.id) : [];

  // Dirty = name typed OR template moved off the default (index 0).
  const isDirty = companyName.trim().length > 0 || description.trim().length > 0 || safeIndex !== 0;
  const busy = step !== 'ready';

  function attemptDismiss() {
    if (busy || !dismissible) return;
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
      if (event.key !== 'Escape' || busy || !dismissible) return;
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
  }, [isDirty, busy, dismissible, onDismiss]);

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

  async function start() {
    if (!selected) return;
    if (!companyName.trim()) return;
    setCreateError(null);
    setStep(isCustom ? 'opening-studio' : 'creating');
    const name = companyName.trim();
    try {
      await onComplete({
        name,
        description: description.trim() || null,
        template: selected,
        openStudio: isCustom,
      });
      clearDiscardConfirm();
    } catch (error) {
      setStep('ready');
      setCreateError(error instanceof Error ? error.message : 'Company creation failed');
    }
  }

  const primaryDisabled = !selected || !companyName.trim();

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
                  <span
                    className="off-wiz-carousel-ic"
                    style={roleAccentStyle(meta?.accentHex ?? UI_DATA_COLORS.ink3)}
                  >
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
              <Tabs value={String(safeIndex)} onValueChange={(value) => setIndex(Number(value))}>
                <TabsList className="off-wiz-dots" aria-label="Template pager">
                  {templates.map((t, i) => {
                    const active = i === safeIndex;
                    const m = TEMPLATE_META[t.id];
                    return (
                      <TabsTrigger
                        key={t.id}
                        value={String(i)}
                        aria-label={t.name}
                        className={cn('off-wiz-dot off-focusable', active && 'is-active')}
                        style={active ? { background: m?.accentHex ?? UI_DATA_COLORS.blue2 } : undefined}
                        disabled={busy}
                      />
                    );
                  })}
                </TabsList>
              </Tabs>
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
              <TemplatePreview template={selected} accentHex={meta?.accentHex ?? UI_DATA_COLORS.blue3} />
            ) : null}
          </div>
        </div>
      </div>

      <div className="off-wiz-foot">
        {busy ? (
          <div className="off-wiz-building">
            <div className="off-wiz-building-ln">
              <Loader2 className="off-wiz-spin" size={18} />
              {isCustom ? 'Preparing Studio workspace…' : 'Building your office…'}
            </div>
            <div className="off-wiz-building-sub">
              {isCustom
                ? 'Creating a real company record before Studio opens'
                : 'Setting up employees, zones, and office layout'}
            </div>
          </div>
        ) : (
          <div className="off-wiz-foot-in">
            {dismissible ? (
              <button
                type="button"
                className="off-wiz-back off-focusable"
                disabled={busy}
                onClick={attemptDismiss}
              >
                <Icon icon={ChevronLeft} size="sm" />
                Back
              </button>
            ) : null}
            <div className={cn('off-wiz-fields', isCustom && 'off-wiz-fields-custom')}>
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
                <Textarea
                  id="off-wiz-desc"
                  rows={2}
                  placeholder="What does this company do? (optional)"
                  value={description}
                  disabled={busy}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              {createError ? <div className="off-wiz-error">{createError}</div> : null}
            </div>
            <button
              type="button"
              className={cn(
                'off-wiz-cta off-focusable',
                isCustom && 'is-cyo',
                !primaryDisabled && !busy && 'is-pulse',
              )}
              disabled={primaryDisabled || busy}
              onClick={() => void start()}
            >
              {ctaLabel}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
