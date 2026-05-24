import { Button, cn } from '@offisim/ui-core';
import type { LucideIcon } from 'lucide-react';
import { Bot, Cpu, Plug, Users } from 'lucide-react';
import type { SettingsTab } from './SettingsWorkspaceSurface';

const SETTINGS_TABS: Array<{ key: SettingsTab; label: string; icon: LucideIcon }> = [
  { key: 'provider', label: 'Provider', icon: Bot },
  { key: 'runtime', label: 'Runtime', icon: Cpu },
  { key: 'mcp', label: 'MCP', icon: Plug },
  { key: 'external', label: 'External Employees', icon: Users },
];

interface SettingsTabNavProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  orientation?: 'vertical' | 'horizontal';
}

export function SettingsTabNav({
  activeTab,
  onTabChange,
  orientation = 'vertical',
}: SettingsTabNavProps) {
  const horizontal = orientation === 'horizontal';
  return (
    <nav className="settings-tab-nav" data-orientation={orientation} aria-orientation={orientation}>
      {!horizontal ? <span className="settings-tab-nav-caption">Settings</span> : null}
      {SETTINGS_TABS.map(({ key, label, icon: Icon }) => {
        const isActive = activeTab === key;
        return (
          <Button
            key={key}
            type="button"
            variant="ghost"
            onClick={() => onTabChange(key)}
            className={cn('settings-tab-nav-item', isActive && 'settings-tab-nav-item-active')}
          >
            <Icon data-icon="settings-tab" />
            {label}
          </Button>
        );
      })}
    </nav>
  );
}
