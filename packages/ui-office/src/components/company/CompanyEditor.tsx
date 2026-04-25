import { useFocusTrap, useRegisterModal, useTopmostEscape } from '@offisim/ui-core';
import { ExternalLink, Save, X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { UseCompanyEditorReturn } from '../../hooks/useCompanyEditor';
import { useCompanyZones } from '../../hooks/useCompanyZones.js';
import { useOfficeLayout } from '../../hooks/useOfficeLayout.js';
import type { ZoneLayoutMap } from '../office/OfficeEditorOverlay.js';
import { PolicyEditor } from './PolicyEditor';
import { parseZoneLayoutMap } from './company-editor-layout';
import {
  FieldLabel,
  MetricCard,
  SurfaceCard,
  surfaceInputClassName,
  surfaceTextareaClassName,
} from './company-editor-primitives';

type Tab = 'general' | 'zones' | 'defaults';
const COMPANY_EDITOR_TABS: Array<[Tab, string]> = [
  ['general', 'Overview'],
  ['zones', 'Zone Layout'],
  ['defaults', 'Employee Defaults'],
];

interface CompanyEditorProps
  extends Pick<
    UseCompanyEditorReturn,
    | 'company'
    | 'policy'
    | 'isDirty'
    | 'isSaving'
    | 'isOpen'
    | 'updateCompanyName'
    | 'updateCompanyDescription'
    | 'updatePolicy'
    | 'save'
    | 'close'
  > {
  /** When provided, the Zones tab shows an "Open Office Editor" button. */
  onOpenOfficeEditor?: () => void;
}

export function CompanyEditor({
  company,
  policy,
  isDirty,
  isSaving,
  isOpen,
  updateCompanyName,
  updateCompanyDescription,
  updatePolicy,
  save,
  close,
  onOpenOfficeEditor,
}: CompanyEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const { activeLayout } = useOfficeLayout();
  const zoneLayoutMap = useMemo<ZoneLayoutMap>(
    () => parseZoneLayoutMap(activeLayout?.layout_json),
    [activeLayout?.layout_json],
  );

  const editorStackId = 'company-editor';
  useRegisterModal(isOpen ? editorStackId : null, 'overlay');

  const handleRequestClose = useCallback(() => {
    if (isSaving) return;
    // Dirty-state confirmation: keep the dialog open unless the user confirms.
    if (isDirty && !window.confirm('Discard unsaved company changes?')) return;
    close();
  }, [close, isDirty, isSaving]);

  useTopmostEscape(isOpen ? editorStackId : null, handleRequestClose, { enabled: isOpen });

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen);

  if (!isOpen) return null;

  async function handleSave() {
    await save();
    close();
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape handled by useTopmostEscape; backdrop click is a mouse affordance only
    // biome-ignore lint/a11y/useSemanticElements: <dialog> can't host this fixed full-screen overlay layout
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleRequestClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Company editor"
    >
      <div className="mx-auto mt-3 flex h-[calc(100vh-24px)] w-[min(1480px,calc(100vw-24px))] max-w-none flex-col overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top,#14203d_0%,#0b1121_42%,#040814_100%)] shadow-[0_30px_120px_rgba(0,0,0,0.52)]">
        <div className="border-b border-white/10 bg-slate-950/45 px-6 py-5 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.36em] text-cyan-300/80">
                Layout & Defaults
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                Studio Profile
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                Shape the company identity, open the zone layout workflow, and define the defaults
                that new employees inherit. This surface now matches the rest of the new workspace
                UI.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRequestClose}
              disabled={isSaving}
              className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
              aria-label="Close company editor"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <MetricCard
              label="Company"
              value={company?.name || 'Untitled company'}
              detail="Identity and description live here."
            />
            <MetricCard
              label="Zone Layout"
              value={`${Object.keys(zoneLayoutMap).length} mapped zones`}
              detail="Studio edits remain explicit and zone-first."
            />
            <MetricCard
              label="Status"
              value={isDirty ? 'Unsaved changes' : 'Synced'}
              detail="Changes apply to the active company profile."
            />
          </div>
        </div>

        <div className="border-b border-white/10 bg-slate-950/25 px-6 py-4">
          <div className="grid w-full gap-2 rounded-full border border-white/10 bg-white/[0.03] p-1 md:grid-cols-3">
            {COMPANY_EDITOR_TABS.map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  activeTab === tab
                    ? 'bg-cyan-400/15 text-cyan-100 ring-1 ring-cyan-300/30'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {activeTab === 'general' && (
            <div className="grid gap-6 xl:grid-cols-[320px,minmax(0,1fr)]">
              <SurfaceCard
                eyebrow="Identity"
                title={company?.name || 'Untitled company'}
                description="Naming, positioning, and defaults stay aligned with the active studio profile. Zone layout editing stays explicit — select a zone first, then enter its edit mode."
              >
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Active studio</p>
              </SurfaceCard>

              <SurfaceCard
                eyebrow="Overview"
                title="Company narrative"
                description="Set the visible identity for the company profile and keep the copy aligned with the workspace."
              >
                <div className="grid gap-4">
                  <div>
                    <FieldLabel htmlFor="company-name">Company name</FieldLabel>
                    <input
                      id="company-name"
                      type="text"
                      value={company?.name ?? ''}
                      onChange={(e) => updateCompanyName(e.target.value)}
                      placeholder="My AI Company"
                      className={surfaceInputClassName('placeholder:text-slate-500')}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="company-description">Description</FieldLabel>
                    <textarea
                      id="company-description"
                      rows={5}
                      value={company?.description ?? ''}
                      onChange={(e) => updateCompanyDescription(e.target.value)}
                      placeholder="Describe the operating style, audience, and outcome this company is here to produce."
                      className={surfaceTextareaClassName('placeholder:text-slate-500')}
                    />
                  </div>
                </div>
              </SurfaceCard>
            </div>
          )}

          {activeTab === 'zones' && (
            <ZoneSummaryTab
              zoneLayoutMap={zoneLayoutMap}
              onOpenOfficeEditor={onOpenOfficeEditor}
            />
          )}

          {activeTab === 'defaults' && (
            <SurfaceCard
              eyebrow="Defaults"
              title="Employee defaults"
              description="These values seed new employees. Existing employees keep their own model and token settings."
            >
              <PolicyEditor policy={policy} onChange={updatePolicy} />
            </SurfaceCard>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-white/10 bg-slate-950/35 px-6 py-4 backdrop-blur-xl">
          <button
            type="button"
            onClick={handleRequestClose}
            disabled={isSaving}
            className="inline-flex h-11 items-center rounded-2xl border border-white/10 px-4 text-sm text-slate-300 transition hover:bg-white/[0.05] hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!isDirty || isSaving}
            className="inline-flex h-11 items-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-5 text-sm font-medium text-cyan-50 transition hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save studio profile'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Zones Summary Tab ──────────────────────────────────────────────

interface ZoneSummaryTabProps {
  zoneLayoutMap: ZoneLayoutMap;
  onOpenOfficeEditor?: () => void;
}

function ZoneSummaryTab({ zoneLayoutMap, onOpenOfficeEditor }: ZoneSummaryTabProps) {
  const { zones } = useCompanyZones();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-100">Office Zones</p>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Zone layout is managed in the studio editor. Open it from here, then select a zone and
            explicitly enter its edit mode.
          </p>
        </div>
        {onOpenOfficeEditor && (
          <button
            type="button"
            onClick={onOpenOfficeEditor}
            className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-400/15 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/25"
          >
            <ExternalLink className="h-3 w-3" />
            Open Studio Layout
          </button>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {zones.map((zone) => {
          const props = zoneLayoutMap[zone.zoneId];
          const accentColor = props?.accentColor ?? zone.accentColor;
          const displayName = props?.displayName?.trim() || zone.label;
          const isEnabled = props?.enabled ?? true;
          const seats = props?.workstationCount ?? zone.deskSlots;

          return (
            <div
              key={zone.zoneId}
              className={`flex items-center gap-3 rounded-[22px] border px-4 py-4 ${
                isEnabled
                  ? 'border-white/10 bg-white/[0.04]'
                  : 'border-white/5 bg-slate-950/40 opacity-50'
              }`}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: accentColor }}
              />
              <div className="flex-1 min-w-0">
                <span className="block truncate text-sm font-medium text-slate-100">
                  {displayName}
                </span>
                <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {zone.archetype ?? zone.label}
                </span>
              </div>
              {seats > 0 && <span className="shrink-0 text-xs text-slate-400">{seats} seats</span>}
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] ${
                  isEnabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-500'
                }`}
              >
                {isEnabled ? 'On' : 'Off'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
