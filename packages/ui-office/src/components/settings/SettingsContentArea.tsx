import { ErrorState } from '@offisim/ui-core';
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
    <div className="flex min-h-0 flex-1 flex-col bg-surface text-text-primary">
      <div
        data-testid="settings-content-scroll"
        className={`flex-1 overflow-y-auto p-5 sm:p-6 ${showSaveBar ? 'pb-24' : 'pb-6'}`}
      >
        <div className="mx-auto w-full max-w-5xl">
          {saveError && (
            <ErrorState
              variant="banner"
              title="Settings update failed"
              message={saveError}
              primaryAction={{ label: 'Retry', onClick: () => void handleSave() }}
              className="mb-4"
            />
          )}
          {activeTab === 'provider' && <SettingsProviderTab controller={controller} />}
          {activeTab === 'runtime' && <SettingsRuntimeTab controller={controller} />}
          {activeTab === 'mcp' && <McpConfigPanel />}
          {activeTab === 'external' && (
            <SettingsExternalTab onEditEmployee={onEditExternalEmployee} />
          )}
        </div>
      </div>

      {showSaveBar && (
        <div className="shrink-0 border-t border-border-default bg-surface-elevated px-6 py-3 shadow-overlay sm:px-8 sm:py-4">
          <div className="mx-auto w-full max-w-5xl">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={buttonDisabled}
              title={tooltip}
              className={`h-11 w-full rounded-lg text-sm font-medium transition-colors ${
                buttonDisabled
                  ? 'cursor-not-allowed border border-border-default bg-surface-muted text-text-muted'
                  : 'bg-accent text-text-inverse hover:bg-accent-hover'
              }`}
            >
              {buttonLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
