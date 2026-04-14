import { useEffect, useRef } from 'react';
import { SettingsContentArea } from './SettingsContentArea';
import { SettingsTabNav } from './SettingsTabNav';
import { type SettingsTab, useSettingsWorkspaceController } from './SettingsWorkspaceSurface';

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
  onToast?: Parameters<typeof useSettingsWorkspaceController>[0]['onToast'];
}

export function SettingsPage({
  sessionState,
  onSessionStateChange,
  onBack,
  onSave,
  onSaveSuccess,
  onToast,
}: SettingsPageProps) {
  const controller = useSettingsWorkspaceController({
    isActive: true,
    onDismiss: onBack,
    onSave,
    onSaveSuccess,
    onToast,
  });

  // Keep latest requestDismiss in a ref so the keydown listener never re-registers.
  const dismissRef = useRef(controller.requestDismiss);
  useEffect(() => {
    dismissRef.current = controller.requestDismiss;
  });

  // Capture-phase Escape handler — intercepts before App.tsx's bubble-phase
  // handler so unsaved-changes confirmation fires instead of direct navigation.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dismissRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  return (
    <div className="flex h-full">
      <SettingsTabNav
        activeTab={sessionState.activeTab}
        onTabChange={(tab) => onSessionStateChange((prev) => ({ ...prev, activeTab: tab }))}
      />
      <SettingsContentArea activeTab={sessionState.activeTab} controller={controller} />
    </div>
  );
}
