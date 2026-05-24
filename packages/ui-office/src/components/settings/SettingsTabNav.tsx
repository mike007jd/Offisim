import { Button } from '@offisim/ui-core';
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
          ? 'flex w-full flex-shrink-0 gap-1 overflow-x-auto border-b border-line-soft bg-surface-1 p-2'
          : 'flex w-settings-nav flex-shrink-0 flex-col gap-px overflow-y-auto border-r border-line bg-surface-1 px-sp-4 py-sp-7'
      }
      aria-orientation={orientation}
    >
      {!horizontal ? (
        <span className="px-2.5 pb-3 text-fs-micro font-semibold uppercase tracking-ls-caps text-ink-3">
          Settings
        </span>
      ) : null}
      {SETTINGS_TABS.map(({ key, label, icon: Icon }) => {
        const isActive = activeTab === key;
        return (
          <Button
            key={key}
            type="button"
            variant="ghost"
            onClick={() => onTabChange(key)}
            className={`justify-start gap-2.5 text-fs-sm font-medium ${
              horizontal ? 'h-9 min-w-max rounded-r-sm px-3' : 'h-8 w-full rounded-r-sm px-2.5'
            } ${
              isActive
                ? 'bg-accent-surface text-accent ring-1 ring-inset ring-accent-ring hover:bg-accent-surface'
                : 'text-ink-3 hover:bg-surface-sunken hover:text-ink-1'
            }`}
          >
            <Icon className="size-4" />
            {label}
          </Button>
        );
      })}
    </nav>
  );
}
