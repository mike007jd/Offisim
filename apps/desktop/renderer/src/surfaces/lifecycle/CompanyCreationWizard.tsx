import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { useCompanyTemplates } from '@/data/queries.js';
import type { CompanyTemplate, TemplateEmployee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { cn } from '@/lib/utils.js';
import { ChevronDown, ChevronLeft, ChevronUp, Loader2, Wrench } from 'lucide-react';
import { motion } from 'motion/react';
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import { clearDiscardConfirm, showDiscardConfirm } from './DiscardConfirmToast.js';
import { TemplatePreview } from './TemplatePreview.js';
import { roleDot, roleLabel, templateZones } from './lifecycle-data.js';
import { CREATE_YOUR_OWN_TEMPLATE, EMPLOYEE_BIOS, TEMPLATE_META } from './wizard-data.js';

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
              employee.appearance.accentColor ??
              employee.appearance.clothingColor ??
              UI_DATA_COLORS.ink2
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
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const safeIndex = templates.length ? Math.min(index, templates.length - 1) : 0;
  const selected = templates[safeIndex] ?? null;
  const meta = selected ? TEMPLATE_META[selected.id] : null;
  const isCustom = selected?.id === 'create-your-own';
  const zones = selected ? templateZones(selected.id) : [];

  // Dirty = the user typed something (name or description). Browsing template
  // cards is not a draft — guarding it made Esc look broken (it armed a discard
  // toast instead of exiting), so template selection alone never blocks dismiss.
  const hasTypedContent = companyName.trim().length > 0 || description.trim().length > 0;

  // Close attempt (button or Esc) routes through one dirty guard: clean closes
  // immediately, dirty arms (or re-arms) the single discard confirm rather than
  // force-closing the wizard.
  const attemptDismiss = useCallback(() => {
    if (busy || !dismissible) return;
    if (!hasTypedContent) {
      onDismiss();
      return;
    }
    showDiscardConfirm({ onDiscard: onDismiss });
  }, [busy, dismissible, hasTypedContent, onDismiss]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || busy || !dismissible) return;
      event.preventDefault();
      attemptDismiss();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, dismissible, attemptDismiss]);

  // Always clear any armed discard toast when the wizard unmounts.
  useEffect(() => () => clearDiscardConfirm(), []);

  async function start() {
    if (!selected) return;
    if (!companyName.trim()) return;
    setCreateError(null);
    setBusy(true);
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
      setBusy(false);
      setCreateError(error instanceof Error ? error.message : 'Company creation failed');
    }
  }

  const primaryDisabled = !selected || !companyName.trim();

  // One verb for every path. The Studio route is a template choice (Create your
  // own), not a second primary action.
  const ctaLabel = busy ? 'Creating…' : 'Create company';

  return (
    <motion.div
      className="off-wiz"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
    >
      <div className="off-wiz-head">
        <div className="off-wiz-head-ttl">Create a company</div>
        <div className="off-wiz-head-sub">Pick a starting template, or build your own.</div>
      </div>

      {/* Scannable template track — every template + Create-your-own is visible
          and selectable at once (no carousel / pager dots). */}
      <div className="off-wiz-track" role="radiogroup" aria-label="Company template">
        {templates.map((t, i) => {
          const m = TEMPLATE_META[t.id];
          const active = i === safeIndex;
          const isCyo = t.id === 'create-your-own';
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={cn('off-wiz-card off-focusable', active && 'is-active')}
              style={active ? roleAccentStyle(m?.accentHex ?? UI_DATA_COLORS.blue2) : undefined}
              disabled={busy}
              onClick={() => setIndex(i)}
            >
              <span
                className="off-wiz-card-ic"
                style={roleAccentStyle(m?.accentHex ?? UI_DATA_COLORS.ink3)}
              >
                <Icon icon={m?.icon ?? Wrench} size="md" />
              </span>
              <span className="off-wiz-card-nm">{t.name}</span>
              <span className="off-wiz-card-meta">
                {isCyo ? 'Build in Studio' : `${t.employees.length} people`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="off-wiz-body">
        <div className="off-wiz-stage">
          <div className="off-wiz-stage-frame">
            {isCustom ? (
              <div className="off-wiz-studio-empty">
                <Icon icon={Wrench} size="md" />
                <p>Opens in Studio after you create it.</p>
              </div>
            ) : selected ? (
              <TemplatePreview
                template={selected}
                accentHex={meta?.accentHex ?? UI_DATA_COLORS.blue3}
              />
            ) : null}
          </div>
          {!isCustom && zones.length ? (
            <div className="off-wiz-zonechips">
              {zones.map((z) => (
                <span key={z} className="off-wiz-zonechip">
                  {z}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <aside className="off-wiz-side">
          {isCustom ? (
            <div className="off-wiz-cyo">
              <p>Build your office in the Studio editor.</p>
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
            <details className="off-wiz-team" open>
              <summary>Team · {selected.employees.length}</summary>
              <div className="off-wiz-team-list">
                {selected.employees.map((e) => (
                  <EmployeeCard key={e.name} template={selected.id} employee={e} />
                ))}
              </div>
            </details>
          ) : null}
        </aside>
      </div>

      <div className="off-wiz-foot">
        {busy ? (
          <div className="off-wiz-building">
            <Loader2 className="off-wiz-spin" size={18} />
            Creating company…
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
            <div className="off-wiz-fields">
              <div className="off-wiz-name">
                <label htmlFor="off-wiz-name">Company name</label>
                <input
                  id="off-wiz-name"
                  placeholder="My AI Company"
                  value={companyName}
                  disabled={busy}
                  maxLength={60}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
              <div className="off-wiz-desc">
                <label htmlFor="off-wiz-desc">
                  Description <span className="off-wiz-opt">optional</span>
                </label>
                <Textarea
                  id="off-wiz-desc"
                  rows={2}
                  placeholder="What does this company do?"
                  value={description}
                  disabled={busy}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              {createError ? <div className="off-wiz-error">{createError}</div> : null}
            </div>
            <button
              type="button"
              className="off-wiz-cta off-focusable"
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
