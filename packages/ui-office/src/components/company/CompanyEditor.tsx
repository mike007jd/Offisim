import { useState } from 'react';
import { ZoneEditor } from './ZoneEditor';
import { PolicyEditor } from './PolicyEditor';
import type { UseCompanyEditorReturn } from '../../hooks/useCompanyEditor';

type Tab = 'general' | 'zones' | 'defaults';

interface CompanyEditorProps
  extends Pick<
    UseCompanyEditorReturn,
    | 'company'
    | 'zones'
    | 'policy'
    | 'isDirty'
    | 'isSaving'
    | 'isOpen'
    | 'updateCompanyName'
    | 'updateCompanyDescription'
    | 'updateZones'
    | 'updatePolicy'
    | 'save'
    | 'close'
  > {}

export function CompanyEditor({
  company,
  zones,
  policy,
  isDirty,
  isSaving,
  isOpen,
  updateCompanyName,
  updateCompanyDescription,
  updateZones,
  updatePolicy,
  save,
  close,
}: CompanyEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>('general');

  if (!isOpen) return null;

  async function handleSave() {
    await save();
    close();
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {/* Panel */}
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
                <label
                  htmlFor="company-name"
                  className="block text-sm text-gray-300 mb-1"
                >
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
                <label
                  htmlFor="company-description"
                  className="block text-sm text-gray-300 mb-1"
                >
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
            <ZoneEditor zones={zones} onChange={updateZones} />
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
