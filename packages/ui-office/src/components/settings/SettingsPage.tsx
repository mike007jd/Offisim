import { cn } from '@offisim/ui-core';
import { useEffect, useRef } from 'react';
import { useLayoutTier } from '../../hooks/use-layout-tier.js';
import { useSidebarCollapse } from '../../lib/sidebar-collapse-store.js';
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
  onEditExternalEmployee?: (employeeId: string) => void;
}

export function SettingsPage({
  sessionState,
  onSessionStateChange,
  onBack,
  onSave,
  onSaveSuccess,
  onToast,
  onEditExternalEmployee,
}: SettingsPageProps) {
  const { tier } = useLayoutTier();
  const [navCollapse, setNavCollapse] = useSidebarCollapse('settings');
  const navCollapsed = tier !== 'narrow' && navCollapse === 'collapsed';
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
    <div
      className={cn(
        'flex h-full bg-surface text-text-primary',
        tier === 'narrow' ? 'flex-col' : 'flex-row',
      )}
      data-layout-tier={tier}
    >
      <SettingsTabNav
        activeTab={sessionState.activeTab}
        orientation={tier === 'narrow' ? 'horizontal' : 'vertical'}
        collapsed={navCollapsed}
        onToggleCollapse={
          tier === 'narrow'
            ? undefined
            : () => setNavCollapse(navCollapse === 'collapsed' ? 'expanded' : 'collapsed')
        }
        onTabChange={(tab) => onSessionStateChange((prev) => ({ ...prev, activeTab: tab }))}
      />
      <SettingsContentArea
        activeTab={sessionState.activeTab}
        controller={controller}
        onEditExternalEmployee={onEditExternalEmployee}
      />
    </div>
  );
}
