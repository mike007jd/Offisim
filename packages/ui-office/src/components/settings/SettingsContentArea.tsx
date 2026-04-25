import { McpConfigPanel } from './McpConfigPanel';
import { SettingsExternalTab } from './SettingsExternalTab';
import { SettingsProviderTab } from './SettingsProviderTab';
import { SettingsRuntimeTab } from './SettingsRuntimeTab';
import type { SettingsTab } from './SettingsWorkspaceSurface';
import type { useSettingsWorkspaceController } from './SettingsWorkspaceSurface';

interface SettingsContentAreaProps {
  activeTab: SettingsTab;
  controller: ReturnType<typeof useSettingsWorkspaceController>;
  onEditExternalEmployee?: (employeeId: string) => void;
}

export function SettingsContentArea({
  activeTab,
  controller,
  onEditExternalEmployee,
}: SettingsContentAreaProps) {
  const { handleSave, hasUnsavedChanges, isSaveDisabled, isSaving, saveError } = controller;
  const showSaveBar = activeTab !== 'external';

  const saveDisabledReason = !hasUnsavedChanges
    ? 'No changes to save'
    : isSaving
      ? 'Saving…'
      : isSaveDisabled
        ? 'Resolve validation issues before saving'
        : null;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className={`flex-1 overflow-y-auto p-6 sm:p-8 ${showSaveBar ? 'pb-28' : 'pb-8'}`}>
        <div className="mx-auto w-full max-w-3xl">
          {activeTab === 'provider' && <SettingsProviderTab controller={controller} />}
          {activeTab === 'runtime' && <SettingsRuntimeTab controller={controller} />}
          {activeTab === 'mcp' && <McpConfigPanel />}
          {activeTab === 'external' && (
            <SettingsExternalTab onEditEmployee={onEditExternalEmployee} />
          )}
        </div>
      </div>

      {showSaveBar && (
        <div className="shrink-0 border-t border-white/10 bg-slate-950/80 px-6 py-3 backdrop-blur-sm sm:px-8 sm:py-4">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaveDisabled || !hasUnsavedChanges}
              title={saveDisabledReason ?? undefined}
              className={`h-11 rounded-lg text-sm font-medium transition-colors ${
                hasUnsavedChanges && !isSaveDisabled
                  ? 'bg-cyan-500 text-white hover:bg-cyan-400'
                  : 'cursor-not-allowed bg-white/10 text-slate-500 opacity-60'
              }`}
            >
              {isSaving ? 'Saving…' : 'Save settings'}
            </button>
            {saveDisabledReason && !hasUnsavedChanges && (
              <p className="text-center text-xs text-slate-500">{saveDisabledReason}</p>
            )}
            {saveError && <p className="text-center text-sm text-red-400">{saveError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
