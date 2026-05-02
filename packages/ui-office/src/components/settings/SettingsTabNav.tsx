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
    <nav
      className={
        horizontal
          ? 'flex w-full flex-shrink-0 gap-1 overflow-x-auto border-b border-border-default bg-surface-elevated p-2'
          : 'w-56 flex-shrink-0 border-r border-border-default bg-surface-elevated py-6'
      }
      aria-orientation={orientation}
    >
      {SETTINGS_TABS.map(({ key, label, icon: Icon }) => {
        const isActive = activeTab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            className={`flex h-12 items-center gap-3 text-sm transition-colors ${
              horizontal ? 'min-w-max rounded-lg border px-3' : 'w-full border-l-[4px] px-5'
            } ${
              isActive
                ? 'border-border-focus bg-accent-muted text-accent-text'
                : 'border-transparent text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
