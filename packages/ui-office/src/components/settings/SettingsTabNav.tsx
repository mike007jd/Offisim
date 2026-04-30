import type { LucideIcon } from 'lucide-react';
import { Bot, ChevronLeft, ChevronRight, Cpu, Plug, Users } from 'lucide-react';
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
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function SettingsTabNav({
  activeTab,
  onTabChange,
  orientation = 'vertical',
  collapsed = false,
  onToggleCollapse,
}: SettingsTabNavProps) {
  const horizontal = orientation === 'horizontal';
  const verticalCollapsed = !horizontal && collapsed;
  return (
    <nav
      className={
        horizontal
          ? 'flex w-full flex-shrink-0 gap-1 overflow-x-auto border-b border-white/10 bg-slate-950/60 p-2'
          : verticalCollapsed
            ? 'w-12 flex-shrink-0 border-r border-white/10 bg-slate-950/60 py-3'
            : 'w-56 flex-shrink-0 border-r border-white/10 bg-slate-950/60 py-6'
      }
      aria-orientation={orientation}
    >
      {!horizontal && onToggleCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white"
          aria-label={
            verticalCollapsed ? 'Expand settings navigation' : 'Collapse settings navigation'
          }
          title={verticalCollapsed ? 'Expand settings navigation' : 'Collapse settings navigation'}
        >
          {verticalCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      )}
      {SETTINGS_TABS.map(({ key, label, icon: Icon }) => {
        const isActive = activeTab === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onTabChange(key)}
            className={`flex h-12 items-center gap-3 text-sm transition-colors ${
              horizontal
                ? 'min-w-max rounded-lg border px-3'
                : verticalCollapsed
                  ? 'mx-auto w-10 justify-center rounded-md border'
                  : 'w-full border-l-[4px] px-5'
            } ${
              isActive
                ? 'border-cyan-400 bg-white/[0.06] text-white'
                : 'border-transparent text-slate-400 hover:bg-white/[0.03] hover:text-slate-200'
            }`}
          >
            <Icon className="h-4 w-4" />
            {!verticalCollapsed && label}
          </button>
        );
      })}
    </nav>
  );
}
