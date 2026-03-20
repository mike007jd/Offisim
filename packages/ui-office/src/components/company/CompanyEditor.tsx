import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { ZONES } from '../../lib/zone-config.js';
import { useOfficeLayout } from '../../hooks/useOfficeLayout.js';
import type { ZoneLayoutMap } from '../office/OfficeEditorOverlay.js';
import { PolicyEditor } from './PolicyEditor';
import type { UseCompanyEditorReturn } from '../../hooks/useCompanyEditor';

type Tab = 'general' | 'zones' | 'defaults';

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

  if (!isOpen) return null;

  async function handleSave() {
    await save();
    close();
  }

  // Parse current zone props from the active layout for the read-only summary
  let zoneLayoutMap: ZoneLayoutMap = {};
  try {
    if (activeLayout?.layout_json) {
      const parsed = JSON.parse(activeLayout.layout_json) as Record<string, unknown>;
      if (parsed.zoneProps && typeof parsed.zoneProps === 'object' && !Array.isArray(parsed.zoneProps)) {
        zoneLayoutMap = parsed.zoneProps as ZoneLayoutMap;
      }
    }
  } catch { /* use empty map */ }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="relative flex flex-col w-full max-w-xl rounded-lg border border-gray-700 bg-gray-900 shadow-xl max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-5 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-white">Company Settings</h2>
            {isDirty && (
              <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">
                Unsaved changes
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded p-1 text-gray-400 hover:text-white hover:bg-gray-700"
            aria-label="Close"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.22 3.22a.75.75 0 0 1 1.06 0L8 6.94l3.72-3.72a.75.75 0 1 1 1.06 1.06L9.06 8l3.72 3.72a.75.75 0 1 1-1.06 1.06L8 9.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L6.94 8 3.22 4.28a.75.75 0 0 1 0-1.06z" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700 px-5">
          {(['general', 'zones', 'defaults'] as Tab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={[
                'px-3 py-2.5 text-sm capitalize transition-colors',
                activeTab === tab
                  ? 'border-b-2 border-blue-500 text-blue-400 font-medium'
                  : 'text-gray-400 hover:text-gray-200',
              ].join(' ')}
            >
              {tab === 'defaults' ? 'New Employee Defaults' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
          {activeTab === 'general' && (
            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor="company-name" className="block text-sm text-gray-300 mb-1">
                  Company Name
                </label>
                <input
                  id="company-name"
                  type="text"
                  value={company?.name ?? ''}
                  onChange={(e) => updateCompanyName(e.target.value)}
                  placeholder="My AI Company"
                  className="w-full rounded bg-gray-800 border border-gray-600 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 placeholder-gray-500"
                />
              </div>
              <div>
                <label htmlFor="company-description" className="block text-sm text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  id="company-description"
                  rows={3}
                  value={company?.description ?? ''}
                  onChange={(e) => updateCompanyDescription(e.target.value)}
                  placeholder="A short description of your company..."
                  className="w-full rounded bg-gray-800 border border-gray-600 px-3 py-1.5 text-sm text-white resize-none focus:outline-none focus:border-blue-500 placeholder-gray-500"
                />
              </div>
            </div>
          )}

          {activeTab === 'zones' && (
            <ZoneSummaryTab
              zoneLayoutMap={zoneLayoutMap}
              onOpenOfficeEditor={onOpenOfficeEditor}
            />
          )}

          {activeTab === 'defaults' && (
            <PolicyEditor policy={policy} onChange={updatePolicy} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-gray-700 px-5 py-3">
          <button
            type="button"
            onClick={close}
            disabled={isSaving}
            className="rounded px-4 py-1.5 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!isDirty || isSaving}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save'}
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
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-gray-300 font-medium">Office Zones</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Zone layout is managed in the Office Editor. Use the button to open it.
          </p>
        </div>
        {onOpenOfficeEditor && (
          <button
            type="button"
            onClick={onOpenOfficeEditor}
            className="shrink-0 flex items-center gap-1.5 rounded border border-blue-500/40 bg-blue-600/15 px-3 py-1.5 text-xs text-blue-400 hover:bg-blue-600/25 hover:text-blue-300 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Open Office Editor
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {ZONES.map((zone) => {
          const props = zoneLayoutMap[zone.id];
          const accentColor = props?.accentColor ?? zone.accent;
          const displayName = props?.displayName?.trim() || zone.label;
          const isEnabled = props?.enabled ?? true;
          const seats = props?.workstationCount ?? zone.deskSlots;

          return (
            <div
              key={zone.id}
              className={`flex items-center gap-3 rounded-md border px-3 py-2.5 ${
                isEnabled
                  ? 'border-gray-700 bg-gray-800'
                  : 'border-gray-800 bg-gray-900 opacity-50'
              }`}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: accentColor }}
              />
              <div className="flex-1 min-w-0">
                <span className="block truncate text-sm font-medium text-gray-200">
                  {displayName}
                </span>
                <span className="text-xs text-gray-500">{zone.spaceType}</span>
              </div>
              {seats > 0 && (
                <span className="shrink-0 text-xs text-gray-500">
                  {seats} seats
                </span>
              )}
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  isEnabled
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-gray-700/50 text-gray-500'
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
