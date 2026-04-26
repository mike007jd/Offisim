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
  const {
    handleSave,
    hasUnsavedChanges,
    isReinitializing,
    isSaveDisabled,
    isSaving,
    saveError,
  } = controller;
  const showSaveBar = activeTab !== 'external';
  // controller.isSaving is already (save.isSaving || save.isReinitializing); isReinitializing is
  // exposed only so the hint line can call out the reinit phase distinctly.
  const buttonLabel = isSaving ? 'Saving…' : 'Save changes';

  let tooltip: string;
  if (saveError) {
    tooltip = 'Save failed — retry';
  } else if (isSaving) {
    tooltip = 'Saving changes';
  } else if (!hasUnsavedChanges) {
    tooltip = 'No changes to save';
  } else if (isSaveDisabled) {
    tooltip = 'Resolve validation issues before saving';
  } else {
    tooltip = 'Save provider + runtime changes';
  }

  const buttonDisabled = (isSaveDisabled || !hasUnsavedChanges) && !saveError;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div
        data-testid="settings-content-scroll"
        className={`flex-1 overflow-y-auto p-6 sm:p-8 ${showSaveBar ? 'pb-28' : 'pb-8'}`}
      >
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
              disabled={buttonDisabled}
              title={tooltip}
              className={`h-11 rounded-lg text-sm font-medium transition-colors ${
                buttonDisabled
                  ? 'cursor-not-allowed bg-white/10 text-slate-500 opacity-60'
                  : 'bg-cyan-500 text-white hover:bg-cyan-400'
              }`}
            >
              {buttonLabel}
            </button>
            {!hasUnsavedChanges && !saveError && !isSaving && (
              <p className="text-center text-xs text-slate-500">No changes to save</p>
            )}
            {isReinitializing && (
              <p className="text-center text-xs text-slate-400">Reinitializing runtime</p>
            )}
            {saveError && (
              <div className="flex flex-col items-center gap-1">
                <p className="text-center text-sm text-red-400">{saveError}</p>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  className="text-xs text-cyan-300 underline disabled:opacity-50"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
