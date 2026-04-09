import { OpenClawSettings } from '../openclaw/OpenClawSettings';
import { McpConfigPanel } from './McpConfigPanel';
import { SettingsProviderTab } from './SettingsProviderTab';
import { SettingsRuntimeTab } from './SettingsRuntimeTab';
import type { SettingsTab } from './SettingsWorkspaceSurface';
import type { useSettingsWorkspaceController } from './SettingsWorkspaceSurface';

interface SettingsContentAreaProps {
  activeTab: SettingsTab;
  controller: ReturnType<typeof useSettingsWorkspaceController>;
}

export function SettingsContentArea({ activeTab, controller }: SettingsContentAreaProps) {
  const { handleSave, hasUnsavedChanges, isSaveDisabled, isSaving, saveError } = controller;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-8">
        {activeTab === 'provider' && <SettingsProviderTab controller={controller} />}
        {activeTab === 'runtime' && <SettingsRuntimeTab controller={controller} />}
        {activeTab === 'mcp' && <McpConfigPanel />}
        {activeTab === 'openclaw' && <OpenClawSettings />}
      </div>

      <div className="sticky bottom-0 border-t border-white/10 bg-slate-950/80 backdrop-blur-sm px-8 py-4">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaveDisabled || !hasUnsavedChanges}
          className={`w-full h-11 rounded-lg text-sm font-medium transition-colors ${
            hasUnsavedChanges
              ? 'bg-cyan-500 hover:bg-cyan-400 text-white'
              : 'opacity-50 cursor-not-allowed bg-white/10 text-slate-500'
          }`}
        >
          {isSaving ? 'Saving…' : 'Save settings'}
        </button>
        {saveError && <p className="mt-2 text-sm text-red-400">{saveError}</p>}
      </div>
    </div>
  );
}
