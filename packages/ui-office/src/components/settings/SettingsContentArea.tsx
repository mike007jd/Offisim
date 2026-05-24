import { Button, ErrorState } from '@offisim/ui-core';
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

const SETTINGS_CONTENT_META: Record<SettingsTab, { title: string; description: string }> = {
  provider: {
    title: 'Provider',
    description:
      'The model vendor every employee uses. Product, access mode, and execution lane decide which route and tools are available.',
  },
  runtime: {
    title: 'Runtime',
    description:
      'Execution policy for harness behavior, memory, summarization, and tool discovery across employee runs.',
  },
  mcp: {
    title: 'MCP',
    description: 'Local and remote tool servers available to Offisim runtime profiles.',
  },
  external: {
    title: 'External Employees',
    description: 'Imported workers and hosted agents connected to this workspace.',
  },
};

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
  const meta = SETTINGS_CONTENT_META[activeTab];

  return (
    <div className="settings-content">
      <div
        data-testid="settings-content-scroll"
        className="settings-content-scroll"
        data-savebar={showSaveBar ? 'visible' : 'hidden'}
      >
        <div className="settings-content-pane">
          <header className="settings-content-head">
            <h2>{meta.title}</h2>
            <p>{meta.description}</p>
          </header>
          {saveError && (
            <ErrorState
              variant="banner"
              title="Settings update failed"
              message={saveError}
              primaryAction={{ label: 'Retry', onClick: () => void handleSave() }}
              className="settings-content-error"
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
        <div className="settings-savebar">
          <div className="settings-savebar-inner">
            <Button
              type="button"
              variant={buttonDisabled ? 'outline' : 'default'}
              onClick={() => void handleSave()}
              disabled={buttonDisabled}
              title={tooltip}
              className="settings-savebar-button"
            >
              {buttonLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
