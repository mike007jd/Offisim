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
    <div className="flex min-h-0 flex-1 flex-col bg-surface text-text-primary">
      <div
        data-testid="settings-content-scroll"
        className={`flex-1 overflow-y-auto p-5 sm:p-6 ${showSaveBar ? 'pb-24' : 'pb-6'}`}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-sp-5">
          <header className="flex flex-col gap-1">
            <h2 className="text-fs-lg font-semibold text-ink-1">{meta.title}</h2>
            <p className="max-w-2xl text-fs-sm leading-relaxed text-ink-3">{meta.description}</p>
          </header>
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
        <div className="shrink-0 border-t border-line-soft bg-surface-1 px-6 py-3 shadow-overlay sm:px-8 sm:py-4">
          <div className="mx-auto w-full max-w-3xl">
            <Button
              type="button"
              variant={buttonDisabled ? 'outline' : 'default'}
              onClick={() => void handleSave()}
              disabled={buttonDisabled}
              title={tooltip}
              className="h-11 w-full rounded-lg text-sm font-medium"
            >
              {buttonLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
