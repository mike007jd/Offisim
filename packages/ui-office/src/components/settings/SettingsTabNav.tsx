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
          : 'flex w-60 flex-shrink-0 flex-col gap-px overflow-y-auto border-r border-line-soft bg-surface-1 px-2.5 py-6'
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
            className={`justify-start gap-2.5 text-sm font-medium ${
              horizontal ? 'h-9 min-w-max rounded-r-sm px-3' : 'h-8 w-full rounded-r-sm px-2.5'
            } ${
              isActive
                ? 'bg-accent-muted text-accent-text ring-1 ring-inset ring-accent-ring hover:bg-accent-muted'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
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
