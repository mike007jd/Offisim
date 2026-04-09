import { Button } from '@offisim/ui-core';
import { ArrowLeft } from 'lucide-react';
import {
  type SettingsTab,
  SettingsWorkspaceSurface,
  useSettingsWorkspaceController,
} from './SettingsWorkspaceSurface';

interface SettingsPageProps {
  sessionState: {
    activeTab: SettingsTab;
  };
  onSessionStateChange: (
    updater: (prev: { activeTab: SettingsTab }) => { activeTab: SettingsTab },
  ) => void;
  onBack: () => void;
  onSave: Parameters<typeof useSettingsWorkspaceController>[0]['onSave'];
  onSaveSuccess?: () => void;
}

export function SettingsPage({
  sessionState,
  onSessionStateChange,
  onBack,
  onSave,
  onSaveSuccess,
}: SettingsPageProps) {
  const controller = useSettingsWorkspaceController({
    isActive: true,
    onDismiss: onBack,
    onSave,
    onSaveSuccess,
  });

  return (
    <SettingsWorkspaceSurface
      activeTab={sessionState.activeTab}
      onActiveTabChange={(activeTab) => onSessionStateChange((prev) => ({ ...prev, activeTab }))}
      controller={controller}
      dismissControl={
        <Button
          type="button"
          variant="ghost"
          onClick={controller.requestDismiss}
          className="h-11 rounded-2xl border border-white/10 bg-white/5 px-4 text-slate-300 transition hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      }
    />
  );
}
