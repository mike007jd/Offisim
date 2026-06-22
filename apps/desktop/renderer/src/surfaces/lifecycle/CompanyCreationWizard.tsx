import { UI_DATA_COLORS } from '@/data/color-palette.js';
import { useCompanyTemplates } from '@/data/queries.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Textarea } from '@/design-system/primitives/textarea.js';
import { cn } from '@/lib/utils.js';
import { ChevronDown, ChevronLeft, ChevronUp, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import { clearDiscardConfirm, showDiscardConfirm } from './DiscardConfirmToast.js';
import { CyoBlueprint, TemplatePreview } from './TemplatePreview.js';
import { CREATE_YOUR_OWN_TEMPLATE, type WizardEmployee, type WizardTemplate } from './template-view.js';

function roleAccentStyle(color: string): CSSProperties {
  return { '--off-wiz-role-accent': color } as CSSProperties;
}

/** Format a structured capability tag ('system-design') into a readable chip
 *  label ('System design'). */
function formatCapability(tag: string): string {
  const words = tag.split('-').filter(Boolean);
  const first = words[0];
  if (!first) return tag;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join(' ');
}

/** First sentence of the employee's working style — the collapsed one-liner. */
function firstSentence(text: string): string {
  const match = /^.*?[.!?](?:\s|$)/.exec(text.trim());
  return (match ? match[0] : text).trim();
}

export interface CreateCompanyRequest {
  name: string;
  description: string | null;
  /** createCompany only needs the template id + name. */
  template: { id: string; name: string };
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

function EmployeeCard({
  templateId,
  employee,
}: { templateId: string; employee: WizardEmployee }) {
  const [expanded, setExpanded] = useState(false);
  const accent = employee.appearance?.accentColor ?? UI_DATA_COLORS.blue2;
  const clothing = employee.appearance?.clothingColor ?? UI_DATA_COLORS.ink3;
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
            seed={`${templateId}:${employee.name}`}
            appearance={employee.appearance}
            colorA={clothing}
            colorB={accent}
            size={40}
          />
          <span className="off-wiz-emp-st" style={roleAccentStyle(accent)} />
        </span>
        <span className="off-wiz-emp-copy">
          <span className="off-wiz-emp-name">{employee.name}</span>
          <span className="off-wiz-emp-role" style={roleAccentStyle(accent)}>
            {employee.displayTitle}
          </span>
          <span className="off-wiz-emp-bio">{firstSentence(employee.workingStyle)}</span>
        </span>
        <Icon icon={expanded ? ChevronUp : ChevronDown} size="sm" className="off-wiz-emp-caret" />
      </button>
      {expanded ? (
        <div className="off-wiz-emp-detail">
          <div className="off-wiz-emp-tags">
            {employee.capabilities.map((tag) => (
              <span key={tag} className="off-wiz-tag" style={roleAccentStyle(accent)}>
                {formatCapability(tag)}
              </span>
            ))}
          </div>
          <p>{employee.expertise}</p>
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

  const templates = useMemo<WizardTemplate[]>(
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
  const isCustom = selected?.isCustom === true;

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
        template: { id: selected.id, name: selected.name },
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
          const active = i === safeIndex;
          return (
            <label
              key={t.id}
              className={cn(
                'off-wiz-card off-focusable',
                active && 'is-active',
                busy && 'is-disabled',
              )}
              style={active ? roleAccentStyle(t.accentHex) : undefined}
            >
              <input
                type="radio"
                name="off-company-template"
                className="off-wiz-card-radio"
                checked={active}
                disabled={busy}
                onChange={() => setIndex(i)}
              />
              <span className="off-wiz-card-ic" style={roleAccentStyle(t.accentHex)}>
                <Icon icon={t.icon} size="md" />
              </span>
              <span className="off-wiz-card-nm">{t.name}</span>
              <span className="off-wiz-card-meta">
                {t.isCustom ? 'Build in Studio' : `${t.employees.length} people`}
              </span>
            </label>
          );
        })}
      </div>

      <div className="off-wiz-body">
        <div className="off-wiz-stage">
          <div className="off-wiz-stage-frame">
            {isCustom && selected ? (
              <div className="off-wiz-cyo-stage">
                <CyoBlueprint />
                <div className="off-wiz-cyo-caps">
                  {selected.capabilities.map((c) => (
                    <span key={c} className="off-wiz-cyo-cap">
                      <span className="off-wiz-cyo-dot" />
                      {c}
                    </span>
                  ))}
                </div>
                <p className="off-wiz-cyo-note">Opens in Studio after you create it.</p>
              </div>
            ) : selected ? (
              <TemplatePreview template={selected} accentHex={selected.accentHex} />
            ) : null}
          </div>
        </div>

        <aside className="off-wiz-side">
          {isCustom ? (
            <div className="off-wiz-cyo">
              <p>Build your office in the Studio editor.</p>
            </div>
          ) : selected ? (
            <details className="off-wiz-team" open>
              <summary>Team · {selected.employees.length}</summary>
              <div className="off-wiz-team-list">
                {selected.employees.map((e) => (
                  <EmployeeCard key={e.key} templateId={selected.id} employee={e} />
                ))}
              </div>
            </details>
          ) : null}
        </aside>
      </div>

      <div className="off-wiz-foot">
        {/* Out-of-flow error anchored above the footer, CTA side — keeps the
            footer height stable (no whole-page jump when it appears). */}
        {createError ? (
          <div className="off-alert is-err off-wiz-error" role="alert">
            {createError}
          </div>
        ) : null}
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
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
              <div className="off-wiz-desc">
                <label htmlFor="off-wiz-desc">
                  Description <span className="off-wiz-opt">optional</span>
                </label>
                <Textarea
                  id="off-wiz-desc"
                  className="is-compact"
                  rows={2}
                  placeholder="What does this company do?"
                  value={description}
                  disabled={busy}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
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
